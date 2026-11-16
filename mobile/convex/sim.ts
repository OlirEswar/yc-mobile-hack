import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { beginTx, commitTx } from './engine/core';
import { cadence, shouldRun, warpCadence } from './engine/loop';
import { advance } from './engine/step';
import { WARP_STEP_BUDGET } from './lib/constants';

/**
 * The tick loop. Each invocation advances cadence(speed).ticks ticks in one transaction, commits
 * once, and schedules the next invocation with the same token while the world should keep running
 * (a fresh heartbeat and a speed above 0). A newer chain (ensureLoop bumps the token) ends this one.
 * While the story director sets world.focusWarp, the loop fast-forwards (warpCadence) with a cap
 * on agent steps, and drops back to the normal cadence as soon as the flag clears.
 */
export const tick = internalMutation({
  args: { worldId: v.id('worlds'), token: v.number() },
  handler: async (ctx, { worldId, token }) => {
    const world = await ctx.db.get(worldId);
    if (!world || world.loop.token !== token || !world.loop.running) return;
    const now = Date.now();
    if (!shouldRun(world, now)) {
      await ctx.db.patch(worldId, { loop: { ...world.loop, running: false }, status: 'paused' });
      return;
    }
    const { ticks, intervalMs } = world.focusWarp ? warpCadence(world.speed) : cadence(world.speed);
    const tx = beginTx(ctx, world);
    await advance(tx, ticks, world.focusWarp ? { stepBudget: WARP_STEP_BUDGET } : {});
    tx.world.loop = { token, running: true, nextAt: now + intervalMs };
    tx.world.status = 'running';
    await commitTx(tx);
    await ctx.scheduler.runAfter(intervalMs, internal.sim.tick, { worldId, token });
  },
});
