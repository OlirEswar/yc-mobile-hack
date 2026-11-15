/**
 * Follow mode (docs/STORY_SPEC.md 5): the followed colonist's monologue, story hooks and storylines,
 * and the player's questions to any colonist. Asking never changes the world: answers are stored in
 * conversations, which the simulation never reads, and their LLM calls have their own allowance per
 * session instead of the colony's planning budget.
 */
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { dayOf } from './engine/core';
import { loadAskContext } from './cognition/context';
import type { AskContext } from './cognition/context';
import { askRequest } from './cognition/prompt';
import { chat, providerConfig } from './cognition/provider';
import { parseJson, validateAnswer } from './cognition/validate';
import { asAgentId, asWorldId, getSession } from './lib/auth';
import { storyHooks } from './storyteller/hooks';
import { isLive, liveStorylines, toStorylinePublic } from './storyteller/storylines';
import type { AskResult, AskTurn, FocusState, ThoughtLine } from '../shared/types';

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
