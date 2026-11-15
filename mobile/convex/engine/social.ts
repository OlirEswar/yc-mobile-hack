/**
 * How ideas move between people and what follows from them: ties, belief lookup, the ground truth
 * behind accusations, rumor spreading in conversation, and the colony-wide ripples of accusations.
 */
import type { Id } from '../_generated/dataModel';
import { PANTRY_DAYS, RATIONS } from '../lib/constants';
import { clamp, round2 } from '../lib/rng';
import { reserveDays } from './conditions';
import { simState } from './state';
import { adjustRelationship, enqueueCognition, learnBelief, loadAgent, loadFactions, loadHousehold, loadMind, touchFaction, emitEvent } from './core';
import type { AgentDoc, AgentId, BeliefDoc, EventId, RelationshipDoc, Tx } from './core';

/** Belief kinds that accuse a person of something an investigation can settle. */
export const ACCUSABLE = new Set(['thief', 'hoarding', 'saboteur', 'corrupt', 'suspect', 'untrustworthy']);
/** What someone can be publicly accused of: acts, not opinions. */
export const ACCUSE_KINDS = new Set(['thief', 'hoarding', 'saboteur', 'corrupt', 'suspect']);
/** Beliefs heavy enough that learning one is worth an LLM rethink. */
const HEAVY = new Set(['thief', 'hoarding', 'saboteur', 'corrupt', 'suspect']);

export async function tie(tx: Tx, from: AgentId, to: AgentId): Promise<RelationshipDoc | null> {
  return await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_to', (q) => q.eq('fromAgentId', from).eq('toAgentId', to))
    .first();
}

export async function getBelief(tx: Tx, agentId: AgentId, key: string): Promise<BeliefDoc | null> {
  return await tx.ctx.db
    .query('beliefs')
    .withIndex('by_agent_key', (q) => q.eq('agentId', agentId).eq('key', key))
    .first();
}

export async function beliefsOf(tx: Tx, agentId: AgentId): Promise<BeliefDoc[]> {
  return await tx.ctx.db
    .query('beliefs')
    .withIndex('by_agent_key', (q) => q.eq('agentId', agentId))
    .collect();
}

/**
 * Hearsay fades when nobody repeats it: a told or rumored belief loses a fifth of its confidence
 * per day after the first since it was last reinforced. What someone saw, and politics, do not fade.
 */
export function effectiveConfidence(b: BeliefDoc, tick: number): number {
  if (b.sourceType === 'observed' || b.kind.startsWith('policy_')) return b.confidence;
  const days = (tick - b.lastReinforcedTick) / 144 - 1;
  return days <= 0 ? b.confidence : round2(b.confidence * Math.pow(0.8, days));
}

export const markActed = async (tx: Tx, belief: BeliefDoc): Promise<void> => void (await tx.ctx.db.patch(belief._id, { acted: tx.tick }));

/** Trust as a 0..1 weight: 0.5 for a stranger. */
export const trustWeight = (r: RelationshipDoc | null): number => ((r?.trust ?? 0) + 1) / 2;

/**
 * Whether what a belief says about someone is really so, from world state: true, false, or null
 * when nothing an investigation could find would settle it. detail describes the evidence.
 */
export async function truthAbout(tx: Tx, kind: string, subject: AgentDoc): Promise<{ truth: boolean | null; detail: string; settled?: boolean }> {
  const punished = (await simState(tx)).punished?.[subject._id];
  if (kind === 'thief') {
    const mind = await loadMind(tx, subject);
    const thefts = mind?.thefts ?? 0;
    if (thefts > 0) return { truth: true, detail: thefts === 1 ? 'a theft traced back to them' : thefts + ' thefts traced back to them' };
    if (punished !== undefined) return { truth: true, detail: 'security has already fined them for it', settled: true };
    return { truth: false, detail: 'nothing that ties them to any theft' };
  }
  if (kind === 'hoarding' && punished !== undefined && tx.tick - punished < 432) {
    return { truth: true, detail: 'security has already made them hand their stash to the depot', settled: true };
  }
  if (kind === 'hoarding') {
    if (subject.role === 'quartermaster') {
      const holding = tx.world.econ.rationLevel > 0 && reserveDays(tx.world, 'water') >= 2.5;
      return holding
        ? { truth: true, detail: 'the depot holding ' + Math.round(tx.world.stockpiles.depot?.water ?? 0) + ' water while rations stay cut' }
        : { truth: false, detail: 'the depot ledgers matching the shelves' };
    }
    const carried = subject.inv.food + subject.inv.water;
    const household = await loadHousehold(tx, subject.householdId);
    const members = Math.max(1, household?.memberIds.length ?? 1);
    const perHead = household ? (household.pantry.food + household.pantry.water) / members : 0;
    const limit = subject.occupation === 'trader' ? 45 : 14;
    if (carried >= limit) return { truth: true, detail: Math.round(subject.inv.water) + ' water and ' + Math.round(subject.inv.food) + ' food stashed away' };
    if (perHead >= (RATIONS[0].food + RATIONS[0].water) * PANTRY_DAYS * 1.4) return { truth: true, detail: 'a pantry packed far past its ration' };
    return { truth: false, detail: 'no more than anyone else has' };
  }
  if (kind === 'hero') return { truth: subject.traits.empathy >= 0.65, detail: subject.traits.empathy >= 0.65 ? 'neighbours who owe them meals' : 'nobody who remembers a kindness' };
  if (kind === 'saboteur' || kind === 'suspect') return { truth: false, detail: 'no sign they had anything to do with it' };
  if (kind === 'corrupt') {
    const rich = subject.inv.credits >= 400 && !!subject.role;
    return { truth: rich, detail: rich ? Math.round(subject.inv.credits) + ' credits no wage explains' : 'accounts that add up' };
  }
  return { truth: null, detail: '' };
}

export type SpreadOutcome =
  | { kind: 'learned'; belief: BeliefDoc; created: boolean; confidence: number }
  | { kind: 'doubted'; belief: BeliefDoc }
  | { kind: 'defended'; belief: BeliefDoc };

/**
 * The speaker passes one belief to the listener. How much the listener takes on depends on their
 * trust in the speaker, their own scepticism, how many retellings the idea has been through, and
 * whether it attacks someone they love (then they defend them instead).
 */
export async function spreadBelief(tx: Tx, speaker: AgentDoc, listener: AgentDoc, belief: BeliefDoc): Promise<SpreadOutcome> {
  const toSpeaker = await tie(tx, listener._id, speaker._id);
  if (belief.subjectAgentId && belief.valence < 0) {
    const toSubject = await tie(tx, listener._id, belief.subjectAgentId);
    if ((toSubject?.affinity ?? 0) >= 0.45) {
      await adjustRelationship(tx, listener, speaker, { affinity: -0.08, trust: -0.05 });
      return { kind: 'defended', belief };
    }
  }
  const sceptic = listener.traits.caution * 0.35 + listener.traits.stubbornness * 0.25;
  let confidence = effectiveConfidence(belief, tx.tick) * (0.35 + 0.65 * trustWeight(toSpeaker)) * (1 - sceptic) * Math.pow(0.93, belief.hops);
  if (belief.subjectAgentId && belief.valence < 0) {
    const cleared = await getBelief(tx, listener._id, 'innocent:' + belief.subjectAgentId);
    if (cleared && cleared.confidence > 0.4) confidence *= 0.3;
  }
  // Hearing the same story again from the same person adds little; from someone new it adds more.
  // Someone who saw it for themselves, or has already acted on it, learns nothing new from gossip.
  const held = await getBelief(tx, listener._id, belief.key);
  if (held && (held.sourceType === 'observed' || held.acted !== undefined)) return { kind: 'learned', belief, created: false, confidence: held.confidence };
  if (held) confidence *= held.sourceAgentId === speaker._id ? 0.15 : 0.5;
  confidence = round2(clamp(confidence, 0, 0.95));
  if (confidence < 0.12) return held ? { kind: 'learned', belief, created: false, confidence: held.confidence } : { kind: 'doubted', belief };
  const learned = await learnBelief(tx, listener, {
    kind: belief.kind,
    text: belief.text,
    valence: belief.valence,
    confidence,
    sourceType: 'told',
    subjectAgentId: belief.subjectAgentId,
    subjectName: belief.subjectName,
    worldKey: belief.subjectAgentId ? undefined : belief.key,
    sourceAgentId: speaker._id,
    sourceName: speaker.name,
    originEventId: belief.originEventId,
    hops: belief.hops + 1,
  });
  await adjustRelationship(tx, listener, speaker, { trust: 0.02 });
  if (learned.created && HEAVY.has(belief.kind) && confidence >= 0.4) {
    await enqueueCognition(tx, listener, {
      kind: 'plan',
      trigger: 'heard from ' + speaker.name + ': ' + belief.text,
      priority: 0.45 + confidence * 0.3,
      lane: 'normal',
      eventId: belief.originEventId,
    });
  }
  return { kind: 'learned', belief, created: learned.created, confidence };
}

/**
 * Members who watched their own faction's leader be accused, believed it, and no longer trust them
 * walk out. Returns the event id of the split, if one happened.
 */
export async function maybeSplitFaction(tx: Tx, leader: AgentDoc, believers: AgentDoc[], accusationId: EventId): Promise<EventId | undefined> {
  const faction = (await loadFactions(tx)).find((f) => f.leaderAgentId === leader._id);
  if (!faction) return undefined;
  const leaving: AgentDoc[] = [];
  for (const m of believers) {
    if (m.factionId !== faction.key || m._id === leader._id) continue;
    const r = await tie(tx, m._id, leader._id);
    if ((r?.trust ?? 0) < -0.1) leaving.push(m);
  }
  if (leaving.length === 0) return undefined;
  for (const m of leaving) {
    m.factionId = undefined;
    faction.officerIds = faction.officerIds.filter((id) => id !== m._id);
  }
  faction.memberCount = Math.max(0, faction.memberCount - leaving.length);
  touchFaction(tx, faction);
  const names = leaving.map((m) => m.name);
  const who = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'faction_split',
    actorId: leaving[0]._id,
    participantIds: [...leaving.map((m) => m._id), leader._id],
    summary: who + (leaving.length === 1 ? ' walked out of the ' : ' walked out of the ') + faction.name + ', no longer willing to follow ' + leader.name + '.',
    salience: leaving.length >= 2 ? 0.8 : 0.65,
    causationEventId: accusationId,
    visibility: 'public',
  });
  return eventId;
}

/** Loads a living agent present at the same place and awake, or null. */
export async function presentWith(tx: Tx, a: AgentDoc, id: string): Promise<AgentDoc | null> {
  const normalized = tx.ctx.db.normalizeId('agents', id);
  if (!normalized) return null;
  const b = await loadAgent(tx, normalized as Id<'agents'>);
  if (!b || !b.alive || b._id === a._id || b.locationId !== a.locationId || b.activity === 'sleeping') return null;
  if (b.move && tx.tick < b.move.arriveTick) return null;
  return b;
}
