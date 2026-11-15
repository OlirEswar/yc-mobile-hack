import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { asAgentId, asEventId, asWorldId } from './lib/auth';
import { toEventPublic } from './lib/public';
import { tierFloor } from './lib/events';
import type { WorldEventPublic } from '../shared/types';

/** Newest first, filtered by salience. `beforeTick` pages backwards. With agentId: that colonist's diary. */
export const feed = query({
  args: {
    worldId: v.string(),
    beforeTick: v.optional(v.number()),
    limit: v.optional(v.number()),
    minSalience: v.optional(v.number()),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<WorldEventPublic[]> => {
    const worldId = asWorldId(ctx, args.worldId);
    if (!worldId) return [];
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 30)));
    const minSalience = Math.max(0, Math.min(1, args.minSalience ?? 0.3));
    const before = args.beforeTick ?? Number.MAX_SAFE_INTEGER;

    if (args.agentId !== undefined) {
      const agentId = asAgentId(ctx, args.agentId);
      const agent = agentId ? await ctx.db.get(agentId) : null;
      if (!agentId || !agent || agent.worldId !== worldId) return [];
      const memories = await ctx.db
        .query('memories')
        .withIndex('by_agent_tick', (q) => q.eq('agentId', agentId).lt('tick', before))
        .order('desc')
        .take(limit * 3);
      const out: WorldEventPublic[] = [];
      const seen = new Set<string>();
      for (const m of memories) {
        if (out.length >= limit) break;
        if (m.salience < minSalience || seen.has(m.eventId)) continue;
        seen.add(m.eventId);
        const event = await ctx.db.get(m.eventId);
        if (event) out.push(toEventPublic(event));
      }
      return out;
    }

    // Only read the salience tiers that can hold a match, so mundane events are never scanned.
    const merged: Doc<'events'>[] = [];
    for (let tier = 3; tier >= 0; tier--) {
      if (tier < 3 && tierFloor(tier + 1) <= minSalience) break;
      const rows = await ctx.db
        .query('events')
        .withIndex('by_world_tier_tick', (q) => q.eq('worldId', worldId).eq('tier', tier).lt('tick', before))
        .order('desc')
        .take(limit);
      merged.push(...rows);
    }
    return merged
      .filter((e) => e.salience >= minSalience)
      .sort((a, b) => b.tick - a.tick || b._creationTime - a._creationTime)
      .slice(0, limit)
      .map(toEventPublic);
  },
});

/** The cause chain through one event: its ancestors from the root, then the event, then its direct effects. */
export const chain = query({
  args: { worldId: v.string(), eventId: v.string() },
  handler: async (ctx, args): Promise<WorldEventPublic[]> => {
    const worldId = asWorldId(ctx, args.worldId);
    const eventId = asEventId(ctx, args.eventId);
    if (!worldId || !eventId) return [];
    const event = await ctx.db.get(eventId);
    if (!event || event.worldId !== worldId) return [];
    const ancestors: Doc<'events'>[] = [];
    let cursor = event;
    for (let depth = 0; depth < 24 && cursor.causationEventId; depth++) {
      const parent = await ctx.db.get(cursor.causationEventId);
      if (!parent || parent.worldId !== worldId) break;
      ancestors.unshift(parent);
      cursor = parent;
    }
    const effects = await ctx.db
      .query('events')
      .withIndex('by_cause', (q) => q.eq('causationEventId', eventId))
      .take(40);
    effects.sort((a, b) => a.tick - b.tick || a._creationTime - b._creationTime);
    return [...ancestors, event, ...effects].map(toEventPublic);
  },
});
