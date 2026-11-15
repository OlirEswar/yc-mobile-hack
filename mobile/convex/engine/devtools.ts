/**
 * Helpers for tests and story dumps: advance a world by whole chunks of ticks, and render its
 * chronicle as readable text. Not called by the live game.
 */
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { tickToClock } from '../../shared/colony';
import { beginTx, commitTx, emitEvent } from './core';
import { advance } from './step';
import type { AdvanceResult } from './step';

/** Advances a world by `ticks` in one transaction, the way one sim:tick invocation does. */
export async function runTicks(ctx: MutationCtx, worldId: Id<'worlds'>, ticks: number): Promise<AdvanceResult> {
  const world = await ctx.db.get(worldId);
  if (!world) throw new Error('no world ' + worldId);
  const tx = beginTx(ctx, world);
  const result = await advance(tx, ticks);
  await commitTx(tx);
  return result;
}

/**
 * Writes a standing condition the way the powers owner's interventions do: the effect, its
 * announcing event as world.causes[type], and for a storm the impact damage. For tests and dumps.
 */
export async function startEffect(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  effect: { type: 'drought' | 'storm'; severity: number; ticks: number; locationIds?: string[] },
): Promise<Id<'events'>> {
  const world = await ctx.db.get(worldId);
  if (!world) throw new Error('no world ' + worldId);
  const tx = beginTx(ctx, world);
  const locationIds = effect.locationIds ?? [];
  const drought = effect.type === 'drought';
  const { eventId } = await emitEvent(tx, {
    category: 'intervention',
    eventType: effect.type,
    locationId: drought ? 'ice_wells' : locationIds[0],
    summary: drought
      ? 'The ice wells are running dry. Water output has fallen by ' + Math.round(effect.severity * 100) + '%.'
      : 'A meteor storm is hitting ' + (locationIds.length > 0 ? locationIds.join(', ') : 'every exposed site') + '.',
    salience: 0.95,
    visibility: 'public',
  });
  tx.world.activeEffects.push({
    id: effect.type + '-' + tx.tick,
    type: effect.type,
    locationIds,
    severity: effect.severity,
    startTick: tx.tick,
    endTick: tx.tick + effect.ticks,
    label: drought ? 'Drought' : 'Meteor storm',
    eventId,
  });
  tx.world.causes[effect.type] = eventId;
  if (!drought) for (const loc of locationIds) tx.world.damage[loc] = Math.min(1, (tx.world.damage[loc] ?? 0) + effect.severity * 0.4);
  await commitTx(tx);
  return eventId;
}

/** The chronicle from a tick onwards, one line per event at or above minSalience, with its cause. */
export async function chronicleText(ctx: QueryCtx, worldId: Id<'worlds'>, options: { minSalience?: number; sinceTick?: number } = {}): Promise<string> {
  const events = await ctx.db
    .query('events')
    .withIndex('by_world_version', (q) => q.eq('worldId', worldId))
    .collect();
  const byId = new Map(events.map((e) => [e._id as string, e]));
  return events
    .filter((e) => e.salience >= (options.minSalience ?? 0.5) && e.tick >= (options.sinceTick ?? 0))
    .sort((a, b) => a.tick - b.tick || a._creationTime - b._creationTime)
    .map((e) => {
      const cause = e.causationEventId ? byId.get(e.causationEventId) : undefined;
      return tickToClock(e.tick).label + '  [' + e.eventType + ' ' + e.salience + ']  ' + e.summary + (cause ? '\n      <- ' + cause.eventType + ': ' + cause.summary.slice(0, 90) : '');
    })
    .join('\n');
}
