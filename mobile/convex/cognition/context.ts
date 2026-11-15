/**
 * What a colonist knows when the LLM thinks for them: a compact, perception-limited snapshot read
 * from the database once per job. People and beliefs get short refs (p1, b1) so the prompt stays
 * small and the model can only point at things it was shown; validate.ts maps refs back to ids.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { LOCATIONS, OCCUPATIONS, TRAIT_KEYS, VALUE_KEYS, tickToClock } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { ROSTER_ASLEEP, ROSTER_DEAD, ROSTER_TRANSIT, locChar } from '../seed/insert';

export type PersonRef = {
  ref: string;
  id: Id<'agents'>;
  name: string;
  occupation: string;
  alive: boolean;
  /** At the same location right now, awake. */
  present: boolean;
  /** Where they can usually be found: their workplace. Common knowledge, unlike where they are now. */
  usualPlace: string;
  /** How the agent knows them, e.g. "friend, trusts a lot". */
  tie?: string;
};

export type BeliefRef = {
  ref: string;
  key: string;
  kind: string;
  text: string;
  confidence: number;
  sourceType: string;
  sourceName?: string;
  subjectId?: Id<'agents'>;
};

export type GoalRef = { id: string; kind: string; description: string; priority: number; source: string; targetId?: Id<'agents'> };

export type PlanContext = {
  kind: 'plan';
  tick: number;
  agentId: Id<'agents'>;
  name: string;
  /** "an elder Councilor (council chair) of the Founders' Compact". */
  identity: string;
  background: string;
  personality: string;
  values: string;
  mood: string;
  condition: string;
  inventory: string;
  credits: number;
  inv: Doc<'agents'>['inv'];
  household?: string;
  locationId: LocationId;
  homeLocationId: string;
  workLocationId?: string;
  doing: string;
  clock: string;
  world: string[];
  goals: GoalRef[];
  beliefs: BeliefRef[];
  memories: string[];
  trigger: string;
  detail?: string;
  people: PersonRef[];
};

export type SpeechContext = {
  kind: 'speech';
  tick: number;
  agentId: Id<'agents'>;
  name: string;
  identity: string;
  personality: string;
  mood: string;
  doing: string;
  place: string;
  partner: PersonRef;
  /** What the agent believes about the partner, strongest first. */
  aboutPartner: string[];
  trigger: string;
  detail?: string;
};

export type JobContext = PlanContext | SpeechContext;

const MAX_BELIEFS = 8;
const MAX_TIES = 8;
const MAX_MEMORIES = 8;
const MAX_PRESENT = 10;

const TRAIT_WORDS: Record<(typeof TRAIT_KEYS)[number], [low: string, high: string]> = {
  ambition: ['unambitious', 'ambitious'],
  empathy: ['cold', 'empathetic'],
  caution: ['reckless', 'cautious'],
  curiosity: ['incurious', 'curious'],
  sociability: ['solitary', 'sociable'],
  stubbornness: ['easily swayed', 'stubborn'],
};

/** Strong traits in words: "very cautious, stubborn, solitary". */
export function describeTraits(traits: Doc<'agents'>['traits']): string {
  const words: string[] = [];
  for (const key of TRAIT_KEYS) {
    const x = traits[key];
    if (x >= 0.7) words.push((x >= 0.85 ? 'very ' : '') + TRAIT_WORDS[key][1]);
    else if (x <= 0.3) words.push((x <= 0.15 ? 'very ' : '') + TRAIT_WORDS[key][0]);
  }
  return words.length > 0 ? words.join(', ') : 'even-tempered, nothing extreme';
}

/** "cares most about family and harmony, least about wealth". */
export function describeValues(values: Doc<'minds'>['values']): string {
  const ranked = VALUE_KEYS.slice().sort((a, b) => values[b] - values[a]);
  return 'cares most about ' + ranked[0] + ' and ' + ranked[1] + ', least about ' + ranked[ranked.length - 1];
}

const level = (pressure: number): string => (pressure >= 80 ? 'desperate' : pressure >= 60 ? 'strong' : pressure >= 40 ? 'moderate' : 'low');

function describeCondition(a: Doc<'agents'>): string {
  const needs = (['hunger', 'thirst', 'fatigue', 'safety', 'social'] as const).map((k) => k + ' ' + level(a.needs[k]) + ' (' + Math.round(a.needs[k]) + ')');
  const health = a.health >= 80 ? 'healthy' : a.health >= 50 ? 'unwell' : a.health >= 25 ? 'badly hurt or sick' : 'close to death';
  return health + ' (health ' + Math.round(a.health) + '/100). Needs, 0 fine to 100 desperate: ' + needs.join(', ');
}

function describeTie(r: Doc<'relationships'>): string {
  const feel = r.affinity >= 0.5 ? 'likes a lot' : r.affinity >= 0.15 ? 'likes' : r.affinity <= -0.5 ? 'despises' : r.affinity <= -0.15 ? 'dislikes' : 'neutral';
  const trust = r.trust >= 0.4 ? ', trusts' : r.trust <= -0.3 ? ', distrusts' : '';
  const fear = r.fear >= 0.4 ? ', fears' : '';
  return r.kind + ', ' + feel + trust + fear;
}

const occupationLabel = (id: string): string => OCCUPATIONS.find((o) => o.id === id)?.label ?? id;
const placeName = (id: string): string => LOCATIONS[id as LocationId]?.name ?? id;

/** A span of ticks in words: "under an hour", "5h", "2d". */
function span(ticks: number): string {
  const hours = Math.round(ticks / 6);
  return hours < 1 ? 'under an hour' : hours < 24 ? hours + 'h' : Math.round(hours / 24) + 'd';
}

/** Living, awake agents at a location, from the roster (the same rule as agentsAt in engine/core.ts). */
async function presentAt(ctx: QueryCtx, world: Doc<'worlds'>, locationId: string, self: Id<'agents'>): Promise<Id<'agents'>[]> {
  const row = await ctx.db
    .query('worldIndex')
    .withIndex('by_world', (q) => q.eq('worldId', world._id))
    .first();
  if (!row) return [];
  const want = locChar(locationId);
  const out: Id<'agents'>[] = [];
  for (let seq = 0; seq < world.roster.loc.length; seq++) {
    const st = world.roster.st[seq];
    if (world.roster.loc[seq] !== want || st === ROSTER_DEAD || st === ROSTER_TRANSIT || st === ROSTER_ASLEEP) continue;
    const id = row.agentIds[seq];
    if (id && id !== self) out.push(id);
  }
  return out;
}

function identityOf(a: Doc<'agents'>, ageBand: string, faction?: Doc<'factions'>): string {
  const role = a.role ? ' (' + a.role.replace(/_/g, ' ') + ')' : '';
  return (ageBand === 'elder' ? 'an elder ' : ageBand === 'young' ? 'a young ' : 'an adult ') + occupationLabel(a.occupation) + role + (faction ? ' of the ' + faction.name : ', in no faction');
}

/** Builds the context for a job, or explains why the job can no longer run. */
export async function loadJobContext(
  ctx: QueryCtx,
  job: Doc<'cognitionJobs'>,
): Promise<{ ok: true; context: JobContext; mindVersion: number } | { ok: false; reason: string }> {
  const world = await ctx.db.get(job.worldId);
  const agent = await ctx.db.get(job.agentId);
  if (!world || world.deleted || !agent) return { ok: false, reason: 'gone' };
  if (!agent.alive) return { ok: false, reason: 'dead' };
  const mind = agent.mindId ? await ctx.db.get(agent.mindId) : null;
  if (!mind) return { ok: false, reason: 'no mind' };
  const factions = await ctx.db
    .query('factions')
    .withIndex('by_world', (q) => q.eq('worldId', world._id))
    .collect();
  const faction = factions.find((f) => f.key === agent.factionId);
  const ties = await ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', agent._id))
    .order('desc')
    .take(MAX_TIES);
  const beliefDocs = (
    await ctx.db
      .query('beliefs')
      .withIndex('by_agent_key', (q) => q.eq('agentId', agent._id))
      .collect()
  ).sort((a, b) => b.confidence + b.lastReinforcedTick / 2000 - (a.confidence + a.lastReinforcedTick / 2000));

  const people: PersonRef[] = [];
  const byId = new Map<string, PersonRef>();
  const addPerson = async (id: Id<'agents'> | undefined, extra: { present?: boolean; tie?: string } = {}): Promise<PersonRef | undefined> => {
    if (!id || id === agent._id) return undefined;
    const known = byId.get(id);
    if (known) {
      if (extra.tie && !known.tie) known.tie = extra.tie;
      return known;
    }
    const doc = await ctx.db.get(id);
    if (!doc || doc.worldId !== world._id) return undefined;
    const person: PersonRef = {
      ref: 'p' + (people.length + 1),
      id,
      name: doc.name,
      occupation: occupationLabel(doc.occupation),
      alive: doc.alive,
      present: extra.present ?? false,
      usualPlace: doc.workLocationId ?? doc.homeLocationId,
      tie: extra.tie,
    };
    people.push(person);
    byId.set(id, person);
    return person;
  };

  if (job.kind === 'speech') {
    const partner = await addPerson(agent.interactingWithId, { present: true });
    if (!partner || !partner.alive) return { ok: false, reason: 'no interaction' };
    const tie = await ctx.db
      .query('relationships')
      .withIndex('by_from_to', (q) => q.eq('fromAgentId', agent._id).eq('toAgentId', partner.id))
      .first();
    if (tie) partner.tie = describeTie(tie);
    return {
      ok: true,
      mindVersion: mind.stateVersion,
      context: {
        kind: 'speech',
        tick: world.tick,
        agentId: agent._id,
        name: agent.name,
        identity: identityOf(agent, mind.ageBand, faction),
        personality: describeTraits(agent.traits),
        mood: agent.mood,
        doing: agent.activityLabel,
        place: placeName(agent.locationId),
        partner,
        aboutPartner: beliefDocs.filter((b) => b.subjectAgentId === partner.id).slice(0, 3).map((b) => b.text + ' (confidence ' + b.confidence.toFixed(1) + ')'),
        trigger: job.trigger,
        detail: job.detail,
      },
    };
  }

  // People first in the order the model most needs them: who is here, then close ties.
  const present = await presentAt(ctx, world, agent.locationId, agent._id);
  const tieTo = new Map(ties.map((t) => [t.toAgentId as string, t]));
  present.sort((a, b) => (tieTo.get(b)?.strength ?? 0) - (tieTo.get(a)?.strength ?? 0));
  for (const id of present.slice(0, MAX_PRESENT)) await addPerson(id, { present: true, tie: tieTo.has(id) ? describeTie(tieTo.get(id)!) : undefined });
  for (const t of ties) await addPerson(t.toAgentId, { tie: describeTie(t) });
  const household = agent.householdId ? await ctx.db.get(agent.householdId) : null;
  for (const id of household?.memberIds ?? []) await addPerson(id, { tie: 'household' });
  const activeGoals = mind.goals.filter((g) => g.status === 'active').sort((a, b) => b.priority - a.priority).slice(0, 4);
  for (const g of activeGoals) await addPerson(g.targetAgentId);
  const beliefs: BeliefRef[] = [];
  for (const b of beliefDocs.slice(0, MAX_BELIEFS)) {
    if (b.subjectAgentId) await addPerson(b.subjectAgentId);
    beliefs.push({ ref: 'b' + (beliefs.length + 1), key: b.key, kind: b.kind, text: b.text, confidence: b.confidence, sourceType: b.sourceType, sourceName: b.sourceName, subjectId: b.subjectAgentId });
  }

  const memoryDocs = await ctx.db
    .query('memories')
    .withIndex('by_agent_tick', (q) => q.eq('agentId', agent._id))
    .order('desc')
    .take(24);
  const memories: string[] = [];
  const seen = new Set<string>();
  for (const m of memoryDocs) {
    if (memories.length >= MAX_MEMORIES || seen.has(m.eventId) || (m.salience < 0.25 && memories.length >= 3)) continue;
    seen.add(m.eventId);
    const event = await ctx.db.get(m.eventId);
    if (event) memories.push((event.tick >= world.tick - 3 ? 'just now' : span(world.tick - event.tick) + ' ago') + ': ' + event.summary);
  }

  const clock = tickToClock(world.tick);
  const nightShift = agent.dayOffset >= 48 && agent.dayOffset <= 108;
  const worldLines: string[] = [];
  for (const e of world.activeEffects) worldLines.push('ACTIVE: ' + e.label + ' (severity ' + e.severity.toFixed(1) + ', ends in ' + span(e.endTick - world.tick) + ')');
  const damaged = Object.entries(world.damage).filter(([, d]) => d > 0.05);
  if (damaged.length > 0) worldLines.push('Damaged buildings: ' + damaged.map(([loc, d]) => placeName(loc) + ' ' + Math.round(d * 100) + '%').join(', '));
  worldLines.push('Exchange prices in credits: ' + Object.entries(world.prices).map(([r, p]) => r + ' ' + p).join(', '));
  worldLines.push('Depot rations: ' + ['full', 'reduced', 'emergency'][world.econ.rationLevel] + '. Depot reserve: ' + Object.entries(world.stockpiles.depot ?? {}).map(([r, n]) => r + ' ' + Math.round(n)).join(', '));
  if (world.econ.wagesUnpaid > 0) worldLines.push('The treasury is behind on wages.');
  worldLines.push('Population ' + world.population.alive + ' alive, ' + world.population.dead + ' dead.');

  const invParts = (['food', 'water', 'parts', 'medicine'] as const).filter((r) => agent.inv[r] > 0).map((r) => agent.inv[r] + ' ' + r);
  return {
    ok: true,
    mindVersion: mind.stateVersion,
    context: {
      kind: 'plan',
      tick: world.tick,
      agentId: agent._id,
      name: agent.name,
      identity: identityOf(agent, mind.ageBand, faction),
      background: mind.background,
      personality: describeTraits(agent.traits),
      values: describeValues(mind.values),
      mood: agent.mood,
      condition: describeCondition(agent),
      inventory: (invParts.length > 0 ? invParts.join(', ') : 'no goods') + '; ' + Math.round(agent.inv.credits) + ' credits',
      credits: agent.inv.credits,
      inv: agent.inv,
      household: household
        ? household.name + ' at ' + placeName(household.homeLocationId) + ', pantry ' + household.pantry.food + ' food and ' + household.pantry.water + ' water'
        : undefined,
      locationId: agent.locationId as LocationId,
      homeLocationId: agent.homeLocationId,
      workLocationId: agent.workLocationId,
      doing: agent.activityLabel,
      clock: clock.label + (nightShift ? ' (works the night shift)' : ''),
      world: worldLines,
      goals: activeGoals.map((g) => ({ id: g.id, kind: g.kind, description: g.description, priority: g.priority, source: g.source, targetId: g.targetAgentId })),
      beliefs,
      memories,
      trigger: job.trigger,
      detail: job.detail,
      people,
    },
  };
}
