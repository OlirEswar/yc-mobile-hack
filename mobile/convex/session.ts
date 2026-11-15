import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation } from './_generated/server';
import { ensureLoop } from './engine/loop';
import { asAgentId, authorizeWorld, newToken } from './lib/auth';
import { DEFAULT_SEED, RATE_LIMITS } from './lib/constants';
import { seedWorld } from './seed/insert';

/**
 * Finds or creates the session and its world for this install. The first call seeds the colony.
 * The returned token authorises every other mutation.
 */
export const bootstrap = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args): Promise<{ sessionToken: string; worldId: string }> => {
    const deviceId = args.deviceId.trim();
    if (deviceId.length < 6 || deviceId.length > 128) throw new Error('deviceId must be 6 to 128 characters');
    const now = Date.now();
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .first();
    if (session) {
      const world = await ctx.db.get(session.worldId);
      if (world && !world.deleted) {
        await ctx.db.patch(session._id, { lastHeartbeatAt: now });
        const fresh = { ...world, lastHeartbeatAt: now };
        const loop = await ensureLoop(ctx, fresh, now);
        await ctx.db.patch(world._id, { lastHeartbeatAt: now, ...(loop ?? {}) });
        return { sessionToken: session.token, worldId: world._id };
      }
    }

    // A new install. Keep the number of worlds bounded: retire the stalest one when at the cap.
    const worlds = await ctx.db.query('worlds').take(RATE_LIMITS.maxWorlds + 1);
    const live = worlds.filter((w) => !w.deleted);
    if (live.length >= RATE_LIMITS.maxWorlds) {
      const stalest = live.sort((a, b) => a.lastHeartbeatAt - b.lastHeartbeatAt)[0];
      if (now - stalest.lastHeartbeatAt < 6 * 60 * 60 * 1000) throw new Error('Too many active worlds. Try again later.');
      await ctx.db.patch(stalest._id, { deleted: true, speed: 0, status: 'paused' });
      await ctx.scheduler.runAfter(0, internal.admin.purgeWorld, { worldId: stalest._id });
    }

    const worldId = await seedWorld(ctx, deviceId, DEFAULT_SEED);
    const world = (await ctx.db.get(worldId))!;
    const loop = await ensureLoop(ctx, world, now);
    if (loop) await ctx.db.patch(worldId, loop);
    const token = session?.token ?? newToken();
    if (session) {
      await ctx.db.patch(session._id, { worldId, lastHeartbeatAt: now, focusAgentId: undefined });
    } else {
      await ctx.db.insert('sessions', { deviceId, token, worldId, lastHeartbeatAt: now, powerTimes: [], createTimes: [], createdAt: now });
    }
    return { sessionToken: token, worldId };
  },
});

/** Called about every 15 seconds while the app is open. The world only ticks while this is fresh. */
export const heartbeat = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ ok: boolean }> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) return { ok: false };
    const now = Date.now();
    await ctx.db.patch(auth.session._id, { lastHeartbeatAt: now });
    const fresh = { ...auth.world, lastHeartbeatAt: now };
    const loop = await ensureLoop(ctx, fresh, now);
    await ctx.db.patch(auth.world._id, { lastHeartbeatAt: now, ...(loop ?? {}) });
    return { ok: true };
  },
});

/** Which colonist the player follows. Only affects LLM queue priority, never the simulation. */
export const setFocus = mutation({
  args: { sessionToken: v.string(), agentId: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionToken, agentId }): Promise<{ ok: boolean }> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) return { ok: false };
    let focus = undefined;
    if (agentId !== null) {
      const id = asAgentId(ctx, agentId);
      const agent = id ? await ctx.db.get(id) : null;
      if (!agent || agent.worldId !== auth.world._id) return { ok: false };
      focus = agent._id;
    }
    await ctx.db.patch(auth.session._id, { focusAgentId: focus });
    if (auth.world.focusAgentId !== focus) await ctx.db.patch(auth.world._id, { focusAgentId: focus });
    return { ok: true };
  },
});
