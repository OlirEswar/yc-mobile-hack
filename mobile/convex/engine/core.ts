/**
 * Shared primitives of the simulation. Everything that changes the world (the tick engine, the god
 * powers, the LLM plan commit) goes through a Tx so that one mutation produces one world version,
 * interacting agents never clobber each other, and events, memories, beliefs and relationships are
 * written the same way everywhere.
 *
 * Usage inside a mutation:
 *   const tx = await beginTx(ctx, world);
 *   const agent = await loadAgent(tx, id);  // working copy: mutate it, then touch(tx, agent)
 *   await emitEvent(tx, {...});
 *   await commitTx(tx);                      // the only write of the world document
 */
import { SOCIETY_STEP_SPECS } from '../society/steps';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { START_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../shared/colony';
import type { ActivityKind, EventCategory } from '../../shared/types';
import { NEVER_DUE } from '../lib/constants';
import { clamp, round2 } from '../lib/rng';
import {
  ROSTER_ASLEEP,
  ROSTER_AWAKE,
  ROSTER_DEAD,
  ROSTER_TRANSIT,
  ROSTER_WORKING,
  locChar,
  relationshipStrength,
  standingWeight,
  topicWeight,
} from '../seed/insert';

export type AgentDoc = Doc<'agents'>;
export type MindDoc = Doc<'minds'>;
export type WorldDoc = Doc<'worlds'>;
export type HouseholdDoc = Doc<'households'>;
export type FactionDoc = Doc<'factions'>;
export type BeliefDoc = Doc<'beliefs'>;
export type RelationshipDoc = Doc<'relationships'>;
export type AgentId = Id<'agents'>;
export type EventId = Id<'events'>;

// ---------- time ----------

/** Zero-based day index of a tick. Day 0 starts at tick 0 (06:00 on Sol 1). */
export const dayOf = (tick: number): number => Math.floor(tick / TICKS_PER_DAY);
/** Hour of the day, 0..23. */
export const hourOf = (tick: number): number => (Math.floor(tick / TICKS_PER_HOUR) + START_HOUR) % 24;

// ---------- plan steps ----------

/**
 * The legal actions a colonist can queue. A step is stored as "type|arg|arg" in agents.q and
 * minds.plan.steps. The tick engine executes them and decides whether each one succeeds; planners
 * (rules or the LLM) may only propose steps from this table. Agent arguments are agent ids.
 */
export const STEP_SPECS = {
  go: { args: ['locationId'], about: 'Walk to a location along the tube and surface routes.' },
  work: { args: ['ticks'], about: 'Work a shift at the job site. Produces goods and earns a wage.' },
  eat: { args: [], about: 'Eat from own inventory, the household pantry (at home) or the canteen.' },
  drink: { args: [], about: 'Drink from own inventory, the household pantry (at home) or the canteen.' },
  sleep: { args: ['ticks'], about: 'Sleep at home.' },
  rest: { args: ['ticks'], about: 'Rest or idle where they are.' },
  ration: { args: [], about: 'Collect the household ration at the Supply Depot.' },
  buy: { args: ['resource', 'quantity'], about: 'Buy goods at the Exchange for credits.' },
  sell: { args: ['resource', 'quantity'], about: 'Sell goods at the Exchange for credits.' },
  talk: { args: ['agentId', 'topicKey?'], about: 'Talk with someone at the same location. With a topic key, share that belief.' },
  give: { args: ['agentId', 'resource', 'quantity'], about: 'Give goods or credits to someone at the same location.' },
  steal: { args: ['target', 'resource', 'quantity'], about: 'Steal from an agent id, from "depot", or from "pantry:<householdId>". May be witnessed.' },
  help: { args: ['agentId'], about: 'Help someone at the same location: treat them if a medic, otherwise share food or water.' },
  investigate: { args: ['agentId'], about: 'Look into what is said about someone and learn whether it is true.' },
  accuse: { args: ['agentId', 'beliefKey'], about: 'Publicly accuse someone of what a held belief says about them.' },
  petition: { args: ['topic'], about: 'Speak at the council in the plaza for a cause: "rations_open", "rations_guard", "seat" or "trade".' },
  repair: { args: ['locationId'], about: 'Repair a damaged building. Uses parts from the depot.' },
  mourn: { args: ['agentId'], about: 'Grieve for someone who died.' },
  flee: { args: ['locationId'], about: 'Run to a safer location.' },
  wait: { args: ['ticks'], about: 'Do nothing for a while.' },
  // ----- iteration 2: ways to get by and ways to make trouble (docs/STORY_SPEC.md 3.2) -----
  grow: { args: ['ticks'], about: 'Tend a private grow rack at Hydroponics or home. Turns a little water into food over time.' },
  scavenge: { args: ['locationId'], about: 'Search an exposed surface site for salvage: parts, sometimes something valuable. Risky in storms.' },
  beg: { args: ['agentId', 'resource'], about: 'Ask someone at the same location for food, water or credits. They decide.' },
  borrow: { args: ['agentId', 'resource', 'quantity'], about: 'Borrow from someone at the same location. Creates a debt they remember.' },
  repay: { args: ['agentId'], about: 'Pay back what is owed to someone at the same location.' },
  barter: { args: ['agentId', 'giveResource', 'giveQuantity', 'wantResource', 'wantQuantity'], about: 'Offer a direct swap of goods with someone at the same location.' },
  bribe: { args: ['agentId', 'quantity', 'favor'], about: 'Offer credits for a favor: "silence", "vote", "ration" or "look_away".' },
  blackmail: { args: ['agentId', 'beliefKey'], about: 'Threaten to reveal what a held belief says about someone unless they pay or comply.' },
  lie: { args: ['agentId', 'subjectId', 'kind'], about: 'Tell someone a made-up story about a third person (kind: thief, hoarding, saboteur, corrupt, affair, coward).' },
  confide: { args: ['agentId', 'beliefKey?'], about: 'Share a secret or private worry with someone trusted. Deepens the bond; the secret may travel.' },
  court: { args: ['agentId'], about: 'Flirt with or court someone at the same location.' },
  comfort: { args: ['agentId'], about: 'Console someone who is grieving, afraid or desperate.' },
  threaten: { args: ['agentId'], about: 'Intimidate someone at the same location. Raises their fear; may provoke them.' },
  sabotage: { args: ['locationId'], about: 'Secretly damage equipment at a location. May be witnessed.' },
  smuggle: { args: ['resource', 'quantity'], about: 'Trade off the books with shuttle crews at the Landing Pad, at better prices and real risk.' },
  rally: { args: ['topic'], about: 'Gather supporters in the plaza for a cause: "strike", "rations_open", "recall_chair" or "trade".' },
  strike: { args: ['ticks'], about: 'Refuse to work, publicly, as a protest.' },
  reconcile: { args: ['agentId'], about: 'Apologise to or make peace with someone at the same location.' },
  eavesdrop: { args: ['agentId'], about: 'Listen in on someone at the same location to learn what they believe or hide.' },
  hide: { args: ['resource', 'quantity'], about: 'Stash goods out of sight so others cannot find or take them.' },
  confess: { args: ['beliefKey'], about: 'Publicly admit to something they did or hid.' },
  ...SOCIETY_STEP_SPECS,
} as const;
export type StepType = keyof typeof STEP_SPECS;
export type Step = { type: StepType; args: string[] };

export const encodeStep = (type: StepType, ...args: (string | number)[]): string => [type, ...args].join('|');

export function decodeStep(encoded: string): Step | null {
  const [type, ...args] = encoded.split('|');
  return type in STEP_SPECS ? { type: type as StepType, args } : null;
}

// ---------- transaction ----------

export type Tx = {
  ctx: MutationCtx;
  /** Working copy. Mutate freely; commitTx writes it once. Never patch the world document directly. */
  world: WorldDoc;
  tick: number;
  /** The version every row touched by this mutation is stamped with. */
  version: number;
  agents: Map<string, AgentDoc>;
  minds: Map<string, MindDoc>;
  dirtyAgents: Set<string>;
  dirtyMinds: Set<string>;
  rosterLoc: string[];
  rosterSt: string[];
  index: AgentId[] | null;
  indexDirty: boolean;
  /** Working copies of households (pantries, rations) and factions, written once by commitTx. */
  households: Map<string, HouseholdDoc>;
  dirtyHouseholds: Set<string>;
  factions: FactionDoc[] | null;
  dirtyFactions: Set<string>;
  /** Events emitted so far, in order. */
  eventIds: EventId[];
};

export function beginTx(ctx: MutationCtx, world: WorldDoc): Tx {
  return {
    ctx,
    world: JSON.parse(JSON.stringify(world)) as WorldDoc,
    tick: world.tick,
    version: world.version + 1,
    agents: new Map(),
    minds: new Map(),
    dirtyAgents: new Set(),
    dirtyMinds: new Set(),
    rosterLoc: world.roster.loc.split(''),
    rosterSt: world.roster.st.split(''),
    index: null,
    indexDirty: false,
    households: new Map(),
    dirtyHouseholds: new Set(),
    factions: null,
    dirtyFactions: new Set(),
    eventIds: [],
  };
}

/** The working copy of an agent. Mutate it, then call touch. */
export async function loadAgent(tx: Tx, id: AgentId): Promise<AgentDoc | null> {
  const cached = tx.agents.get(id);
  if (cached) return cached;
  const doc = await tx.ctx.db.get(id);
  if (!doc || doc.worldId !== tx.world._id) return null;
  const copy = JSON.parse(JSON.stringify(doc)) as AgentDoc;
  tx.agents.set(id, copy);
  return copy;
}

/** Registers a document read elsewhere (an index scan) so later loads return the same working copy. */
export function adoptAgent(tx: Tx, doc: AgentDoc): AgentDoc {
  const cached = tx.agents.get(doc._id);
  if (cached) return cached;
  const copy = JSON.parse(JSON.stringify(doc)) as AgentDoc;
  tx.agents.set(doc._id, copy);
  return copy;
}

function rosterState(a: AgentDoc): string {
  if (!a.alive) return ROSTER_DEAD;
  if (a.move) return ROSTER_TRANSIT;
  if (a.activity === 'sleeping') return ROSTER_ASLEEP;
  if (a.activity === 'working') return ROSTER_WORKING;
  return ROSTER_AWAKE;
}

/** Marks an agent changed and keeps the roster current. Call after every mutation of a working copy. */
export function touch(tx: Tx, a: AgentDoc): void {
  tx.dirtyAgents.add(a._id);
  while (tx.rosterLoc.length <= a.seq) {
    tx.rosterLoc.push(locChar('plaza'));
    tx.rosterSt.push(ROSTER_DEAD);
  }
  tx.rosterLoc[a.seq] = locChar(a.locationId);
  tx.rosterSt[a.seq] = rosterState(a);
}

export async function loadMind(tx: Tx, a: AgentDoc): Promise<MindDoc | null> {
  if (!a.mindId) return null;
  const cached = tx.minds.get(a.mindId);
  if (cached) return cached;
  const doc = await tx.ctx.db.get(a.mindId);
  if (!doc) return null;
  const copy = JSON.parse(JSON.stringify(doc)) as MindDoc;
  tx.minds.set(a.mindId, copy);
  return copy;
}

export const touchMind = (tx: Tx, m: MindDoc): void => void tx.dirtyMinds.add(m._id);

/** The working copy of a household. Mutate it, then call touchHousehold. */
export async function loadHousehold(tx: Tx, id: Id<'households'> | undefined): Promise<HouseholdDoc | null> {
  if (!id) return null;
  const cached = tx.households.get(id);
  if (cached) return cached;
  const doc = await tx.ctx.db.get(id);
  if (!doc || doc.worldId !== tx.world._id) return null;
  const copy = JSON.parse(JSON.stringify(doc)) as HouseholdDoc;
  tx.households.set(id, copy);
  return copy;
}

export const touchHousehold = (tx: Tx, h: HouseholdDoc): void => void tx.dirtyHouseholds.add(h._id);

/** Working copies of the world's factions. Mutate one, then call touchFaction. */
export async function loadFactions(tx: Tx): Promise<FactionDoc[]> {
  if (tx.factions) return tx.factions;
  const docs = await tx.ctx.db
    .query('factions')
    .withIndex('by_world', (q) => q.eq('worldId', tx.world._id))
    .collect();
  tx.factions = docs.map((f) => JSON.parse(JSON.stringify(f)) as FactionDoc);
  return tx.factions;
}

export const touchFaction = (tx: Tx, f: FactionDoc): void => void tx.dirtyFactions.add(f._id);

/** Agent ids by seq. */
export async function agentIndex(tx: Tx): Promise<AgentId[]> {
  if (tx.index) return tx.index;
  const row = await tx.ctx.db
    .query('worldIndex')
    .withIndex('by_world', (q) => q.eq('worldId', tx.world._id))
    .first();
  tx.index = row ? [...row.agentIds] : [];
  return tx.index;
}

/** Registers a newly inserted agent (create_character) in the index and the roster. */
export async function registerAgent(tx: Tx, a: AgentDoc): Promise<void> {
  const index = await agentIndex(tx);
  index[a.seq] = a._id;
  tx.indexDirty = true;
  tx.agents.set(a._id, a);
  touch(tx, a);
}

/**
 * Ids of the living agents at a location, from the roster (no agent reads). People in transit are
 * never included. By default the sleeping are excluded too, because they perceive nothing.
 */
export async function agentsAt(tx: Tx, locationId: string, options: { includeAsleep?: boolean; exclude?: AgentId[] } = {}): Promise<AgentId[]> {
  const index = await agentIndex(tx);
  const want = locChar(locationId);
  const out: AgentId[] = [];
  for (let seq = 0; seq < tx.rosterLoc.length; seq++) {
    if (tx.rosterLoc[seq] !== want) continue;
    const st = tx.rosterSt[seq];
    if (st === ROSTER_DEAD || st === ROSTER_TRANSIT) continue;
    if (st === ROSTER_ASLEEP && !options.includeAsleep) continue;
    const id = index[seq];
    if (id && !options.exclude?.includes(id)) out.push(id);
  }
  return out;
}

/** Writes every changed agent and mind and the world document. Call exactly once, last. */
export async function commitTx(tx: Tx): Promise<void> {
  for (const id of tx.dirtyAgents) {
    const a = tx.agents.get(id)!;
    a.updatedAtVersion = tx.version;
    a.dueTick = a.alive ? a.busyUntilTick : NEVER_DUE;
    const { _id, _creationTime, ...fields } = a;
    await tx.ctx.db.replace(_id, fields);
  }
  for (const id of tx.dirtyMinds) {
    const { _id, _creationTime, ...fields } = tx.minds.get(id)!;
    await tx.ctx.db.replace(_id, fields);
  }
  for (const id of tx.dirtyHouseholds) {
    const { _id, _creationTime, ...fields } = tx.households.get(id)!;
    await tx.ctx.db.replace(_id, fields);
  }
  for (const f of tx.factions ?? []) {
    if (!tx.dirtyFactions.has(f._id)) continue;
    const { _id, _creationTime, ...fields } = f;
    await tx.ctx.db.replace(_id, fields);
  }
  if (tx.indexDirty && tx.index) {
    const row = await tx.ctx.db
      .query('worldIndex')
      .withIndex('by_world', (q) => q.eq('worldId', tx.world._id))
      .first();
    if (row) await tx.ctx.db.patch(row._id, { agentIds: tx.index });
  }
  tx.world.roster = { loc: tx.rosterLoc.join(''), st: tx.rosterSt.join('') };
  tx.world.version = tx.version;
  const { _id, _creationTime, ...fields } = tx.world;
  await tx.ctx.db.replace(_id, fields);
}

// ---------- events and memory ----------

export type EventInput = {
  category: EventCategory;
  /** Snake case, e.g. conversation, trade, gift, theft, death, drought, storm, rumor_started. */
  eventType: string;
  /** Fact-grounded sentence with real names. Shown to the player as is. */
  summary: string;
  salience: number; // 0..1
  actorId?: AgentId;
  participantIds?: AgentId[];
  locationId?: string;
  /** Parent in the cause chain. Only set it when that event really caused this one. */
  causationEventId?: EventId;
  visibility?: 'public' | 'local' | 'private';
  facts?: unknown;
  /** Who else remembers it: explicit ids, or 'location' for awake bystanders at locationId. */
  witnesses?: AgentId[] | 'location';
  /** Overrides the banner rule (salience 0.7 or more, rate limited). */
  banner?: boolean;
};

export const MAX_WITNESSES = 12;
const BANNER_SALIENCE = 0.7;
const BANNER_GAP_TICKS = 2;

export const salienceTier = (salience: number): number => (salience >= 0.8 ? 3 : salience >= 0.55 ? 2 : salience >= 0.3 ? 1 : 0);

/**
 * Appends an event to the chronicle and writes a memory of it for the actor, the participants and
 * the witnesses. Returns the event id and the ids of everyone who now remembers it.
 */
export async function emitEvent(tx: Tx, e: EventInput): Promise<{ eventId: EventId; witnessIds: AgentId[] }> {
  const salience = clamp(round2(e.salience), 0, 1);
  let banner = e.banner ?? (salience >= BANNER_SALIENCE && (salience >= 0.85 || tx.tick - tx.world.lastBannerTick >= BANNER_GAP_TICKS));
  if (e.visibility === 'private' && e.banner === undefined) banner = false;
  if (banner) tx.world.lastBannerTick = tx.tick;
  const participantIds = [...new Set(e.participantIds ?? [])].filter((id) => id !== e.actorId);
  const eventId = await tx.ctx.db.insert('events', {
    worldId: tx.world._id,
    tick: tx.tick,
    version: tx.version,
    category: e.category,
    eventType: e.eventType,
    actorId: e.actorId,
    participantIds,
    locationId: e.locationId,
    summary: e.summary,
    salience,
    tier: salienceTier(salience),
    causationEventId: e.causationEventId,
    banner,
    visibility: e.visibility ?? (e.locationId ? 'local' : 'public'),
    facts: e.facts,
  });
  tx.eventIds.push(eventId);

  const remembered = new Map<string, string>();
  if (e.actorId) remembered.set(e.actorId, 'actor');
  for (const id of participantIds) remembered.set(id, 'participant');
  let witnesses: AgentId[] = [];
  if (e.witnesses === 'location' && e.locationId) witnesses = (await agentsAt(tx, e.locationId)).slice(0, MAX_WITNESSES + remembered.size);
  else if (Array.isArray(e.witnesses)) witnesses = e.witnesses;
  const witnessIds: AgentId[] = [];
  for (const id of witnesses) {
    if (remembered.has(id) || witnessIds.length >= MAX_WITNESSES) continue;
    remembered.set(id, 'witness');
    witnessIds.push(id);
  }
  for (const [agentId, role] of remembered) {
    await tx.ctx.db.insert('memories', { worldId: tx.world._id, agentId: agentId as AgentId, eventId, tick: tx.tick, salience, role });
  }
  return { eventId, witnessIds };
}

// ---------- relationships ----------

export type RelationshipDelta = { affinity?: number; trust?: number; fear?: number; obligation?: number; kind?: string };

/**
 * Shifts how from feels about to (creating the tie as an acquaintance if needed) and keeps to's
 * standing, the sum of what others think of them, in step.
 */
export async function adjustRelationship(tx: Tx, from: AgentDoc, to: AgentDoc, delta: RelationshipDelta): Promise<Doc<'relationships'>> {
  const existing = await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_to', (q) => q.eq('fromAgentId', from._id).eq('toAgentId', to._id))
    .first();
  const before = existing ? standingWeight(existing.affinity, existing.trust) : 0;
  const affinity = round2(clamp((existing?.affinity ?? 0) + (delta.affinity ?? 0), -1, 1));
  const trust = round2(clamp((existing?.trust ?? 0) + (delta.trust ?? 0), -1, 1));
  const fear = round2(clamp((existing?.fear ?? 0) + (delta.fear ?? 0), 0, 1));
  const obligation = round2(clamp((existing?.obligation ?? 0) + (delta.obligation ?? 0), -1, 1));
  let kind = delta.kind ?? existing?.kind ?? 'acquaintance';
  if (!delta.kind && kind !== 'family') {
    if (affinity <= -0.45 && kind !== 'rival') kind = 'rival';
    else if (affinity >= 0.5 && (kind === 'acquaintance' || kind === 'colleague' || kind === 'rival')) kind = 'friend';
  }
  const fields = {
    kind,
    affinity,
    trust,
    fear,
    obligation,
    strength: relationshipStrength(kind, affinity, trust, fear),
    lastInteractionTick: tx.tick,
    toName: to.name,
    toAlive: to.alive,
  };
  to.standing = round2(to.standing + standingWeight(affinity, trust) - before);
  touch(tx, to);
  if (existing) {
    await tx.ctx.db.patch(existing._id, fields);
    return { ...existing, ...fields };
  }
  const id = await tx.ctx.db.insert('relationships', { worldId: tx.world._id, fromAgentId: from._id, toAgentId: to._id, ...fields });
  return (await tx.ctx.db.get(id))!;
}

// ---------- beliefs ----------

export type BeliefInput = {
  /** Mechanical meaning: hoarding, thief, saboteur, corrupt, hero, untrustworthy, admirable, scarcity, death, windfall, custom... */
  kind: string;
  /** Display text with real names. A belief can be false. */
  text: string;
  /** -1..1: how the belief colours the holder's view of the subject. */
  valence: number;
  confidence: number; // 0..1
  sourceType: 'observed' | 'told' | 'rumor' | 'divine' | 'inference';
  subjectAgentId?: AgentId;
  subjectName?: string;
  /** Key for beliefs about the world rather than a person. */
  worldKey?: string;
  sourceAgentId?: AgentId;
  sourceName?: string;
  /** The event that started this idea in the colony. Carried along as it spreads. */
  originEventId?: EventId;
  /** The event that makes it true, when someone saw it happen. */
  truthEventId?: EventId;
  /** Retellings between the origin and this holder. */
  hops?: number;
  private?: boolean;
};

export const beliefKey = (kind: string, subjectAgentId?: string, worldKey?: string): string =>
  subjectAgentId ? kind + ':' + subjectAgentId : (worldKey ?? kind);

/**
 * The one way an agent comes to believe something, or to believe it more. Creates or reinforces
 * the belief, refreshes the agent's conversation topics, shifts their view of the subject, and
 * invalidates plans made before they knew. delta is how much confidence rose.
 */
export async function learnBelief(tx: Tx, agent: AgentDoc, input: BeliefInput): Promise<{ beliefId: Id<'beliefs'>; key: string; created: boolean; delta: number }> {
  const key = beliefKey(input.kind, input.subjectAgentId, input.worldKey);
  const existing = await tx.ctx.db
    .query('beliefs')
    .withIndex('by_agent_key', (q) => q.eq('agentId', agent._id).eq('key', key))
    .first();
  const gained = clamp(input.confidence, 0, 1);
  let beliefId: Id<'beliefs'>;
  let delta: number;
  if (existing) {
    const confidence = round2(clamp(Math.max(existing.confidence, existing.confidence + (1 - existing.confidence) * gained * 0.5), 0, 1));
    delta = confidence - existing.confidence;
    beliefId = existing._id;
    await tx.ctx.db.patch(existing._id, {
      confidence,
      lastReinforcedTick: tx.tick,
      ...(input.sourceType === 'observed' ? { sourceType: 'observed', truthEventId: input.truthEventId ?? existing.truthEventId } : {}),
    });
  } else {
    delta = round2(gained);
    beliefId = await tx.ctx.db.insert('beliefs', {
      worldId: tx.world._id,
      agentId: agent._id,
      key,
      kind: input.kind,
      text: input.text,
      subjectAgentId: input.subjectAgentId,
      subjectName: input.subjectName,
      valence: input.valence,
      confidence: round2(gained),
      sourceType: input.sourceType,
      sourceAgentId: input.sourceAgentId,
      sourceName: input.sourceName,
      truthEventId: input.truthEventId,
      originEventId: input.originEventId,
      learnedAtTick: tx.tick,
      lastReinforcedTick: tx.tick,
      hops: input.hops ?? 0,
      private: input.private,
    });
  }

  const held = await tx.ctx.db
    .query('beliefs')
    .withIndex('by_agent_key', (q) => q.eq('agentId', agent._id))
    .collect();
  agent.topics = held
    .map((b) => ({ key: b.key, weight: topicWeight(b.kind, b.confidence) + b.lastReinforcedTick / 100_000 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((t) => t.key);
  touch(tx, agent);

  if (input.subjectAgentId && input.subjectAgentId !== agent._id && delta > 0 && input.valence !== 0) {
    const subject = await loadAgent(tx, input.subjectAgentId);
    if (subject) await adjustRelationship(tx, agent, subject, { affinity: input.valence * delta * 0.5, trust: input.valence * delta * 0.6 });
  }
  if (!existing || delta >= 0.1) {
    const mind = await loadMind(tx, agent);
    if (mind) {
      mind.stateVersion += 1;
      touchMind(tx, mind);
    }
  }
  return { beliefId, key, created: !existing, delta };
}

// ---------- plans ----------

function setActivity(a: AgentDoc, activity: ActivityKind, label: string): void {
  a.activity = activity;
  a.activityLabel = label;
}

/** Makes the agent due on this tick, abandoning the step in progress (its effects do not apply). */
export function wake(tx: Tx, a: AgentDoc): void {
  if (!a.alive) return;
  a.cur = undefined;
  a.curStartTick = undefined;
  a.interactingWithId = undefined;
  a.speech = undefined;
  if (a.move) {
    // Stop where the walk started rather than teleport to the destination.
    if (tx.tick < a.move.arriveTick) a.locationId = a.move.from;
    a.move = undefined;
  }
  a.busyUntilTick = tx.tick;
  if (a.activity !== 'idle') setActivity(a, 'idle', 'Deciding what to do');
  touch(tx, a);
}

/** Drops the queued plan so the engine plans afresh the next time the agent is due. */
export function replan(tx: Tx, a: AgentDoc, options: { now?: boolean } = {}): void {
  if (!a.alive) return;
  a.q = [];
  a.planEpoch += 1;
  if (options.now) wake(tx, a);
  else touch(tx, a);
}

/** Puts steps in front of whatever the agent had queued and makes them due now. */
export function interrupt(tx: Tx, a: AgentDoc, steps: string[]): void {
  if (!a.alive) return;
  const resumed = a.cur ? [a.cur, ...a.q] : a.q;
  wake(tx, a);
  a.q = [...steps, ...resumed].slice(0, 24);
  touch(tx, a);
}

export type PlanInput = {
  /** One sentence: what the agent is trying to do and why. */
  intent: string;
  source: 'routine' | 'template' | 'local_planner' | 'llm';
  /** Encoded steps (see STEP_SPECS) and a display label for each. */
  steps: string[];
  labels: string[];
  goalId?: string;
  causeEventId?: EventId;
  /** What prompted the decision, for the "why did they do that" panel. Omit for mundane routine. */
  trigger?: string;
  /** Start now, abandoning the current step. Otherwise the plan starts when the current step ends. */
  now?: boolean;
};

/** Commits a plan: stores it on the mind for display and queues its steps on the agent. */
export async function setPlan(tx: Tx, a: AgentDoc, plan: PlanInput): Promise<void> {
  if (!a.alive) return;
  const mind = await loadMind(tx, a);
  if (mind) {
    mind.plan = {
      intent: plan.intent,
      source: plan.source,
      goalId: plan.goalId,
      steps: plan.steps,
      labels: plan.labels,
      createdAtTick: tx.tick,
      causeEventId: plan.causeEventId,
    };
    if (plan.trigger) mind.lastThought = { tick: tx.tick, trigger: plan.trigger, intent: plan.intent, source: plan.source === 'llm' ? 'llm' : 'rules' };
    touchMind(tx, mind);
  }
  if (plan.now) wake(tx, a);
  a.q = [...plan.steps];
  a.planEpoch += 1;
  touch(tx, a);
}

// ---------- death ----------

/** Causes of death that make the bereaved look for someone to blame. */
const VIOLENT_CAUSE = /murder|kill|stab|shot|poison|strangl|attack|beat|violen|blood/i;

/**
 * Kills an agent: writes the death, the public event and the population count, marks every tie to
 * them, vacates their role, and puts grief in front of whatever their family and friends were doing.
 * The death ripples: bystanders are shaken, a faction that loses its leader picks a successor, and
 * a violent death sets the bereaved suspecting the victim's rivals.
 */
export async function killAgent(
  tx: Tx,
  a: AgentDoc,
  death: { cause: string; summary?: string; causationEventId?: EventId; category?: EventCategory; salience?: number },
): Promise<EventId | null> {
  if (!a.alive) return null;
  a.alive = false;
  if (a.move && tx.tick < a.move.arriveTick) a.locationId = a.move.from;
  a.move = undefined;
  a.cur = undefined;
  a.curStartTick = undefined;
  a.q = [];
  a.interactingWithId = undefined;
  a.speech = undefined;
  a.activity = 'dead';
  a.activityLabel = 'Died: ' + death.cause;
  a.busyUntilTick = NEVER_DUE;
  a.health = 0;
  touch(tx, a);
  const mind = await loadMind(tx, a);
  if (mind) {
    mind.death = { tick: tx.tick, cause: death.cause };
    mind.plan = undefined;
    touchMind(tx, mind);
  }
  tx.world.population = { alive: tx.world.population.alive - 1, dead: tx.world.population.dead + 1 };
  if (tx.world.focusAgentId === a._id) tx.world.focusAgentId = undefined;
  const vacated = Object.entries(tx.world.roles).filter(([, holder]) => holder === a._id).map(([role]) => role);
  for (const role of vacated) delete tx.world.roles[role];
  if (tx.world.sim) tx.world.sim.council = tx.world.sim.council.filter((id) => id !== a._id);

  const ties = await tx.ctx.db
    .query('relationships')
    .withIndex('by_to', (q) => q.eq('toAgentId', a._id))
    .collect();
  const close = ties.filter((t) => t.kind === 'family' || (t.kind === 'friend' && t.affinity >= 0.3));
  const { eventId, witnessIds } = await emitEvent(tx, {
    category: death.category ?? 'health',
    eventType: 'death',
    actorId: a._id,
    participantIds: close.map((t) => t.fromAgentId),
    locationId: a.locationId,
    summary: death.summary ?? a.name + ' died: ' + death.cause + '.',
    salience: death.salience ?? 0.9,
    causationEventId: death.causationEventId,
    visibility: 'public',
    witnesses: 'location',
    facts: { cause: death.cause },
  });
  for (const role of vacated) tx.world.vacancies.push({ occupation: a.occupation, sinceTick: tx.tick, role, eventId });
  if (vacated.length === 0 && a.occupation !== 'resident') tx.world.vacancies.push({ occupation: a.occupation, sinceTick: tx.tick, eventId });
  for (const t of ties) await tx.ctx.db.patch(t._id, { toAlive: false });
  for (const t of close) {
    const mourner = await loadAgent(tx, t.fromAgentId);
    if (!mourner || !mourner.alive) continue;
    mourner.mood = 'grieving';
    interrupt(tx, mourner, [encodeStep('mourn', a._id)]);
    await enqueueCognition(tx, mourner, {
      kind: 'plan',
      trigger: (t.kind === 'family' ? 'family member ' : 'close friend ') + a.name + ' died',
      detail: death.cause,
      priority: 0.8,
      lane: 'crisis',
      eventId,
    });
  }
  for (const id of witnessIds) {
    const witness = await loadAgent(tx, id);
    if (!witness || !witness.alive || witness.mood === 'grieving') continue;
    witness.needs.safety = Math.min(100, witness.needs.safety + 35);
    witness.mood = 'shaken';
    touch(tx, witness);
  }
  await succeedFactionLeader(tx, a, eventId);
  if (VIOLENT_CAUSE.test(death.cause)) await suspectRivals(tx, a, close, eventId);
  return eventId;
}

/** A faction that loses its leader turns to its most respected surviving officer. */
async function succeedFactionLeader(tx: Tx, dead: AgentDoc, deathEventId: EventId): Promise<void> {
  for (const f of await loadFactions(tx)) {
    if (f.key === dead.factionId) {
      f.memberCount = Math.max(0, f.memberCount - 1);
      touchFaction(tx, f);
    }
    if (f.leaderAgentId !== dead._id) continue;
    f.officerIds = f.officerIds.filter((id) => id !== dead._id);
    let heir: AgentDoc | null = null;
    for (const id of f.officerIds) {
      const officer = await loadAgent(tx, id);
      if (officer?.alive && (!heir || officer.standing > heir.standing)) heir = officer;
    }
    f.leaderAgentId = heir?._id;
    touchFaction(tx, f);
    if (!heir) continue;
    f.officerIds = f.officerIds.filter((id) => id !== heir._id);
    await emitEvent(tx, {
      category: 'politics',
      eventType: 'leadership_change',
      actorId: heir._id,
      participantIds: [dead._id],
      summary: heir.name + ' now leads the ' + f.name + ' after the death of ' + dead.name + '.',
      salience: 0.8,
      causationEventId: deathEventId,
      visibility: 'public',
    });
  }
}

/** After a violent death, the bereaved wonder aloud about the victim's worst rival. */
async function suspectRivals(tx: Tx, dead: AgentDoc, close: Doc<'relationships'>[], deathEventId: EventId): Promise<void> {
  const rivals = await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', dead._id))
    .order('desc')
    .take(16);
  const rival = rivals.filter((r) => r.toAlive && r.affinity < -0.15).sort((x, y) => x.affinity - y.affinity)[0];
  if (!rival) return;
  const suspect = await loadAgent(tx, rival.toAgentId);
  if (!suspect?.alive) return;
  const suspicious: AgentId[] = [];
  for (const t of close.slice(0, 6)) {
    const mourner = await loadAgent(tx, t.fromAgentId);
    if (!mourner?.alive || mourner._id === suspect._id) continue;
    await learnBelief(tx, mourner, {
      kind: 'suspect',
      text: suspect.name + ' may have had a hand in the death of ' + dead.name + '.',
      valence: -1,
      confidence: 0.35 + 0.3 * (1 - mourner.traits.caution),
      sourceType: 'inference',
      subjectAgentId: suspect._id,
      subjectName: suspect.name,
      originEventId: deathEventId,
    });
    suspicious.push(mourner._id);
  }
  if (suspicious.length === 0) return;
  await emitEvent(tx, {
    category: 'social',
    eventType: 'suspicion',
    actorId: suspicious[0],
    participantIds: [...suspicious, suspect._id],
    summary: 'Those closest to ' + dead.name + ' are asking whether ' + suspect.name + ', a known rival, had a hand in it.',
    salience: 0.65,
    causationEventId: deathEventId,
    visibility: 'public',
  });
}

// ---------- LLM planning queue ----------

export type CognitionRequest = {
  /** plan: choose a goal and a sequence of steps. speech: one line of dialogue for an interaction. */
  kind: 'plan' | 'speech';
  /** Why now, in plain words: "learned a rumor about Mira", "water ration cut", "followed by the player". */
  trigger: string;
  detail?: string;
  /** 0..1. Higher runs first. */
  priority: number;
  /** focus: the followed colonist. crisis: reacting to a high-salience event. normal: the rest. */
  lane: 'focus' | 'crisis' | 'normal';
  eventId?: EventId;
};

/**
 * Asks for LLM reasoning about an agent. Never blocks: the agent keeps acting on rule-based plans
 * and the result, if it arrives and still applies, replaces them. Returns false when not queued.
 */
export async function enqueueCognition(tx: Tx, a: AgentDoc, request: CognitionRequest): Promise<boolean> {
  const llm = tx.world.llm;
  if (!llm.enabled || !a.alive || !a.mindId) return false;
  if (llm.disabledUntil !== undefined && llm.disabledUntil > Date.now()) return false;
  const mind = await loadMind(tx, a);
  if (!mind) return false;
  if (request.kind === 'plan' && request.lane === 'normal' && mind.llmCooldownUntilTick > tx.tick) return false;
  const pending = await tx.ctx.db
    .query('cognitionJobs')
    .withIndex('by_agent_status', (q) => q.eq('agentId', a._id).eq('status', 'queued'))
    .first();
  if (pending) return false;
  await tx.ctx.db.insert('cognitionJobs', {
    worldId: tx.world._id,
    agentId: a._id,
    kind: request.kind,
    trigger: request.trigger,
    detail: request.detail,
    priority: clamp(request.priority, 0, 1),
    status: 'queued',
    lane: request.lane,
    enqueuedTick: tx.tick,
    mindVersion: mind.stateVersion,
    attempts: 0,
    eventId: request.eventId,
  });
  llm.queued += 1;
  await tx.ctx.scheduler.runAfter(0, internal.cognition.drain, { worldId: tx.world._id });
  return true;
}
