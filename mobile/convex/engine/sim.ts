/**
 * The simulation context for one mutation: a working copy of the world, a cache of the documents
 * touched, and the helpers every rule uses. Nothing is written until flush(), except events,
 * memories, beliefs and relationships, which are inserted or patched as they happen. Everything
 * commits or rolls back together because it all runs inside one Convex mutation.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { LOCATIONS, LOCATION_IDS, OCCUPATIONS, ROUTES, TICKS_PER_DAY, routeKey } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { NEVER_DUE } from '../lib/constants';
import { tierOf } from '../lib/events';
import { clamp, rand, round2 } from '../lib/rng';
import { ROSTER_ASLEEP, ROSTER_AWAKE, ROSTER_DEAD, ROSTER_TRANSIT, ROSTER_WORKING, locChar } from '../seed/insert';

export type Agent = Doc<'agents'>;
export type Mind = Doc<'minds'>;
export type World = Doc<'worlds'>;
export type Household = Doc<'households'>;
export type Faction = Doc<'factions'>;
export type Goal = Mind['goals'][number];
export type AgentId = Id<'agents'>;
export type EventId = Id<'events'>;

export type EmitInput = {
  category: 'environment' | 'economy' | 'social' | 'politics' | 'health' | 'action' | 'intervention';
  eventType: string;
  actorId?: AgentId;
  participantIds?: AgentId[];
  locationId?: string;
  summary: string;
  salience: number;
  cause?: EventId;
  visibility?: 'public' | 'local' | 'private';
  /** Force or forbid a banner. Left undefined, the governor decides from salience and recency. */
  banner?: boolean;
  facts?: Record<string, unknown>;
  /** Others at the scene who saw it and remember it. */
  witnessIds?: AgentId[];
};

export type Emitted = { id: EventId; tick: number; salience: number; banner: boolean; actorId?: AgentId; participantIds: AgentId[]; eventType: string };

export function locName(id: string): string {
  return LOCATIONS[id as LocationId]?.name ?? id;
}

export function occupationLabel(id: string): string {
  return OCCUPATIONS.find((o) => o.id === id)?.label ?? id;
}

export function isLocationId(id: unknown): id is LocationId {
  return typeof id === 'string' && (LOCATION_IDS as readonly string[]).includes(id);
}

function strip<T extends { _id: unknown; _creationTime: number }>(doc: T): Omit<T, '_id' | '_creationTime'> {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}

export class Sim {
  readonly ctx: MutationCtx;
  world: World;
  /** The tick being processed. */
  tick: number;
  /** Stamped on every agent and event this mutation writes. */
  readonly version: number;
  readonly seed: number;
  readonly emitted: Emitted[] = [];
  /** Documents read and written, for cost reporting. */
  readonly cost = { reads: 0, writes: 0 };

  private agents = new Map<string, Agent>();
  private dirtyAgents = new Set<string>();
  private minds = new Map<string, Mind>();
  private dirtyMinds = new Set<string>();
  private households = new Map<string, Household>();
  private dirtyHouseholds = new Set<string>();
  private factionList: Faction[] | null = null;
  private dirtyFactions = new Set<string>();
  private indexDoc: Doc<'worldIndex'> | null = null;
  private indexDirty = false;
  private rosterLoc: string[];
  private rosterSt: string[];
  private blockedCache: { tick: number; set: Set<string> } | null = null;

  constructor(ctx: MutationCtx, world: World) {
    this.ctx = ctx;
    this.world = world;
    this.tick = world.tick;
    this.version = world.version + 1;
    this.seed = world.seed;
    this.rosterLoc = world.roster.loc.split('');
    this.rosterSt = world.roster.st.split('');
  }

  static async open(ctx: MutationCtx, worldId: Id<'worlds'>): Promise<Sim | null> {
    const world = await ctx.db.get(worldId);
    if (!world || world.deleted) return null;
    const sim = new Sim(ctx, world);
    sim.cost.reads += 1;
    return sim;
  }

  // ----- time and chance -----

  get day(): number {
    return Math.floor(this.tick / TICKS_PER_DAY);
  }

  get tickOfDay(): number {
    return this.tick % TICKS_PER_DAY;
  }

  rand(entity: number | string, salt: number | string = 0): number {
    return rand(this.seed, this.tick, entity, salt);
  }

  // ----- agents -----

  cacheAgent(agent: Agent): Agent {
    const existing = this.agents.get(agent._id);
    if (existing) return existing;
    this.agents.set(agent._id, agent);
    return agent;
  }

  async agent(id: AgentId | undefined | null): Promise<Agent | null> {
    if (!id) return null;
    const cached = this.agents.get(id);
    if (cached) return cached;
    const doc = await this.ctx.db.get(id);
    this.cost.reads += 1;
    if (!doc || doc.worldId !== this.world._id) return null;
    this.agents.set(id, doc);
    return doc;
  }

  async agentBySeq(seq: number): Promise<Agent | null> {
    for (const a of this.agents.values()) if (a.seq === seq) return a;
    const doc = await this.ctx.db
      .query('agents')
      .withIndex('by_world_seq', (q) => q.eq('worldId', this.world._id).eq('seq', seq))
      .unique();
    this.cost.reads += 1;
    return doc ? this.cacheAgent(doc) : null;
  }

  cachedAgents(): Agent[] {
    return [...this.agents.values()];
  }

  /** Marks an agent changed: stamps the version and mirrors location and state into the roster. */
  touch(agent: Agent): void {
    agent.updatedAtVersion = this.version;
    agent.dueTick = agent.alive ? agent.busyUntilTick : NEVER_DUE;
    this.dirtyAgents.add(agent._id);
    this.rosterLoc[agent.seq] = locChar(agent.locationId);
    this.rosterSt[agent.seq] = !agent.alive
      ? ROSTER_DEAD
      : agent.move
        ? ROSTER_TRANSIT
        : agent.activity === 'sleeping'
          ? ROSTER_ASLEEP
          : agent.activity === 'working'
            ? ROSTER_WORKING
            : ROSTER_AWAKE;
  }

  async mind(agent: Agent): Promise<Mind> {
    const cached = this.minds.get(agent._id);
    if (cached) return cached;
    const doc = agent.mindId ? await this.ctx.db.get(agent.mindId) : null;
    this.cost.reads += 1;
    if (!doc) throw new Error('agent ' + agent.name + ' has no mind');
    this.minds.set(agent._id, doc);
    return doc;
  }

  touchMind(agent: Agent): void {
    this.dirtyMinds.add(agent._id);
  }

  /** Registers a document created in this mutation so later steps see it. */
  adopt(agent: Agent, mind: Mind): void {
    this.agents.set(agent._id, agent);
    this.minds.set(agent._id, mind);
    while (this.rosterLoc.length <= agent.seq) {
      this.rosterLoc.push(locChar(agent.locationId));
      this.rosterSt.push(ROSTER_AWAKE);
    }
    this.touch(agent);
  }

  // ----- households, factions, index -----

  async household(id: Id<'households'> | undefined): Promise<Household | null> {
    if (!id) return null;
    const cached = this.households.get(id);
    if (cached) return cached;
    const doc = await this.ctx.db.get(id);
    this.cost.reads += 1;
    if (!doc) return null;
    this.households.set(id, doc);
    return doc;
  }

  touchHousehold(h: Household): void {
    this.dirtyHouseholds.add(h._id);
  }

  adoptHousehold(h: Household): void {
    this.households.set(h._id, h);
  }

  async factions(): Promise<Faction[]> {
    if (!this.factionList) {
      this.factionList = await this.ctx.db
        .query('factions')
        .withIndex('by_world', (q) => q.eq('worldId', this.world._id))
        .collect();
      this.cost.reads += this.factionList.length;
    }
    return this.factionList;
  }

  async faction(key: string | undefined): Promise<Faction | null> {
    if (!key) return null;
    return (await this.factions()).find((f) => f.key === key) ?? null;
  }

  touchFaction(f: Faction): void {
    this.dirtyFactions.add(f._id);
  }

  async agentIds(): Promise<AgentId[]> {
    if (!this.indexDoc) {
      this.indexDoc = await this.ctx.db
        .query('worldIndex')
        .withIndex('by_world', (q) => q.eq('worldId', this.world._id))
        .unique();
      this.cost.reads += 1;
      if (!this.indexDoc) throw new Error('world index missing');
    }
    return this.indexDoc.agentIds;
  }

  async registerAgentId(seq: number, id: AgentId): Promise<void> {
    const ids = await this.agentIds();
    ids[seq] = id;
    this.indexDirty = true;
  }

  // ----- roster: who is where, without reading agent documents -----

  /** Seqs of living agents at a location. By default only those awake and not in transit. */
  presentAt(locationId: string, options: { includeAsleep?: boolean; except?: number } = {}): number[] {
    const c = locChar(locationId);
    const out: number[] = [];
    for (let seq = 0; seq < this.rosterLoc.length; seq++) {
      if (this.rosterLoc[seq] !== c || seq === options.except) continue;
      const st = this.rosterSt[seq];
      if (st === ROSTER_AWAKE || st === ROSTER_WORKING || (options.includeAsleep && st === ROSTER_ASLEEP)) out.push(seq);
    }
    return out;
  }

  workingAt(locationId: string): number[] {
    const c = locChar(locationId);
    const out: number[] = [];
    for (let seq = 0; seq < this.rosterLoc.length; seq++) if (this.rosterLoc[seq] === c && this.rosterSt[seq] === ROSTER_WORKING) out.push(seq);
    return out;
  }

  rosterState(seq: number): { loc: string; st: string } {
    return { loc: this.rosterLoc[seq], st: this.rosterSt[seq] };
  }

  isPresentAwake(seq: number, locationId: string): boolean {
    const st = this.rosterSt[seq];
    return this.rosterLoc[seq] === locChar(locationId) && (st === ROSTER_AWAKE || st === ROSTER_WORKING);
  }

  /** Seqs of every living agent, wherever they are. */
  livingSeqs(): number[] {
    const out: number[] = [];
    for (let seq = 0; seq < this.rosterSt.length; seq++) if (this.rosterSt[seq] !== ROSTER_DEAD) out.push(seq);
    return out;
  }

  /** Loads up to `cap` awake agents at a location, chosen by a seeded shuffle. */
  async witnesses(locationId: string, exceptIds: AgentId[], cap: number, salt: string): Promise<Agent[]> {
    const seqs = this.presentAt(locationId);
    const ordered = seqs
      .map((seq) => ({ seq, r: this.rand(seq, 'witness:' + salt) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.seq);
    const out: Agent[] = [];
    for (const seq of ordered) {
      if (out.length >= cap) break;
      const agent = await this.agentBySeq(seq);
      if (agent && agent.alive && !exceptIds.includes(agent._id)) out.push(agent);
    }
    return out;
  }

  // ----- world state helpers -----

  stock(locationId: string, resource: string): number {
    return this.world.stockpiles[locationId]?.[resource] ?? 0;
  }

  /** Adds to a stockpile and returns the amount actually applied. Stock never goes below zero. */
  addStock(locationId: string, resource: string, delta: number): number {
    const pile = (this.world.stockpiles[locationId] ??= {});
    const before = pile[resource] ?? 0;
    const after = Math.max(0, before + delta);
    pile[resource] = after;
    return after - before;
  }

  effect(type: string): World['activeEffects'][number] | undefined {
    return this.world.activeEffects.find((e) => e.type === type && e.startTick <= this.tick && e.endTick > this.tick);
  }

  stormAt(locationId: string): World['activeEffects'][number] | undefined {
    return this.world.activeEffects.find(
      (e) => e.type === 'storm' && e.startTick <= this.tick && e.endTick > this.tick && e.locationIds.includes(locationId),
    );
  }

  /** Route keys closed to travel right now: surface routes touching a location under a storm. */
  blockedRoutes(): Set<string> {
    if (this.blockedCache && this.blockedCache.tick === this.tick) return this.blockedCache.set;
    const set = new Set<string>();
    const storms = this.world.activeEffects.filter((e) => e.type === 'storm' && e.startTick <= this.tick && e.endTick > this.tick);
    if (storms.length > 0) {
      for (const route of ROUTES) {
        if (!route.surface) continue;
        if (storms.some((s) => s.locationIds.includes(route.a) || s.locationIds.includes(route.b))) set.add(routeKey(route.a, route.b));
      }
    }
    this.blockedCache = { tick: this.tick, set };
    return set;
  }

  invalidateRoutes(): void {
    this.blockedCache = null;
  }

  // ----- events and memories -----

  private wantsBanner(salience: number): boolean {
    const since = this.tick - this.world.lastBannerTick;
    const threshold = since < 6 ? 0.8 : since < 10 ? 0.62 : since < 14 ? 0.5 : since < 18 ? 0.4 : 0.28;
    return salience >= threshold;
  }

  async emit(input: EmitInput): Promise<EventId> {
    const salience = round2(clamp(input.salience, 0, 1));
    const banner = input.banner ?? this.wantsBanner(salience);
    if (banner) this.world.lastBannerTick = this.tick;
    const participantIds = [...new Set(input.participantIds ?? [])].filter((id) => id !== input.actorId);
    const id = await this.ctx.db.insert('events', {
      worldId: this.world._id,
      tick: this.tick,
      version: this.version,
      category: input.category,
      eventType: input.eventType,
      actorId: input.actorId,
      participantIds,
      locationId: input.locationId,
      summary: input.summary,
      salience,
      tier: tierOf(salience),
      causationEventId: input.cause,
      banner,
      visibility: input.visibility ?? 'local',
      facts: input.facts,
    });
    this.cost.writes += 1;
    this.emitted.push({ id, tick: this.tick, salience, banner, actorId: input.actorId, participantIds, eventType: input.eventType });
    if (input.actorId) await this.remember(input.actorId, id, salience, 'actor');
    for (const p of participantIds) await this.remember(p, id, salience, 'participant');
    for (const w of input.witnessIds ?? []) {
      if (w !== input.actorId && !participantIds.includes(w)) await this.remember(w, id, salience, 'witness');
    }
    return id;
  }

  /** Adds an event to an agent's diary. Canonical history stays in the events table. */
  async remember(agentId: AgentId, eventId: EventId, salience: number, role: string): Promise<void> {
    await this.ctx.db.insert('memories', { worldId: this.world._id, agentId, eventId, tick: this.tick, salience, role });
    this.cost.writes += 1;
  }

  // ----- commit -----

  async flush(): Promise<void> {
    for (const id of this.dirtyAgents) {
      const agent = this.agents.get(id)!;
      await this.ctx.db.replace(agent._id, strip(agent));
      this.cost.writes += 1;
    }
    this.dirtyAgents.clear();
    for (const id of this.dirtyMinds) {
      const mind = this.minds.get(id)!;
      await this.ctx.db.replace(mind._id, strip(mind));
      this.cost.writes += 1;
    }
    this.dirtyMinds.clear();
    for (const id of this.dirtyHouseholds) {
      const h = this.households.get(id)!;
      await this.ctx.db.replace(h._id, strip(h));
      this.cost.writes += 1;
    }
    this.dirtyHouseholds.clear();
    for (const id of this.dirtyFactions) {
      const f = this.factionList!.find((x) => x._id === id)!;
      await this.ctx.db.replace(f._id, strip(f));
      this.cost.writes += 1;
    }
    this.dirtyFactions.clear();
    if (this.indexDirty && this.indexDoc) {
      await this.ctx.db.replace(this.indexDoc._id, strip(this.indexDoc));
      this.cost.writes += 1;
      this.indexDirty = false;
    }
    this.world.roster = { loc: this.rosterLoc.join(''), st: this.rosterSt.join('') };
    this.world.version = this.version;
    await this.ctx.db.replace(this.world._id, strip(this.world));
    this.cost.writes += 1;
  }
}
