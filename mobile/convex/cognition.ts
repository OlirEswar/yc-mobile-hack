/**
 * LLM cognition: the bounded, prioritised job queue that lets a model propose goals, plans and
 * lines of dialogue for colonists. The simulation enqueues jobs with enqueueCognition
 * (engine/core.ts) and never waits; drain claims a few jobs, calls the model outside any
 * transaction, validates the answer hard, and commits it through setPlan only if it still applies.
 * Every write to the world document goes through a Tx, so counters move with the world version.
 */
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { TICKS_PER_DAY } from '../shared/colony';
import { DEFAULT_LLM_CONFIG } from './lib/constants';
import { beginTx, commitTx, loadAgent, loadMind, setPlan, touch, touchMind } from './engine/core';
import type { AgentDoc, MindDoc, Tx } from './engine/core';
import { LANE_RANK, admits, charge, recordSpend, rollDay } from './cognition/budget';
import { loadJobContext } from './cognition/context';
import type { JobContext } from './cognition/context';
import { dialogueRequest, planRequest, speechRequest, thoughtRequest } from './cognition/prompt';
import { commitDialogue } from './storyteller/dialogue';
import { chat, providerConfig } from './cognition/provider';
import type { ChatResult, ProviderConfig } from './cognition/provider';
import { parseJson, validateDialogue, validatePlan, validateSpeech, validateThought } from './cognition/validate';
import { writeThought } from './storyteller/monologue';
import type { ValidGoal, ValidPlan } from './cognition/validate';

/** How far a mind's stateVersion may move after a job was queued before its answer is ignored. */
export const MAX_MIND_DRIFT = 1;
/** A plan answer arriving later than this is about a moment that has passed (3 sim hours). */
const PLAN_STALE_TICKS = 18;
const SPEECH_STALE_TICKS = 3;
/** A monologue line is about this moment; later than this it reads as a non sequitur. */
const THOUGHT_STALE_TICKS = 3;
/** A running job older than this lost its action; it is failed so its slot frees up. */
const RUNNING_TIMEOUT_MS = 90_000;
const QUEUE_SCAN = 60;
/** Consecutive failed calls before the LLM pauses, and the pause, doubling per further failure. */
export const FAILS_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
/** LLM goals lapse after two sim days unless restated. */
const GOAL_TTL_TICKS = 2 * TICKS_PER_DAY;
const MAX_GOALS = 8;

const goalV = v.object({ kind: v.string(), description: v.string(), priority: v.number(), targetAgentId: v.optional(v.id('agents')) });
const planV = v.object({
  intent: v.string(),
  steps: v.array(v.string()),
  labels: v.array(v.string()),
  goal: v.optional(goalV),
  speech: v.optional(v.string()),
  thought: v.optional(v.string()),
});

/** What one job did, for the trace and for debugPlan. Holds no secrets. */
export type JobReport = {
  jobId: Id<'cognitionJobs'>;
  outcome: string;
  promptChars?: number;
  approxPromptTokens?: number;
  prompt?: { system: string; user: string };
  raw?: string;
  dropped?: string[];
  plan?: ValidPlan;
  line?: string;
  thought?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
};

/**
 * Works through the queued cognition jobs of a world. Scheduled by enqueueCognition and by itself:
 * after a batch it runs once more, so jobs queued while every slot was busy are never stranded.
 */
export const drain = internalAction({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }): Promise<void> => {
    const config = providerConfig();
    const { jobIds, again } = await ctx.runMutation(internal.cognition.claim, { worldId, configured: config !== null });
    if (config) await Promise.all(jobIds.map((jobId) => runJob(ctx, config, jobId, true)));
    if (again) await ctx.scheduler.runAfter(0, internal.cognition.drain, { worldId });
  },
});

/**
 * Claims up to maxConcurrent - running queued jobs, focus before crisis before normal, then by
 * priority. Drops what can no longer run (dead agent, moved mind, too old, budget spent, LLM off)
 * so a stuck job never blocks an agent's next request, and keeps world.llm counters exact.
 */
export const claim = internalMutation({
  args: { worldId: v.id('worlds'), configured: v.boolean() },
  handler: async (ctx, { worldId, configured }): Promise<{ jobIds: Id<'cognitionJobs'>[]; again: boolean }> => {
    const world = await ctx.db.get(worldId);
    if (!world) return { jobIds: [], again: false };
    const tx = beginTx(ctx, world);
    const llm = tx.world.llm;
    const config = tx.world.config.llm;
    const before = JSON.stringify(llm);
    const now = Date.now();
    rollDay(llm, config, tx.tick);

    let live = 0;
    for (const job of await jobsIn(ctx, worldId, 'running')) {
      if ((job.startedAt ?? 0) > now - RUNNING_TIMEOUT_MS) live += 1;
      else await ctx.db.patch(job._id, { status: 'failed', outcome: 'timed out', finishedAt: now });
    }

    const queued = await jobsIn(ctx, worldId, 'queued');
    queued.sort((a, b) => (LANE_RANK[a.lane] ?? 9) - (LANE_RANK[b.lane] ?? 9) || b.priority - a.priority || a._creationTime - b._creationTime);
    const off = !llm.enabled ? 'llm disabled' : !configured ? 'no api key' : (llm.disabledUntil ?? 0) > now ? 'backing off' : null;
    const jobIds: Id<'cognitionJobs'>[] = [];
    let removed = 0;
    const end = async (job: Doc<'cognitionJobs'>, status: 'dropped' | 'stale', outcome: string) => {
      removed += 1;
      await ctx.db.patch(job._id, { status, outcome, finishedAt: now });
    };
    for (const job of queued) {
      if (off) {
        await end(job, 'dropped', off);
        continue;
      }
      const staleAfter = job.kind === 'speech' || job.kind === 'dialogue' ? SPEECH_STALE_TICKS : job.kind === 'thought' ? THOUGHT_STALE_TICKS : PLAN_STALE_TICKS;
      if (tx.tick - job.enqueuedTick > staleAfter) {
        await end(job, 'stale', 'waited too long');
        continue;
      }
      if (live + jobIds.length >= config.maxConcurrent) continue;
      const agent = await ctx.db.get(job.agentId);
      const mind = agent?.mindId ? await ctx.db.get(agent.mindId) : null;
      if (!agent?.alive || !mind) {
        await end(job, 'dropped', 'agent dead');
        continue;
      }
      if (job.kind === 'plan' && mind.stateVersion - job.mindVersion > MAX_MIND_DRIFT) {
        await end(job, 'stale', 'mind moved');
        continue;
      }
      if (!admits(llm, config, job.kind, job.lane, now)) {
        await end(job, 'dropped', job.kind === 'speech' ? 'speech allowance spent' : 'daily budget spent');
        continue;
      }
      charge(llm, job.kind, job.lane);
      await ctx.db.patch(job._id, { status: 'running', startedAt: now, attempts: job.attempts + 1 });
      jobIds.push(job._id);
      removed += 1;
    }
    const left = queued.length - removed;
    llm.queued = queued.length < QUEUE_SCAN ? left : Math.max(left, llm.queued - removed);
    llm.running = live + jobIds.length;
    if (JSON.stringify(llm) !== before) await commitTx(tx);
    return { jobIds, again: jobIds.length > 0 || removed >= QUEUE_SCAN };
  },
});

async function jobsIn(ctx: MutationCtx, worldId: Id<'worlds'>, status: 'queued' | 'running'): Promise<Doc<'cognitionJobs'>[]> {
  return await ctx.db
    .query('cognitionJobs')
    .withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', status))
    .order('desc')
    .take(QUEUE_SCAN);
}

/** The compact, perception-limited context of a job (see cognition/context.ts). */
export const context = internalQuery({
  args: { jobId: v.id('cognitionJobs') },
  handler: async (ctx, { jobId }): Promise<{ ok: true; context: JobContext; mindVersion: number } | { ok: false; reason: string }> => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false, reason: 'gone' };
    return await loadJobContext(ctx, job);
  },
});

/** Runs one claimed job: context, model call, validation, commit. Never throws. */
async function runJob(ctx: ActionCtx, config: ProviderConfig, jobId: Id<'cognitionJobs'>, commit: boolean): Promise<JobReport> {
  const loaded = await ctx.runQuery(internal.cognition.context, { jobId });
  const meta = { jobId, commit, provider: config.provider, model: config.model };
  if (!loaded.ok) {
    return { jobId, outcome: await ctx.runMutation(internal.cognition.finish, { ...meta, status: 'stale', reason: loaded.reason }) };
  }
  const c = loaded.context;
  const request = c.kind === 'dialogue' ? dialogueRequest(c) : c.kind === 'plan' ? planRequest(c) : c.kind === 'thought' ? thoughtRequest(c) : speechRequest(c);
  const promptChars = request.system.length + request.user.length;
  const report: JobReport = { jobId, outcome: '', promptChars, approxPromptTokens: Math.round(promptChars / 4), prompt: { system: request.system, user: request.user } };
  let result: ChatResult;
  try {
    result = await chat(config, request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    report.outcome = await ctx.runMutation(internal.cognition.finish, { ...meta, status: 'failed', reason, trace: { promptChars } });
    return report;
  }
  const usage = { tokensIn: result.tokensIn, tokensOut: result.tokensOut, latencyMs: result.latencyMs };
  Object.assign(report, usage, { raw: result.text });
  const parsed = parseJson(result.text);
  const trace = { promptChars, raw: result.text.slice(0, 2000) };
  if (c.kind === 'dialogue') {
    const checked = validateDialogue(parsed);
    report.outcome = await ctx.runMutation(internal.cognition.finish, {
      ...meta,
      usage,
      status: checked.ok ? 'done' : 'rejected',
      reason: checked.ok ? undefined : checked.reason,
      dialogue: checked.ok ? { dialogueId: c.dialogueId, lines: checked.lines, outcome: checked.outcome, summary: checked.summary } : undefined,
      trace,
    });
    return report;
  }
  if (c.kind === 'plan') {
    const checked = validatePlan(parsed, c);
    report.dropped = checked.dropped;
    if (checked.ok) report.plan = checked.plan;
    report.outcome = await ctx.runMutation(internal.cognition.finish, {
      ...meta,
      usage,
      status: checked.ok ? 'done' : 'rejected',
      reason: checked.ok ? undefined : checked.reason,
      plan: checked.ok ? checked.plan : undefined,
      trace: { ...trace, dropped: checked.dropped },
    });
    return report;
  }
  if (c.kind === 'thought') {
    const checked = validateThought(parsed);
    if (checked.ok) report.thought = checked.text;
    report.outcome = await ctx.runMutation(internal.cognition.finish, {
      ...meta,
      usage,
      status: checked.ok ? 'done' : 'rejected',
      reason: checked.ok ? undefined : checked.reason,
      thought: checked.ok ? { text: checked.text, mood: checked.mood } : undefined,
      trace,
    });
    return report;
  }
  const checked = validateSpeech(parsed);
  if (checked.ok) report.line = checked.line;
  report.outcome = await ctx.runMutation(internal.cognition.finish, {
    ...meta,
    usage,
    status: checked.ok ? 'done' : 'rejected',
    reason: checked.ok ? undefined : checked.reason,
    speech: checked.ok ? { line: checked.line, partnerId: c.partner.id } : undefined,
    trace,
  });
  return report;
}

/**
 * Records the end of a running job and, for a valid answer that still applies, commits it in the
 * same Tx: the plan through setPlan (source llm), the goal, the cooldown, and the speech line.
 * Plans from the focus and crisis lanes start now; normal ones start when the current step ends.
 * Returns the outcome, e.g. "done: committed" or "stale: mind moved".
 */
export const finish = internalMutation({
  args: {
    jobId: v.id('cognitionJobs'),
    status: v.union(v.literal('done'), v.literal('rejected'), v.literal('failed'), v.literal('stale')),
    reason: v.optional(v.string()),
    plan: v.optional(planV),
    speech: v.optional(v.object({ line: v.string(), partnerId: v.id('agents') })),
    thought: v.optional(v.object({ text: v.string(), mood: v.optional(v.string()) })),
    dialogue: v.optional(v.object({ dialogueId: v.id('dialogues'), lines: v.array(v.object({ speaker: v.string(), text: v.string() })), outcome: v.string(), summary: v.optional(v.string()) })),
    usage: v.optional(v.object({ tokensIn: v.number(), tokensOut: v.number(), latencyMs: v.number() })),
    provider: v.string(),
    model: v.string(),
    trace: v.optional(v.any()),
    /** False for a dry run: record everything but leave the agent alone. */
    commit: v.boolean(),
  },
  handler: async (ctx, a): Promise<string> => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.status !== 'running') return 'ignored: job not running';
    const world = await ctx.db.get(job.worldId);
    if (!world) return 'ignored: world gone';
    const tx = beginTx(ctx, world);
    const llm = tx.world.llm;
    llm.running = Math.max(0, llm.running - 1);
    llm.provider = a.provider;
    llm.model = a.model;
    if (a.usage) {
      llm.totalCalls += 1;
      llm.tokensIn += a.usage.tokensIn;
      llm.tokensOut += a.usage.tokensOut;
      recordSpend(llm, a.usage.tokensIn, a.usage.tokensOut, Date.now());
      llm.failStreak = 0;
      delete llm.disabledUntil;
    }

    let status: string = a.status;
    let outcome = a.reason ?? '';
    if (a.status === 'failed') await recordFailure(tx, outcome);
    else if (a.status === 'done' && !a.commit) outcome = 'dry run';
    else if (a.status === 'done') {
      const stale = a.dialogue ? await commitDialogue(tx, a.dialogue.dialogueId, a.dialogue) : a.plan ? await commitPlan(tx, job, a.plan) : a.thought ? await commitThought(tx, job, a.thought) : await commitSpeech(tx, job, a.speech!);
      status = stale ? 'stale' : 'done';
      outcome = stale ?? 'committed';
    }
    await ctx.db.patch(job._id, {
      status,
      outcome,
      finishedAt: Date.now(),
      latencyMs: a.usage?.latencyMs,
      tokensIn: a.usage?.tokensIn,
      tokensOut: a.usage?.tokensOut,
      trace: a.trace,
    });
    await commitTx(tx);
    return status + ': ' + outcome;
  },
});

/** Counts a failed call; after a few in a row, pauses the LLM with a doubling backoff. */
async function recordFailure(tx: Tx, reason: string): Promise<void> {
  const llm = tx.world.llm;
  llm.failStreak += 1;
  llm.lastError = reason.slice(0, 200);
  if (llm.failStreak < FAILS_BEFORE_BACKOFF) return;
  llm.disabledUntil = Date.now() + Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (llm.failStreak - FAILS_BEFORE_BACKOFF));
  const queued = await tx.ctx.db
    .query('cognitionJobs')
    .withIndex('by_world_status', (q) => q.eq('worldId', tx.world._id).eq('status', 'queued'))
    .take(QUEUE_SCAN);
  for (const job of queued) await tx.ctx.db.patch(job._id, { status: 'dropped', outcome: 'backing off', finishedAt: Date.now() });
  llm.queued = Math.max(0, llm.queued - queued.length);
}

/** Applies a validated plan if it still fits the agent. Returns why not, or null when committed. */
async function commitPlan(tx: Tx, job: Doc<'cognitionJobs'>, plan: ValidPlan): Promise<string | null> {
  const agent = await loadAgent(tx, job.agentId);
  if (!agent?.alive) return 'agent dead';
  const mind = await loadMind(tx, agent);
  if (!mind) return 'no mind';
  if (mind.stateVersion - job.mindVersion > MAX_MIND_DRIFT) return 'mind moved';
  const goalId = plan.goal ? await mergeGoal(tx, agent, mind, plan.goal, job) : undefined;
  await setPlan(tx, agent, {
    source: 'llm',
    trigger: job.trigger,
    intent: plan.intent,
    steps: plan.steps,
    labels: plan.labels,
    goalId,
    causeEventId: job.eventId,
    now: job.lane !== 'normal',
  });
  mind.llmCooldownUntilTick = tx.tick + (job.lane === 'orbit' ? (tx.world.config.llm.orbitCooldownTicks ?? DEFAULT_LLM_CONFIG.orbitCooldownTicks) : tx.world.config.llm.cooldownTicks);
  mind.lastLlmPlanTick = tx.tick;
  touchMind(tx, mind);
  // A plan that starts later would say its line at the wrong moment.
  if (plan.speech && job.lane !== 'normal') {
    agent.speech = plan.speech;
    touch(tx, agent);
  }
  if (plan.thought) await writeThought(tx, agent._id, plan.thought, 'llm');
  return null;
}

/** Adds a monologue line while its moment is still the agent's present. */
async function commitThought(tx: Tx, job: Doc<'cognitionJobs'>, thought: { text: string; mood?: string }): Promise<string | null> {
  const agent = await loadAgent(tx, job.agentId);
  if (!agent?.alive) return 'agent dead';
  await writeThought(tx, agent._id, thought.text, 'llm', thought.mood);
  return null;
}

/** Shows a line of dialogue if the agent is still in the interaction it was written for. */
async function commitSpeech(tx: Tx, job: Doc<'cognitionJobs'>, speech: { line: string; partnerId: Id<'agents'> }): Promise<string | null> {
  const agent = await loadAgent(tx, job.agentId);
  if (!agent?.alive) return 'agent dead';
  if (agent.interactingWithId !== speech.partnerId) return 'interaction over';
  agent.speech = speech.line;
  touch(tx, agent);
  return null;
}

/** The whitelisted predicate that lets the rules judge an LLM goal, where one fits the kind. */
function predicateFor(goal: ValidGoal, agent: AgentDoc): { predicate: string; targetQuantity?: number } {
  if (goal.kind === 'earn_wealth') return { predicate: 'credits_at_least', targetQuantity: Math.ceil((agent.inv.credits + 100) / 10) * 10 };
  if (goal.kind === 'improve_relationship') return { predicate: 'affinity_at_least', targetQuantity: 0.5 };
  if (goal.kind === 'protect_person') return { predicate: 'target_safe' };
  if (goal.kind === 'gain_influence') return { predicate: 'standing_at_least', targetQuantity: 6 };
  return { predicate: 'none' };
}

/** Restates an active goal of the same kind and target, or adds an LLM goal. Returns its id. */
async function mergeGoal(tx: Tx, agent: AgentDoc, mind: MindDoc, goal: ValidGoal, job: Doc<'cognitionJobs'>): Promise<string> {
  const same = mind.goals.find((g) => g.status === 'active' && g.kind === goal.kind && g.targetAgentId === goal.targetAgentId);
  if (same) {
    same.description = goal.description;
    same.priority = goal.priority;
    if (same.source === 'llm') same.expiresAtTick = tx.tick + GOAL_TTL_TICKS;
    return same.id;
  }
  const target = goal.targetAgentId ? await loadAgent(tx, goal.targetAgentId) : null;
  const id = 'g' + mind.nextGoalSeq;
  mind.nextGoalSeq += 1;
  mind.goals.push({
    id,
    kind: goal.kind,
    description: goal.description,
    priority: goal.priority,
    source: 'llm',
    status: 'active',
    ...(target ? { targetAgentId: target._id, targetAgentName: target.name } : {}),
    ...predicateFor(goal, agent),
    createdAtTick: tx.tick,
    expiresAtTick: tx.tick + GOAL_TTL_TICKS,
    ...(job.eventId ? { originEventId: job.eventId } : {}),
  });
  while (mind.goals.length > MAX_GOALS) {
    const finished = mind.goals.findIndex((g) => g.status !== 'active');
    const weakestLlm = mind.goals.reduce((best, g, i) => (g.source === 'llm' && g.id !== id && (best < 0 || g.priority < mind.goals[best].priority) ? i : best), -1);
    mind.goals.splice(finished >= 0 ? finished : weakestLlm >= 0 ? weakestLlm : 0, 1);
  }
  return id;
}

/** Inserts a focus-lane plan job that is already running, for debugPlan. Counts against the budget. */
export const debugJob = internalMutation({
  args: { agentId: v.id('agents'), trigger: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { agentId, trigger, detail }): Promise<Id<'cognitionJobs'>> => {
    const agent = await ctx.db.get(agentId);
    const mind = agent?.mindId ? await ctx.db.get(agent.mindId) : null;
    const world = agent ? await ctx.db.get(agent.worldId) : null;
    if (!agent || !mind || !world) throw new Error('agent not found');
    const tx = beginTx(ctx, world);
    rollDay(tx.world.llm, tx.world.config.llm, tx.tick);
    charge(tx.world.llm, 'plan', 'focus');
    tx.world.llm.running += 1;
    const jobId = await ctx.db.insert('cognitionJobs', {
      worldId: world._id,
      agentId,
      kind: 'plan',
      trigger,
      detail,
      priority: 1,
      status: 'running',
      lane: 'focus',
      enqueuedTick: world.tick,
      mindVersion: mind.stateVersion,
      attempts: 1,
      startedAt: Date.now(),
    });
    await commitTx(tx);
    return jobId;
  },
});

/**
 * Manual test: runs one plan job for an agent end to end and returns the prompt, its size, the raw
 * answer and the validation result. commit false records the job without touching the agent.
 * Run with: npx convex run cognition:debugPlan '{"agentId": "..."}'
 */
export const debugPlan = internalAction({
  args: { agentId: v.id('agents'), trigger: v.optional(v.string()), detail: v.optional(v.string()), commit: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<JobReport> => {
    const config = providerConfig();
    if (!config) throw new Error('LLM_API_KEY is not set on this deployment');
    const jobId = await ctx.runMutation(internal.cognition.debugJob, { agentId: args.agentId, trigger: args.trigger ?? 'A quiet moment to think things over', detail: args.detail });
    return await runJob(ctx, config, jobId, args.commit ?? true);
  },
});
