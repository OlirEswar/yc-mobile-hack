/**
 * Builds the starting colony as plain data: 100 colonists, their households, factions, directed
 * relationships and differing beliefs. Pure and deterministic for a seed. ./insert.ts writes it.
 */
import { LOCATIONS, OCCUPATIONS, SEEDED_POPULATION, SPRITE_VARIANTS } from '../../shared/colony';
import type { LocationId, SpriteArchetype } from '../../shared/colony';
import { clamp, round2, sequence } from '../lib/rng';
import { BUNK_NAMES, FAMILY_NAMES, FIRST_NAMES } from './names';
import { FACTIONS, KEY_CHARACTERS, KEY_TIES } from './keyCharacters';

export type Home = 'habitat_a' | 'habitat_b';
export type AgeBand = 'young' | 'adult' | 'elder';

export type SeedGoal = {
  kind: string;
  description: string;
  priority: number;
  source: 'needs' | 'personality';
  predicate: string;
  target?: number;
  targetResource?: string;
  targetQuantity?: number;
  targetOccupation?: string;
  targetFaction?: string;
  drive?: string;
};

export type SeedAgent = {
  seq: number;
  key?: string;
  name: string;
  familyName: string;
  ageBand: AgeBand;
  occupation: string;
  role?: string;
  faction?: string;
  household: number;
  home: Home;
  workLocationId: LocationId;
  spriteId: string;
  traits: { ambition: number; empathy: number; caution: number; curiosity: number; sociability: number; stubbornness: number };
  values: { wealth: number; family: number; status: number; harmony: number; freedom: number };
  skills: Record<string, number>;
  skill: number;
  dayOffset: number;
  background: string;
  inv: { food: number; water: number; parts: number; medicine: number; credits: number };
  health: number;
  markup?: number;
  goals: SeedGoal[];
};

export type SeedHousehold = {
  name: string;
  home: Home;
  members: number[];
  pantry: { food: number; water: number };
  family: boolean;
};

export type SeedRelationship = {
  from: number;
  to: number;
  kind: string;
  affinity: number;
  trust: number;
  fear: number;
  obligation: number;
};

export type SeedBelief = {
  agent: number;
  kind: string;
  /** Subject colonist, when the belief is about a person. The key becomes `kind:subjectId`. */
  subject?: number;
  /** Key for beliefs about the world rather than a person. */
  worldKey?: string;
  text: string;
  valence: number;
  confidence: number;
  sourceType: 'observed' | 'told' | 'rumor' | 'inference';
};

export type SeedFaction = {
  key: string;
  name: string;
  color: string;
  description: string;
  stance: string;
  leader: number;
  officers: number[];
};

export type SeedColony = {
  agents: SeedAgent[];
  households: SeedHousehold[];
  relationships: SeedRelationship[];
  beliefs: SeedBelief[];
  factions: SeedFaction[];
  roles: Record<string, number>;
};

const OCCUPATION_COUNTS: Record<string, number> = {
  hydroponicist: 14,
  ice_miner: 10,
  quarry_hand: 7,
  fabricator: 8,
  solar_tech: 5,
  trader: 6,
  quartermaster: 2,
  councilor: 5,
  security: 6,
  medic: 6,
  researcher: 5,
  cook: 5,
  dock_hand: 4,
  hauler: 6,
  resident: 11,
};

export const PRIMARY_SKILL: Record<string, string> = {
  hydroponicist: 'farming',
  ice_miner: 'drilling',
  quarry_hand: 'mining',
  fabricator: 'engineering',
  solar_tech: 'engineering',
  trader: 'trade',
  quartermaster: 'logistics',
  councilor: 'persuasion',
  security: 'security',
  medic: 'healing',
  researcher: 'science',
  cook: 'cooking',
  dock_hand: 'logistics',
  hauler: 'logistics',
  resident: 'craft',
};

const SECONDARY_SKILLS = ['persuasion', 'trade', 'healing', 'engineering', 'farming', 'craft', 'security', 'science'];

/** Trait and value leanings by occupation, added to a random base. Order follows TRAIT_KEYS and VALUE_KEYS. */
const LEANINGS: Record<string, { t: number[]; v: number[] }> = {
  hydroponicist: { t: [0, 0.1, 0.1, 0, 0, 0], v: [0, 0.15, 0, 0.1, -0.05] },
  ice_miner: { t: [0.05, 0, -0.1, 0, 0.05, 0.1], v: [0.05, 0.1, 0, -0.05, 0.1] },
  quarry_hand: { t: [0, 0, -0.1, -0.05, 0.05, 0.15], v: [0.05, 0.1, -0.05, 0, 0.1] },
  fabricator: { t: [0.05, 0, 0.1, 0.15, -0.05, 0.05], v: [0.05, 0, 0.05, 0.05, 0.05] },
  solar_tech: { t: [0, 0, 0.15, 0.1, -0.05, 0], v: [0, 0, 0, 0.1, 0.1] },
  trader: { t: [0.25, -0.1, 0, 0.05, 0.15, 0], v: [0.3, -0.05, 0.1, -0.1, 0.15] },
  quartermaster: { t: [0, -0.05, 0.25, 0, -0.1, 0.15], v: [0, 0.05, 0.15, 0.1, -0.15] },
  councilor: { t: [0.25, 0, 0.05, 0, 0.15, 0.1], v: [0, 0, 0.3, 0.05, -0.05] },
  security: { t: [0, -0.05, 0.2, 0.05, -0.05, 0.15], v: [0, 0.05, 0.1, 0.15, -0.2] },
  medic: { t: [-0.05, 0.3, 0.1, 0.1, 0, 0], v: [-0.15, 0.05, 0, 0.25, 0] },
  researcher: { t: [0.05, 0, 0, 0.35, -0.1, 0.05], v: [-0.1, -0.1, 0.05, 0, 0.25] },
  cook: { t: [-0.05, 0.15, 0, 0.05, 0.25, -0.05], v: [0, 0.1, 0, 0.15, 0] },
  dock_hand: { t: [0.1, 0, -0.1, 0.05, 0.1, 0], v: [0.15, -0.05, 0, -0.05, 0.2] },
  hauler: { t: [0, 0.05, 0, -0.05, 0.05, 0.05], v: [0.05, 0.1, -0.05, 0.05, 0.05] },
  resident: { t: [-0.1, 0.1, 0.05, 0.05, 0.1, 0], v: [-0.1, 0.2, -0.05, 0.1, 0] },
};

const JOB_LINES: Record<string, string[]> = {
  hydroponicist: ['Tends the lettuce and soy racks in the Hydroponics Bays', 'Runs the nutrient lines in the Hydroponics Bays', 'Grew up under the grow lights and works them now'],
  ice_miner: ['Drills the shadowed crater at the Ice Wells', 'Works a thermal lance on the well crews', 'Has cut ice at the wells since the second shaft opened'],
  quarry_hand: ['Digs regolith in the open pit', 'Runs a loader at the Regolith Quarry', 'Breaks rock at the quarry face'],
  fabricator: ['Prints and mills parts at the Fabrication Works', 'Keeps the sinter forges running at the works', 'Machines drill heads and seals at the works'],
  solar_tech: ['Cleans and re-aims panels on the crater rim', 'Keeps the Solar Farm inverters alive', 'Walks the panel rows of the Solar Farm every shift'],
  trader: ['Keeps a small stall on the Exchange Concourse', 'Buys from the depot and sells by the cup on the concourse', 'Trades anything that fits on a counter'],
  quartermaster: ['Deputy at the Supply Depot, in charge of the night count'],
  councilor: ['Sits on the colony council', 'Holds a council seat for the habitat rings', 'Speaks for the old corridors on the council'],
  security: ['Walks the tubes for colony security', 'Stands watch at the plaza airlocks', 'Keeps the peace on the night rounds'],
  medic: ['Works the wards at the Med Bay', 'Runs the pharmacy bench at the Med Bay', 'Sets bones and treats dust lung at the Med Bay'],
  researcher: ['Logs melt rates at the Observatory Lab', 'Studies regolith chemistry at the lab', 'Watches the sky for storms from the Observatory'],
  cook: ['Works the line at the Airlock Canteen', 'Stretches rations into meals at the canteen', 'Bakes the canteen flatbread before first shift'],
  dock_hand: ['Unloads shuttles at the Landing Pad', 'Lashes and logs cargo at the pad', 'Runs the pad winch when a shuttle is down'],
  hauler: ['Hauls water and ore through the tubes to the depot', 'Drives a hand-tug between the wells and the depot', 'Moves crates wherever the quartermaster points'],
  resident: ['Keeps the home corridor running', 'Minds the ring nursery and the notice board', 'Mends suits and tells stories on the ring'],
};

const TRAIT_LINES: Record<string, string[]> = {
  ambition: ['Wants more than a bunk and a ration card.', 'Is always working an angle for something better.'],
  empathy: ['Is the first to notice when a neighbour is short.', 'Cannot walk past someone in trouble.'],
  caution: ['Checks every seal twice.', 'Never spends the last of anything.'],
  curiosity: ['Asks more questions than the council likes.', 'Has to know how everything works, and who decided it.'],
  sociability: ['Knows everyone on the ring by name.', 'Talks to anyone who stands still long enough.'],
  stubbornness: ['Has never changed an opinion in public.', 'Will argue a point until the lights dim.'],
};

const VALUE_LINES: Record<string, string[]> = {
  wealth: ['Counts credits before sleep.', 'Thinks a full account is the only real safety.'],
  family: ['Everything goes home to the family.', 'Would trade a week of rations for a quiet evening at home.'],
  status: ['Cares what the plaza says about them.', 'Wants a name people listen to.'],
  harmony: ['Hates a raised voice.', 'Would rather split the last cup than fight over it.'],
  freedom: ['Bristles at every new rule.', 'Dreams of answering to nobody.'],
};

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pickFrom = <T>(items: readonly T[], next: () => number): T => items[Math.floor(next() * items.length)];
const TRAIT_ORDER = ['ambition', 'empathy', 'caution', 'curiosity', 'sociability', 'stubbornness'] as const;
const VALUE_ORDER = ['wealth', 'family', 'status', 'harmony', 'freedom'] as const;

function occupationDef(id: string) {
  const def = OCCUPATIONS.find((o) => o.id === id);
  if (!def) throw new Error('unknown occupation ' + id);
  return def;
}

export function factionName(key: string | undefined): string {
  return FACTIONS.find((f) => f.key === key)?.name ?? 'no faction';
}

export function buildColony(seed: number): SeedColony {
  const next = sequence(seed ^ 0x51ed270b);
  const agents: SeedAgent[] = [];
  const households: SeedHousehold[] = [];
  const spriteCounters: Partial<Record<SpriteArchetype, number>> = {};
  const usedNames = new Set<string>(KEY_CHARACTERS.flatMap((k) => [k.name, ...(k.household ?? []).map((m) => m.name)]));
  const usedFirst = new Set<string>([...usedNames].map((n) => n.split(' ')[0]));
  const firstPool = shuffle(FIRST_NAMES.filter((n) => !usedFirst.has(n)), next);
  const familyPool = shuffle(FAMILY_NAMES, next);
  const bunkPool = BUNK_NAMES.slice();

  const sprite = (occupation: string): string => {
    const archetype = occupationDef(occupation).archetype;
    const n = spriteCounters[archetype] ?? 0;
    spriteCounters[archetype] = n + 1;
    return archetype + '_' + (n % SPRITE_VARIANTS);
  };

  const remaining: Record<string, number> = { ...OCCUPATION_COUNTS };
  for (const k of KEY_CHARACTERS) {
    remaining[k.occupation] -= 1;
    for (const m of k.household ?? []) remaining[m.occupation] -= 1;
  }

  const makeAgent = (input: {
    key?: string;
    name: string;
    familyName: string;
    ageBand: AgeBand;
    occupation: string;
    role?: string;
    faction?: string;
    household: number;
    home: Home;
    traits?: number[];
    values?: number[];
    skill?: number;
    credits?: number;
    health?: number;
    background?: string;
  }): SeedAgent => {
    const lean = LEANINGS[input.occupation];
    const t = input.traits ?? TRAIT_ORDER.map((_, i) => clamp(round2(0.2 + next() * 0.6 + lean.t[i]), 0.05, 0.98));
    const v = input.values ?? VALUE_ORDER.map((_, i) => clamp(round2(0.2 + next() * 0.6 + lean.v[i]), 0.05, 0.98));
    const traits = { ambition: t[0], empathy: t[1], caution: t[2], curiosity: t[3], sociability: t[4], stubbornness: t[5] };
    const values = { wealth: v[0], family: v[1], status: v[2], harmony: v[3], freedom: v[4] };
    const ageSkill = input.ageBand === 'young' ? -18 : input.ageBand === 'elder' ? 6 : 0;
    const skill = input.skill ?? Math.round(clamp(48 + next() * 36 + ageSkill, 20, 95));
    const skills: Record<string, number> = { [PRIMARY_SKILL[input.occupation]]: skill };
    const persuasion = Math.round(clamp(25 + traits.sociability * 45 + next() * 20, 10, 95));
    if (skills.persuasion === undefined) skills.persuasion = persuasion;
    const extra = pickFrom(SECONDARY_SKILLS, next);
    if (skills[extra] === undefined) skills[extra] = Math.round(20 + next() * 40);
    const isTrader = input.occupation === 'trader';
    const baseCredits = isTrader ? 140 + next() * 120 : input.occupation === 'resident' ? 6 + next() * 20 : 18 + next() * 45 + values.wealth * 25;
    const dominantTrait = TRAIT_ORDER.reduce((a, b) => (traits[b] > traits[a] ? b : a));
    const dominantValue = VALUE_ORDER.reduce((a, b) => (values[b] > values[a] ? b : a));
    const background =
      input.background ??
      [pickFrom(JOB_LINES[input.occupation], next) + '.', pickFrom(TRAIT_LINES[dominantTrait], next), pickFrom(VALUE_LINES[dominantValue], next)].join(' ');
    let dayOffset = Math.floor(next() * 8) - 3;
    const nightShare: Record<string, number> = { security: 0.4, medic: 0.35, ice_miner: 0.3 };
    if (!input.key && next() < (nightShare[input.occupation] ?? 0)) dayOffset += 72;
    const agent: SeedAgent = {
      seq: agents.length,
      key: input.key,
      name: input.name,
      familyName: input.familyName,
      ageBand: input.ageBand,
      occupation: input.occupation,
      role: input.role,
      faction: input.faction,
      household: input.household,
      home: input.home,
      workLocationId: occupationDef(input.occupation).workLocationId,
      spriteId: sprite(input.occupation),
      traits,
      values,
      skills,
      skill,
      dayOffset: (dayOffset + 144) % 144,
      background,
      inv: {
        food: isTrader ? 10 + Math.floor(next() * 5) : 1,
        water: isTrader ? 12 + Math.floor(next() * 7) : 1,
        parts: isTrader ? 2 + Math.floor(next() * 3) : 0,
        medicine: isTrader ? 1 + Math.floor(next() * 2) : 0,
        credits: Math.round(input.credits ?? baseCredits),
      },
      health: input.health ?? Math.round(clamp(84 + next() * 16 - (input.ageBand === 'elder' ? 10 : 0), 55, 100)),
      markup: isTrader ? round2(0.12 + traits.ambition * 0.22 + values.wealth * 0.1 - traits.empathy * 0.1) : undefined,
      goals: [],
    };
    agents.push(agent);
    return agent;
  };

  const uniqueName = (familyName: string): string => {
    for (let i = 0; i < firstPool.length; i++) {
      const first = firstPool[i];
      const full = first + ' ' + familyName;
      if (!usedNames.has(full)) {
        firstPool.splice(i, 1);
        usedNames.add(full);
        return full;
      }
    }
    throw new Error('name pool exhausted');
  };

  const pickFaction = (occupation: string, ageBand: AgeBand): string | undefined => {
    const r = next();
    const table: Record<string, [string, number][]> = {
      ice_miner: [['union', 0.8]],
      quarry_hand: [['union', 0.8]],
      fabricator: [['union', 0.7], ['exchange', 0.1]],
      hauler: [['union', 0.7]],
      solar_tech: [['union', 0.45], ['founders', 0.2]],
      hydroponicist: [['founders', 0.45], ['union', 0.3]],
      cook: [['union', 0.3], ['exchange', 0.3]],
      councilor: [['founders', 0.67], ['exchange', 0.33]],
      quartermaster: [['founders', 1]],
      security: [['founders', 0.65]],
      medic: [['founders', 0.4]],
      researcher: [['exchange', 0.45], ['founders', 0.2]],
      trader: [['exchange', 0.9]],
      dock_hand: [['exchange', 0.7], ['union', 0.2]],
      resident: ageBand === 'elder' ? [['founders', 0.55]] : [['union', 0.15]],
    };
    let acc = 0;
    for (const [key, p] of table[occupation] ?? []) {
      acc += p;
      if (r < acc) return key;
    }
    return undefined;
  };

  // ----- households -----
  const slotOccupations: string[] = [];
  for (const [occupation, count] of Object.entries(remaining)) {
    if (occupation === 'resident') continue;
    for (let i = 0; i < count; i++) slotOccupations.push(occupation);
  }
  const workerPool = shuffle(slotOccupations, next);
  let residentsLeft = remaining.resident;

  const generatedSizes: { size: number; home: Home }[] = [
    { size: 6, home: 'habitat_a' }, { size: 5, home: 'habitat_a' }, { size: 5, home: 'habitat_b' }, { size: 5, home: 'habitat_b' },
    { size: 4, home: 'habitat_a' }, { size: 4, home: 'habitat_a' }, { size: 4, home: 'habitat_b' }, { size: 4, home: 'habitat_b' },
    { size: 3, home: 'habitat_a' }, { size: 3, home: 'habitat_b' }, { size: 3, home: 'habitat_b' }, { size: 3, home: 'habitat_b' },
    { size: 3, home: 'habitat_b' }, { size: 2, home: 'habitat_b' }, { size: 2, home: 'habitat_b' }, { size: 2, home: 'habitat_b' },
  ];

  const addGeneratedMember = (household: number, home: Home, familyName: string, head: boolean, family: boolean, size: number): SeedAgent => {
    let occupation: string;
    let ageBand: AgeBand = 'adult';
    // Children and elders live in family households of three or more.
    const wantsResident = !head && family && size >= 3 && residentsLeft > 0 && next() < 0.3;
    if (wantsResident || workerPool.length === 0) {
      occupation = 'resident';
      residentsLeft -= 1;
      ageBand = next() < 0.55 ? 'young' : 'elder';
    } else {
      occupation = workerPool.pop()!;
      const r = next();
      if (!head && r < 0.1) ageBand = 'young';
      else if (r > 0.93 || (occupation === 'councilor' && r > 0.6)) ageBand = 'elder';
    }
    const name = uniqueName(family && next() < 0.8 ? familyName : pickFrom(familyPool, next));
    return makeAgent({ name, familyName: name.split(' ').slice(1).join(' '), ageBand, occupation, faction: pickFaction(occupation, ageBand), household, home });
  };

  for (const k of KEY_CHARACTERS) {
    const index = households.length;
    const household: SeedHousehold = {
      name: k.householdSize === 1 ? k.name + "'s quarters" : 'The ' + k.familyName + ' household',
      home: k.home,
      members: [],
      pantry: { food: 0, water: 0 },
      family: true,
    };
    households.push(household);
    const head = makeAgent({
      key: k.key, name: k.name, familyName: k.familyName, ageBand: k.ageBand, occupation: k.occupation, role: k.role, faction: k.faction,
      household: index, home: k.home, traits: k.traits, values: k.values, skill: k.skill, credits: k.credits, health: k.health, background: k.background,
    });
    household.members.push(head.seq);
    if (k.household) {
      for (const m of k.household) {
        const member = makeAgent({ name: m.name, familyName: k.familyName, ageBand: m.ageBand, occupation: m.occupation, faction: pickFaction(m.occupation, m.ageBand), household: index, home: k.home, credits: 2 });
        household.members.push(member.seq);
      }
    } else {
      for (let i = 1; i < k.householdSize; i++) household.members.push(addGeneratedMember(index, k.home, k.familyName, false, true, k.householdSize).seq);
    }
    const factor = k.pantryFactor ?? 0.7 + next() * 0.6;
    household.pantry = { food: Math.round(household.members.length * 2 * factor), water: Math.round(household.members.length * 3 * factor) };
  }

  generatedSizes.forEach(({ size, home }, i) => {
    const index = households.length;
    const family = !(home === 'habitat_b' && size <= 3 && i % 2 === 1);
    const familyName = familyPool[i % familyPool.length];
    const household: SeedHousehold = { name: family ? 'The ' + familyName + ' household' : bunkPool.shift() ?? 'Bunk ' + (30 + i), home, members: [], pantry: { food: 0, water: 0 }, family };
    households.push(household);
    for (let m = 0; m < size; m++) household.members.push(addGeneratedMember(index, home, familyName, m === 0, family, size).seq);
    // A few households start thin, most have about a day in hand.
    const factor = i % 5 === 3 ? 0.35 : 0.65 + next() * 0.7;
    household.pantry = { food: Math.round(size * 2 * factor), water: Math.round(size * 3 * factor) };
  });

  // Any residents not placed yet replace leftover worker slots, and vice versa.
  if (agents.length !== SEEDED_POPULATION) throw new Error('seed produced ' + agents.length + ' colonists');

  const byKey = new Map<string, SeedAgent>();
  for (const a of agents) if (a.key) byKey.set(a.key, a);
  const keyOf = (key: string): number => {
    const a = byKey.get(key);
    if (!a) throw new Error('unknown key character ' + key);
    return a.seq;
  };

  // ----- relationships -----
  const relationships: SeedRelationship[] = [];
  const pairs = new Set<string>();
  const tie = (a: number, b: number, kind: string, affinity: number, trust: number, fear = 0, obligation = 0): boolean => {
    if (a === b) return false;
    const key = a < b ? a + ':' + b : b + ':' + a;
    if (pairs.has(key)) return false;
    pairs.add(key);
    const jitter = () => (next() - 0.5) * 0.24;
    relationships.push({ from: a, to: b, kind, affinity: round2(clamp(affinity + jitter(), -1, 1)), trust: round2(clamp(trust + jitter(), -1, 1)), fear: round2(clamp(fear + next() * 0.05, 0, 1)), obligation: round2(clamp(obligation, -1, 1)) });
    relationships.push({ from: b, to: a, kind, affinity: round2(clamp(affinity + jitter(), -1, 1)), trust: round2(clamp(trust + jitter(), -1, 1)), fear: round2(clamp(fear + next() * 0.05, 0, 1)), obligation: round2(clamp(obligation, -1, 1)) });
    return true;
  };

  for (const t of KEY_TIES) tie(keyOf(t.a), keyOf(t.b), t.kind, t.affinity, t.trust, t.fear ?? 0, t.kind === 'friend' ? 0.3 : 0);

  for (const h of households) {
    for (let i = 0; i < h.members.length; i++) {
      for (let j = i + 1; j < h.members.length; j++) {
        if (h.family) tie(h.members[i], h.members[j], 'family', 0.55 + next() * 0.35, 0.6 + next() * 0.3, 0, 0.5 + next() * 0.3);
        else tie(h.members[i], h.members[j], 'friend', 0.3 + next() * 0.35, 0.3 + next() * 0.3, 0, 0.2);
      }
    }
  }

  const byOccupation = new Map<string, SeedAgent[]>();
  for (const a of agents) {
    if (a.occupation === 'resident') continue;
    const group = byOccupation.get(a.workLocationId) ?? [];
    group.push(a);
    byOccupation.set(a.workLocationId, group);
  }
  for (const group of byOccupation.values()) {
    const ring = shuffle(group, next);
    for (let i = 0; i < ring.length; i++) {
      if (ring.length > 1) tie(ring[i].seq, ring[(i + 1) % ring.length].seq, 'colleague', 0.1 + next() * 0.4, 0.2 + next() * 0.4, 0, 0.1);
      if (ring.length > 3 && next() < 0.7) tie(ring[i].seq, ring[(i + 2) % ring.length].seq, 'colleague', 0.05 + next() * 0.35, 0.15 + next() * 0.4, 0, 0.1);
    }
  }

  for (const a of agents) {
    const wanted = 1 + (next() < a.traits.sociability ? 1 : 0);
    for (let n = 0; n < wanted; n++) {
      let best: SeedAgent | undefined;
      let bestScore = -1;
      for (let attempt = 0; attempt < 6; attempt++) {
        const candidate = agents[Math.floor(next() * agents.length)];
        if (candidate.seq === a.seq || candidate.household === a.household) continue;
        const score = next() + (candidate.faction && candidate.faction === a.faction ? 0.5 : 0) + (candidate.home === a.home ? 0.3 : 0) + (candidate.ageBand === a.ageBand ? 0.3 : 0);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (best) tie(a.seq, best.seq, 'friend', 0.4 + next() * 0.4, 0.4 + next() * 0.35, 0, 0.25);
    }
  }

  // Generated rivalries: ambitious people in the same trade, or across faction lines.
  let rivalries = 0;
  const ambitious = shuffle(agents.filter((a) => a.traits.ambition > 0.55 && !a.key), next);
  for (const a of ambitious) {
    if (rivalries >= 9) break;
    const rival = agents.find(
      (b) => b.seq !== a.seq && b.household !== a.household && !pairs.has(a.seq < b.seq ? a.seq + ':' + b.seq : b.seq + ':' + a.seq) &&
        ((b.occupation === a.occupation && b.traits.ambition > 0.5) || (a.faction && b.faction && a.faction !== b.faction && b.traits.stubbornness > 0.6)) && next() < 0.35,
    );
    if (rival && tie(a.seq, rival.seq, 'rival', -0.3 - next() * 0.35, -0.2 - next() * 0.3, next() * 0.15)) rivalries += 1;
  }

  // Members know their faction leader, one way: loyalty is what leadership rests on.
  const factions: SeedFaction[] = FACTIONS.map((f) => ({
    key: f.key, name: f.name, color: f.color, description: f.description, stance: f.stance, leader: keyOf(f.leader), officers: f.officers.map(keyOf),
  }));
  for (const a of agents) {
    const faction = factions.find((f) => f.key === a.faction);
    if (!faction || faction.leader === a.seq) continue;
    const key = a.seq < faction.leader ? a.seq + ':' + faction.leader : faction.leader + ':' + a.seq;
    if (pairs.has(key)) continue;
    relationships.push({ from: a.seq, to: faction.leader, kind: 'acquaintance', affinity: round2(0.15 + next() * 0.4), trust: round2(0.25 + next() * 0.45), fear: 0, obligation: round2(0.1 + next() * 0.2) });
  }

  const edgesFrom = new Map<number, SeedRelationship[]>();
  for (const r of relationships) {
    const list = edgesFrom.get(r.from) ?? [];
    list.push(r);
    edgesFrom.set(r.from, list);
  }

  // ----- goals -----
  for (const a of agents) {
    const household = households[a.household];
    a.goals.push({
      kind: 'survive',
      description: household.members.length > 1 ? 'Keep myself and my household fed, watered and safe' : 'Keep myself fed, watered and safe',
      priority: round2(0.5 + a.values.family * 0.2),
      source: 'needs',
      predicate: 'needs_ok',
    });
    const key = KEY_CHARACTERS.find((k) => k.key === a.key);
    if (key) {
      const g = key.goal;
      let target: number | undefined;
      if (g.target?.startsWith('household:')) target = household.members[Number(g.target.split(':')[1])];
      else if (g.target) target = keyOf(g.target);
      a.goals.push({ kind: g.kind, description: g.description, priority: g.priority, source: 'personality', predicate: g.predicate, target, targetResource: g.targetResource, targetQuantity: g.targetQuantity, targetOccupation: g.targetOccupation, targetFaction: g.targetFaction, drive: g.drive });
      continue;
    }
    a.goals.push(personalGoal(a, agents, households, edgesFrom.get(a.seq) ?? [], next));
  }

  // ----- beliefs -----
  const beliefs: SeedBelief[] = [];
  const dmitri = byKey.get('dmitri')!;
  const soledad = byKey.get('soledad')!;
  const anneliese = byKey.get('anneliese')!;
  const conf = (lo: number, hi: number) => round2(lo + next() * (hi - lo));
  for (const a of agents) {
    const stance = a.faction === 'union' ? (next() < 0.7 ? 'open' : null) : a.faction === 'founders' ? (next() < 0.7 ? 'guard' : null) : next() < 0.25 ? (next() < 0.5 ? 'open' : 'guard') : null;
    if (stance === 'open') beliefs.push({ agent: a.seq, kind: 'policy_open', worldKey: 'policy_open', text: 'The depot reserve should be opened to the people who fill it.', valence: 0, confidence: conf(0.5, 0.9), sourceType: 'inference' });
    if (stance === 'guard') beliefs.push({ agent: a.seq, kind: 'policy_guard', worldKey: 'policy_guard', text: 'The depot reserve must be kept back for hard times.', valence: 0, confidence: conf(0.5, 0.9), sourceType: 'inference' });
    const doubt = a.seq === dmitri.seq ? 0 : a.key === 'priya' ? 1 : a.faction === 'union' ? 0.35 : a.occupation === 'researcher' ? 0.4 : 0.07;
    if (next() < doubt) beliefs.push({ agent: a.seq, kind: 'hoarding', subject: dmitri.seq, text: 'Dmitri Volkov is secretly hoarding food and water.', valence: -1, confidence: conf(0.25, 0.55), sourceType: 'rumor' });
    if (a.seq !== soledad.seq && a.occupation !== 'trader' && next() < 0.14) beliefs.push({ agent: a.seq, kind: 'untrustworthy', subject: soledad.seq, text: 'Soledad Marchetti overcharges whenever supplies run short.', valence: -1, confidence: conf(0.35, 0.7), sourceType: next() < 0.5 ? 'observed' : 'told' });
    if (a.seq !== anneliese.seq && next() < 0.2) beliefs.push({ agent: a.seq, kind: 'hero', subject: anneliese.seq, text: 'Anneliese Brandt has never turned a patient away.', valence: 1, confidence: conf(0.55, 0.9), sourceType: next() < 0.5 ? 'observed' : 'told' });
    const scarcity = a.occupation === 'ice_miner' ? 0.4 : a.occupation === 'researcher' ? 0.5 : 0.06;
    if (next() < scarcity) beliefs.push({ agent: a.seq, kind: 'scarcity', worldKey: 'scarcity:water', text: 'The ice wells give less water every season.', valence: -1, confidence: conf(0.3, 0.7), sourceType: a.occupation === 'ice_miner' ? 'observed' : 'inference' });
    for (const edge of edgesFrom.get(a.seq) ?? []) {
      if (edge.kind === 'rival' && next() < 0.7) beliefs.push({ agent: a.seq, kind: 'untrustworthy', subject: edge.to, text: agents[edge.to].name + ' cannot be trusted.', valence: -1, confidence: conf(0.45, 0.8), sourceType: 'inference' });
    }
    const faction = factions.find((f) => f.key === a.faction);
    if (faction && faction.leader !== a.seq && next() < 0.3) beliefs.push({ agent: a.seq, kind: 'admirable', subject: faction.leader, text: agents[faction.leader].name + ' stands up for people like us.', valence: 1, confidence: conf(0.5, 0.85), sourceType: 'inference' });
  }

  const roles: Record<string, number> = {};
  for (const a of agents) if (a.role) roles[a.role] = a.seq;

  return { agents, households, relationships, beliefs, factions, roles };
}

function personalGoal(a: SeedAgent, agents: SeedAgent[], households: SeedHousehold[], edges: SeedRelationship[], next: () => number): SeedGoal {
  const household = households[a.household];
  const others = household.members.filter((m) => m !== a.seq);
  const rival = edges.find((e) => e.kind === 'rival');
  const coolColleague = edges.filter((e) => e.kind === 'colleague').sort((x, y) => x.affinity - y.affinity)[0];
  const ranked = (['wealth', 'family', 'status', 'harmony', 'freedom'] as const)
    .map((k) => ({ k, w: a.values[k] + next() * 0.25 }))
    .sort((x, y) => y.w - x.w);
  const base = { source: 'personality' as const, priority: round2(0.45 + next() * 0.3) };
  if (a.traits.curiosity > 0.78 && a.occupation !== 'resident') {
    const subjectKey = next() < 0.5 ? 'dmitri' : 'soledad';
    const subject = agents.find((b) => b.key === subjectKey);
    if (subject && subject.seq !== a.seq) {
      return { ...base, kind: 'investigate', description: 'Find out what ' + subject.name + ' is really keeping back', predicate: 'belief_resolved', target: subject.seq, drive: 'hoarding' };
    }
  }
  for (const { k } of ranked) {
    if (k === 'wealth' && a.occupation !== 'resident') {
      const amount = Math.ceil((a.inv.credits + 80 + next() * 120) / 10) * 10;
      return { ...base, kind: 'earn_wealth', description: 'Save up ' + amount + ' credits', predicate: 'credits_at_least', targetQuantity: amount, drive: 'get_rich' };
    }
    if (k === 'family' && others.length > 0) {
      const dependants = others.filter((m) => agents[m].ageBand !== 'adult');
      const target = dependants.length > 0 ? dependants[Math.floor(next() * dependants.length)] : others[Math.floor(next() * others.length)];
      return { ...base, kind: 'protect_person', description: 'Make sure ' + agents[target].name + ' never goes without', predicate: 'target_safe', target };
    }
    if (k === 'status' && a.ageBand !== 'young') {
      return { ...base, kind: 'gain_influence', description: a.faction ? 'Earn a voice people listen to in the ' + factionName(a.faction) : 'Earn a name the council listens to', predicate: 'standing_at_least', targetQuantity: 6, drive: 'seek_power' };
    }
    if (k === 'harmony') {
      if (rival) return { ...base, kind: 'improve_relationship', description: 'Make peace with ' + agents[rival.to].name, predicate: 'affinity_at_least', target: rival.to, targetQuantity: 0.2, drive: 'befriend' };
      if (coolColleague) return { ...base, kind: 'improve_relationship', description: 'Become real friends with ' + agents[coolColleague.to].name, predicate: 'affinity_at_least', target: coolColleague.to, targetQuantity: 0.65, drive: 'befriend' };
    }
    if (k === 'freedom') {
      if (!a.faction && a.ageBand !== 'young') {
        const faction = FACTIONS[Math.floor(next() * FACTIONS.length)];
        return { ...base, kind: 'join_faction', description: 'Join the ' + faction.name, predicate: 'member_of_faction', targetFaction: faction.key };
      }
      if (a.occupation === 'resident' && a.ageBand === 'young') {
        const job = (['hydroponicist', 'hauler', 'dock_hand'] as const)[Math.floor(next() * 3)];
        return { ...base, kind: 'change_job', description: 'Get taken on as a ' + OCCUPATIONS.find((o) => o.id === job)!.label.toLowerCase(), predicate: 'occupation_is', targetOccupation: job };
      }
      if (['quarry_hand', 'hauler', 'dock_hand'].includes(a.occupation) && a.traits.ambition > 0.55) {
        return { ...base, kind: 'change_job', description: 'Leave the ' + LOCATIONS[a.workLocationId].name + ' and open a stall on the Exchange', predicate: 'occupation_is', targetOccupation: 'trader' };
      }
    }
  }
  const friend = edges.filter((e) => e.kind === 'friend' || e.kind === 'colleague').sort((x, y) => y.affinity - x.affinity)[0];
  if (friend) return { ...base, kind: 'improve_relationship', description: 'Stay close to ' + agents[friend.to].name, predicate: 'affinity_at_least', target: friend.to, targetQuantity: 0.85, drive: 'befriend' };
  return { ...base, kind: 'earn_wealth', description: 'Put 60 credits by for a bad season', predicate: 'credits_at_least', targetQuantity: 60, drive: 'get_rich' };
}
