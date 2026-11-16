/**
 * Follow mode (docs/STORY_SPEC.md 5): the followed colonist's monologue, story hooks and storylines,
 * and the player's questions to any colonist. Asking never changes the world: answers are stored in
 * conversations, which the simulation never reads, and their LLM calls have their own allowance per
 * session instead of the colony's planning budget.
 */
import { recentDialogues } from './storyteller/dialogue';
import { buildRecap } from './storyteller/recap';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { beginTx, commitTx, dayOf, loadAgent, loadMind, replan } from './engine/core';
import { admits, dailyCapUsd, recordSpend, rollDay, spentToday } from './cognition/budget';
import { loadAskContext } from './cognition/context';
import type { AskContext } from './cognition/context';
import { askRequest } from './cognition/prompt';
import { chat, providerConfig } from './cognition/provider';
import { parseJson, validateAnswer } from './cognition/validate';
import { asAgentId, asWorldId, authorizeWorld, getSession } from './lib/auth';
import { RATE_LIMITS } from './lib/constants';
import { round2 } from './lib/rng';
import { POWERS } from './powers';
import { isFailure } from './powers/common';
import { queueThought, writeThought } from './storyteller/monologue';
import { plantRequest, reactionLine, readByRules, takesItUp, validateReading } from './storyteller/plant';
import type { Person, Reading } from './storyteller/plant';
import { storyHooks } from './storyteller/hooks';
import { isLive, liveStorylines, toStorylinePublic } from './storyteller/storylines';
import type { AskResult, AskTurn, FocusState, PlantResult, ThoughtLine } from '../shared/types';

const THOUGHTS_SHOWN = 20;
/** Least wall-clock gap between two questions from one session, and questions per sim day. */
export const ASK_GAP_MS = 3_000;
export const ASKS_PER_DAY = 60;
const MAX_QUESTION = 300;
/** Finished storylines stay in the follow view this long (a sim day). */
const RECENT_TICKS = 144;

/** Inner monologue, story hooks and storylines of the followed colonist. Reactive. */
export const state = query({
  args: { worldId: v.string(), agentId: v.string() },
  handler: async (ctx, args): Promise<FocusState | null> => {
    const worldId = asWorldId(ctx, args.worldId);
    const agentId = asAgentId(ctx, args.agentId);
    const world = worldId ? await ctx.db.get(worldId) : null;
    const agent = agentId ? await ctx.db.get(agentId) : null;
    if (!world || world.deleted || !agent || agent.worldId !== world._id) return null;
    const thoughts: ThoughtLine[] = (
      await ctx.db
        .query('thoughts')
        .withIndex('by_agent_tick', (q) => q.eq('agentId', agent._id))
        .order('desc')
        .take(THOUGHTS_SHOWN)
    ).map((t) => ({ id: t._id, tick: t.tick, text: t.text, mood: t.mood, source: t.source as ThoughtLine['source'] }));
    const live = await liveStorylines(ctx.db, world._id);
    const finished = [];
    for (const status of ['resolved', 'fizzled']) {
      finished.push(
        ...(await ctx.db
          .query('storylines')
          .withIndex('by_world_status', (q) => q.eq('worldId', world._id).eq('status', status))
          .order('desc')
          .take(10)),
      );
    }
    const theirs = [...live, ...finished.filter((s) => (s.resolvedTick ?? s.lastBeatTick) >= world.tick - RECENT_TICKS)].filter((s) => s.participantIds.includes(agent._id));
    return {
      agentId: agent._id,
      thoughts,
      hooks: agent.alive ? await storyHooks(ctx, world, agent, live) : [],
      storylines: theirs.sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.tension - a.tension).map(toStorylinePublic),
      warping: !!world.focusWarp && world.focusAgentId === agent._id,
      dialogue: await recentDialogues(ctx.db, agent._id),
      recap: buildRecap(agent, agent.mindId ? await ctx.db.get(agent.mindId) : null, theirs),
    };
  },
});

/** The player's questions to this colonist and their answers, oldest first. Reactive. */
export const conversation = query({
  args: { sessionToken: v.string(), agentId: v.string() },
  handler: async (ctx, args): Promise<AskTurn[]> => {
    const session = await getSession(ctx, args.sessionToken);
    const agentId = asAgentId(ctx, args.agentId);
    if (!session || !agentId) return [];
    const rows = await ctx.db
      .query('conversations')
      .withIndex('by_session_agent', (q) => q.eq('sessionId', session._id).eq('agentId', agentId))
      .take(200);
    return rows.map((r) => ({ id: r._id, tick: r.tick, question: r.question, answer: r.answer }));
  },
});

type Refusal = Extract<AskResult, { ok: false }>;
const refuse = (code: Refusal['code'], message: string): Refusal => ({ ok: false, code, message });

/** Checks a question and takes one from the session's allowance. */
export const beginAsk = internalMutation({
  args: { sessionToken: v.string(), worldId: v.string(), agentId: v.string(), question: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; sessionId: Id<'sessions'>; agentId: Id<'agents'>; question: string } | Refusal> => {
    const session = await getSession(ctx, args.sessionToken);
    if (!session || session.worldId !== args.worldId) return refuse('unauthorized', 'This session cannot ask in that world.');
    const world = await ctx.db.get(session.worldId);
    const agentId = asAgentId(ctx, args.agentId);
    const agent = agentId ? await ctx.db.get(agentId) : null;
    if (!world || world.deleted || !agent || agent.worldId !== world._id) return refuse('not_found', 'No such colonist.');
    if (!agent.alive) return refuse('dead', agent.name + ' is dead and can no longer answer.');
    const question = args.question.replace(/\s+/g, ' ').trim();
    if (question.length < 1 || question.length > MAX_QUESTION) return refuse('invalid', 'Ask in 1 to ' + MAX_QUESTION + ' characters.');
    const now = Date.now();
    const day = dayOf(world.tick);
    const used = session.ask && session.ask.day === day ? session.ask.count : 0;
    if (session.ask && now - session.ask.lastAt < ASK_GAP_MS) return refuse('rate_limited', 'Give them a moment to gather their thoughts.');
    if (used >= ASKS_PER_DAY) return refuse('rate_limited', 'They have heard enough voices for one day. Ask again tomorrow.');
    await ctx.db.patch(session._id, { ask: { lastAt: now, day, count: used + 1 } });
    return { ok: true, sessionId: session._id, agentId: agent._id, question };
  },
});

export const askContext = internalQuery({
  args: { agentId: v.id('agents'), sessionId: v.id('sessions'), question: v.string() },
  handler: async (ctx, { agentId, sessionId, question }): Promise<AskContext | null> => await loadAskContext(ctx, agentId, sessionId, question),
});

export const recordAsk = internalMutation({
  args: { sessionId: v.id('sessions'), agentId: v.id('agents'), question: v.string(), answer: v.string() },
  handler: async (ctx, a): Promise<AskTurn | null> => {
    const agent = await ctx.db.get(a.agentId);
    const world = agent ? await ctx.db.get(agent.worldId) : null;
    if (!agent || !world) return null;
    const id = await ctx.db.insert('conversations', { worldId: world._id, sessionId: a.sessionId, agentId: a.agentId, tick: world.tick, question: a.question, answer: a.answer });
    return { id, tick: world.tick, question: a.question, answer: a.answer };
  },
});

/** Ask a colonist a question. They answer in character from what they know; the world is untouched. */
export const ask = action({
  args: { sessionToken: v.string(), worldId: v.string(), agentId: v.string(), question: v.string() },
  handler: async (ctx, args): Promise<AskResult> => {
    const config = providerConfig();
    if (!config) return refuse('unavailable', 'The colonists cannot hear you right now.');
    const begun = await ctx.runMutation(internal.focus.beginAsk, args);
    if (!begun.ok) return begun;
    const context = await ctx.runQuery(internal.focus.askContext, { agentId: begun.agentId, sessionId: begun.sessionId, question: begun.question });
    if (!context) return refuse('not_found', 'No such colonist.');
    let answer: string | undefined;
    try {
      answer = validateAnswer(parseJson((await chat(config, askRequest(context))).text));
    } catch {
      return refuse('unavailable', context.name.split(' ')[0] + ' does not seem to hear you. Try again in a moment.');
    }
    if (!answer) return refuse('unavailable', context.name.split(' ')[0] + ' stays silent.');
    const turn = await ctx.runMutation(internal.focus.recordAsk, { sessionId: begun.sessionId, agentId: begun.agentId, question: begun.question, answer });
    return turn ? { ok: true, turn } : refuse('not_found', 'No such colonist.');
  },
});


const MIN_PLANT = 3;
const MAX_PLANT = 200;
const PEOPLE_LISTED = 120;

type PlantBegun = { ok: true; agentId: Id<'agents'>; text: string; useLlm: boolean; who: { name: string; voice?: string; want?: string }; people: Person[] };

/** Who may be named in a planted thought: the living colonists the target knows first, then everyone else. */
async function plantPeople(ctx: QueryCtx, agent: Doc<'agents'>): Promise<Person[]> {
  const ties = await ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', agent._id))
    .order('desc')
    .take(40);
  const all = (await ctx.db
    .query('agents')
    .withIndex('by_world_seq', (q) => q.eq('worldId', agent.worldId))
    .take(400)).filter((x) => x.alive && x._id !== agent._id);
  const known = new Set(ties.map((t) => t.toAgentId as string));
  return [...all.filter((x) => known.has(x._id)), ...all.filter((x) => !known.has(x._id))].map((x) => ({ id: x._id, name: x.name }));
}

/** Checks a planted thought (session, colonist, length, the powers' rate limit) without spending anything. */
export const beginPlant = internalMutation({
  args: { sessionToken: v.string(), worldId: v.string(), agentId: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<PlantBegun | PlantResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken, args.worldId);
    if (!auth) return { ok: false, message: 'This session cannot reach that world.' };
    const agentId = asAgentId(ctx, args.agentId);
    const agent = agentId ? await ctx.db.get(agentId) : null;
    if (!agent || agent.worldId !== auth.world._id) return { ok: false, message: 'No such colonist.' };
    if (!agent.alive) return { ok: false, message: agent.name.split(' ')[0] + ' is beyond any voice now. Their thoughts went quiet when they died.' };
    const text = args.text.replace(/\s+/g, ' ').trim();
    if (text.length < MIN_PLANT || text.length > MAX_PLANT) return { ok: false, message: 'A thought needs ' + MIN_PLANT + ' to ' + MAX_PLANT + ' characters.' };
    const now = Date.now();
    if (auth.session.powerTimes.filter((t) => now - t < RATE_LIMITS.powerWindowMs).length >= RATE_LIMITS.powersPerWindow) {
      return { ok: false, message: 'Too many voices at once. Let their head clear for a moment.' };
    }
    const mind = agent.mindId ? await ctx.db.get(agent.mindId) : null;
    const llm = auth.world.llm;
    const useLlm = llm.enabled && !((llm.disabledUntil ?? 0) > now) && spentToday(llm, now) < dailyCapUsd();
    return { ok: true, agentId: agent._id, text, useLlm, who: { name: agent.name, voice: mind?.persona?.voice, want: mind?.persona?.want }, people: (await plantPeople(ctx, agent)).slice(0, PEOPLE_LISTED) };
  },
});

/**
 * Applies a read thought in one Tx: the whisper power (intervention event, belief, goal, crisis
 * plan), the planted line in the monologue, a plan interrupt, and the reaction, an LLM thought job
 * when the LLM can take one, else a rules line. Counts as a power against the session's limit.
 */
export const applyPlant = internalMutation({
  args: {
    sessionToken: v.string(),
    worldId: v.string(),
    agentId: v.id('agents'),
    text: v.string(),
    reading: v.object({ presetKey: v.string(), kind: v.optional(v.string()), aboutId: v.optional(v.id('agents')), strength: v.number(), surfaced: v.string() }),
    usage: v.optional(v.object({ tokensIn: v.number(), tokensOut: v.number() })),
  },
  handler: async (ctx, args): Promise<PlantResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken, args.worldId);
    if (!auth) return { ok: false, message: 'This session cannot reach that world.' };
    const { session, world } = auth;
    const now = Date.now();
    const powerTimes = session.powerTimes.filter((t) => now - t < RATE_LIMITS.powerWindowMs);
    if (powerTimes.length >= RATE_LIMITS.powersPerWindow) return { ok: false, message: 'Too many voices at once. Let their head clear for a moment.' };
    const tx = beginTx(ctx, world);
    if (args.usage) recordSpend(tx.world.llm, args.usage.tokensIn, args.usage.tokensOut, now);
    const agent = await loadAgent(tx, args.agentId);
    if (!agent || !agent.alive) return { ok: false, message: 'Their thoughts went quiet before the idea could land.' };
    const reading: Reading = args.reading;
    rollDay(tx.world.llm, tx.world.config.llm, tx.tick);
    const thinks = providerConfig() !== null && tx.world.llm.enabled && !((tx.world.llm.disabledUntil ?? 0) > now) && admits(tx.world.llm, tx.world.config.llm, 'thought', 'focus', now);
    const accepted = thinks || takesItUp(agent, reading);
    const outcome = await POWERS.whisper(tx, {
      agentId: agent._id,
      presetKey: reading.presetKey,
      text: args.text,
      strength: accepted ? reading.strength : round2(reading.strength * 0.5),
      ...(reading.aboutId ? { aboutAgentId: reading.aboutId } : {}),
      ...(reading.kind ? { kind: reading.kind } : {}),
    });
    if (isFailure(outcome)) return { ok: false, message: outcome.message };
    replan(tx, agent, { now: true });
    await writeThought(tx, agent._id, reading.surfaced, 'planted');
    const mind = (await loadMind(tx, agent))!;
    if (thinks) {
      await queueThought(tx, agent, mind, {
        trigger: 'this thought just surfaced in their head out of nowhere: "' + reading.surfaced + '"',
        detail: 'React to it in your own words: does it ring true, and what will you do about it?',
        eventId: tx.eventIds[0],
      });
    } else {
      const about = reading.aboutId ? await loadAgent(tx, reading.aboutId) : null;
      await writeThought(tx, agent._id, reactionLine(agent, mind, reading, about?.name, accepted), 'rules');
    }
    await commitTx(tx);
    await ctx.db.patch(session._id, { powerTimes: [...powerTimes, now] });
    return { ok: true, message: reading.surfaced };
  },
});

/**
 * Plant a thought in a colonist's head from free text. The LLM reads it into the whisper machinery
 * (preset, suspicion kind, subject, strength) and words it as their own thought; without the LLM,
 * keywords and names do. It then lands as a whisper and the colonist reacts to it.
 */
export const plant = action({
  args: { sessionToken: v.string(), worldId: v.string(), agentId: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<PlantResult> => {
    const begun = await ctx.runMutation(internal.focus.beginPlant, args);
    if (!('agentId' in begun)) return begun;
    let reading: Reading | null = null;
    let usage: { tokensIn: number; tokensOut: number } | undefined;
    const config = providerConfig();
    if (config && begun.useLlm) {
      try {
        const result = await chat(config, plantRequest(begun.text, begun.who, begun.people));
        usage = { tokensIn: result.tokensIn, tokensOut: result.tokensOut };
        reading = validateReading(parseJson(result.text), begun.people);
      } catch {
        reading = null;
      }
    }
    reading ??= readByRules(begun.text, begun.people);
    return await ctx.runMutation(internal.focus.applyPlant, {
      sessionToken: args.sessionToken,
      worldId: args.worldId,
      agentId: begun.agentId,
      text: begun.text,
      reading: { presetKey: reading.presetKey, surfaced: reading.surfaced, strength: reading.strength, ...(reading.kind ? { kind: reading.kind } : {}), ...(reading.aboutId ? { aboutId: reading.aboutId } : {}) },
      ...(usage ? { usage } : {}),
    });
  },
});
