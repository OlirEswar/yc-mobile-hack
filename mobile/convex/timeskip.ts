/**
 * The timeskip runner. world:timeskip starts a skip (convex/world.ts); from there a chain runs on
 * its own, one chapter at a time: an action asks the LLM what the stretch holds (when configured),
 * and one internal mutation plays the stretch out through the macro rules and commits it. A final
 * action and mutation write the chronicle, seed the storylines the world resumes with, and restart
 * the clock at the speed the player left it.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { chat, providerConfig } from './cognition/provider';
import type { ChatResult } from './cognition/provider';
import { dayOf } from './engine/core';
import { ensureLoop } from './engine/loop';
import { asWorldId } from './lib/auth';
import { liveStorylines } from './storyteller/storylines';
import type { TimeskipPublic, TimeskipSpan, TimeskipStartResult, TimeskipSummary } from '../shared/types';
import { applyEffect, validEffect } from './timeskip/effects';
import { CHAPTER_SCHEMA, chapterPrompt, parseEffects } from './timeskip/llm';
import { closeChapter, openChapter } from './timeskip/model';
import { runRules } from './timeskip/rules';
import { SPANS, TICKS_PER_YEAR, isSpan, progressOf } from './timeskip/spans';
import { seedStorylines } from './timeskip/stories';
import { SUMMARY_SCHEMA, gatherFacts, mergeLlm, rulesSummary, snapshot, summaryPrompt } from './timeskip/summary';

/** At most this many skips start per world per hour, and never two within a minute. */
const SKIPS_PER_HOUR = 6;
const SKIP_GAP_MS = 60_000;
/** Beats kept on the skip document; the weakest go first. */
const MAX_BEATS = 360;
const usageV = v.optional(v.object({ tokensIn: v.number(), tokensOut: v.number(), failed: v.boolean(), error: v.optional(v.string()) }));

// ---------- starting ----------

/** Starts a skip for an authorized world. Idempotent: while one runs, the same span returns it. */
export async function startTimeskip(ctx: MutationCtx, world: Doc<'worlds'>, session: Doc<'sessions'>, span: string): Promise<TimeskipStartResult> {
  if (!isSpan(span)) return { ok: false, code: 'invalid', message: 'Unknown span.' };
  if (world.timeskip) {
    const running = await ctx.db.get(world.timeskip.id);
    if (running && (running.status === 'running' || running.status === 'summarizing')) {
      return running.span === span ? { ok: true, timeskipId: running._id } : { ok: false, code: 'busy', message: 'The years are already turning. Wait for this skip to end.' };
    }
  }
  const now = Date.now();
  const recent = await ctx.db
    .query('timeskips')
    .withIndex('by_world', (q) => q.eq('worldId', world._id))
    .order('desc')
    .take(SKIPS_PER_HOUR);
  if (recent[0] && now - recent[0].createdAt < SKIP_GAP_MS) return { ok: false, code: 'rate_limited', message: 'Let the colony live a little before skipping again.' };
  if (recent.length >= SKIPS_PER_HOUR && now - recent[recent.length - 1].createdAt < 3_600_000) return { ok: false, code: 'rate_limited', message: 'Enough years for one hour. Watch them live for a while.' };
  const def = SPANS[span];
  const ticks = Math.round((def.days / 365) * TICKS_PER_YEAR);
  const timeskipId = await ctx.db.insert('timeskips', {
    worldId: world._id,
    sessionId: session._id,
    span,
    status: 'running',
    startTick: world.tick,
    endTick: world.tick + ticks,
    chapter: 0,
    chapters: def.chapters,
    chapterTicks: Math.ceil(ticks / def.chapters),
    resumeSpeed: world.speed > 0 ? world.speed : (world.timeskip?.resumeSpeed ?? 1),
    focusAgentId: session.focusAgentId ?? world.focusAgentId,
    createdAt: now,
    updatedAt: now,
    beats: [],
    stats: {},
    start: null,
    llm: { calls: 0, failures: 0, tokensIn: 0, tokensOut: 0 },
    newStorylineIds: [],
  });
  const paused = { ...world, speed: 0, timeskip: { id: timeskipId, resumeSpeed: world.speed > 0 ? world.speed : 1 } };
  const loop = await ensureLoop(ctx, paused, now);
  await ctx.db.patch(world._id, { speed: 0, timeskip: paused.timeskip, focusWarp: false, ...(loop ?? {}) });
  await ctx.scheduler.runAfter(0, internal.timeskip.chapter, { skipId: timeskipId });
  return { ok: true, timeskipId };
}

// ---------- the chapter chain ----------

export const chapterContext = internalQuery({
  args: { skipId: v.id('timeskips') },
  handler: async (ctx, { skipId }) => {
    const skip = await ctx.db.get(skipId);
    if (!skip || skip.status !== 'running') return null;
    const world = await ctx.db.get(skip.worldId);
    if (!world || world.deleted || world.timeskip?.id !== skipId) return null;
    return { chapter: skip.chapter, prompt: await chapterPrompt(ctx, skip, world) };
  },
});

/** One chapter: the LLM's choices for the stretch (if configured), then the mutation that plays it out. */
export const chapter = internalAction({
  args: { skipId: v.id('timeskips') },
  handler: async (ctx, { skipId }): Promise<void> => {
    const config = providerConfig();
    let effects = '[]';
    let usage: { tokensIn: number; tokensOut: number; failed: boolean; error?: string } | undefined;
    const context = config ? await ctx.runQuery(internal.timeskip.chapterContext, { skipId }) : null;
    if (config && context) {
      try {
        const result: ChatResult = await chat(config, { system: context.prompt.system, user: context.prompt.user, maxTokens: context.prompt.maxTokens, schema: CHAPTER_SCHEMA, temperature: 0.9 });
        effects = JSON.stringify(parseEffects(result.text, context.prompt.refs));
        usage = { tokensIn: result.tokensIn, tokensOut: result.tokensOut, failed: false };
      } catch (error) {
        usage = { tokensIn: 0, tokensOut: 0, failed: true, error: String(error instanceof Error ? error.message : error).slice(0, 200) };
      }
    }
    try {
      await ctx.runMutation(internal.timeskip.applyChapter, { skipId, chapter: context?.chapter, effects, usage });
    } catch (error) {
      // A chapter that cannot commit (a limit, a bad effect) is retried once on rules alone, then the skip ends gracefully.
      try {
        await ctx.runMutation(internal.timeskip.applyChapter, { skipId, chapter: context?.chapter, effects: '[]', usage });
      } catch {
        await ctx.runMutation(internal.timeskip.fail, { skipId, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
      }
    }
  },
});

export const applyChapter = internalMutation({
  args: { skipId: v.id('timeskips'), chapter: v.optional(v.number()), effects: v.string(), usage: usageV },
  handler: async (ctx, { skipId, chapter, effects, usage }): Promise<void> => {
    const next = await playChapter(ctx, skipId, chapter, effects, usage);
    if (next) await ctx.scheduler.runAfter(0, next === 'summarize' ? internal.timeskip.summarize : internal.timeskip.chapter, { skipId });
  },
});

type Usage = { tokensIn: number; tokensOut: number; failed: boolean; error?: string };

/** Plays one chapter out and commits it. Returns what runs next, or null when the skip is not at this chapter. */
export async function playChapter(ctx: MutationCtx, skipId: Id<'timeskips'>, chapter: number | undefined, effects: string, usage?: Usage): Promise<'chapter' | 'summarize' | null> {
    const skip = await ctx.db.get(skipId);
    if (!skip || skip.status !== 'running' || (chapter !== undefined && chapter !== skip.chapter)) return null;
    const world = await ctx.db.get(skip.worldId);
    if (!world || world.deleted || world.timeskip?.id !== skipId) return null;
    const ch = await openChapter(ctx, skip, world);
    const start = skip.chapter === 0 ? await snapshot(ch) : skip.start;
    let applied = 0;
    for (const raw of (JSON.parse(effects) as unknown[]).slice(0, 8)) {
      const e = await validEffect(ch, raw);
      if (e && (await applyEffect(ch, e))) applied += 1;
    }
    await runRules(ch);
    const last = skip.chapter + 1 >= skip.chapters;
    if (last) resumeState(ch);
    await closeChapter(ch);

    const stats = { ...skip.stats };
    for (const [k, n] of Object.entries(ch.stats)) stats[k] = (stats[k] ?? 0) + n;
    stats.llmEffects = (stats.llmEffects ?? 0) + applied;
    let beats = [...skip.beats, ...ch.beats];
    if (beats.length > MAX_BEATS) {
      const keep = new Set([...beats].sort((x, y) => y.weight - x.weight).slice(0, MAX_BEATS));
      beats = beats.filter((b) => keep.has(b));
    }
    await ctx.db.patch(skipId, {
      chapter: skip.chapter + 1,
      status: last ? 'summarizing' : 'running',
      beats,
      stats,
      start,
      updatedAt: Date.now(),
      llm: usage ? { calls: skip.llm.calls + 1, failures: skip.llm.failures + (usage.failed ? 1 : 0), tokensIn: skip.llm.tokensIn + usage.tokensIn, tokensOut: skip.llm.tokensOut + usage.tokensOut, lastError: usage.error ?? skip.llm.lastError } : skip.llm,
    });
    return last ? 'summarize' : 'chapter';
}

/** Clears what only made sense at the old moment, so the live engine resumes cleanly at the new one. */
function resumeState(ch: Awaited<ReturnType<typeof openChapter>>): void {
  const w = ch.tx.world;
  const day = dayOf(ch.end);
  if (w.sim) w.sim = { ...w.sim, petitions: [], cases: [], rallies: [], strike: undefined, accused: {}, punished: {}, lastCouncilTick: ch.end, missing: { food: 0, water: 0, parts: 0 }, missingEventId: undefined };
  w.econ.lastShuttleDay = day;
  w.lastDailyDay = day - 1;
  w.lastPriceTick = ch.end;
  w.lastBannerTick = ch.end;
  w.nudge = undefined;
  w.focusWarp = false;
  if (w.focusAgentId && !ch.people.has(w.focusAgentId)) w.focusAgentId = undefined;
}

// ---------- the chronicle ----------

export const summaryContext = internalQuery({
  args: { skipId: v.id('timeskips') },
  handler: async (ctx, { skipId }) => {
    const skip = await ctx.db.get(skipId);
    if (!skip || skip.status !== 'summarizing') return null;
    const world = await ctx.db.get(skip.worldId);
    if (!world) return null;
    return summaryPrompt(await gatherFacts(ctx.db, skip, world));
  },
});

export const summarize = internalAction({
  args: { skipId: v.id('timeskips') },
  handler: async (ctx, { skipId }): Promise<void> => {
    const config = providerConfig();
    let text: string | undefined;
    let usage: { tokensIn: number; tokensOut: number; failed: boolean; error?: string } | undefined;
    const prompt = config ? await ctx.runQuery(internal.timeskip.summaryContext, { skipId }) : null;
    if (config && prompt) {
      try {
        const result = await chat(config, { ...prompt, schema: SUMMARY_SCHEMA, temperature: 0.85 });
        text = result.text;
        usage = { tokensIn: result.tokensIn, tokensOut: result.tokensOut, failed: false };
      } catch (error) {
        usage = { tokensIn: 0, tokensOut: 0, failed: true, error: String(error instanceof Error ? error.message : error).slice(0, 200) };
      }
    }
    await ctx.runMutation(internal.timeskip.finish, { skipId, text, usage });
  },
});

export const finish = internalMutation({
  args: { skipId: v.id('timeskips'), text: v.optional(v.string()), usage: usageV },
  handler: async (ctx, { skipId, text, usage }): Promise<void> => {
    const skip = await ctx.db.get(skipId);
    if (!skip || skip.status !== 'summarizing') return;
    const world = await ctx.db.get(skip.worldId);
    if (!world) return;
    const facts = await gatherFacts(ctx.db, skip, world);
    const rules = rulesSummary(facts);
    const told = text ? mergeLlm(rules, facts, text) : null;
    const summary: TimeskipSummary = told?.summary ?? rules;
    const seeds = told?.seeds.length ? told.seeds : facts.tensions.flatMap((t) => (t.seed ? [t.seed] : []));
    const storylineIds = await seedStorylines(ctx.db, world._id, skipId, world.tick, await liveStorylines(ctx.db, world._id), seeds);
    summary.storylineIds = storylineIds;
    await ctx.db.patch(skipId, {
      status: 'done',
      summary,
      newStorylineIds: storylineIds,
      updatedAt: Date.now(),
      llm: usage ? { calls: skip.llm.calls + 1, failures: skip.llm.failures + (usage.failed ? 1 : 0), tokensIn: skip.llm.tokensIn + usage.tokensIn, tokensOut: skip.llm.tokensOut + usage.tokensOut, lastError: usage.error ?? skip.llm.lastError } : skip.llm,
    });
    await resume(ctx, world, skip);
  },
});

/** Ends a skip that could not go on: the world keeps what was committed and the clock restarts. */
export const fail = internalMutation({
  args: { skipId: v.id('timeskips'), error: v.string() },
  handler: async (ctx, { skipId, error }): Promise<void> => {
    const skip = await ctx.db.get(skipId);
    if (!skip || skip.status === 'done' || skip.status === 'failed') return;
    await ctx.db.patch(skipId, { status: 'failed', error, updatedAt: Date.now() });
    const world = await ctx.db.get(skip.worldId);
    if (world) await resume(ctx, world, skip);
  },
});

async function resume(ctx: MutationCtx, world: Doc<'worlds'>, skip: Doc<'timeskips'>): Promise<void> {
  if (world.timeskip?.id !== skip._id) return;
  const now = Date.now();
  const speed = world.speed > 0 ? world.speed : skip.resumeSpeed;
  const fresh = { ...world, timeskip: undefined, speed, lastHeartbeatAt: now };
  const loop = await ensureLoop(ctx, fresh, now, { restart: true });
  await ctx.db.patch(world._id, { timeskip: undefined, speed, lastHeartbeatAt: now, ...(loop ?? {}) });
}

// ---------- reading ----------

/** Reactive. A skip's progress and, once done, its chronicle. Without timeskipId, the world's latest skip. */
export const get = query({
  args: { worldId: v.string(), timeskipId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<TimeskipPublic | null> => {
    const worldId = asWorldId(ctx, args.worldId);
    if (!worldId) return null;
    const id = args.timeskipId !== undefined ? ctx.db.normalizeId('timeskips', args.timeskipId) : null;
    const skip = id
      ? await ctx.db.get(id)
      : await ctx.db
          .query('timeskips')
          .withIndex('by_world', (q) => q.eq('worldId', worldId))
          .order('desc')
          .first();
    if (!skip || skip.worldId !== worldId) return null;
    const world = await ctx.db.get(worldId);
    const span = skip.span as TimeskipSpan;
    const tick = skip.status === 'running' ? Math.min(skip.endTick, Math.max(skip.startTick, world?.tick ?? skip.startTick)) : skip.endTick;
    const progress = skip.status === 'done' || skip.status === 'failed' ? 1 : Math.min(0.97, skip.chapter / (skip.chapters + 0.5));
    const latest = [...skip.beats].sort((x, y) => y.tick - x.tick).find((b) => b.weight >= 0.6) ?? skip.beats[skip.beats.length - 1];
    return {
      id: skip._id,
      span,
      status: skip.status as TimeskipPublic['status'],
      startTick: skip.startTick,
      endTick: skip.endTick,
      tick,
      chapter: skip.chapter,
      chapters: skip.chapters,
      progress,
      progressLabel: skip.status === 'summarizing' ? 'The chronicler sets it all down…' : skip.status === 'done' ? 'The years have passed.' : progressOf(span, skip.startTick, tick) + (latest ? ': ' + latest.text : ': the days begin to blur…'),
      latestBeat: latest?.text,
      summary: skip.status === 'done' ? (skip.summary as TimeskipSummary) : undefined,
      error: skip.error,
    };
  },
});

export type { Id };
