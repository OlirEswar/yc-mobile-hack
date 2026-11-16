/**
 * The followed colonist (world.focusAgentId) gets the director's attention every tick: every new
 * decision goes to the LLM in the focus lane, notable moments become monologue lines, routine
 * stretches fast-forward (world.focusWarp), and a quiet spell brings the story to them. Everything
 * here changes conditions through engine primitives; outcomes stay with the simulation.
 */
import type { Doc } from '../_generated/dataModel';
import { admits, rollDay } from '../cognition/budget';
import { providerConfig } from '../cognition/provider';
import { DEFAULT_LLM_CONFIG } from '../lib/constants';
import { STEP_SPECS, agentsAt, decodeStep, encodeStep, enqueueCognition, interrupt, loadAgent, loadMind, tiesOf, touchMind } from '../engine/core';
import type { AgentDoc, MindDoc, Tx } from '../engine/core';
import { cool, cooling, debtsTo } from '../engine/ledger';
import { inDialogue } from './dialogue';
import { orgsOf } from '../society/orgs';
import { queueThought, recentThoughts, ruleThought, writeThought } from './monologue';
import type { Moment } from './monologue';
import { describeStoryline, involvedIn } from './storylines';
import type { StorylineDoc } from './storylines';

/** Ticks left in a routine step (or walk) before it is worth skipping. */
const WARP_MIN_TICKS = 3;
/** Salience at which an event near them is something they notice. */
const NOTABLE = 0.4;
/** A fresh thought every 20 to 30 waking minutes; every two hours while the world fast-forwards. */
const IDLE_THOUGHT_TICKS = 2;
const WARP_THOUGHT_TICKS = 12;
/** The people around the followed colonist: at most this many, and "recently" means 3 hours. */
const ORBIT_MAX = 8;
const ORBIT_RECENT = 18;
/** Least time between two LLM speech lines for one colonist (30 minutes). */
const SPEECH_GAP = 3;
/** In-game time without a story beat before the director brings the story to them (50 minutes). */
const QUIET_TICKS = 2;
/** Least time between two nudges for the same colonist (an hour). */
const NUDGE_GAP = 3;

export async function spotlightTick(tx: Tx, live: StorylineDoc[], events: Doc<'events'>[]): Promise<void> {
  const a = tx.world.focusAgentId ? await loadAgent(tx, tx.world.focusAgentId) : null;
  const mind = a?.alive ? await loadMind(tx, a) : null;
  if (!a || !mind) {
    if (tx.world.focusWarp) tx.world.focusWarp = false;
    return;
  }
  const awake = a.activity !== 'sleeping';
  const near = events.filter(
    (e) => involvedIn(e).includes(a._id) || (awake && !a.move && e.locationId === a.locationId && e.visibility !== 'private' && e.salience >= NOTABLE),
  );
  const pending = await hasPendingJob(tx, a);
  const warp = await shouldWarp(tx, a, live, near, pending);
  const woke = !!tx.world.focusAsleep && awake;
  tx.world.focusAsleep = !awake;
  await narrate(tx, a, mind, live, near, pending, warp, woke);
  tx.world.focusWarp = warp && !(await hasPendingJob(tx, a));
  if (!tx.world.focusWarp && !pending) await nudge(tx, a, mind, live, near);
  tx.world.orbitIds = await orbitOf(tx, a, live);
  await speakInCharacter(tx, a);
}

/**
 * The people around the followed colonist, nearest first: whoever they are dealing with, whoever
 * they dealt with in the last few hours, the cast of their storylines, and whoever shares the room.
 * Their decisions go to the LLM's orbit lane (engine/planner.ts).
 */
async function orbitOf(tx: Tx, a: AgentDoc, live: StorylineDoc[]): Promise<AgentDoc['_id'][]> {
  const out: AgentDoc['_id'][] = [];
  const add = (id: AgentDoc['_id'] | undefined) => {
    if (id && id !== a._id && !out.includes(id) && out.length < ORBIT_MAX) out.push(id);
  };
  add(a.interactingWithId);
  for (const t of await tiesOf(tx, a._id)) if (t.toAlive && t.lastInteractionTick >= tx.tick - ORBIT_RECENT) add(t.toAgentId);
  for (const s of live) if (s.participantIds.includes(a._id)) for (const id of s.participantIds) add(id);
  if (!a.move) for (const id of await agentsAt(tx, a.locationId, { exclude: [a._id] })) add(id);
  return out;
}

/** Whoever is talking with the followed colonist, and the colonist themselves, say their lines in character. */
async function speakInCharacter(tx: Tx, a: AgentDoc): Promise<void> {
  const speakers: AgentDoc[] = [];
  for (const id of [a._id, ...(tx.world.orbitIds ?? [])]) {
    const p = await loadAgent(tx, id);
    if (p?.alive && p.interactingWithId && (p._id === a._id || p.interactingWithId === a._id)) speakers.push(p);
  }
  for (const p of speakers) {
    const mind = await loadMind(tx, p);
    if (!mind || cooling(mind, 'llm-speech', tx.tick) || (await inDialogue(tx, p._id))) continue;
    const queued = await enqueueCognition(tx, p, { kind: 'speech', trigger: p.activityLabel, priority: p._id === a._id ? 0.85 : 0.75, lane: p._id === a._id ? 'focus' : 'orbit' });
    if (!queued) continue;
    cool(tx, mind, 'llm-speech', SPEECH_GAP);
    touchMind(tx, mind);
  }
}

async function hasPendingJob(tx: Tx, a: AgentDoc): Promise<boolean> {
  for (const status of ['queued', 'running']) {
    const job = await tx.ctx.db
      .query('cognitionJobs')
      .withIndex('by_agent_status', (q) => q.eq('agentId', a._id).eq('status', status))
      .first();
    if (job) return true;
  }
  return false;
}

/** True when a focus-lane call can be made now: a key, the LLM on, and budget left. */
function llmReady(tx: Tx): boolean {
  const llm = tx.world.llm;
  rollDay(llm, DEFAULT_LLM_CONFIG, tx.tick);
  return providerConfig() !== null && llm.enabled && !((llm.disabledUntil ?? 0) > Date.now()) && admits(llm, DEFAULT_LLM_CONFIG, 'thought', 'focus');
}

const sleepsOnly = (steps: string[]): boolean => steps.every((s) => ['go', 'sleep'].includes(decodeStep(s)?.type ?? ''));

/** New decisions go to the LLM; notable moments and quiet stretches become monologue lines. */
async function narrate(tx: Tx, a: AgentDoc, mind: MindDoc, live: StorylineDoc[], near: Doc<'events'>[], pending: boolean, warp: boolean, woke: boolean): Promise<void> {
  const plan = mind.plan;
  const decided = !!plan && plan.createdAtTick === tx.tick && plan.source !== 'llm';
  const ready = llmReady(tx);
  if (decided && !pending && ready && !sleepsOnly(plan.steps)) {
    const theirs = live.filter((s) => s.participantIds.includes(a._id)).slice(0, 2);
    const queued = await enqueueCognition(tx, a, {
      kind: 'plan',
      trigger: 'followed by the player; habit alone would have them "' + plan.intent.replace(/\.$/, '') + '", but they decide from what is happening to them',
      detail: theirs.length > 0 ? 'On their mind: ' + theirs.map(describeStoryline).join(' ') : undefined,
      priority: 0.95,
      lane: 'focus',
    });
    if (queued) return;
  }
  if (pending) return;

  const recent = await recentThoughts(tx, a._id, 8);
  const since = recent[0] ? tx.tick - recent[0].tick : Infinity;
  const notable = near.filter((e) => e.salience >= NOTABLE).sort((x, y) => y.salience - x.salience)[0];
  let moment: Moment | null = null;
  if (woke) {
    const story = live.find((s) => s.participantIds.includes(a._id));
    const otherId = story?.participantIds.find((id) => id !== a._id);
    moment = { kind: 'wake', otherName: otherId ? (await loadAgent(tx, otherId))?.name : undefined };
  } else if (notable && since >= 1) {
    const otherId = involvedIn(notable).find((id) => id !== a._id);
    const other = otherId ? await loadAgent(tx, otherId) : null;
    moment = { kind: 'event', event: notable, otherName: other?.name };
  } else if (decided && since >= 1) {
    const step = plan.steps.map(decodeStep).find((s) => s && s.type !== 'go') ?? decodeStep(plan.steps[0]);
    const at = step ? (STEP_SPECS[step.type].args as readonly string[]).findIndex((n) => n === 'agentId' || n === 'target') : -1;
    const whoId = step && at >= 0 ? tx.ctx.db.normalizeId('agents', step.args[at] ?? '') : null;
    const who = whoId ? await loadAgent(tx, whoId) : null;
    moment = { kind: 'plan', label: plan.labels[0] ?? plan.intent, step: step?.type, place: step?.type === 'go' ? step.args[0] : undefined, otherName: who?.name };
  } else if (a.activity !== 'sleeping' && since >= (warp ? WARP_THOUGHT_TICKS : IDLE_THOUGHT_TICKS + (tx.tick % 2))) {
    const story = live.find((s) => s.participantIds.includes(a._id));
    const otherId = story?.participantIds.find((id) => id !== a._id);
    moment = { kind: 'idle', otherName: otherId ? (await loadAgent(tx, otherId))?.name : undefined };
  }
  if (!moment) return;
  if (ready) {
    const trigger =
      moment.kind === 'event'
        ? 'just witnessed or took part in: ' + moment.event.summary
        : moment.kind === 'plan'
          ? 'about to: ' + moment.label
          : moment.kind === 'wake'
            ? 'just woke up; the day ahead and what is waiting in it'
            : 'a quiet moment while ' + a.activityLabel.toLowerCase();
    await queueThought(tx, a, mind, { trigger, eventId: moment.kind === 'event' ? moment.event._id : undefined });
    return;
  }
  await writeThought(tx, a._id, ruleThought(tx, a, mind, moment, recent.map((t) => t.text)), 'rules');
}

/** Fast-forward while they sleep, work or walk through a long stretch and nothing story-relevant is near. */
async function shouldWarp(tx: Tx, a: AgentDoc, live: StorylineDoc[], near: Doc<'events'>[], pending: boolean): Promise<boolean> {
  // Only sleep is skipped: waking time stays continuous for the viewer.
  if (pending || a.move || a.activity !== 'sleeping' || near.some((e) => e.salience >= 0.35)) return false;
  const step = a.cur ? decodeStep(a.cur) : null;
  if (!step || step.type !== 'sleep' || a.busyUntilTick - tx.tick < WARP_MIN_TICKS) return false;
  const cast = new Set<string>(live.flatMap((s) => s.participantIds));
  cast.delete(a._id);
  const here = await agentsAt(tx, a.locationId, { exclude: [a._id] });
  return !here.some((id) => cast.has(id));
}

/**
 * After a quiet spell, sends someone from the story to them: a participant of their storylines, a
 * tie who is caught up in one, or the hottest storyline's cast. What the visitor does on arrival
 * follows from how they feel about the followed colonist. With nobody available, it asks the LLM
 * for a choice instead.
 */
async function nudge(tx: Tx, a: AgentDoc, mind: MindDoc, live: StorylineDoc[], near: Doc<'events'>[]): Promise<void> {
  if (near.length > 0 || a.activity === 'sleeping' || a.move) return;
  const last = tx.world.nudge?.agentId === a._id ? tx.world.nudge.tick : -Infinity;
  if (tx.tick - last < NUDGE_GAP) return;
  const memories = await tx.ctx.db
    .query('memories')
    .withIndex('by_agent_tick', (q) => q.eq('agentId', a._id))
    .order('desc')
    .take(8);
  const lastBeat = Math.max(last, ...memories.filter((m) => m.salience >= NOTABLE).map((m) => m.tick));
  if (tx.tick - lastBeat < QUIET_TICKS) return;

  const ties = await tiesOf(tx, a._id, 16);
  const storyOf = (id: string) => live.find((s) => s.participantIds.includes(id as AgentDoc['_id']));
  const candidates: { id: AgentDoc['_id']; story?: StorylineDoc }[] = [];
  for (const s of live.filter((s) => s.participantIds.includes(a._id))) for (const id of s.participantIds) candidates.push({ id, story: s });
  for (const t of ties) {
    if (Math.abs(t.affinity) >= 0.3 || Math.abs(t.obligation) >= 0.15 || t.fear >= 0.3) {
      const story = storyOf(t.toAgentId);
      if (story) candidates.push({ id: t.toAgentId, story });
    }
  }
  for (const s of live) for (const id of s.participantIds.slice(0, 3)) candidates.push({ id, story: s });
  for (const t of ties.slice(0, 6)) candidates.push({ id: t.toAgentId });

  const seen = new Set<string>([a._id]);
  for (const c of candidates) {
    if (seen.has(c.id) || seen.size > 12) continue;
    seen.add(c.id);
    const visitor = await loadAgent(tx, c.id);
    if (!visitor?.alive || visitor.activity === 'sleeping') continue;
    const verb = await visitStep(tx, visitor, a, c.story);
    interrupt(tx, visitor, visitor.locationId === a.locationId ? [verb] : [encodeStep('go', a.locationId), verb]);
    tx.world.nudge = { agentId: a._id, tick: tx.tick, visitorId: visitor._id };
    return;
  }
  const theirs = live.find((s) => s.participantIds.includes(a._id));
  const queued = await enqueueCognition(tx, a, {
    kind: 'plan',
    trigger: 'restless: nothing has happened to them for a while' + (mind.persona ? ', and ' + mind.persona.want.toLowerCase() + ' will not wait' : ''),
    detail: theirs ? 'On their mind: ' + describeStoryline(theirs) : undefined,
    priority: 0.9,
    lane: 'focus',
  });
  if (queued) tx.world.nudge = { agentId: a._id, tick: tx.tick };
}

/** What a visitor sent by the director does when they find the followed colonist. */
export async function visitStep(tx: Tx, visitor: AgentDoc, a: AgentDoc, story?: StorylineDoc): Promise<string> {
  const tie = (from: AgentDoc, to: AgentDoc) =>
    tx.ctx.db
      .query('relationships')
      .withIndex('by_from_to', (q) => q.eq('fromAgentId', from._id).eq('toAgentId', to._id))
      .first();
  const toward = await tie(visitor, a);
  if (debtsTo(await loadMind(tx, visitor), a._id).length > 0) return encodeStep('repay', a._id);
  const beliefs = await tx.ctx.db
    .query('beliefs')
    .withIndex('by_agent_key', (q) => q.eq('agentId', visitor._id))
    .take(30);
  if ((toward?.affinity ?? 0) <= -0.35) {
    const leverage = beliefs.find((b) => b.subjectAgentId === a._id && b.valence < 0 && b.confidence >= 0.5);
    return leverage && visitor.traits.empathy < 0.5 ? encodeStep('blackmail', a._id, leverage.key) : encodeStep('threaten', a._id);
  }
  if (toward?.kind === 'romance' || toward?.kind === 'partner') return encodeStep(['grieving', 'shaken', 'afraid'].includes(a.mood) ? 'comfort' : 'court', a._id);
  const vm = await loadMind(tx, visitor);
  const org = vm ? (await orgsOf(tx, vm)).find((o) => ['cult', 'gang', 'militia', 'party'].includes(o.kind) && !o.memberIds.includes(a._id)) : undefined;
  if (org && (toward?.affinity ?? 0) > -0.2 && (tx.tick + visitor.seq) % 3 === 0) return encodeStep('recruit', a._id, org._id);
  if ((toward?.affinity ?? 0) >= 0.45 && (toward?.trust ?? 0) >= 0.3) {
    return ['grieving', 'shaken', 'afraid', 'desperate'].includes(a.mood) ? encodeStep('comfort', a._id) : encodeStep('confide', a._id);
  }
  const cast = new Set<string>(story?.participantIds ?? []);
  const news = beliefs
    .filter((b) => b.confidence >= 0.4 && b.subjectAgentId !== a._id && (b.subjectAgentId ? cast.has(b.subjectAgentId) : b.kind !== 'custom'))
    .sort((x, y) => y.confidence - x.confidence)[0];
  return news ? encodeStep('talk', a._id, news.key) : encodeStep('talk', a._id);
}
