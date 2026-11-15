import { v } from 'convex/values';
import { query } from './_generated/server';
import { asWorldId } from './lib/auth';
import { toAgentLite, toEventPublic } from './lib/public';
import type { SyncUpdates } from '../shared/types';

const MAX_EVENTS = 150;

/**
 * Agents and events that changed after sinceVersion. Both come from version indexes, so the cost
 * is the changed rows only. When the caller is far behind, the newest MAX_EVENTS events are sent.
 */
export const updates = query({
  args: { worldId: v.string(), sinceVersion: v.number() },
  handler: async (ctx, args): Promise<SyncUpdates> => {
    const worldId = asWorldId(ctx, args.worldId);
    const world = worldId ? await ctx.db.get(worldId) : null;
    if (!worldId || !world || world.deleted) return { version: 0, tick: 0, agents: [], events: [] };
    const since = Math.max(0, Math.floor(args.sinceVersion));
    const agents = await ctx.db
      .query('agents')
      .withIndex('by_world_version', (q) => q.eq('worldId', worldId).gt('updatedAtVersion', since))
      .collect();
    const events = await ctx.db
      .query('events')
      .withIndex('by_world_version', (q) => q.eq('worldId', worldId).gt('version', since))
      .order('desc')
      .take(MAX_EVENTS);
    return { version: world.version, tick: world.tick, agents: agents.map(toAgentLite), events: events.reverse().map(toEventPublic) };
  },
});
