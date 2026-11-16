/**
 * The create_character power: a new colonist steps off a shuttle at the Landing Pad. Inserts the
 * agent, mind, household membership and relationships with the same conventions as seed/insert.ts,
 * registers the agent in the index and roster, and sends them walking to their new home.
 */
import { LOCATIONS, MAX_POPULATION, OCCUPATIONS, RESOURCES, SPRITE_IDS, TRAIT_KEYS, VALUE_KEYS } from '../../shared/colony';
import type { ResourceId } from '../../shared/colony';
import type { GoalKind, NewCharacterInput, RelationshipPublic } from '../../shared/types';
import { adjustRelationship, dayOf, emitEvent, encodeStep, enqueueCognition, registerAgent, setPlan } from '../engine/core';
import type { AgentDoc, Tx } from '../engine/core';
import { MAX_STARTING } from '../lib/constants';
import { round2 } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import { agentOf, fail, isFailure, numberIn, oneOf, record, textOf } from './common';
import type { Power, PowerFailure } from './common';

const AGE_BANDS = ['young', 'adult', 'elder'] as const;
const HOMES = ['habitat_a', 'habitat_b'] as const;
const GOAL_KINDS: readonly GoalKind[] = [
  'survive',
  'earn_wealth',
  'acquire_resource',
  'protect_person',
  'improve_relationship',
  'gain_influence',
  'change_job',
  'join_faction',
  'avoid_person',
  'investigate',
  'custom',
];
const RELATIONSHIP_KINDS: readonly RelationshipPublic['kind'][] = ['family', 'friend', 'colleague', 'rival', 'acquaintance'];

/** How a declared tie starts out, in both directions. */
const TIE_TONE: Record<RelationshipPublic['kind'], { affinity: number; trust: number }> = {
  family: { affinity: 0.7, trust: 0.7 },
  friend: { affinity: 0.55, trust: 0.5 },
  colleague: { affinity: 0.2, trust: 0.3 },
  rival: { affinity: -0.5, trust: -0.3 },
  acquaintance: { affinity: 0.1, trust: 0.15 },
  romance: { affinity: 0.7, trust: 0.5 },
  partner: { affinity: 0.75, trust: 0.7 },
};

/**
 * The checkable predicate for each goal kind, matching the seed. Kinds marked needsTarget fall back
 * to 'none' (tracked by the planner alone) when the player named nobody.
 */
const GOAL_PREDICATES: Partial<Record<GoalKind, { predicate: string; needsTarget?: boolean; targetQuantity?: number; drive?: string }>> = {
  survive: { predicate: 'needs_ok' },
  earn_wealth: { predicate: 'credits_at_least', drive: 'get_rich' },
  improve_relationship: { predicate: 'affinity_at_least', needsTarget: true, targetQuantity: 0.6, drive: 'befriend' },
  protect_person: { predicate: 'target_safe', needsTarget: true },
  investigate: { predicate: 'belief_resolved', needsTarget: true },
  gain_influence: { predicate: 'standing_at_least', targetQuantity: 6, drive: 'seek_power' },
};

type ArrivalParams = {
  input: Omit<NewCharacterInput, 'goals' | 'relationships' | 'startingResources'>;
  startingResources: Partial<Record<ResourceId, number>>;
  goals: { kind: GoalKind; description: string; target?: AgentDoc }[];
  ties: { other: AgentDoc; kind: RelationshipPublic['kind'] }[];
};

/** Every key of keys present as a number in 0..1. */
function scores<K extends string>(raw: unknown, keys: readonly K[], label: string): Record<K, number> | PowerFailure {
  const p = record(raw);
  if (isFailure(p)) return fail('invalid', label + ' are missing.');
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const value = numberIn(p[key], 0, 1, label + ': ' + key);
    if (isFailure(value)) return value;
    out[key] = round2(value);
  }
  return out;
}

function listOf(raw: unknown, max: number, label: string): unknown[] | PowerFailure {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > max) return fail('invalid', 'At most ' + max + ' ' + label + '.');
  return raw;
}

export const createCharacter: Power<ArrivalParams> = {
  async parse(tx, raw) {
    if (tx.world.population.alive >= MAX_POPULATION) return fail('cap_reached', 'The colony is full (' + MAX_POPULATION + ' colonists).');
    const p = record(raw);
    if (isFailure(p)) return p;
    const name = textOf(p.name, 2, 40, 'The name');
    if (isFailure(name)) return name;
    const spriteId = oneOf(p.spriteId, SPRITE_IDS, 'sprite');
    if (isFailure(spriteId)) return spriteId;
    const ageBand = oneOf(p.ageBand, AGE_BANDS, 'age band');
    if (isFailure(ageBand)) return ageBand;
    const occupation = oneOf(p.occupation, OCCUPATIONS.map((o) => o.id), 'occupation');
    if (isFailure(occupation)) return occupation;
    const homeLocationId = oneOf(p.homeLocationId, HOMES, 'home');
    if (isFailure(homeLocationId)) return homeLocationId;
    const traits = scores(p.traits, TRAIT_KEYS, 'Traits');
    if (isFailure(traits)) return traits;
    const values = scores(p.values, VALUE_KEYS, 'Values');
    if (isFailure(values)) return values;
    const backstory = textOf(p.backstory ?? '', 0, 280, 'The backstory');
    if (isFailure(backstory)) return backstory;

    const startingResources: Partial<Record<ResourceId, number>> = {};
    const stock = p.startingResources === undefined ? {} : record(p.startingResources);
    if (isFailure(stock)) return stock;
    for (const [key, amount] of Object.entries(stock)) {
      const resource = oneOf(key, RESOURCES, 'resource');
      if (isFailure(resource)) return resource;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > MAX_STARTING[resource]) {
        return fail('invalid', 'Starting ' + resource + ' must be a whole number from 0 to ' + MAX_STARTING[resource] + '.');
      }
      startingResources[resource] = amount;
    }

    const rawGoals = listOf(p.goals, 2, 'goals');
    if (isFailure(rawGoals)) return rawGoals;
    const goals: ArrivalParams['goals'] = [];
    for (const g of rawGoals) {
      const goal = record(g);
      if (isFailure(goal)) return goal;
      const kind = oneOf(goal.kind, GOAL_KINDS, 'goal kind');
      if (isFailure(kind)) return kind;
      const description = textOf(goal.description, 2, 140, 'A goal');
      if (isFailure(description)) return description;
      const target = goal.targetAgentId ? await agentOf(tx, goal.targetAgentId) : undefined;
      if (isFailure(target)) return target;
      goals.push({ kind, description, target });
    }

    const rawTies = listOf(p.relationships, 3, 'relationships');
    if (isFailure(rawTies)) return rawTies;
    const ties: ArrivalParams['ties'] = [];
    for (const r of rawTies) {
      const tie = record(r);
      if (isFailure(tie)) return tie;
      const other = await agentOf(tx, tie.toAgentId);
      if (isFailure(other)) return other;
      const kind = oneOf(tie.kind, RELATIONSHIP_KINDS, 'relationship kind');
      if (isFailure(kind)) return kind;
      if (ties.some((t) => t.other._id === other._id)) return fail('invalid', 'Each relationship must be with a different colonist.');
      ties.push({ other, kind });
    }

    let factionId: string | undefined;
    if (p.factionId !== undefined && p.factionId !== null && p.factionId !== '') {
      const factions = await tx.ctx.db
        .query('factions')
        .withIndex('by_world', (q) => q.eq('worldId', tx.world._id))
        .collect();
      if (!factions.some((f) => f.key === p.factionId)) return fail('invalid', 'Unknown faction.');
      factionId = p.factionId as string;
    }

    return {
      input: { name, spriteId, ageBand, occupation, homeLocationId, traits, values, backstory, factionId },
      startingResources,
      goals,
      ties,
    };
  },

  async apply(tx, { input, startingResources, goals, ties }) {
    const occupation = OCCUPATIONS.find((o) => o.id === input.occupation)!;
    const home = LOCATIONS[input.homeLocationId];
    const seq = tx.world.nextSeq;
    tx.world.nextSeq += 1;
    tx.world.population = { ...tx.world.population, alive: tx.world.population.alive + 1 };

    const householdId = await joinHousehold(tx, input.name, input.homeLocationId, ties);
    const skill = input.ageBand === 'young' ? 35 : input.ageBand === 'elder' ? 58 : 50;
    const agentId = await tx.ctx.db.insert('agents', {
      worldId: tx.world._id,
      seq,
      name: input.name,
      spriteId: input.spriteId,
      occupation: occupation.id,
      factionId: input.factionId,
      householdId,
      alive: true,
      locationId: 'landing_pad',
      homeLocationId: input.homeLocationId,
      workLocationId: occupation.workLocationId,
      activity: 'idle',
      activityLabel: 'Just stepped off the shuttle',
      busyUntilTick: tx.tick,
      dueTick: tx.tick,
      mood: 'hopeful',
      health: input.ageBand === 'elder' ? 85 : 100,
      needs: { hunger: 30, thirst: 30, fatigue: 30, safety: 15, social: 55 },
      needsTick: tx.tick,
      updatedAtVersion: tx.version,
      inv: { food: 0, water: 0, parts: 0, medicine: 0, credits: 0, ...startingResources },
      traits: input.traits,
      skill,
      dayOffset: 0,
      q: [],
      planEpoch: 0,
      standing: 0,
      topics: [],
      lastLevyDay: dayOf(tx.tick),
      markup: occupation.id === 'trader' ? round2(0.12 + input.traits.ambition * 0.22 + input.values.wealth * 0.1 - input.traits.empathy * 0.1) : undefined,
      failStreak: 0,
    });
    await tx.ctx.db.patch(householdId, { memberIds: [...(await tx.ctx.db.get(householdId))!.memberIds, agentId] });

    const credits = startingResources.credits ?? 0;
    const mindGoals = [
      { kind: 'survive' as GoalKind, description: 'Find my feet and keep myself fed, watered and safe', target: undefined, priority: 0.6, source: 'needs' },
      ...goals.map((g, i) => ({ ...g, priority: round2(0.75 - 0.1 * i), source: 'divine' })),
    ].map((g, i) => {
      const rule = GOAL_PREDICATES[g.kind];
      const usable = rule && (!rule.needsTarget || g.target);
      return {
        id: 'g' + (i + 1),
        kind: g.kind,
        description: g.description,
        priority: g.priority,
        source: g.source,
        status: 'active',
        targetAgentId: g.target?._id,
        targetAgentName: g.target?.name,
        targetQuantity: usable ? (g.kind === 'earn_wealth' ? credits + 150 : rule.targetQuantity) : undefined,
        createdAtTick: tx.tick,
        predicate: usable ? rule.predicate : 'none',
        drive: usable ? rule.drive : undefined,
      };
    });
    const mindId = await tx.ctx.db.insert('minds', {
      worldId: tx.world._id,
      agentId,
      ageBand: input.ageBand,
      background: input.backstory || 'Arrived on the shuttle to work as a ' + occupation.label.toLowerCase() + '.',
      values: input.values,
      skills: { [PRIMARY_SKILL[occupation.id]]: skill, persuasion: Math.round(25 + input.traits.sociability * 45) },
      goals: mindGoals,
      stateVersion: 0,
      llmCooldownUntilTick: 0,
      thefts: 0,
      nextGoalSeq: mindGoals.length + 1,
    });
    await tx.ctx.db.patch(agentId, { mindId });
    const agent = (await tx.ctx.db.get(agentId))!;
    await registerAgent(tx, agent);

    for (const { other, kind } of ties) {
      await adjustRelationship(tx, agent, other, { ...TIE_TONE[kind], kind });
      await adjustRelationship(tx, other, agent, { ...TIE_TONE[kind], kind });
    }
    if (input.factionId) {
      const faction = (await tx.ctx.db.query('factions').withIndex('by_world', (q) => q.eq('worldId', tx.world._id)).collect()).find((f) => f.key === input.factionId)!;
      await tx.ctx.db.patch(faction._id, { memberCount: faction.memberCount + 1 });
    }

    const { eventId } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'arrival',
      actorId: agent._id,
      participantIds: ties.map((t) => t.other._id),
      locationId: 'landing_pad',
      summary: agent.name + ' stepped off a shuttle at the Landing Pad, a new ' + occupation.label.toLowerCase() + '.',
      salience: 0.8,
      banner: true,
      visibility: 'public',
      witnesses: 'location',
      facts: { occupation: occupation.id, homeLocationId: input.homeLocationId },
    });
    await setPlan(tx, agent, {
      intent: 'Find a bunk in ' + home.name,
      source: 'routine',
      steps: [encodeStep('go', home.id)],
      labels: ['Walk to ' + home.name],
      causeEventId: eventId,
    });
    await enqueueCognition(tx, agent, { kind: 'plan', trigger: 'Arrived in the colony', priority: 0.5, lane: 'normal', eventId });
    return { affectedAgentIds: [agent._id, ...ties.map((t) => t.other._id)], createdAgentId: agent._id };
  },
};

/**
 * The household a newcomer joins: that of a declared family member living in the same habitat ring,
 * or else new quarters of their own. Their daily ration is added either way.
 */
async function joinHousehold(tx: Tx, name: string, homeLocationId: string, ties: ArrivalParams['ties']) {
  const kin = ties.find((t) => t.kind === 'family' && t.other.householdId && t.other.homeLocationId === homeLocationId);
  const existing = kin?.other.householdId ? await tx.ctx.db.get(kin.other.householdId) : null;
  if (existing) {
    await tx.ctx.db.patch(existing._id, { rationDue: { food: existing.rationDue.food + 1, water: existing.rationDue.water + 2 } });
    return existing._id;
  }
  return await tx.ctx.db.insert('households', {
    worldId: tx.world._id,
    name: name + "'s quarters",
    homeLocationId,
    memberIds: [],
    pantry: { food: 2, water: 3 },
    rationDue: { food: 1, water: 2 },
    rationDay: dayOf(tx.tick),
  });
}
