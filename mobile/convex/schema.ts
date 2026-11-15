import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const num = v.number();
const str = v.string();

export const resourcesV = v.object({ food: num, water: num, parts: num, medicine: num, credits: num });
export const needsV = v.object({ hunger: num, thirst: num, fatigue: num, safety: num, social: num });
export const traitsV = v.object({
  ambition: num,
  empathy: num,
  caution: num,
  curiosity: num,
  sociability: num,
  stubbornness: num,
});
export const valuesV = v.object({ wealth: num, family: num, status: num, harmony: num, freedom: num });
export const moveV = v.object({ from: str, to: str, departTick: num, arriveTick: num });

export const goalV = v.object({
  id: str,
  kind: str,
  description: str,
  priority: num,
  source: str,
  status: str,
  targetAgentId: v.optional(v.id('agents')),
  targetAgentName: v.optional(str),
  targetResource: v.optional(str),
  targetQuantity: v.optional(num),
  targetFaction: v.optional(str),
  targetOccupation: v.optional(str),
  createdAtTick: num,
  expiresAtTick: v.optional(num),
  /** Whitelisted predicate key checked against real world state. Never executable code. */
  predicate: str,
  /** Preset key or belief key that created the goal, for mechanics. */
  drive: v.optional(str),
  originEventId: v.optional(v.id('events')),
});

export const planV = v.object({
  intent: str,
  source: str,
  goalId: v.optional(str),
  /** Every step of the plan, encoded as "type|arg|arg". The agent document holds the cursor. */
  steps: v.array(str),
  /** Display label per step, written when the plan is made so reads need no joins. */
  labels: v.array(str),
  createdAtTick: num,
  causeEventId: v.optional(v.id('events')),
});

export const thoughtV = v.object({ tick: num, trigger: str, intent: str, source: str });

export const effectV = v.object({
  id: str,
  type: str,
  locationIds: v.array(str),
  severity: num,
  startTick: num,
  endTick: num,
  label: str,
  eventId: v.optional(v.id('events')),
});

export const llmConfigV = v.object({
  budgetPerDay: num,
  maxConcurrent: num,
  cooldownTicks: num,
  focusReserve: num,
  crisisReserve: num,
  speechPerDay: num,
});

export default defineSchema({
  worlds: defineTable({
    name: str,
    seed: num,
    deviceId: str,
    tick: num,
    speed: num,
    status: str,
    version: num,
    deleted: v.optional(v.boolean()),
    population: v.object({ alive: num, dead: num }),
    activeEffects: v.array(effectV),
    stockpiles: v.record(str, v.record(str, num)),
    damage: v.record(str, num),
    prices: v.object({ food: num, water: num, parts: num, medicine: num }),
    /** One character per agent seq: where they are and what state they are in. Keeps ticks cheap. */
    roster: v.object({ loc: str, st: str }),
    nextSeq: num,
    econ: v.object({
      treasury: num,
      regolith: v.object({ quarry: num, workshop: num }),
      /** 0 full rations, 1 reduced, 2 emergency. */
      rationLevel: num,
      announcedPrices: v.object({ food: num, water: num, parts: num, medicine: num }),
      demand: v.object({ food: num, water: num, parts: num, medicine: num }),
      unmet: v.object({ food: num, water: num, parts: num, medicine: num }),
      produced: v.object({ food: num, water: num, parts: num, medicine: num }),
      wagesUnpaid: num,
      lastShuttleDay: num,
    }),
    /** Event ids of standing conditions, used as honest parents for the events they cause. */
    causes: v.record(str, v.id('events')),
    roles: v.record(str, v.id('agents')),
    vacancies: v.array(v.object({ occupation: str, sinceTick: num, role: v.optional(str) })),
    llm: v.object({
      enabled: v.boolean(),
      callsToday: num,
      budgetPerDay: num,
      queued: num,
      running: num,
      day: num,
      focusUsed: num,
      crisisUsed: num,
      speechToday: num,
      failStreak: num,
      disabledUntil: v.optional(num),
      lastError: v.optional(str),
      provider: v.optional(str),
      model: v.optional(str),
      totalCalls: num,
      tokensIn: num,
      tokensOut: num,
    }),
    config: v.object({ llm: llmConfigV }),
    loop: v.object({ token: num, running: v.boolean(), nextAt: num }),
    lastHeartbeatAt: num,
    focusAgentId: v.optional(v.id('agents')),
    lastBannerTick: num,
    lastDailyDay: num,
    lastPriceTick: num,
  }).index('by_device', ['deviceId']),

  /** Agent ids by seq. Read only when an event fans out to many witnesses. */
  worldIndex: defineTable({
    worldId: v.id('worlds'),
    agentIds: v.array(v.id('agents')),
  }).index('by_world', ['worldId']),

  factions: defineTable({
    worldId: v.id('worlds'),
    key: str,
    name: str,
    color: str,
    description: str,
    leaderAgentId: v.optional(v.id('agents')),
    officerIds: v.array(v.id('agents')),
    memberCount: num,
    /** 'guard' keeps reserves tight, 'open' hands them out, 'trade' favours the market. */
    stance: str,
  }).index('by_world', ['worldId']),

  households: defineTable({
    worldId: v.id('worlds'),
    name: str,
    homeLocationId: str,
    memberIds: v.array(v.id('agents')),
    pantry: v.object({ food: num, water: num }),
    rationDue: v.object({ food: num, water: num }),
    rationDay: num,
    /** Set when someone took from the pantry unseen, until a member notices. */
    missing: v.optional(v.object({ food: num, water: num, eventId: v.id('events') })),
  }).index('by_world', ['worldId']),

  /** Hot per-agent state: everything a tick needs to run a step, and everything the map draws. */
  agents: defineTable({
    worldId: v.id('worlds'),
    seq: num,
    name: str,
    spriteId: str,
    occupation: str,
    role: v.optional(str),
    factionId: v.optional(str),
    householdId: v.optional(v.id('households')),
    mindId: v.optional(v.id('minds')),
    alive: v.boolean(),
    locationId: str,
    homeLocationId: str,
    workLocationId: v.optional(str),
    move: v.optional(moveV),
    activity: str,
    activityLabel: str,
    busyUntilTick: num,
    /** Scheduler key. Equals busyUntilTick while alive, a far-future sentinel when dead. */
    dueTick: num,
    interactingWithId: v.optional(v.id('agents')),
    speech: v.optional(str),
    mood: str,
    health: num,
    needs: needsV,
    needsTick: num,
    updatedAtVersion: num,
    inv: resourcesV,
    traits: traitsV,
    /** Primary job skill 0..100, copied from the mind so work needs no second read. */
    skill: num,
    /** Offset of the personal day in ticks: 0 wakes at 06:00, 72 works nights. */
    dayOffset: num,
    /** Step in progress and the steps still queued, encoded as "type|arg|arg". */
    cur: v.optional(str),
    curStartTick: v.optional(num),
    q: v.array(str),
    planEpoch: num,
    /** Reputation: sum of what others think of this agent, kept incrementally. */
    standing: num,
    /** Keys of the beliefs this agent is most likely to bring up in conversation. */
    topics: v.array(str),
    lastLevyDay: num,
    markup: v.optional(num),
    failStreak: num,
  })
    .index('by_world_seq', ['worldId', 'seq'])
    .index('by_world_due', ['worldId', 'dueTick'])
    .index('by_world_version', ['worldId', 'updatedAtVersion']),

  /** Cold per-agent state: read when planning, not on every step. */
  minds: defineTable({
    worldId: v.id('worlds'),
    agentId: v.id('agents'),
    ageBand: str,
    background: str,
    values: valuesV,
    skills: v.record(str, num),
    goals: v.array(goalV),
    plan: v.optional(planV),
    lastThought: v.optional(thoughtV),
    death: v.optional(v.object({ tick: num, cause: str })),
    /** Bumped by events that should invalidate an LLM plan computed before them. */
    stateVersion: num,
    llmCooldownUntilTick: num,
    thefts: num,
    nextGoalSeq: num,
  }).index('by_agent', ['agentId']),

  relationships: defineTable({
    worldId: v.id('worlds'),
    fromAgentId: v.id('agents'),
    toAgentId: v.id('agents'),
    toName: str,
    toAlive: v.boolean(),
    kind: str,
    affinity: num,
    trust: num,
    fear: num,
    obligation: num,
    /** Sort key for "strongest first". */
    strength: num,
    lastInteractionTick: num,
  })
    .index('by_from_to', ['fromAgentId', 'toAgentId'])
    .index('by_from_strength', ['fromAgentId', 'strength'])
    .index('by_to', ['toAgentId']),

  beliefs: defineTable({
    worldId: v.id('worlds'),
    agentId: v.id('agents'),
    /** Dedupe key: one belief per (agent, key). */
    key: str,
    /** Mechanical meaning, e.g. hoarding, thief, hero, scarcity, custom. */
    kind: str,
    text: str,
    subjectAgentId: v.optional(v.id('agents')),
    subjectName: v.optional(str),
    valence: num,
    confidence: num,
    sourceType: str,
    sourceAgentId: v.optional(v.id('agents')),
    sourceName: v.optional(str),
    truthEventId: v.optional(v.id('events')),
    /** The event that started this idea in the colony (a rumor, a whisper, a witnessed act). */
    originEventId: v.optional(v.id('events')),
    learnedAtTick: num,
    lastReinforcedTick: num,
    hops: num,
    private: v.optional(v.boolean()),
  })
    .index('by_agent_key', ['agentId', 'key'])
    .index('by_world_key', ['worldId', 'key']),

  memories: defineTable({
    worldId: v.id('worlds'),
    agentId: v.id('agents'),
    eventId: v.id('events'),
    tick: num,
    salience: num,
    role: str,
  }).index('by_agent_tick', ['agentId', 'tick']),

  events: defineTable({
    worldId: v.id('worlds'),
    tick: num,
    version: num,
    category: str,
    eventType: str,
    actorId: v.optional(v.id('agents')),
    participantIds: v.array(v.id('agents')),
    locationId: v.optional(str),
    summary: str,
    salience: num,
    /** Salience bucket 0..3, so the feed can skip mundane events without scanning them. */
    tier: num,
    causationEventId: v.optional(v.id('events')),
    banner: v.boolean(),
    visibility: str,
    facts: v.optional(v.any()),
  })
    .index('by_world_version', ['worldId', 'version'])
    .index('by_world_tier_tick', ['worldId', 'tier', 'tick'])
    .index('by_cause', ['causationEventId']),

  interventions: defineTable({
    worldId: v.id('worlds'),
    commandId: str,
    type: str,
    params: v.any(),
    result: v.any(),
    tick: num,
    createdAt: num,
  }).index('by_world_command', ['worldId', 'commandId']),

  cognitionJobs: defineTable({
    worldId: v.id('worlds'),
    agentId: v.id('agents'),
    kind: str,
    trigger: str,
    detail: v.optional(str),
    priority: num,
    /** queued, running, done, rejected, failed, dropped, stale. */
    status: str,
    lane: str,
    enqueuedTick: num,
    mindVersion: num,
    attempts: num,
    eventId: v.optional(v.id('events')),
    startedAt: v.optional(num),
    finishedAt: v.optional(num),
    latencyMs: v.optional(num),
    tokensIn: v.optional(num),
    tokensOut: v.optional(num),
    outcome: v.optional(str),
    trace: v.optional(v.any()),
  })
    .index('by_world_status', ['worldId', 'status', 'priority'])
    .index('by_agent_status', ['agentId', 'status']),

  sessions: defineTable({
    deviceId: str,
    token: str,
    worldId: v.id('worlds'),
    lastHeartbeatAt: num,
    focusAgentId: v.optional(v.id('agents')),
    powerTimes: v.array(num),
    createTimes: v.array(num),
    createdAt: num,
  })
    .index('by_device', ['deviceId'])
    .index('by_token', ['token']),
});
