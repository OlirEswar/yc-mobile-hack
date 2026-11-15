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

export const personaV = v.object({
  epithet: str,
  want: str,
  need: str,
  fear: str,
  flaw: str,
  voice: str,
  /** A true fact about them that others can discover. kind maps to a belief kind (e.g. embezzler, affair, saboteur). */
  secret: v.optional(v.object({ kind: str, text: str, exposedAtTick: v.optional(num) })),
  /** Preferred ways to meet needs, most preferred first: work, grow, trade, charm, borrow, beg, scavenge, smuggle, steal, scheme. */
  strategies: v.array(str),
  arc: v.object({ stage: str, note: str }),
  key: v.boolean(),
  /** For key characters: why the player should care, one sentence. */
  hook: v.optional(str),
});

/** The engine's per-colonist bookkeeping (engine/ledger.ts): debts, hidden goods, what worked, deeds, favours owed. */
export const ledgerV = v.object({
  /** What this colonist owes and to whom. The lender holds a 'debt' belief about it. */
  owes: v.array(v.object({ to: v.id('agents'), toName: str, res: str, qty: num, tick: num, dueTick: num, pressed: num, eventId: v.optional(v.id('events')) })),
  /** Goods hidden at home, safe from thieves and searches until someone finds them. */
  stash: resourcesV,
  /** Recent ways they tried to meet a need (persona strategies) and whether it worked, newest last. */
  tried: v.array(v.object({ s: str, ok: v.boolean(), tick: num })),
  /** The strategy behind the plan in progress, settled when the need is met or the plan fails. */
  pending: v.optional(v.object({ s: str, res: str, tick: num })),
  /** Hidden wrongdoing an investigation can uncover, counted by kind (saboteur, smuggler, liar, briber, blackmailer). */
  deeds: v.record(str, num),
  /** Favours bought from this colonist with a bribe or extorted by blackmail. */
  favors: v.array(v.object({ forId: v.id('agents'), kind: str, until: num })),
  /** Tick until which the planner will not try a move again, by key (e.g. "bribe:<agentId>"), so a refusal is not repeated every tick. */
  cooldowns: v.optional(v.record(str, num)),
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
    vacancies: v.array(v.object({ occupation: str, sinceTick: num, role: v.optional(str), eventId: v.optional(v.id('events')) })),
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
    /** Set by the story director while the tick loop should fast-forward the followed colonist's routine. */
    focusWarp: v.optional(v.boolean()),
    /** The colonist the story introduction starts the player on. */
    starterAgentId: v.optional(v.id('agents')),
    /** Authored character key (seed/keyCharacters.ts, e.g. 'ines', 'dmitri') to agent id, for story:intro. */
    keyAgents: v.optional(v.record(v.string(), v.id('agents'))),
    /** Bookkeeping of the tick engine (engine/state.ts). Created on the first tick. */
    sim: v.optional(
      v.object({
        /** Effect ids whose onset the engine has already played out. */
        seenEffects: v.array(str),
        /** Causes raised at the plaza, heard at the next council session. */
        petitions: v.array(v.object({ topic: str, agentId: v.id('agents'), tick: num, eventId: v.id('events') })),
        lastCouncilTick: num,
        /** Sitting councilors, the chair included. */
        council: v.array(v.id('agents')),
        /** Open security cases: thefts reported or discovered and not yet answered. */
        cases: v.array(v.object({ eventId: v.id('events'), suspectId: v.optional(v.id('agents')), locationId: str, tick: num })),
        /** Depot stock taken unseen, until the quartermaster's count finds it. */
        missing: v.object({ food: num, water: num, parts: num }),
        missingEventId: v.optional(v.id('events')),
        /** Tick of the last public accusation against each agent, so a crowd does not pile on. */
        accused: v.optional(v.record(v.string(), v.number())),
        /** Tick security last fined a thief or searched a hoarder, so a closed case is not reopened. */
        punished: v.optional(v.record(v.string(), v.number())),
        /** Causes being rallied for in the plaza today, with everyone who has stood up for each. */
        rallies: v.optional(v.array(v.object({ topic: str, organizerId: v.id('agents'), supporters: v.array(v.id('agents')), tick: num, eventId: v.id('events') }))),
        /** A walkout in progress: who called it, what they demand, and when it ends. */
        strike: v.optional(v.object({ leaderId: v.id('agents'), demand: str, startTick: num, untilTick: num, eventId: v.id('events'), answered: v.optional(v.boolean()) })),
      }),
    ),
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
    /** Society layer (docs/STORY_SPEC.md 8). All optional so older worlds still load. */
    society: v.optional(
      v.object({
        /** Hidden social status 0..100: prestige from job, wealth, fame, org rank, deeds. */
        status: num,
        fame: num,
        orgIds: v.array(v.id('organizations')),
        partnerId: v.optional(v.id('agents')),
        parentIds: v.array(v.id('agents')),
        childIds: v.array(v.id('agents')),
        /** Ticks of age for children; they grow up into colonists. */
        bornTick: v.optional(num),
        obsession: v.optional(v.object({ text: str, kind: str, target: v.optional(str), intensity: num, sinceTick: num })),
        education: v.optional(v.object({ studying: v.optional(str), progress: num, mastered: v.array(str) })),
        jobHistory: v.array(v.object({ occupation: str, fromTick: num })),
        inspiration: num,
      }),
    ),
    /** The character's story (docs/STORY_SPEC.md 3.1). Absent on worlds seeded before iteration 2. */
    persona: v.optional(personaV),
    /** Engine bookkeeping, created on first use. */
    ledger: v.optional(ledgerV),
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
    /** Tick at which the holder last acted on it (investigated, accused, petitioned). */
    acted: v.optional(num),
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

  /** Live and finished storylines (docs/STORY_SPEC.md 4). Seeded at Sol 1 and created by the director. */
  storylines: defineTable({
    worldId: v.id('worlds'),
    /** Stable key for seeded storylines and for deduping emergent ones. */
    key: str,
    title: str,
    premise: str,
    status: str,
    tension: num,
    participantIds: v.array(v.id('agents')),
    beats: v.array(v.object({ tick: num, text: str, eventId: v.optional(v.id('events')) })),
    origin: str,
    createdTick: num,
    lastBeatTick: num,
    resolvedTick: v.optional(num),
    /** Director bookkeeping (what it is waiting for, what it last nudged). */
    state: v.optional(v.any()),
  })
    .index('by_world_status', ['worldId', 'status'])
    .index('by_world_key', ['worldId', 'key']),

  // ----- society layer (docs/STORY_SPEC.md 8) -----
  organizations: defineTable({
    worldId: v.id('worlds'),
    key: str,
    name: str,
    kind: str,
    creed: str,
    founderId: v.optional(v.id('agents')),
    leaderId: v.optional(v.id('agents')),
    officerIds: v.array(v.id('agents')),
    memberIds: v.array(v.id('agents')),
    treasury: num,
    /** Hidden: how the colony regards it, -1..1. */
    reputation: num,
    status: str,
    foundedTick: num,
    territory: v.optional(v.array(str)),
    rules: v.optional(v.array(str)),
    rivalIds: v.array(v.id('organizations')),
    state: v.optional(v.any()),
  }).index('by_world_status', ['worldId', 'status']),

  discoveries: defineTable({
    worldId: v.id('worlds'),
    /** Key into DISCOVERIES in shared/society.ts. */
    key: str,
    tick: num,
    discovererIds: v.array(v.id('agents')),
    eventId: v.optional(v.id('events')),
  }).index('by_world_key', ['worldId', 'key']),

  /** Research progress toward discoveries not yet made, per world. */
  research: defineTable({
    worldId: v.id('worlds'),
    key: str,
    progress: num,
    contributorIds: v.array(v.id('agents')),
  }).index('by_world_key', ['worldId', 'key']),

  structures: defineTable({
    worldId: v.id('worlds'),
    /** Key into STRUCTURES in shared/society.ts. */
    key: str,
    name: str,
    locationId: str,
    builderIds: v.array(v.id('agents')),
    ownerOrgId: v.optional(v.id('organizations')),
    progress: num,
    builtTick: v.optional(num),
    eventId: v.optional(v.id('events')),
  }).index('by_world', ['worldId']),

  works: defineTable({
    worldId: v.id('worlds'),
    creatorId: v.id('agents'),
    title: str,
    kind: str,
    about: str,
    quality: num,
    fame: num,
    locationId: v.optional(str),
    createdTick: num,
    inspiredByEventId: v.optional(v.id('events')),
  })
    .index('by_world_fame', ['worldId', 'fame'])
    .index('by_creator', ['creatorId']),

  pets: defineTable({
    worldId: v.id('worlds'),
    ownerId: v.optional(v.id('agents')),
    name: str,
    species: str,
    alive: v.boolean(),
    bornTick: num,
    bond: num,
  }).index('by_owner', ['ownerId']),

  /** Inner monologue lines (docs/STORY_SPEC.md 5). */
  thoughts: defineTable({
    worldId: v.id('worlds'),
    agentId: v.id('agents'),
    tick: num,
    text: str,
    mood: v.optional(str),
    source: str,
  }).index('by_agent_tick', ['agentId', 'tick']),

  /** The player's questions to colonists and their answers. Never read by the simulation. */
  conversations: defineTable({
    worldId: v.id('worlds'),
    sessionId: v.id('sessions'),
    agentId: v.id('agents'),
    tick: num,
    question: str,
    answer: str,
  }).index('by_session_agent', ['sessionId', 'agentId']),

  sessions: defineTable({
    deviceId: str,
    token: str,
    worldId: v.id('worlds'),
    lastHeartbeatAt: num,
    focusAgentId: v.optional(v.id('agents')),
    powerTimes: v.array(num),
    createTimes: v.array(num),
    createdAt: num,
    /** Set by the Whop payment.succeeded webhook once this install buys the Colony Pass. */
    premium: v.optional(v.boolean()),
    premiumPaymentId: v.optional(str),
  })
    .index('by_device', ['deviceId'])
    .index('by_token', ['token']),
});
