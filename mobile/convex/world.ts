import { v } from 'convex/values';
import { query } from './_generated/server';
import { asWorldId } from './lib/auth';
import { toWorldPublic } from './lib/public';
import type { WorldPublic } from '../shared/types';

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
