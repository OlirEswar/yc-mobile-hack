import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import { beginTx, commitTx } from './engine/core';
import { ensureLoop } from './engine/loop';
import { advance } from './engine/step';
import { asAgentId, asWorldId, authorizeWorld } from './lib/auth';
import { DEFAULT_SEED, NOTABLE_SALIENCE, SKIP_MAX_TICKS, SKIP_STEP_BUDGET } from './lib/constants';
import { toWorldPublic } from './lib/public';
import { seedWorld } from './seed/insert';
import { startTimeskip } from './timeskip';
import { SPEEDS } from '../shared/colony';
import type { TimeskipStartResult, WorldPublic } from '../shared/types';

/** Reactive. Changes every tick, so it also serves as the clock. */
export const get = query({
  args: { worldId: v.string() },
  handler: async (ctx, args): Promise<WorldPublic | null> => {
    const worldId = asWorldId(ctx, args.worldId);
    if (!worldId) return null;
    const world = await ctx.db.get(worldId);
    if (!world || world.deleted) return null;
    const factions = await ctx.db
      .query('factions')
      .withIndex('by_world', (q) => q.eq('worldId', worldId))
      .collect();
    return toWorldPublic(world, factions);
  },
});

/** Speed 0 pauses. Any other speed restarts the loop at the new cadence. */
export const setSpeed = mutation({
  args: { sessionToken: v.string(), worldId: v.string(), speed: v.number() },
  handler: async (ctx, { sessionToken, worldId, speed }): Promise<{ ok: boolean }> => {
    const auth = await authorizeWorld(ctx, sessionToken, worldId);
    if (!auth || !(SPEEDS as readonly number[]).includes(speed)) return { ok: false };
    const now = Date.now();
    await ctx.db.patch(auth.session._id, { lastHeartbeatAt: now });
    const fresh = { ...auth.world, speed, lastHeartbeatAt: now };
    const loop = await ensureLoop(ctx, fresh, now, { restart: true });
    await ctx.db.patch(auth.world._id, { speed, lastHeartbeatAt: now, ...(loop ?? {}) });
    return { ok: true };
  },
});

/**
 * Runs the world forward in one transaction until a high-salience event (or one involving agentId)
 * happens, at most SKIP_MAX_TICKS ticks, stopping early when the agent-step budget is spent so the
 * mutation stays inside Convex limits. The client can call it again to keep skipping.
 */
export const skipToNotable = mutation({
  args: { sessionToken: v.string(), worldId: v.string(), agentId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ advancedTicks: number; eventId?: string }> => {
    const auth = await authorizeWorld(ctx, args.sessionToken, args.worldId);
    if (!auth) return { advancedTicks: 0 };
    const agentId = args.agentId !== undefined ? asAgentId(ctx, args.agentId) : null;
    const tx = beginTx(ctx, auth.world);
    const result = await advance(tx, SKIP_MAX_TICKS, {
      stepBudget: SKIP_STEP_BUDGET,
      stopAt: async (_, eventIds) => {
        for (const id of eventIds) {
          const e = await ctx.db.get(id);
          if (!e) continue;
          if (agentId ? e.actorId === agentId || e.participantIds.includes(agentId) : e.salience >= NOTABLE_SALIENCE) return id;
        }
        return undefined;
      },
    });
    await commitTx(tx);
    return { advancedTicks: result.ticks, eventId: result.stoppedAt };
  },
});

/**
 * Skips the world ahead by a span (a week to ten years) through the macro simulation in
 * convex/timeskip.ts, pausing the clock until the chronicle is written. Idempotent while one runs.
 */
export const timeskip = mutation({
  args: { sessionToken: v.string(), worldId: v.string(), span: v.string() },
  handler: async (ctx, args): Promise<TimeskipStartResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken, args.worldId);
    if (!auth) return { ok: false, code: 'unauthorized', message: 'Session expired.' };
    return await startTimeskip(ctx, auth.world, auth.session, args.span);
  },
});

/** Retires the session's world and seeds a fresh one in its place. */
export const reset = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ worldId: string }> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) throw new Error('unauthorized');
    const now = Date.now();
    await ctx.db.patch(auth.world._id, { deleted: true, speed: 0, status: 'paused', loop: { ...auth.world.loop, running: false } });
    await ctx.scheduler.runAfter(0, internal.admin.purgeWorld, { worldId: auth.world._id });
    const worldId = await seedWorld(ctx, auth.session.deviceId, DEFAULT_SEED);
    const world = (await ctx.db.get(worldId))!;
    const loop = await ensureLoop(ctx, world, now);
    if (loop) await ctx.db.patch(worldId, loop);
    await ctx.db.patch(auth.session._id, { worldId, lastHeartbeatAt: now, focusAgentId: undefined });
    return { worldId };
  },
});
