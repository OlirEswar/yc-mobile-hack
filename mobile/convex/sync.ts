import { v } from 'convex/values';
import { query } from './_generated/server';
import { asWorldId } from './lib/auth';
import { toAgentLite, toEventPublic } from './lib/public';
import type { SyncUpdates } from '../shared/types';

/** Most events one sync returns: the newest ones win, so a client that fell far behind skips the oldest. */
const SYNC_EVENT_CAP = 200;

/**
 * Agents and events changed after sinceVersion, read through the by_world_version indexes so only
 * changed rows are touched. sinceVersion 0 returns every agent and the recent events. Private
 * events (whispers) never leave the backend through here.
 */
export const updates = query({
  args: { worldId: v.string(), sinceVersion: v.number() },
  handler: async (ctx, args): Promise<SyncUpdates> => {
    const worldId = asWorldId(ctx, args.worldId);
    const world = worldId ? await ctx.db.get(worldId) : null;
    if (!worldId || !world || world.deleted) return { version: 0, tick: 0, agents: [], events: [] };
    const agents = await ctx.db
      .query('agents')
      .withIndex('by_world_version', (q) => q.eq('worldId', worldId).gt('updatedAtVersion', args.sinceVersion))
      .collect();
    const events = await ctx.db
      .query('events')
      .withIndex('by_world_version', (q) => q.eq('worldId', worldId).gt('version', args.sinceVersion))
      .order('desc')
      .take(SYNC_EVENT_CAP);
    return {
      version: world.version,
      tick: world.tick,
      agents: agents.map(toAgentLite),
      events: events
        .filter((e) => e.visibility !== 'private')
        .reverse()
        .map(toEventPublic),
    };
  },
});
