/**
 * A local fake of the backend, in the shapes of shared/types.ts. It is not the simulation: it
 * produces plausible colonists, daily routines, moves, social events and power results so the
 * client can be built and demoed without the Convex deployment (EXPO_PUBLIC_DATA_SOURCE=mock).
 */
import {
  LOCATIONS,
  LOCATION_IDS,
  MAX_POPULATION,
  OCCUPATIONS,
  RESOURCE_LABELS,
  SPRITE_VARIANTS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICK_MS_AT_1X,
  TRAIT_KEYS,
  VALUE_KEYS,
  findPath,
  tickToClock,
  type LocationId,
  type Speed,
  type SpriteId,
} from '../../shared/colony';
import type {
  ActiveEffect,
  ActivityKind,
  AgentDetail,
  AgentLite,
  BeliefPublic,
  EventCategory,
  Id,
  Intervention,
  InterventionResult,
  RelationshipPublic,
  SyncUpdates,
  Traits,
  Values,
  WorldEventPublic,
  WorldPublic,
} from '../../shared/types';
import type { FeedArgs, Unsubscribe, WorldSource } from './WorldSource';

const FIRST = ['Mira', 'Tomas', 'Elian', 'Asha', 'Kenji', 'Noor', 'Ivo', 'Lena', 'Dax', 'Yara', 'Soren', 'Priya', 'Malik', 'Juno', 'Teo', 'Ines', 'Rafe', 'Zhen', 'Oksana', 'Bram', 'Calla', 'Emeka', 'Farah', 'Goran', 'Hana', 'Idris', 'Jaya', 'Kofi', 'Liang', 'Marit', 'Nico', 'Oona', 'Pavel', 'Quinn', 'Rosa', 'Sami', 'Talia', 'Uri', 'Vera', 'Wren', 'Xavi', 'Yusuf', 'Zora', 'Anouk', 'Bodhi', 'Cyrus', 'Dalia', 'Esme', 'Finn', 'Greta'];
const LAST = ['Okafor', 'Vance', 'Reyes', 'Tanaka', 'Novak', 'Haddad', 'Lindqvist', 'Mbeki', 'Sorensen', 'Park', 'Castillo', 'Ivanova', 'Rahman', 'Duarte', 'Fischer', 'Adeyemi', 'Kowalski', 'Nakamura', 'Silva', 'Brandt', 'Chowdhury', 'Moreau', 'Petrov', 'Osei', 'Alvarez', 'Hale', 'Ng', 'Bianchi', 'Koroma', 'Stone'];
const MOODS = ['content', 'focused', 'tired', 'cheerful', 'restless', 'calm', 'worried', 'hopeful'];
const TALK = ['Water ration is down again.', 'Did you hear about the depot?', 'The council is hiding something.', 'Long shift. I need a drink.', 'Prices at the Exchange are up.', 'Drill three is jammed again.', 'The new arrivals seem decent.', 'Save me a seat at the canteen.', 'Earth feels so far away.', 'I could sleep for a sol.', 'They say a shuttle is coming.', 'Careful who you trust here.'];
const FACTIONS = [
  { id: 'council', name: "Founders' Circle", color: '#7f8cff', description: 'The original crew and their allies. They hold most council seats.' },
  { id: 'union', name: "Haulers' Union", color: '#ff9a4a', description: 'Workers who want a bigger share of what they dig, print and carry.' },
  { id: 'icers', name: 'Deep Ice Collective', color: '#5fd9f0', description: 'Ice miners and their families. Without them nobody drinks.' },
];
const OCC_COUNTS: Record<string, number> = { hydroponicist: 14, ice_miner: 10, quarry_hand: 8, fabricator: 10, solar_tech: 6, trader: 8, quartermaster: 2, councilor: 5, security: 6, medic: 6, researcher: 6, cook: 5, dock_hand: 4, hauler: 5, resident: 5 };
const WORK_VERB: Record<string, string> = { hydroponicist: 'Tending the grow racks', ice_miner: 'Drilling for ice', quarry_hand: 'Digging regolith', fabricator: 'Printing parts', solar_tech: 'Servicing the panels', trader: 'Running a stall', quartermaster: 'Counting the reserve', councilor: 'Hearing petitions', security: 'Patrolling', medic: 'Treating patients', researcher: 'Running experiments', cook: 'Cooking for the colony', dock_hand: 'Unloading cargo', hauler: 'Hauling crates', resident: 'Running errands' };

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type MockAgent = AgentDetail & { rumorKeys: Set<string> };

export function createMockSource(): WorldSource {
  const rand = mulberry(20261115);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

  let tick = 12; // 08:00 on Sol 1
  let speed: Speed = 1;
  let version = 1;
  let nextId = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const agents = new Map<Id, MockAgent>();
  const events: WorldEventPublic[] = [];
  const effects: ActiveEffect[] = [];
  const damage: Partial<Record<LocationId, number>> = {};
  const stock = { food: 620, water: 540, parts: 210, medicine: 90, credits: 4000 };
  const prices = { food: 4, water: 5, parts: 9, medicine: 14 };
  const eventVersion = new Map<Id, number>();
  const commands = new Map<string, InterventionResult>();
  const worldListeners = new Set<(world: WorldPublic | null) => void>();
  const agentListeners = new Map<Id, Set<(agent: AgentDetail | null) => void>>();
  let focusId: Id | null = null;
  let llmCalls = 0;

  const touch = (a: MockAgent) => {
    a.updatedAtVersion = version;
  };
  const name = (id?: Id) => (id ? (agents.get(id)?.name ?? 'someone') : 'someone');

  function emit(e: Omit<WorldEventPublic, 'id' | 'tick' | 'banner' | 'visibility' | 'participantIds'> & { participantIds?: Id[]; visibility?: WorldEventPublic['visibility']; banner?: boolean }): WorldEventPublic {
    const event: WorldEventPublic = {
      id: 'e' + nextId++,
      tick,
      participantIds: e.participantIds ?? [],
      visibility: e.visibility ?? 'public',
      banner: e.banner ?? e.salience >= 0.6,
      category: e.category,
      eventType: e.eventType,
      actorId: e.actorId,
      locationId: e.locationId,
      summary: e.summary,
      salience: e.salience,
      causationEventId: e.causationEventId,
    };
    events.push(event);
    eventVersion.set(event.id, version);
    if (events.length > 600) events.splice(0, events.length - 600).forEach((old) => eventVersion.delete(old.id));
    for (const id of [event.actorId, ...event.participantIds]) {
      const a = id ? agents.get(id) : undefined;
      if (a) a.recentEvents = [event, ...a.recentEvents].slice(0, 14);
    }
    return event;
  }

  function relationship(from: MockAgent, to: MockAgent, kind: RelationshipPublic['kind'], affinity: number) {
    if (from.id === to.id || from.relationships.some((r) => r.toAgentId === to.id)) return;
    from.relationships.push({ toAgentId: to.id, toAgentName: to.name, toAgentAlive: to.alive, kind, affinity, trust: clamp(affinity + (rand() - 0.5) * 0.4, -1, 1), fear: kind === 'rival' ? rand() * 0.4 : 0 });
  }

  function makeAgent(input: { name: string; spriteId: SpriteId; occupation: string; home: 'habitat_a' | 'habitat_b'; ageBand: AgentDetail['ageBand']; traits?: Traits; values?: Values; background?: string; factionId?: string; locationId?: LocationId }): MockAgent {
    const occ = OCCUPATIONS.find((o) => o.id === input.occupation) ?? OCCUPATIONS[OCCUPATIONS.length - 1];
    const traits = input.traits ?? (Object.fromEntries(TRAIT_KEYS.map((k) => [k, Math.round(rand() * 100) / 100])) as Traits);
    const values = input.values ?? (Object.fromEntries(VALUE_KEYS.map((k) => [k, Math.round(rand() * 100) / 100])) as Values);
    const faction = FACTIONS.find((f) => f.id === input.factionId);
    const agent: MockAgent = {
      id: 'a' + nextId++,
      name: input.name,
      spriteId: input.spriteId,
      occupation: occ.id,
      factionId: faction?.id,
      factionName: faction?.name,
      alive: true,
      locationId: input.locationId ?? input.home,
      activity: 'idle',
      activityLabel: 'Getting ready for the shift',
      busyUntilTick: tick + Math.floor(rand() * 4),
      mood: pick(MOODS),
      health: 70 + Math.floor(rand() * 30),
      needs: { hunger: 20 + rand() * 30, thirst: 20 + rand() * 30, fatigue: 10 + rand() * 30, safety: rand() * 20, social: 20 + rand() * 40 },
      updatedAtVersion: version,
      ageBand: input.ageBand,
      background: input.background ?? 'Came up on one of the early shuttles and never left.',
      homeLocationId: input.home,
      workLocationId: occ.workLocationId,
      householdMemberIds: [],
      traits,
      values,
      skills: { [occ.id]: 40 + Math.floor(rand() * 55), persuasion: Math.floor(rand() * 80), repair: Math.floor(rand() * 80) },
      inventory: { food: 2 + Math.floor(rand() * 6), water: 2 + Math.floor(rand() * 6), credits: 10 + Math.floor(rand() * 90) },
      goals: [],
      beliefs: [],
      relationships: [],
      recentEvents: [],
      rumorKeys: new Set(),
    };
    agent.goals = [
      { id: 'g' + nextId++, kind: 'survive', description: 'Keep fed, watered and rested', priority: 0.5, source: 'needs', status: 'active', createdAtTick: 0 },
      { id: 'g' + nextId++, kind: values.wealth > 0.6 ? 'earn_wealth' : traits.ambition > 0.65 ? 'gain_influence' : values.family > 0.6 ? 'protect_person' : 'improve_relationship', description: values.wealth > 0.6 ? 'Save 300 credits for a private bunk' : traits.ambition > 0.65 ? 'Win a seat on the council' : values.family > 0.6 ? 'Keep the household supplied' : 'Make a real friend in the colony', priority: 0.35 + rand() * 0.3, source: 'personality', status: 'active', createdAtTick: 0 },
    ];
    agent.plan = { intent: 'Get through the shift and keep the household supplied.', source: 'routine', goalId: agent.goals[0].id, steps: [{ label: 'Work the shift', status: 'running' }, { label: 'Eat at the canteen', status: 'pending' }, { label: 'Rest at home', status: 'pending' }], cursor: 0 };
    agents.set(agent.id, agent);
    return agent;
  }

  // ----- seed -----
  const usedNames = new Set<string>();
  for (const occ of OCCUPATIONS) {
    for (let i = 0; i < (OCC_COUNTS[occ.id] ?? 0); i++) {
      let full = '';
      do full = pick(FIRST) + ' ' + pick(LAST);
      while (usedNames.has(full));
      usedNames.add(full);
      const factionId = occ.id === 'councilor' || occ.id === 'quartermaster' || occ.id === 'security' ? 'council' : occ.id === 'ice_miner' ? 'icers' : ['hauler', 'dock_hand', 'quarry_hand', 'fabricator'].includes(occ.id) && rand() > 0.3 ? 'union' : rand() > 0.75 ? pick(FACTIONS).id : undefined;
      makeAgent({ name: full, spriteId: (occ.archetype + '_' + Math.floor(rand() * SPRITE_VARIANTS)) as SpriteId, occupation: occ.id, home: rand() > 0.5 ? 'habitat_a' : 'habitat_b', ageBand: rand() < 0.15 ? 'young' : rand() < 0.2 ? 'elder' : 'adult', factionId });
    }
  }
  const all = () => [...agents.values()];
  const seeded = all();
  for (let i = 0; i < seeded.length; i += 3) {
    const members = seeded.slice(i, i + 3).filter((m) => m.homeLocationId === seeded[i].homeLocationId);
    for (const m of members) {
      m.householdName = seeded[i].name.split(' ')[1] + ' household';
      m.householdMemberIds = members.map((x) => x.id);
      for (const other of members) relationship(m, other, 'family', 0.6 + rand() * 0.4);
    }
  }
  for (const a of seeded) {
    for (let i = 0; i < 4; i++) {
      const other = pick(seeded);
      const kind = other.occupation === a.occupation ? 'colleague' : rand() < 0.2 ? 'rival' : rand() < 0.5 ? 'friend' : 'acquaintance';
      relationship(a, other, kind, kind === 'rival' ? -0.2 - rand() * 0.6 : kind === 'friend' ? 0.4 + rand() * 0.5 : rand() * 0.4);
    }
    a.relationships.sort((x, y) => Math.abs(y.affinity) - Math.abs(x.affinity));
    if (rand() < 0.35) {
      const subject = pick(seeded);
      a.beliefs.push({ id: 'b' + nextId++, text: pick(['{n} keeps a private stash of water.', '{n} is the best fixer in the colony.', '{n} wants the quartermaster job.', '{n} cannot keep a secret.']).replace('{n}', subject.name), subjectAgentId: subject.id, subjectAgentName: subject.name, confidence: 0.3 + rand() * 0.5, sourceType: pick(['observed', 'told', 'inference'] as const), learnedAtTick: 0 });
    }
    a.beliefs.push({ id: 'b' + nextId++, text: 'The Supply Depot holds enough water for about ten sols.', confidence: 0.6, sourceType: 'told', learnedAtTick: 0 });
  }

  // ----- world -----
  function worldPublic(): WorldPublic {
    const list = all();
    return {
      id: 'mock-world',
      name: 'Shackleton Colony',
      tick,
      speed,
      status: speed === 0 ? 'paused' : 'running',
      version,
      population: { alive: list.filter((a) => a.alive).length, dead: list.filter((a) => !a.alive).length },
      activeEffects: effects.map((e) => ({ ...e })),
      stockpiles: { depot: { ...stock }, hydroponics: { food: 120 }, ice_wells: { water: 80 } },
      damage: { ...damage },
      prices: { ...prices },
      factions: FACTIONS.map((f) => ({ ...f, leaderAgentId: all().find((a) => a.factionId === f.id && a.alive)?.id, memberCount: list.filter((a) => a.factionId === f.id && a.alive).length })),
      llm: { enabled: false, callsToday: llmCalls, budgetPerDay: 20, bonusThoughts: 0, queued: 0 },
    };
  }
  const lite = (a: MockAgent): AgentLite => ({ id: a.id, name: a.name, spriteId: a.spriteId, occupation: a.occupation, factionId: a.factionId, alive: a.alive, locationId: a.locationId, move: a.move, activity: a.activity, activityLabel: a.activityLabel, busyUntilTick: a.busyUntilTick, interactingWithId: a.interactingWithId, speech: a.speech, mood: a.mood, health: Math.round(a.health), needs: { hunger: Math.round(a.needs.hunger), thirst: Math.round(a.needs.thirst), fatigue: Math.round(a.needs.fatigue), safety: Math.round(a.needs.safety), social: Math.round(a.needs.social) }, updatedAtVersion: a.updatedAtVersion });
  const detail = (a: MockAgent): AgentDetail => {
    const { rumorKeys: _rumorKeys, ...rest } = a;
    return { ...rest, ...lite(a), relationships: a.relationships.slice(0, 8).map((r) => ({ ...r, toAgentAlive: agents.get(r.toAgentId)?.alive ?? false })), beliefs: a.beliefs.slice(0, 6), goals: [...a.goals].sort((x, y) => y.priority - x.priority) };
  };
  function notify() {
    const w = worldPublic();
    worldListeners.forEach((l) => l(w));
    agentListeners.forEach((set, id) => {
      const a = agents.get(id);
      set.forEach((l) => l(a ? detail(a) : null));
    });
  }

  function setActivity(a: MockAgent, activity: ActivityKind, label: string, duration: number) {
    a.activity = activity;
    a.activityLabel = label;
    a.busyUntilTick = tick + Math.max(1, Math.round(duration));
    a.move = undefined;
    a.interactingWithId = undefined;
    a.speech = undefined;
    touch(a);
  }
  function walk(a: MockAgent, to: LocationId, why: string) {
    const path = findPath(a.locationId, to);
    const ticks = Math.max(1, path?.ticks ?? 2);
    a.move = { from: a.locationId, to, departTick: tick, arriveTick: tick + ticks };
    a.locationId = to;
    a.activity = 'walking';
    a.activityLabel = 'Walking to ' + LOCATIONS[to].name + ' ' + why;
    a.busyUntilTick = tick + ticks;
    a.interactingWithId = undefined;
    a.speech = undefined;
    touch(a);
  }
  const drought = () => effects.find((e) => e.type === 'drought');
  const stormAt = (loc: LocationId) => effects.some((e) => e.type === 'storm' && (e.locationIds.length === 0 ? LOCATIONS[loc].exposed : e.locationIds.includes(loc)));

  function decide(a: MockAgent) {
    const { hour } = tickToClock(tick);
    if (stormAt(a.locationId) && a.activity !== 'fleeing') {
      a.mood = 'afraid';
      a.needs.safety = clamp(a.needs.safety + 40);
      a.activity = 'fleeing';
      walk(a, 'plaza', 'to shelter from the storm');
      a.activity = 'fleeing';
      a.activityLabel = 'Fleeing the storm for the Commons Plaza';
      return;
    }
    let target: LocationId;
    let act: () => void;
    const night = hour >= 22 || hour < 6;
    if (night || a.needs.fatigue > 85) {
      target = a.homeLocationId;
      act = () => setActivity(a, 'sleeping', 'Sleeping in their bunk', night ? ((30 - hour) % 24) * TICKS_PER_HOUR + Math.floor(rand() * 4) : 18);
    } else if (a.needs.thirst > 62) {
      target = 'canteen';
      act = () => {
        const dry = stock.water <= 0;
        if (!dry) stock.water -= 1;
        a.needs.thirst = clamp(a.needs.thirst - (dry ? 5 : 55));
        setActivity(a, 'drinking', dry ? 'Looking for water at the canteen. The taps are dry.' : 'Drinking at the canteen', 2);
      };
    } else if (a.needs.hunger > 62 || hour === 12) {
      target = 'canteen';
      act = () => {
        if (stock.food > 0) stock.food -= 1;
        a.needs.hunger = clamp(a.needs.hunger - 50);
        setActivity(a, 'eating', 'Eating at the canteen', 3);
      };
    } else if ((hour >= 7 && hour < 12) || (hour >= 13 && hour < 18)) {
      target = a.workLocationId ?? 'plaza';
      act = () => {
        setActivity(a, 'working', (WORK_VERB[a.occupation] ?? 'Working') + ' at ' + LOCATIONS[target].name, 5 + rand() * 6);
        a.inventory.credits = (a.inventory.credits ?? 0) + 3;
        const produces = LOCATIONS[target].produces;
        if (produces && produces !== 'credits') stock[produces] += produces === 'water' && drought() ? 0.3 : 2;
        if (damage[target]) {
          damage[target] = Math.max(0, damage[target]! - 0.04);
          if (damage[target]! <= 0.02) {
            delete damage[target];
            emit({ category: 'action', eventType: 'repair', actorId: a.id, locationId: target, summary: a.name + ' and the crew finished repairs at ' + LOCATIONS[target].name + '.', salience: 0.45 });
          }
        }
      };
    } else {
      const spots: LocationId[] = ['plaza', 'canteen', 'market', a.homeLocationId];
      target = spots[Math.floor(rand() * spots.length)];
      act = () => socialise(a);
    }
    if (a.locationId !== target) walk(a, target, target === a.homeLocationId ? 'to rest' : target === 'canteen' ? 'for a meal' : target === a.workLocationId ? 'for the shift' : 'to see who is around');
    else act();
  }

  function socialise(a: MockAgent) {
    const here = all().filter((o) => o.alive && o.id !== a.id && o.locationId === a.locationId && !o.move && o.activity !== 'sleeping' && o.activity !== 'talking');
    const roll = rand();
    if (here.length === 0 || roll < 0.15) return setActivity(a, a.locationId === a.homeLocationId ? 'resting' : 'idle', a.locationId === a.homeLocationId ? 'Resting at home' : 'Watching the crowd at ' + LOCATIONS[a.locationId].name, 3 + rand() * 4);
    const b = pick(here);
    const scarce = stock.water < 150 || stock.food < 150;
    if (a.locationId === 'market' && roll < 0.45) {
      const res = pick(['food', 'water', 'parts', 'medicine'] as const);
      const qty = 1 + Math.floor(rand() * 3);
      setActivity(a, 'trading', 'Buying ' + qty + ' ' + res + ' from ' + b.name, 2);
      setActivity(b, 'trading', 'Selling ' + qty + ' ' + res + ' to ' + a.name, 2);
      a.interactingWithId = b.id;
      b.interactingWithId = a.id;
      a.inventory[res] = (a.inventory[res] ?? 0) + qty;
      a.inventory.credits = Math.max(0, (a.inventory.credits ?? 0) - qty * prices[res]);
      b.inventory.credits = (b.inventory.credits ?? 0) + qty * prices[res];
      emit({ category: 'economy', eventType: 'trade', actorId: a.id, participantIds: [b.id], locationId: a.locationId, summary: a.name + ' bought ' + qty + ' ' + res + ' from ' + b.name + ' for ' + qty * prices[res] + ' credits.', salience: 0.22, visibility: 'local' });
      return;
    }
    if (scarce && a.traits.caution < 0.35 && roll > 0.9) {
      const res = stock.water < stock.food ? 'water' : 'food';
      const cause = events.findLast((e) => e.eventType === 'price_change' || e.eventType === 'drought');
      setActivity(a, 'stealing', 'Slipping ' + res + ' out of the Supply Depot', 2);
      stock[res] = Math.max(0, stock[res] - 6);
      a.inventory[res] = (a.inventory[res] ?? 0) + 6;
      const theft = emit({ category: 'social', eventType: 'theft', actorId: a.id, participantIds: [b.id], locationId: 'depot', summary: a.name + ' stole 6 ' + res + ' from the Supply Depot. ' + b.name + ' saw it happen.', salience: 0.78, causationEventId: cause?.id });
      b.beliefs.unshift({ id: 'b' + nextId++, text: a.name + ' stole ' + res + ' from the Supply Depot.', subjectAgentId: a.id, subjectAgentName: a.name, confidence: 0.9, sourceType: 'observed', learnedAtTick: tick });
      b.lastThought = { tick, trigger: 'witnessed a theft', intent: 'Decide whether to report ' + a.name + ' to security.', source: 'rules' };
      emit({ category: 'social', eventType: 'suspicion', actorId: b.id, participantIds: [a.id], locationId: a.locationId, summary: b.name + ' now distrusts ' + a.name + '.', salience: 0.4, causationEventId: theft.id, visibility: 'local' });
      touch(b);
      return;
    }
    if (roll > 0.8 && (a.inventory.food ?? 0) > 3 && a.traits.empathy > 0.5) {
      setActivity(a, 'giving', 'Sharing rations with ' + b.name, 2);
      a.interactingWithId = b.id;
      a.inventory.food = (a.inventory.food ?? 0) - 2;
      b.inventory.food = (b.inventory.food ?? 0) + 2;
      emit({ category: 'social', eventType: 'gift', actorId: a.id, participantIds: [b.id], locationId: a.locationId, summary: a.name + ' gave 2 food to ' + b.name + '.', salience: 0.35, visibility: 'local' });
      return;
    }
    // talk, and maybe pass a rumor along
    const line = pick(TALK);
    setActivity(a, 'talking', 'Talking with ' + b.name, 2 + rand() * 2);
    setActivity(b, 'talking', 'Talking with ' + a.name, a.busyUntilTick - tick);
    a.interactingWithId = b.id;
    b.interactingWithId = a.id;
    a.speech = line;
    a.needs.social = clamp(a.needs.social - 30);
    b.needs.social = clamp(b.needs.social - 30);
    const rumor = a.beliefs.find((bel) => bel.sourceType === 'rumor' && !b.beliefs.some((x) => x.text === bel.text));
    if (rumor && rand() < 0.7) {
      b.beliefs.unshift({ ...rumor, id: 'b' + nextId++, confidence: Math.max(0.2, rumor.confidence - 0.15), sourceAgentName: a.name, learnedAtTick: tick });
      a.speech = 'They say ' + rumor.text.charAt(0).toLowerCase() + rumor.text.slice(1);
      const origin = events.findLast((e) => e.eventType === 'rumor_started' && e.summary.includes(rumor.subjectAgentName ?? '~'));
      emit({ category: 'social', eventType: 'rumor_spread', actorId: a.id, participantIds: [b.id, ...(rumor.subjectAgentId ? [rumor.subjectAgentId] : [])], locationId: a.locationId, summary: a.name + ' told ' + b.name + ': "' + rumor.text + '"', salience: 0.5, causationEventId: origin?.id, visibility: 'local' });
      const rel = b.relationships.find((r) => r.toAgentId === rumor.subjectAgentId);
      if (rel) rel.affinity = clamp(rel.affinity - 0.2, -1, 1);
    } else if (rand() < 0.25) {
      emit({ category: 'social', eventType: 'conversation', actorId: a.id, participantIds: [b.id], locationId: a.locationId, summary: a.name + ' and ' + b.name + ' talked at ' + LOCATIONS[a.locationId].name + '.', salience: 0.15, visibility: 'local' });
    }
  }

  function stepTick() {
    tick += 1;
    version += 1;
    // effects
    for (let i = effects.length - 1; i >= 0; i--) {
      if (tick >= effects[i].endTick) {
        const ended = effects.splice(i, 1)[0];
        emit({ category: 'environment', eventType: ended.type + '_ended', summary: ended.type === 'drought' ? 'The ice wells are flowing again.' : 'The storm has passed.', salience: 0.55, locationId: ended.locationIds[0] });
      }
    }
    const dry = drought();
    if (dry) stock.water = Math.max(0, stock.water - 2.2 * dry.severity);
    if (tick % 6 === 0) {
      const waterPrice = Math.max(3, Math.round(5 + (540 - stock.water) / 45));
      const foodPrice = Math.max(3, Math.round(4 + (620 - stock.food) / 70));
      if (waterPrice !== prices.water || foodPrice !== prices.food) {
        const rose = waterPrice > prices.water || foodPrice > prices.food;
        const big = Math.abs(waterPrice - prices.water) + Math.abs(foodPrice - prices.food) >= 2;
        prices.water = waterPrice;
        prices.food = foodPrice;
        if (big) emit({ category: 'economy', eventType: 'price_change', locationId: 'market', summary: 'Prices at the Exchange ' + (rose ? 'rose' : 'fell') + ': water ' + waterPrice + ' cr, food ' + foodPrice + ' cr.', salience: rose ? 0.62 : 0.4, causationEventId: dry ? events.findLast((e) => e.eventType === 'drought')?.id : undefined });
      }
    }
    for (const a of agents.values()) {
      if (!a.alive) continue;
      const asleep = a.activity === 'sleeping';
      a.needs.hunger = clamp(a.needs.hunger + 0.45);
      a.needs.thirst = clamp(a.needs.thirst + (dry ? 0.9 : 0.6));
      a.needs.fatigue = clamp(a.needs.fatigue + (asleep ? -2.2 : 0.4));
      a.needs.social = clamp(a.needs.social + 0.25);
      a.needs.safety = clamp(a.needs.safety - 0.5);
      if (a.needs.thirst > 95 || a.needs.hunger > 95) a.health = clamp(a.health - 0.6);
      if (tick % 12 === 0) touch(a);
      if (tick >= a.busyUntilTick) decide(a);
    }
    if (tick % TICKS_PER_DAY === TICKS_PER_DAY - 36) llmCalls = 0;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (speed === 0) return;
    timer = setTimeout(() => {
      stepTick();
      notify();
      schedule();
    }, TICK_MS_AT_1X / speed);
  }

  function applyNow(iv: Intervention): InterventionResult {
    version += 1;
    const ok = (event: WorldEventPublic, affected: Id[], createdAgentId?: Id): InterventionResult => ({ ok: true, interventionId: 'i' + nextId++, worldVersion: version, eventIds: [event.id], affectedAgentIds: affected, createdAgentId });
    const target = (id: Id): MockAgent | InterventionResult => {
      const a = agents.get(id);
      if (!a) return { ok: false, code: 'not_found', message: 'That colonist no longer exists.' };
      if (!a.alive) return { ok: false, code: 'dead_target', message: a.name + ' is already dead.' };
      return a;
    };
    switch (iv.type) {
      case 'drought': {
        const { severity, durationDays } = iv.params;
        if (!(severity > 0 && severity <= 1) || !(durationDays >= 1 && durationDays <= 10)) return { ok: false, code: 'invalid', message: 'Severity must be 0..1 and duration 1..10 sols.' };
        effects.push({ id: 'fx' + nextId++, type: 'drought', locationIds: [], severity, startTick: tick, endTick: tick + durationDays * TICKS_PER_DAY, label: 'Drought ' + Math.round(severity * 100) + '%' });
        const e = emit({ category: 'intervention', eventType: 'drought', locationId: 'ice_wells', summary: 'The ice wells are running dry. Water output has fallen by ' + Math.round(severity * 100) + '% for ' + durationDays + ' sols.', salience: 0.95 });
        const miners = all().filter((a) => a.alive && a.occupation === 'ice_miner');
        miners.forEach((m) => {
          m.mood = 'worried';
          m.lastThought = { tick, trigger: 'the drills came up dry', intent: 'Find out why the wells failed and protect the household water.', source: 'rules' };
          touch(m);
        });
        return ok(e, miners.map((m) => m.id));
      }
      case 'storm': {
        const { severity } = iv.params;
        const ids = iv.params.locationIds?.length ? iv.params.locationIds : LOCATION_IDS.filter((id) => LOCATIONS[id].exposed);
        effects.push({ id: 'fx' + nextId++, type: 'storm', locationIds: [...ids], severity, startTick: tick, endTick: tick + 6 + Math.round(severity * 12), label: 'Storm' });
        const e = emit({ category: 'intervention', eventType: 'storm', locationId: ids[0], summary: 'A meteor storm is hitting ' + ids.map((id) => LOCATIONS[id].name).join(', ') + '.', salience: 0.95 });
        const hit: Id[] = [];
        for (const id of ids) {
          damage[id] = Math.min(1, (damage[id] ?? 0) + 0.3 + severity * 0.6);
          emit({ category: 'environment', eventType: 'damage', locationId: id, summary: LOCATIONS[id].name + ' was damaged by the storm.', salience: 0.6, causationEventId: e.id, banner: false });
        }
        for (const a of all()) {
          if (a.alive && ids.includes(a.locationId)) {
            hit.push(a.id);
            a.health = clamp(a.health - severity * 25 * rand());
            a.busyUntilTick = tick;
            decide(a);
          }
        }
        return ok(e, hit);
      }
      case 'grant': {
        const a = target(iv.params.agentId);
        if (!('id' in a)) return a;
        if (!(iv.params.amount > 0 && iv.params.amount <= 500)) return { ok: false, code: 'invalid', message: 'Amount must be between 1 and 500.' };
        a.inventory[iv.params.resource] = (a.inventory[iv.params.resource] ?? 0) + iv.params.amount;
        a.mood = 'astonished';
        a.lastThought = { tick, trigger: 'found ' + iv.params.amount + ' ' + iv.params.resource + ' in their locker', intent: 'Work out where it came from, and what to do with it.', source: 'rules' };
        touch(a);
        return ok(emit({ category: 'intervention', eventType: 'grant', actorId: a.id, locationId: a.locationId, summary: a.name + ' found ' + iv.params.amount + ' ' + RESOURCE_LABELS[iv.params.resource].toLowerCase() + ' that nobody can account for.', salience: 0.7 }), [a.id]);
      }
      case 'kill': {
        const a = target(iv.params.agentId);
        if (!('id' in a)) return a;
        a.alive = false;
        a.health = 0;
        a.move = undefined;
        a.activity = 'dead';
        a.activityLabel = 'Dead: ' + iv.params.cause;
        a.speech = undefined;
        a.interactingWithId = undefined;
        a.death = { tick, cause: iv.params.cause };
        a.plan = undefined;
        touch(a);
        const e = emit({ category: 'intervention', eventType: 'death', actorId: a.id, locationId: a.locationId, summary: a.name + ' died at ' + LOCATIONS[a.locationId].name + ' (' + iv.params.cause + ').', salience: 1 });
        const mourners = all().filter((o) => o.alive && o.relationships.some((r) => r.toAgentId === a.id && r.affinity > 0.3));
        for (const m of mourners.slice(0, 6)) {
          m.mood = 'grieving';
          setActivity(m, 'mourning', 'Mourning ' + a.name, 6 + rand() * 6);
          m.lastThought = { tick, trigger: a.name + ' died', intent: 'Grieve, then find out what really happened.', source: 'rules' };
          emit({ category: 'social', eventType: 'grief', actorId: m.id, participantIds: [a.id], locationId: m.locationId, summary: m.name + ' is mourning ' + a.name + '.', salience: 0.5, causationEventId: e.id, visibility: 'local' });
        }
        return ok(e, [a.id, ...mourners.slice(0, 6).map((m) => m.id)]);
      }
      case 'whisper': {
        const a = target(iv.params.agentId);
        if (!('id' in a)) return a;
        if (iv.params.text.trim().length < 3) return { ok: false, code: 'invalid', message: 'The whisper needs some words.' };
        const about = iv.params.aboutAgentId ? agents.get(iv.params.aboutAgentId) : undefined;
        const belief: BeliefPublic = { id: 'b' + nextId++, text: iv.params.text, subjectAgentId: about?.id, subjectAgentName: about?.name, confidence: Math.min(1, 0.3 + iv.params.strength * 0.6), sourceType: 'divine', learnedAtTick: tick };
        a.beliefs.unshift(belief);
        a.lastThought = { tick, trigger: 'a thought arrived from nowhere', intent: 'Act on the idea: "' + iv.params.text + '"', source: 'llm' };
        a.goals.unshift({ id: 'g' + nextId++, kind: about ? 'investigate' : 'custom', description: iv.params.text, priority: 0.5 + iv.params.strength * 0.45, source: 'divine', status: 'active', targetAgentId: about?.id, targetAgentName: about?.name, createdAtTick: tick });
        a.mood = 'unsettled';
        llmCalls += 1;
        touch(a);
        return ok(emit({ category: 'intervention', eventType: 'whisper', actorId: a.id, participantIds: about ? [about.id] : [], locationId: a.locationId, summary: 'A voice whispered to ' + a.name + ': "' + iv.params.text + '"', salience: 0.6, visibility: 'private', banner: false }), [a.id]);
      }
      case 'rumor': {
        const subject = agents.get(iv.params.aboutAgentId);
        if (!subject) return { ok: false, code: 'not_found', message: 'That colonist no longer exists.' };
        if (iv.params.text.trim().length < 3) return { ok: false, code: 'invalid', message: 'The rumor needs some words.' };
        const where = iv.params.seedLocationId ?? 'canteen';
        const pool = all().filter((a) => a.alive && a.id !== subject.id && a.locationId === where);
        const hearers = (pool.length >= 3 ? pool : all().filter((a) => a.alive && a.id !== subject.id)).sort(() => rand() - 0.5).slice(0, 3);
        for (const h of hearers) {
          h.beliefs.unshift({ id: 'b' + nextId++, text: iv.params.text, subjectAgentId: subject.id, subjectAgentName: subject.name, confidence: 0.55, sourceType: 'rumor', learnedAtTick: tick });
          h.rumorKeys.add(iv.params.presetKey);
          touch(h);
        }
        return ok(emit({ category: 'intervention', eventType: 'rumor_started', participantIds: [subject.id, ...hearers.map((h) => h.id)], locationId: where, summary: 'A rumor is going round ' + LOCATIONS[where].name + ' about ' + subject.name + ': "' + iv.params.text + '"', salience: 0.72 }), hearers.map((h) => h.id));
      }
      case 'create_character': {
        const p = iv.params;
        if (p.name.trim().length < 2 || p.name.length > 40) return { ok: false, code: 'invalid', message: 'The name must be 2 to 40 characters.' };
        if (agents.size >= MAX_POPULATION) return { ok: false, code: 'cap_reached', message: 'The colony is full (' + MAX_POPULATION + ' colonists).' };
        const a = makeAgent({ name: p.name.trim(), spriteId: p.spriteId, occupation: p.occupation, home: p.homeLocationId, ageBand: p.ageBand, traits: p.traits, values: p.values, background: p.backstory, factionId: p.factionId, locationId: 'landing_pad' });
        a.inventory = { ...a.inventory, ...p.startingResources };
        p.goals.forEach((g, i) => a.goals.unshift({ id: 'g' + nextId++, kind: g.kind, description: g.description, priority: 0.8 - i * 0.1, source: 'divine', status: 'active', targetAgentId: g.targetAgentId, targetAgentName: g.targetAgentId ? name(g.targetAgentId) : undefined, createdAtTick: tick }));
        for (const r of p.relationships ?? []) {
          const other = agents.get(r.toAgentId);
          if (other) {
            relationship(a, other, r.kind, r.kind === 'rival' ? -0.5 : 0.6);
            relationship(other, a, r.kind, r.kind === 'rival' ? -0.5 : 0.6);
          }
        }
        walk(a, a.homeLocationId, 'to find their bunk');
        return ok(emit({ category: 'intervention', eventType: 'arrival', actorId: a.id, locationId: 'landing_pad', summary: a.name + ' stepped off a shuttle at the Landing Pad, a new ' + (OCCUPATIONS.find((o) => o.id === a.occupation)?.label ?? 'resident').toLowerCase() + '.', salience: 0.8 }), [a.id], a.id);
      }
    }
  }

  return {
    kind: 'mock',
    async bootstrap() {
      schedule();
      return { sessionToken: 'mock-session', worldId: 'mock-world' };
    },
    async heartbeat() {},
    async setFocus(agentId) {
      focusId = agentId;
    },
    subscribeWorld(onWorld): Unsubscribe {
      worldListeners.add(onWorld);
      onWorld(worldPublic());
      return () => worldListeners.delete(onWorld);
    },
    async setSpeed(next) {
      speed = next;
      version += 1;
      schedule();
      notify();
    },
    async skipToNotable(agentId) {
      const startCount = events.length;
      let advanced = 0;
      let found: WorldEventPublic | undefined;
      while (advanced < 36 && !found) {
        stepTick();
        advanced += 1;
        found = events.slice(startCount).find((e) => e.salience >= 0.6 || (agentId !== undefined && e.salience >= 0.3 && (e.actorId === agentId || e.participantIds.includes(agentId))));
      }
      notify();
      schedule();
      return { advancedTicks: advanced, eventId: found?.id };
    },
    async reset() {
      return { worldId: 'mock-world' };
    },
    async listAgents() {
      return all().map(lite);
    },
    subscribeAgent(agentId, onAgent): Unsubscribe {
      const set = agentListeners.get(agentId) ?? new Set();
      agentListeners.set(agentId, set);
      set.add(onAgent);
      const a = agents.get(agentId);
      onAgent(a ? detail(a) : null);
      return () => {
        set.delete(onAgent);
        if (set.size === 0) agentListeners.delete(agentId);
      };
    },
    async updates(sinceVersion): Promise<SyncUpdates> {
      return { version, tick, agents: all().filter((a) => a.updatedAtVersion > sinceVersion).map(lite), events: events.filter((e) => (eventVersion.get(e.id) ?? 0) > sinceVersion) };
    },
    async feed(args: FeedArgs) {
      const min = args.minSalience ?? 0.3;
      return events
        .filter((e) => e.salience >= min && e.visibility !== 'private' && (args.beforeTick === undefined || e.tick < args.beforeTick) && (args.agentId === undefined || e.actorId === args.agentId || e.participantIds.includes(args.agentId)))
        .slice(-(args.limit ?? 40))
        .reverse();
    },
    async chain(eventId) {
      const byId = new Map(events.map((e) => [e.id, e]));
      const chain: WorldEventPublic[] = [];
      let cursor = byId.get(eventId);
      while (cursor) {
        chain.unshift(cursor);
        cursor = cursor.causationEventId ? byId.get(cursor.causationEventId) : undefined;
      }
      return [...chain, ...events.filter((e) => e.causationEventId === eventId)];
    },
    async apply(intervention, commandId) {
      const prior = commands.get(commandId);
      if (prior) return prior;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = applyNow(intervention);
      commands.set(commandId, result);
      notify();
      return result;
    },
    subscribePlan(onPlan) {
      onPlan('free');
      return () => {};
    },
    async createCheckout() {
      throw new Error('Checkout needs the live Convex backend');
    },
    dispose() {
      if (timer) clearTimeout(timer);
      worldListeners.clear();
      agentListeners.clear();
      void focusId;
    },
  };
}
