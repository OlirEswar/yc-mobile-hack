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

const TEST_PERSONAS: Record<string, { want: string; fear: string; strategies: string[]; secret?: { kind: string; text: string } }> = {
  'Dmitri Volkov': { want: 'Keep the council in his debt and his second ledger hidden', fear: 'An audit', strategies: ['scheme', 'trade', 'work'], secret: { kind: 'embezzler', text: 'Dmitri Volkov keeps a second ledger and sells reserve water to shuttle crews.' } },
  'Joao Ferreira': { want: 'A union strike that wins the crews a fair share of the water', fear: 'Another Long Dark', strategies: ['work', 'borrow', 'charm'] },
  'Mira Castellanos': { want: 'Love that does not have to hide', fear: 'Being found out', strategies: ['grow', 'charm', 'work'], secret: { kind: 'affair', text: 'Mira Castellanos has been seeing someone behind her partner\'s back.' } },
  'Tobias Okafor': { want: 'Get rich enough to buy passage back to Earth', fear: 'Dying poor on the Moon', strategies: ['smuggle', 'trade', 'scheme'] },
  'Elias Thorne': { want: 'Protect his children from going hungry', fear: 'Watching Wren and Pip starve', strategies: ['work', 'steal', 'beg'] },
  'Lucia Navarro': { want: 'Find someone to love', fear: 'Growing old alone in Ring A', strategies: ['charm', 'work', 'borrow'] },
  'Nadia Haddad': { want: 'Save enough credits to escape the colony', fear: 'The council', strategies: ['smuggle', 'scavenge', 'work'], secret: { kind: 'smuggler', text: 'Nadia Haddad runs contraband for the shuttle crews.' } },
  'Priya Raghunathan': { want: 'Uncover the truth about the Long Dark', fear: 'That the reactor fault was no accident', strategies: ['work', 'trade', 'charm'] },
  'Hana Yilmaz': { want: 'Recall the chair and lead the council herself', fear: 'Irrelevance', strategies: ['charm', 'scheme', 'work'] },
  'Kenji Watanabe': { want: 'Pay back the debts he ran up during the Long Dark', fear: 'His creditors', strategies: ['grow', 'scavenge', 'borrow'], secret: { kind: 'coward', text: 'Kenji Watanabe hid in an airlock during the Long Dark while others died.' } },
  'Yusuf Rahman': { want: 'Win the heart of someone at the canteen', fear: 'Rejection', strategies: ['work', 'charm', 'beg'] },
};

/**
 * Gives every mind without a persona a minimal one, so tests and dumps exercise persona-driven
 * planning on the iteration-1 seed: a few named characters get authored wants and secrets, the
 * rest a want from their traits and, for a sixth of them, a secret.
 */
export async function testPersonas(ctx: MutationCtx, worldId: Id<'worlds'>): Promise<void> {
  const agents = await ctx.db
    .query('agents')
    .withIndex('by_world_seq', (q) => q.eq('worldId', worldId))
    .collect();
  const wants = ['Save up some credits', 'Find someone to share the long nights with', 'Get even with whoever wronged them', 'A seat on the council', 'Keep the family fed', 'Find out what really happened in the Long Dark'];
  const secrets = [
    { kind: 'thief', text: 'has been skimming from the household pantry for months.' },
    { kind: 'saboteur', text: 'damaged the ice drills last winter to get a shift cancelled.' },
    { kind: 'affair', text: 'is having an affair with a neighbour.' },
    { kind: 'smuggler', text: 'sells parts to shuttle crews off the books.' },
  ];
  for (const a of agents) {
    if (!a.mindId) continue;
    const mind = await ctx.db.get(a.mindId);
    if (!mind || mind.persona) continue;
    const authored = TEST_PERSONAS[a.name];
    const t = a.traits;
    const strategies = authored?.strategies ?? [
      t.empathy < 0.25 && t.caution < 0.5 ? 'steal' : 'work',
      t.sociability > 0.55 ? 'charm' : 'grow',
      t.curiosity > 0.55 ? 'scavenge' : 'trade',
      t.ambition > 0.65 ? 'scheme' : 'borrow',
      t.caution < 0.35 ? 'smuggle' : 'beg',
    ];
    const secret = authored?.secret ?? (a.seq % 6 === 1 ? { ...secrets[a.seq % secrets.length], text: a.name + ' ' + secrets[a.seq % secrets.length].text } : undefined);
    await ctx.db.patch(mind._id, {
      persona: {
        epithet: a.occupation.replace(/_/g, ' '),
        want: authored?.want ?? wants[a.seq % wants.length],
        need: 'To be seen',
        fear: authored?.fear ?? 'Running out of water',
        flaw: 'Pride',
        voice: 'Plain',
        secret,
        strategies,
        arc: { stage: 'setup', note: '' },
        key: !!authored,
      },
    });
  }
}
