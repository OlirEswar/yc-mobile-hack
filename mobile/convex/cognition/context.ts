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
import { beliefKey } from '../engine/core';
import { societyContext, societyLookup } from '../society/detail';
import { describeStoryline, liveStorylines } from '../storyteller/storylines';

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
  householdId?: Id<'households'>;
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

/** The character sheet a prompt needs. Never shown to the player as is: the secret stays here. */
export type PersonaContext = {
  epithet: string;
  want: string;
  need: string;
  fear: string;
  flaw: string;
  voice: string;
  strategies: string[];
  /** "rising: torn between the ledger and her brother". */
  arc: string;
};

/** Their own secret, usable as the belief ref s1 in confess and confide. */
export type SecretRef = { ref: 's1'; key: string; text: string; exposed: boolean };

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
  householdId?: Id<'households'>;
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
  /** True for the colonist the player follows: the prompt asks for a monologue line too. */
  followed: boolean;
  persona?: PersonaContext;
  secret?: SecretRef;
  /** Society layer lines in words (organizations, family, status, obsession). */
  society: string[];
  /** Organizations, pets, children and discoveries the plan may name in society steps. */
  societyRefs: Awaited<ReturnType<typeof societyLookup>>;
  /** Live storylines they are part of, one line each. */
  storylines: string[];
  /** Their latest monologue lines, newest first (followed colonist only). */
  thoughts: string[];
};

export type ThoughtContext = {
  kind: 'thought';
  tick: number;
  agentId: Id<'agents'>;
  name: string;
  identity: string;
  personality: string;
  persona?: PersonaContext;
  secret?: SecretRef;
  society: string[];
  mood: string;
  /** How their body feels, in words. */
  feeling: string;
  place: string;
  doing: string;
  intent?: string;
  storylines: string[];
  memories: string[];
  recent: string[];
  trigger: string;
  detail?: string;
};

export type AskContext = Omit<PlanContext, 'kind'> & {
  kind: 'ask';
  question: string;
  /** How far they trust a voice in their head, in words. */
  openness: string;
  history: { question: string; answer: string }[];
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
  prices: string;
  partner: PersonRef;
  voice?: string;
  /** What the agent believes about the partner, strongest first. */
  aboutPartner: string[];
  trigger: string;
  detail?: string;
};

export type JobContext = PlanContext | SpeechContext | ThoughtContext;

const MAX_BELIEFS = 8;
const MAX_TIES = 8;
const MAX_MEMORIES = 8;
const MAX_PRESENT = 10;
const MAX_INCOMING = 40;

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

const describePrices = (world: Doc<'worlds'>): string =>
  'Exchange prices in credits per unit: ' + Object.entries(world.prices).map(([r, p]) => r + ' ' + p).join(', ');

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
  const owes = r.obligation >= 0.5 ? ', deep in their debt' : r.obligation >= 0.2 ? ', owes them' : r.obligation <= -0.2 ? ', is owed by them' : '';
  return r.kind + ', ' + feel + trust + fear + owes;
}

/** What others feel toward the agent that the agent can sense: who owes them, who fears them. */
function describeIncoming(r: Doc<'relationships'>): string | undefined {
  const parts = [r.obligation >= 0.2 ? 'owes you' : '', r.fear >= 0.4 ? 'is afraid of you' : '', r.affinity >= 0.6 && r.kind !== 'family' ? 'is fond of you' : ''].filter(Boolean);
  return parts.length > 0 ? 'they ' + parts.join(' and ') : undefined;
}

function personaOf(mind: Doc<'minds'>, agentId: Id<'agents'>): { persona?: PersonaContext; secret?: SecretRef } {
  const p = mind.persona;
  if (!p) return {};
  return {
    persona: { epithet: p.epithet, want: p.want, need: p.need, fear: p.fear, flaw: p.flaw, voice: p.voice, strategies: p.strategies, arc: p.arc.stage + (p.arc.note ? ': ' + p.arc.note : '') },
    secret: p.secret ? { ref: 's1', key: beliefKey(p.secret.kind, agentId), text: p.secret.text, exposed: p.secret.exposedAtTick !== undefined } : undefined,
  };
}

/** Live storylines the agent is part of, as prompt lines. */
async function storylinesOf(ctx: QueryCtx, worldId: Id<'worlds'>, agentId: Id<'agents'>, max: number): Promise<string[]> {
  return (await liveStorylines(ctx.db, worldId))
    .filter((s) => s.participantIds.includes(agentId))
    .slice(0, max)
    .map(describeStoryline);
}

async function recentThoughts(ctx: QueryCtx, agentId: Id<'agents'>, max: number): Promise<string[]> {
  const rows = await ctx.db
    .query('thoughts')
    .withIndex('by_agent_tick', (q) => q.eq('agentId', agentId))
    .order('desc')
    .take(max);
  return rows.map((t) => t.text);
}

/** How their body feels, in words rather than numbers. */
function describeFeeling(a: Doc<'agents'>): string {
  const words: string[] = [];
  if (a.needs.thirst >= 60) words.push(a.needs.thirst >= 80 ? 'parched' : 'thirsty');
  if (a.needs.hunger >= 60) words.push(a.needs.hunger >= 80 ? 'starving' : 'hungry');
  if (a.needs.fatigue >= 65) words.push(a.needs.fatigue >= 85 ? 'dead on their feet' : 'tired');
  if (a.needs.safety >= 55) words.push('on edge');
  if (a.needs.social >= 70) words.push('lonely');
  if (a.health < 50) words.push(a.health < 25 ? 'gravely ill or hurt' : 'unwell');
  return words.length > 0 ? 'Feels ' + words.join(', ') : 'Body is fine for now';
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
  if (job.kind === 'thought') return { ok: true, mindVersion: mind.stateVersion, context: await thoughtContext(ctx, world, agent, mind, job) };
  if (job.kind === 'speech') {
    const context = await speechContext(ctx, world, agent, mind, job);
    return context ? { ok: true, mindVersion: mind.stateVersion, context } : { ok: false, reason: 'no interaction' };
  }
  const context = await planContext(ctx, world, agent, mind, { trigger: job.trigger, detail: job.detail, followed: job.lane === 'focus' });
  return { ok: true, mindVersion: mind.stateVersion, context };
}

async function factionOf(ctx: QueryCtx, world: Doc<'worlds'>, agent: Doc<'agents'>): Promise<Doc<'factions'> | undefined> {
  if (!agent.factionId) return undefined;
  const factions = await ctx.db
    .query('factions')
    .withIndex('by_world', (q) => q.eq('worldId', world._id))
    .collect();
  return factions.find((f) => f.key === agent.factionId);
}

async function sortedBeliefs(ctx: QueryCtx, agentId: Id<'agents'>): Promise<Doc<'beliefs'>[]> {
  return (
    await ctx.db
      .query('beliefs')
      .withIndex('by_agent_key', (q) => q.eq('agentId', agentId))
      .collect()
  ).sort((a, b) => b.confidence + b.lastReinforcedTick / 2000 - (a.confidence + a.lastReinforcedTick / 2000));
}

function personRef(doc: Doc<'agents'>, ref: string, extra: { present?: boolean; tie?: string }): PersonRef {
  return {
    ref,
    id: doc._id,
    name: doc.name,
    occupation: occupationLabel(doc.occupation),
    alive: doc.alive,
    present: extra.present ?? false,
    usualPlace: doc.workLocationId ?? doc.homeLocationId,
    tie: extra.tie,
    householdId: doc.householdId,
  };
}

async function speechContext(ctx: QueryCtx, world: Doc<'worlds'>, agent: Doc<'agents'>, mind: Doc<'minds'>, job: Doc<'cognitionJobs'>): Promise<SpeechContext | null> {
  const doc = agent.interactingWithId ? await ctx.db.get(agent.interactingWithId) : null;
  if (!doc || !doc.alive || doc.worldId !== world._id) return null;
  const partner = personRef(doc, 'p1', { present: true });
  const tie = await ctx.db
    .query('relationships')
    .withIndex('by_from_to', (q) => q.eq('fromAgentId', agent._id).eq('toAgentId', partner.id))
    .first();
  if (tie) partner.tie = describeTie(tie);
  const beliefDocs = await sortedBeliefs(ctx, agent._id);
  return {
    kind: 'speech',
    tick: world.tick,
    agentId: agent._id,
    name: agent.name,
    identity: identityOf(agent, mind.ageBand, await factionOf(ctx, world, agent)),
    personality: describeTraits(agent.traits),
    mood: agent.mood,
    doing: agent.activityLabel,
    place: placeName(agent.locationId),
    prices: describePrices(world),
    partner,
    voice: mind.persona?.voice,
    aboutPartner: beliefDocs.filter((b) => b.subjectAgentId === partner.id).slice(0, 3).map((b) => b.text + ' (confidence ' + b.confidence.toFixed(1) + ')'),
    trigger: job.trigger,
    detail: job.detail,
  };
}

/** Recent memories as short lines, most recent first, skipping the mundane once a few are in. */
async function memoryLines(ctx: QueryCtx, world: Doc<'worlds'>, agentId: Id<'agents'>, max: number): Promise<string[]> {
  const memoryDocs = await ctx.db
    .query('memories')
    .withIndex('by_agent_tick', (q) => q.eq('agentId', agentId))
    .order('desc')
    .take(24);
  const memories: string[] = [];
  const seen = new Set<string>();
  for (const m of memoryDocs) {
    if (memories.length >= max || seen.has(m.eventId) || (m.salience < 0.25 && memories.length >= 3)) continue;
    seen.add(m.eventId);
    const event = await ctx.db.get(m.eventId);
    if (event) memories.push((event.tick >= world.tick - 3 ? 'just now' : span(world.tick - event.tick) + ' ago') + ': ' + event.summary);
  }
  return memories;
}

async function thoughtContext(ctx: QueryCtx, world: Doc<'worlds'>, agent: Doc<'agents'>, mind: Doc<'minds'>, job: Doc<'cognitionJobs'>): Promise<ThoughtContext> {
  return {
    kind: 'thought',
    tick: world.tick,
    agentId: agent._id,
    name: agent.name,
    identity: identityOf(agent, mind.ageBand, await factionOf(ctx, world, agent)),
    personality: describeTraits(agent.traits),
    ...personaOf(mind, agent._id),
    society: await societyLines(ctx, agent, mind),
    mood: agent.mood,
    feeling: describeFeeling(agent),
    place: placeName(agent.locationId),
    doing: agent.activityLabel,
    intent: mind.plan?.intent,
    storylines: await storylinesOf(ctx, world._id, agent._id, 2),
    memories: await memoryLines(ctx, world, agent._id, 4),
    recent: await recentThoughts(ctx, agent._id, 8),
    trigger: job.trigger,
    detail: job.detail,
  };
}

/** The full plan context: who they are, what they know, who is here. Also the base of an answer. */
export async function planContext(
  ctx: QueryCtx,
  world: Doc<'worlds'>,
  agent: Doc<'agents'>,
  mind: Doc<'minds'>,
  opts: { trigger: string; detail?: string; followed: boolean },
): Promise<PlanContext> {
  const faction = await factionOf(ctx, world, agent);
  const ties = await ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', agent._id))
    .order('desc')
    .take(MAX_TIES);
  const incoming = new Map<string, string>();
  for (const r of await ctx.db
    .query('relationships')
    .withIndex('by_to', (q) => q.eq('toAgentId', agent._id))
    .take(MAX_INCOMING)) {
    const line = describeIncoming(r);
    if (line) incoming.set(r.fromAgentId, line);
  }
  const beliefDocs = await sortedBeliefs(ctx, agent._id);

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
    const person = personRef(doc, 'p' + (people.length + 1), extra);
    people.push(person);
    byId.set(id, person);
    return person;
  };

  // People first in the order the model most needs them: who is here, then close ties.
  const present = await presentAt(ctx, world, agent.locationId, agent._id);
  const tieTo = new Map(ties.map((t) => [t.toAgentId as string, t]));
  present.sort((a, b) => (tieTo.get(b)?.strength ?? 0) - (tieTo.get(a)?.strength ?? 0));
  for (const id of present.slice(0, MAX_PRESENT)) await addPerson(id, { present: true, tie: tieTo.has(id) ? describeTie(tieTo.get(id)!) : undefined });
  for (const t of ties) await addPerson(t.toAgentId, { tie: describeTie(t) });
  for (const id of incoming.keys()) await addPerson(id as Id<'agents'>);
  for (const p of people) {
    const felt = incoming.get(p.id);
    if (felt) p.tie = p.tie ? p.tie + '; ' + felt : felt;
  }
  const household = agent.householdId ? await ctx.db.get(agent.householdId) : null;
  for (const id of household?.memberIds ?? []) await addPerson(id, { tie: 'household' });
  const activeGoals = mind.goals.filter((g) => g.status === 'active').sort((a, b) => b.priority - a.priority).slice(0, 4);
  for (const g of activeGoals) await addPerson(g.targetAgentId);
  const beliefs: BeliefRef[] = [];
  for (const b of beliefDocs.slice(0, MAX_BELIEFS)) {
    if (b.subjectAgentId) await addPerson(b.subjectAgentId);
    beliefs.push({ ref: 'b' + (beliefs.length + 1), key: b.key, kind: b.kind, text: b.text, confidence: b.confidence, sourceType: b.sourceType, sourceName: b.sourceName, subjectId: b.subjectAgentId });
  }

  const memories = await memoryLines(ctx, world, agent._id, MAX_MEMORIES);

  const clock = tickToClock(world.tick);
  const nightShift = agent.dayOffset >= 48 && agent.dayOffset <= 108;
  const worldLines: string[] = [];
  for (const e of world.activeEffects) worldLines.push('ACTIVE: ' + e.label + ' (severity ' + e.severity.toFixed(1) + ', ends in ' + span(e.endTick - world.tick) + ')');
  const damaged = Object.entries(world.damage).filter(([, d]) => d > 0.05);
  if (damaged.length > 0) worldLines.push('Damaged buildings: ' + damaged.map(([loc, d]) => placeName(loc) + ' ' + Math.round(d * 100) + '%').join(', '));
  worldLines.push(describePrices(world));
  worldLines.push('Depot rations: ' + ['full', 'reduced', 'emergency'][world.econ.rationLevel] + '. Depot reserve: ' + Object.entries(world.stockpiles.depot ?? {}).map(([r, n]) => r + ' ' + Math.round(n)).join(', '));
  if (world.econ.wagesUnpaid > 0) worldLines.push('The treasury is behind on wages.');
  worldLines.push('Population ' + world.population.alive + ' alive, ' + world.population.dead + ' dead.');

  const invParts = (['food', 'water', 'parts', 'medicine'] as const).filter((r) => agent.inv[r] > 0).map((r) => agent.inv[r] + ' ' + r);
  return {
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
      householdId: agent.householdId,
      locationId: agent.locationId as LocationId,
      homeLocationId: agent.homeLocationId,
      workLocationId: agent.workLocationId,
      doing: agent.activityLabel,
      clock: clock.label + (nightShift ? ' (works the night shift)' : ''),
      world: worldLines,
      goals: activeGoals.map((g) => ({ id: g.id, kind: g.kind, description: g.description, priority: g.priority, source: g.source, targetId: g.targetAgentId })),
      beliefs,
      memories,
      trigger: opts.trigger,
      detail: opts.detail,
      people,
      followed: opts.followed,
      ...personaOf(mind, agent._id),
      society: await societyLines(ctx, agent, mind),
      societyRefs: await societyLookup(ctx, agent, mind),
      storylines: await storylinesOf(ctx, world._id, agent._id, 3),
      thoughts: opts.followed ? await recentThoughts(ctx, agent._id, 3) : [],
  };
}

/** The society layer's context as prompt lines. */
async function societyLines(ctx: QueryCtx, agent: Doc<'agents'>, mind: Doc<'minds'>): Promise<string[]> {
  return (await societyContext(ctx, agent, mind)).split('\n').filter(Boolean);
}

/** Questions a session asked this colonist, oldest first. */
async function askHistory(ctx: QueryCtx, sessionId: Id<'sessions'>, agentId: Id<'agents'>, max: number): Promise<{ question: string; answer: string }[]> {
  const rows = await ctx.db
    .query('conversations')
    .withIndex('by_session_agent', (q) => q.eq('sessionId', sessionId).eq('agentId', agentId))
    .order('desc')
    .take(max);
  return rows.reverse().map((r) => ({ question: r.question, answer: r.answer }));
}

/** How far someone trusts a voice in their head: guarded people lie, open or desperate ones let things slip. */
function opennessOf(a: Doc<'agents'>, persona?: PersonaContext): string {
  const desperate = a.needs.thirst >= 80 || a.needs.hunger >= 80 || a.mood === 'grieving' || persona?.arc.startsWith('climax');
  const open = (1 - a.traits.caution) * 0.5 + a.traits.sociability * 0.3 + a.traits.empathy * 0.2 + (desperate ? 0.25 : 0);
  if (open >= 0.62) return 'open: you are lonely or rattled enough to talk, and you might let something slip';
  if (open >= 0.42) return 'wary: you answer honestly about small things and steer away from what matters';
  return 'guarded: you give little away, deflect anything close to your secret, and lie if pressed';
}

/** The context of an answer to the player's question: the plan context plus the conversation so far. */
export async function loadAskContext(ctx: QueryCtx, agentId: Id<'agents'>, sessionId: Id<'sessions'>, question: string): Promise<AskContext | null> {
  const agent = await ctx.db.get(agentId);
  const world = agent ? await ctx.db.get(agent.worldId) : null;
  const mind = agent?.mindId ? await ctx.db.get(agent.mindId) : null;
  if (!agent || !world || !mind) return null;
  const base = await planContext(ctx, world, agent, mind, { trigger: 'a voice asks a question', followed: false });
  return { ...base, kind: 'ask', question, openness: opennessOf(agent, base.persona), history: await askHistory(ctx, sessionId, agentId, 4) };
}
