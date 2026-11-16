import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

/** The tick loop. Filled in by the simulation engine. */
export const tick = internalMutation({
  args: { worldId: v.id('worlds'), token: v.number() },
  handler: async (ctx, { worldId, token }) => {
    const world = await ctx.db.get(worldId);
    if (!world || world.loop.token !== token) return;
    await ctx.db.patch(worldId, { loop: { ...world.loop, running: false } });
  },
});
