/**
 * Writes a freshly built colony into the database and returns the new world id: agents, minds with
 * personas, the opening scene, beliefs, ties, factions, the storylines in motion, the key-character
 * map (worlds.keyAgents) and the starter (worlds.starterAgentId).
 */
import { seedSociety } from '../society/seed';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { COLONY_NAME, LOCATION_IDS } from '../../shared/colony';
import { BASE_PRICES, DEFAULT_LLM_CONFIG, INITIAL_STOCKPILES, INITIAL_TREASURY } from '../lib/constants';
import { round2 } from '../lib/rng';
import { buildColony } from './build';

export const ROSTER_AWAKE = 'a';
export const ROSTER_WORKING = 'w';
export const ROSTER_ASLEEP = 's';
export const ROSTER_TRANSIT = 't';
export const ROSTER_DEAD = 'd';

export function locChar(locationId: string): string {
  return String.fromCharCode(97 + Math.max(0, LOCATION_IDS.indexOf(locationId as (typeof LOCATION_IDS)[number])));
}

export function relationshipStrength(kind: string, affinity: number, trust: number, fear: number): number {
  const kindWeight = kind === 'family' ? 0.6 : kind === 'rival' ? 0.5 : kind === 'friend' ? 0.4 : kind === 'colleague' ? 0.15 : 0;
  return round2(Math.abs(affinity) + Math.abs(trust) * 0.6 + fear * 0.5 + kindWeight);
}

export function standingWeight(affinity: number, trust: number): number {
  return 0.6 * trust + 0.4 * affinity;
}

const TOPIC_WEIGHT: Record<string, number> = {
  thief: 1.3, saboteur: 1.3, hoarding: 1.2, corrupt: 1.2, hero: 1, death: 1.2, windfall: 0.9, scarcity: 0.9,
  untrustworthy: 0.8, admirable: 0.7, policy_open: 0.6, policy_guard: 0.6, custom: 1,
};
export function topicWeight(kind: string, confidence: number): number {
  return (TOPIC_WEIGHT[kind] ?? 0.7) * confidence;
}

export async function seedWorld(ctx: MutationCtx, deviceId: string, seed: number): Promise<Id<'worlds'>> {
  const colony = buildColony(seed);
  const now = Date.now();
  const stockpiles: Record<string, Record<string, number>> = {};
  for (const [loc, stock] of Object.entries(INITIAL_STOCKPILES)) stockpiles[loc] = { ...stock };

  const worldId = await ctx.db.insert('worlds', {
    name: COLONY_NAME,
    seed,
    deviceId,
    tick: 0,
    speed: 1,
    status: 'running',
    version: 1,
    population: { alive: colony.agents.length, dead: 0 },
    activeEffects: [],
    stockpiles,
    damage: {},
    prices: { ...BASE_PRICES },
    roster: { loc: '', st: '' },
    nextSeq: colony.agents.length,
    econ: {
      treasury: INITIAL_TREASURY,
      regolith: { quarry: 6, workshop: 14 },
      rationLevel: 0,
      announcedPrices: { ...BASE_PRICES },
      demand: { food: 0, water: 0, parts: 0, medicine: 0 },
      unmet: { food: 0, water: 0, parts: 0, medicine: 0 },
      produced: { food: 0, water: 0, parts: 0, medicine: 0 },
      wagesUnpaid: 0,
      lastShuttleDay: 0,
    },
    causes: {},
    roles: {},
    vacancies: [],
    llm: {
      enabled: Boolean(process.env.LLM_API_KEY),
      callsToday: 0,
      budgetPerDay: DEFAULT_LLM_CONFIG.budgetPerDay,
      queued: 0,
      running: 0,
      day: 0,
      focusUsed: 0,
      crisisUsed: 0,
      speechToday: 0,
      failStreak: 0,
      totalCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
    },
    config: { llm: { ...DEFAULT_LLM_CONFIG } },
    loop: { token: 0, running: false, nextAt: 0 },
    lastHeartbeatAt: now,
    lastBannerTick: -100,
    lastDailyDay: 0,
    lastPriceTick: 0,
  });

  const householdIds: Id<'households'>[] = [];
  for (const h of colony.households) {
    householdIds.push(
      await ctx.db.insert('households', {
        worldId,
        name: h.name,
        homeLocationId: h.home,
        memberIds: [],
        pantry: h.pantry,
        rationDue: { food: h.members.length, water: h.members.length * 2 },
        rationDay: 0,
      }),
    );
  }

  // Standing is the sum of what others think of someone; it starts from the seeded ties.
  const standing = new Array<number>(colony.agents.length).fill(0);
  for (const r of colony.relationships) standing[r.to] += standingWeight(r.affinity, r.trust);

  const agentIds: Id<'agents'>[] = [];
  let loc = '';
  let st = '';
  for (const a of colony.agents) {
    const wakeIn = a.opening ? 0 : 1 + (a.seq % 5);
    const at = a.opening?.at ?? a.home;
    const id = await ctx.db.insert('agents', {
      worldId,
      seq: a.seq,
      name: a.name,
      spriteId: a.spriteId,
      occupation: a.occupation,
      role: a.role,
      factionId: a.faction,
      householdId: householdIds[a.household],
      alive: true,
      locationId: at,
      homeLocationId: a.home,
      workLocationId: a.workLocationId,
      activity: a.opening?.activity ?? 'sleeping',
      activityLabel: a.opening?.label ?? 'Asleep at home',
      busyUntilTick: wakeIn,
      dueTick: wakeIn,
      mood: 'calm',
      health: a.health,
      needs: { hunger: 34 + (a.seq % 9), thirst: 38 + (a.seq % 11), fatigue: 8 + (a.seq % 7), safety: 5, social: 30 + (a.seq % 23) },
      needsTick: 0,
      updatedAtVersion: 1,
      inv: a.inv,
      traits: a.traits,
      skill: a.skill,
      dayOffset: a.dayOffset,
      q: [],
      planEpoch: 0,
      standing: round2(standing[a.seq]),
      topics: [],
      lastLevyDay: 0,
      markup: a.markup,
      failStreak: 0,
    });
    agentIds.push(id);
    loc += locChar(at);
    st += !a.opening ? ROSTER_ASLEEP : a.opening.activity === 'working' ? ROSTER_WORKING : ROSTER_AWAKE;
  }
  const resolveStep = (step: string) => step.split('|').map((arg) => (arg.startsWith('@') ? agentIds[Number(arg.slice(1))] : arg)).join('|');
  for (const a of colony.agents) if (a.opening) await ctx.db.patch(agentIds[a.seq], { q: a.opening.steps.map(resolveStep) });

  for (let i = 0; i < colony.households.length; i++) {
    await ctx.db.patch(householdIds[i], { memberIds: colony.households[i].members.map((seq) => agentIds[seq]) });
  }

  // Beliefs first, so each agent's conversation topics can be stored with the agent.
  const topics: { key: string; weight: number }[][] = colony.agents.map(() => []);
  for (const b of colony.beliefs) {
    const key = b.subject !== undefined ? b.kind + ':' + agentIds[b.subject] : b.worldKey ?? b.kind;
    await ctx.db.insert('beliefs', {
      worldId,
      agentId: agentIds[b.agent],
      key,
      kind: b.kind,
      text: b.text,
      subjectAgentId: b.subject !== undefined ? agentIds[b.subject] : undefined,
      subjectName: b.subject !== undefined ? colony.agents[b.subject].name : undefined,
      valence: b.valence,
      confidence: b.confidence,
      sourceType: b.sourceType,
      learnedAtTick: 0,
      lastReinforcedTick: 0,
      hops: b.sourceType === 'observed' ? 0 : 1,
      private: b.private,
    });
    if (!b.private) topics[b.agent].push({ key, weight: topicWeight(b.kind, b.confidence) });
  }

  for (const a of colony.agents) {
    const mindId = await ctx.db.insert('minds', {
      worldId,
      agentId: agentIds[a.seq],
      ageBand: a.ageBand,
      background: a.background,
      values: a.values,
      skills: a.skills,
      goals: a.goals.map((g, i) => ({
        id: 'g' + (i + 1),
        kind: g.kind,
        description: g.description,
        priority: g.priority,
        source: g.source,
        status: 'active',
        targetAgentId: g.target !== undefined ? agentIds[g.target] : undefined,
        targetAgentName: g.target !== undefined ? colony.agents[g.target].name : undefined,
        targetResource: g.targetResource,
        targetQuantity: g.targetQuantity,
        targetFaction: g.targetFaction,
        targetOccupation: g.targetOccupation,
        createdAtTick: 0,
        predicate: g.predicate,
        drive: g.drive,
      })),
      plan: a.opening
        ? { intent: a.opening.intent, source: 'template', steps: a.opening.steps.map(resolveStep), labels: a.opening.labels, createdAtTick: 0 }
        : undefined,
      stateVersion: 0,
      llmCooldownUntilTick: 0,
      thefts: a.thefts,
      nextGoalSeq: a.goals.length + 1,
      persona: a.persona && {
        epithet: a.persona.epithet,
        want: a.persona.want,
        need: a.persona.need,
        fear: a.persona.fear,
        flaw: a.persona.flaw,
        voice: a.persona.voice,
        secret: a.persona.secret,
        strategies: a.persona.strategies,
        arc: { stage: 'setup', note: a.persona.arc },
        key: a.persona.key,
        hook: a.persona.hook,
      },
    });
    const top = topics[a.seq].sort((x, y) => y.weight - x.weight).slice(0, 4).map((t) => t.key);
    await ctx.db.patch(agentIds[a.seq], { mindId, topics: top });
  }

  for (const r of colony.relationships) {
    await ctx.db.insert('relationships', {
      worldId,
      fromAgentId: agentIds[r.from],
      toAgentId: agentIds[r.to],
      toName: colony.agents[r.to].name,
      toAlive: true,
      kind: r.kind,
      affinity: r.affinity,
      trust: r.trust,
      fear: r.fear,
      obligation: r.obligation,
      strength: relationshipStrength(r.kind, r.affinity, r.trust, r.fear),
      lastInteractionTick: 0,
    });
  }

  for (const f of colony.factions) {
    await ctx.db.insert('factions', {
      worldId,
      key: f.key,
      name: f.name,
      color: f.color,
      description: f.description,
      leaderAgentId: agentIds[f.leader],
      officerIds: f.officers.map((seq) => agentIds[seq]),
      memberCount: colony.agents.filter((a) => a.faction === f.key).length,
      stance: f.stance,
    });
  }

  await ctx.db.insert('worldIndex', { worldId, agentIds });

  for (const s of colony.storylines) {
    const { choice, ...state } = s.state;
    await ctx.db.insert('storylines', {
      worldId,
      key: s.key,
      title: s.title,
      premise: s.premise,
      status: s.status,
      tension: s.tension,
      participantIds: s.participants.map((seq) => agentIds[seq]),
      beats: s.beats.map((text) => ({ tick: 0, text })),
      origin: 'seed',
      createdTick: 0,
      lastBeatTick: 0,
      state: {
        ...state,
        secretHolderIds: state.secretHolderIds.map((seq) => agentIds[seq]),
        ...(choice ? { choice: { ...choice, agentId: agentIds[choice.agentId] } } : {}),
      },
    });
  }

  const roles: Record<string, Id<'agents'>> = {};
  for (const [role, seq] of Object.entries(colony.roles)) roles[role] = agentIds[seq];
  const keyAgents: Record<string, Id<'agents'>> = {};
  for (const [key, seq] of Object.entries(colony.keyAgents)) keyAgents[key] = agentIds[seq];
  await ctx.db.patch(worldId, { roster: { loc, st }, roles, keyAgents, starterAgentId: agentIds[colony.starter] });
  await seedSociety(ctx, worldId, agentIds, { children: false });
  return worldId;
}
