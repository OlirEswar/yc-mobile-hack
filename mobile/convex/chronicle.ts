import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query } from './_generated/server';
import { salienceTier } from './engine/core';
import { asAgentId, asEventId, asWorldId } from './lib/auth';
import { toEventPublic } from './lib/public';
import type { WorldEventPublic } from '../shared/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Longest cause chain walked upwards, a guard against corrupt cycles. */
const MAX_ANCESTORS = 24;
const MAX_EFFECTS = 50;

const newestFirst = (a: Doc<'events'>, b: Doc<'events'>) => b.tick - a.tick || b.version - a.version || b._creationTime - a._creationTime;

/**
 * The chronicle, newest first. minSalience skips whole salience tiers through by_world_tier_tick;
 * beforeTick pages backwards (events strictly before that tick). With agentId, only events that
 * colonist acted in or took part in, read from their memories. Private events are never listed.
 */
export const feed = query({
  args: { worldId: v.string(), beforeTick: v.optional(v.number()), limit: v.optional(v.number()), minSalience: v.optional(v.number()), agentId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<WorldEventPublic[]> => {
    const worldId = asWorldId(ctx, args.worldId);
    if (!worldId) return [];
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.limit ?? DEFAULT_LIMIT)));
    const minSalience = args.minSalience ?? 0;
    const { beforeTick } = args;
    const listed = (e: Doc<'events'> | null): e is Doc<'events'> => !!e && e.worldId === worldId && e.visibility !== 'private' && e.salience >= minSalience;

    if (args.agentId !== undefined) {
      const agentId = asAgentId(ctx, args.agentId);
      if (!agentId) return [];
      const memories = await ctx.db
        .query('memories')
        .withIndex('by_agent_tick', (q) => (beforeTick === undefined ? q.eq('agentId', agentId) : q.eq('agentId', agentId).lt('tick', beforeTick)))
        .order('desc')
        .take(limit * 3);
      const out: Doc<'events'>[] = [];
      const seen = new Set<string>();
      for (const m of memories) {
        if (m.role === 'witness' || seen.has(m.eventId)) continue;
        seen.add(m.eventId);
        const event = await ctx.db.get(m.eventId);
        if (listed(event)) out.push(event);
        if (out.length >= limit) break;
      }
      return out.sort(newestFirst).map(toEventPublic);
    }

    const merged: Doc<'events'>[] = [];
    for (let tier = salienceTier(minSalience); tier <= 3; tier++) {
      const rows = await ctx.db
        .query('events')
        .withIndex('by_world_tier_tick', (q) => {
          const inTier = q.eq('worldId', worldId).eq('tier', tier);
          return beforeTick === undefined ? inTier : inTier.lt('tick', beforeTick);
        })
        .order('desc')
        .take(limit * 2);
      merged.push(...rows.filter(listed));
    }
    return merged.sort(newestFirst).slice(0, limit).map(toEventPublic);
  },
});

/**
 * The cause chain through one event: its ancestors from the root (via causationEventId), then the
 * event, then its direct effects in the order they happened. Private events are walked through but
 * not returned; a private event itself returns an empty chain.
 */
export const chain = query({
  args: { worldId: v.string(), eventId: v.string() },
  handler: async (ctx, args): Promise<WorldEventPublic[]> => {
    const worldId = asWorldId(ctx, args.worldId);
    const eventId = asEventId(ctx, args.eventId);
    const event = eventId ? await ctx.db.get(eventId) : null;
    if (!worldId || !event || event.worldId !== worldId || event.visibility === 'private') return [];
    const ancestors: Doc<'events'>[] = [];
    const seen = new Set<string>([event._id]);
    let parentId: Id<'events'> | undefined = event.causationEventId;
    while (parentId && !seen.has(parentId) && ancestors.length < MAX_ANCESTORS) {
      seen.add(parentId);
      const parent: Doc<'events'> | null = await ctx.db.get(parentId);
      if (!parent || parent.worldId !== worldId) break;
      ancestors.unshift(parent);
      parentId = parent.causationEventId;
    }
    const effects = await ctx.db
      .query('events')
      .withIndex('by_cause', (q) => q.eq('causationEventId', event._id))
      .take(MAX_EFFECTS);
    effects.sort((a, b) => newestFirst(b, a));
    return [...ancestors, event, ...effects].filter((e) => e.visibility !== 'private').map(toEventPublic);
  },
});
