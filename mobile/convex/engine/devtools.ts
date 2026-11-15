/**
 * Helpers for tests and story dumps: advance a world by whole chunks of ticks, and render its
 * chronicle as readable text. Not called by the live game.
 */
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { tickToClock } from '../../shared/colony';
import { beginTx, commitTx, emitEvent, killAgent, learnBelief, loadAgent, loadMind, replan, touchMind } from './core';
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

/** Agents by seq, for scenario setup. */
export async function agentBySeq(ctx: QueryCtx, worldId: Id<'worlds'>, seq: number) {
  return (await ctx.db
    .query('agents')
    .withIndex('by_world_seq', (q) => q.eq('worldId', worldId).eq('seq', seq))
    .first())!;
}

/** Plants a rumor about subject in the given minds, like the rumor power: one origin event, beliefs that point to it. */
export async function plantRumor(ctx: MutationCtx, worldId: Id<'worlds'>, rumor: { subject: Id<'agents'>; hearers: Id<'agents'>[]; kind: string; text: string }): Promise<Id<'events'>> {
  const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
  const subject = (await loadAgent(tx, rumor.subject))!;
  const { eventId } = await emitEvent(tx, {
    category: 'intervention',
    eventType: 'rumor_started',
    participantIds: [subject._id, ...rumor.hearers],
    summary: 'A rumor is going round about ' + subject.name + ': "' + rumor.text + '"',
    salience: 0.72,
    visibility: 'public',
  });
  for (const id of rumor.hearers) {
    const a = (await loadAgent(tx, id))!;
    await learnBelief(tx, a, { kind: rumor.kind, text: rumor.text, valence: -1, confidence: 0.75, sourceType: 'rumor', subjectAgentId: subject._id, subjectName: subject.name, originEventId: eventId });
  }
  await commitTx(tx);
  return eventId;
}

/** Plants a divine goal and its private belief in one mind, like the whisper power. */
export async function whisper(ctx: MutationCtx, worldId: Id<'worlds'>, w: { agent: Id<'agents'>; about?: Id<'agents'>; drive: string; kind: string; description: string; belief?: { kind: string; text: string } }): Promise<Id<'events'>> {
  const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
  const a = (await loadAgent(tx, w.agent))!;
  const about = w.about ? await loadAgent(tx, w.about) : null;
  const { eventId } = await emitEvent(tx, { category: 'intervention', eventType: 'whisper', actorId: a._id, summary: 'A voice whispered to ' + a.name + ': "' + w.description + '"', salience: 0.6, visibility: 'private' });
  const mind = (await loadMind(tx, a))!;
  mind.goals.push({
    id: 'g' + mind.nextGoalSeq++,
    kind: w.kind,
    description: w.description,
    priority: 0.8,
    source: 'divine',
    status: 'active',
    targetAgentId: about?._id,
    targetAgentName: about?.name,
    createdAtTick: tx.tick,
    predicate: 'none',
    drive: w.drive,
    originEventId: eventId,
  });
  touchMind(tx, mind);
  if (w.belief && about) {
    await learnBelief(tx, a, { kind: w.belief.kind, text: w.belief.text, valence: -1, confidence: 0.7, sourceType: 'divine', subjectAgentId: about._id, subjectName: about.name, originEventId: eventId, private: true });
  }
  replan(tx, a, { now: true });
  await commitTx(tx);
  return eventId;
}

/** Kills an agent the way the kill power does. */
export async function smite(ctx: MutationCtx, worldId: Id<'worlds'>, agentId: Id<'agents'>, cause: string): Promise<Id<'events'> | null> {
  const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
  const eventId = await killAgent(tx, (await loadAgent(tx, agentId))!, { cause, category: 'intervention', salience: 1 });
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
