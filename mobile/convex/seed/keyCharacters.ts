/**
 * Hand-authored key colonists. They anchor the colony's starting tensions: a tight depot reserve,
 * rival traders, a council dispute over rations, two friends who want opposite things from the
 * water supply, and one household close to the edge. These are starting conditions, not scripts.
 */
import type { LocationId } from '../../shared/colony';

export type Traits6 = [ambition: number, empathy: number, caution: number, curiosity: number, sociability: number, stubbornness: number];
export type Values5 = [wealth: number, family: number, status: number, harmony: number, freedom: number];

export type KeyGoal = {
  kind: string;
  description: string;
  priority: number;
  predicate: string;
  /** Key of another key character this goal is about. */
  target?: string;
  targetResource?: string;
  targetQuantity?: number;
  targetOccupation?: string;
  targetFaction?: string;
  drive?: string;
};

export type KeyCharacter = {
  key: string;
  name: string;
  familyName: string;
  ageBand: 'young' | 'adult' | 'elder';
  occupation: string;
  role?: string;
  faction?: string;
  home: Extract<LocationId, 'habitat_a' | 'habitat_b'>;
  householdSize: number;
  traits: Traits6;
  values: Values5;
  skill: number;
  credits: number;
  health?: number;
  background: string;
  goal: KeyGoal;
  /** Fixed extra household members instead of generated ones. */
  household?: { name: string; ageBand: 'young' | 'adult' | 'elder'; occupation: string }[];
  pantryFactor?: number;
};

export const KEY_CHARACTERS: KeyCharacter[] = [
  {
    key: 'imani',
    name: 'Imani Reyes',
    familyName: 'Reyes',
    ageBand: 'elder',
    occupation: 'councilor',
    role: 'chair',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 3,
    traits: [0.6, 0.55, 0.85, 0.4, 0.6, 0.8],
    values: [0.3, 0.6, 0.85, 0.7, 0.3],
    skill: 82,
    credits: 90,
    background:
      'Chair of the colony council for eleven years. She wrote the reserve rules after the hungry season of Sol 400 and has refused to loosen them since.',
    goal: {
      kind: 'gain_influence',
      description: 'Stay council chair and keep the depot reserve rules in force',
      priority: 0.7,
      predicate: 'is_chair',
    },
  },
  {
    key: 'hana',
    name: 'Hana Yilmaz',
    familyName: 'Yilmaz',
    ageBand: 'adult',
    occupation: 'councilor',
    faction: 'union',
    home: 'habitat_b',
    householdSize: 2,
    traits: [0.85, 0.6, 0.35, 0.55, 0.8, 0.6],
    values: [0.35, 0.45, 0.8, 0.4, 0.7],
    skill: 74,
    credits: 60,
    background:
      'The youngest councilor, elected on the votes of the well crews. She argues in every session that the reserve should be opened to the people who fill it.',
    goal: {
      kind: 'gain_influence',
      description: 'Replace Imani Reyes as council chair and open the reserve',
      priority: 0.75,
      predicate: 'is_chair',
      target: 'imani',
    },
  },
  {
    key: 'dmitri',
    name: 'Dmitri Volkov',
    familyName: 'Volkov',
    ageBand: 'adult',
    occupation: 'quartermaster',
    role: 'quartermaster',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.45, 0.4, 0.9, 0.35, 0.3, 0.85],
    values: [0.4, 0.7, 0.6, 0.55, 0.25],
    skill: 88,
    credits: 70,
    background:
      'Quartermaster of the Supply Depot. He counts every crate twice and shares the ledgers with nobody, which is why half the colony thinks he is hiding something.',
    goal: {
      kind: 'custom',
      description: 'Keep the depot reserve above the red line whatever the council says',
      priority: 0.7,
      predicate: 'reserve_healthy',
      drive: 'guard_reserve',
    },
  },
  {
    key: 'soledad',
    name: 'Soledad Marchetti',
    familyName: 'Marchetti',
    ageBand: 'adult',
    occupation: 'trader',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.92, 0.3, 0.5, 0.5, 0.7, 0.7],
    values: [0.95, 0.2, 0.75, 0.2, 0.7],
    skill: 86,
    credits: 320,
    background:
      'Runs the biggest stall on the Exchange Concourse and leads the Free Exchange League. She buys early, sells late and remembers every debt.',
    goal: {
      kind: 'earn_wealth',
      description: 'Corner the water trade and build a fortune of 600 credits',
      priority: 0.8,
      predicate: 'credits_at_least',
      targetQuantity: 600,
      drive: 'get_rich',
    },
  },
  {
    key: 'tobias',
    name: 'Tobias Okafor',
    familyName: 'Okafor',
    ageBand: 'adult',
    occupation: 'trader',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 3,
    traits: [0.7, 0.75, 0.45, 0.5, 0.85, 0.4],
    values: [0.6, 0.7, 0.5, 0.65, 0.6],
    skill: 78,
    credits: 180,
    background:
      'Set up his stall across the concourse from Soledad Marchetti three years ago and has undercut her ever since. The well crews buy from him on credit.',
    goal: {
      kind: 'earn_wealth',
      description: 'Win customers away from Soledad Marchetti with fairer prices',
      priority: 0.7,
      predicate: 'credits_at_least',
      targetQuantity: 400,
      target: 'soledad',
      drive: 'undercut',
    },
  },
  {
    key: 'joao',
    name: 'Joao Ferreira',
    familyName: 'Ferreira',
    ageBand: 'adult',
    occupation: 'quarry_hand',
    role: 'union_leader',
    faction: 'union',
    home: 'habitat_a',
    householdSize: 5,
    traits: [0.8, 0.65, 0.3, 0.35, 0.85, 0.75],
    values: [0.4, 0.75, 0.7, 0.35, 0.6],
    skill: 76,
    credits: 45,
    background:
      "Speaker of the Diggers' Union and a quarry hand for twenty years. He has five mouths at home and says the people who dig the colony out of the rock should eat first.",
    goal: {
      kind: 'gain_influence',
      description: "Build the Diggers' Union until the council has to raise the workers' rations",
      priority: 0.75,
      predicate: 'rations_full_and_leader',
      drive: 'seek_power',
    },
  },
  {
    key: 'mira',
    name: 'Mira Castellanos',
    familyName: 'Castellanos',
    ageBand: 'adult',
    occupation: 'hydroponicist',
    role: 'lead_grower',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.75, 0.6, 0.55, 0.6, 0.65, 0.6],
    values: [0.35, 0.7, 0.65, 0.6, 0.4],
    skill: 90,
    credits: 55,
    background:
      'Lead grower at the Hydroponics Bays. She grew up in the same corridor as Yusuf Rahman and still shares a table with him, though she wants the farms to have first call on every litre he drills.',
    goal: {
      kind: 'gain_influence',
      description: 'Win a council seat so the farms get first call on water',
      priority: 0.7,
      predicate: 'on_council',
      drive: 'seek_power',
    },
  },
  {
    key: 'yusuf',
    name: 'Yusuf Rahman',
    familyName: 'Rahman',
    ageBand: 'adult',
    occupation: 'ice_miner',
    role: 'shift_boss',
    faction: 'union',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.75, 0.55, 0.4, 0.45, 0.7, 0.65],
    values: [0.45, 0.75, 0.6, 0.5, 0.5],
    skill: 85,
    credits: 50,
    background:
      'Shift boss at the Ice Wells and Mira Castellanos\'s oldest friend. He wants a council seat too, to make sure the crews who drill the water drink it before the grow racks do.',
    goal: {
      kind: 'gain_influence',
      description: 'Win a council seat so the well crews get water before the farms',
      priority: 0.7,
      predicate: 'on_council',
      drive: 'seek_power',
    },
  },
  {
    key: 'anneliese',
    name: 'Anneliese Brandt',
    familyName: 'Brandt',
    ageBand: 'adult',
    occupation: 'medic',
    role: 'head_medic',
    home: 'habitat_a',
    householdSize: 2,
    traits: [0.5, 0.92, 0.7, 0.6, 0.5, 0.55],
    values: [0.2, 0.6, 0.4, 0.85, 0.35],
    skill: 92,
    credits: 65,
    background:
      'Head medic. She has run the Med Bay through two storms and has never turned a patient away, with or without credits.',
    goal: {
      kind: 'acquire_resource',
      description: 'Build the Med Bay stock up to 30 doses of medicine before the next storm',
      priority: 0.65,
      predicate: 'medbay_medicine_at_least',
      targetResource: 'medicine',
      targetQuantity: 30,
    },
  },
  {
    key: 'kenji',
    name: 'Kenji Watanabe',
    familyName: 'Watanabe',
    ageBand: 'adult',
    occupation: 'fabricator',
    role: 'chief_engineer',
    faction: 'union',
    home: 'habitat_b',
    householdSize: 3,
    traits: [0.55, 0.5, 0.75, 0.8, 0.4, 0.6],
    values: [0.4, 0.55, 0.55, 0.6, 0.5],
    skill: 91,
    credits: 60,
    background:
      'Chief engineer at the Fabrication Works. Every drill head and grow rack in the colony has passed through his hands, and he counts spare parts the way others count credits.',
    goal: {
      kind: 'custom',
      description: 'Keep every drill, panel and grow rack in the colony running',
      priority: 0.65,
      predicate: 'no_damage',
      drive: 'repair',
    },
  },
  {
    key: 'priya',
    name: 'Priya Raghunathan',
    familyName: 'Raghunathan',
    ageBand: 'adult',
    occupation: 'researcher',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.55, 0.5, 0.45, 0.95, 0.45, 0.7],
    values: [0.25, 0.3, 0.5, 0.45, 0.85],
    skill: 89,
    credits: 55,
    background:
      'Astronomer at the Observatory Lab. Her melt-rate figures do not match the depot ledgers, and she cannot leave a discrepancy alone.',
    goal: {
      kind: 'investigate',
      description: "Find out whether Dmitri Volkov's reported reserves are real",
      priority: 0.65,
      predicate: 'belief_resolved',
      target: 'dmitri',
      drive: 'hoarding',
    },
  },
  {
    key: 'marcus',
    name: 'Marcus Bell',
    familyName: 'Bell',
    ageBand: 'adult',
    occupation: 'security',
    role: 'security_chief',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 3,
    traits: [0.5, 0.45, 0.85, 0.55, 0.45, 0.75],
    values: [0.35, 0.65, 0.7, 0.75, 0.2],
    skill: 84,
    credits: 60,
    background:
      'Chief of colony security. He believes order is what keeps the air in, and he keeps a list of everyone who has ever been short at the depot.',
    goal: {
      kind: 'custom',
      description: 'Make sure no theft in the colony goes unanswered',
      priority: 0.6,
      predicate: 'none',
      drive: 'enforce',
    },
  },
  {
    key: 'lucia',
    name: 'Lucia Navarro',
    familyName: 'Navarro',
    ageBand: 'adult',
    occupation: 'cook',
    home: 'habitat_b',
    householdSize: 2,
    traits: [0.45, 0.8, 0.4, 0.75, 0.97, 0.35],
    values: [0.35, 0.6, 0.5, 0.8, 0.55],
    skill: 83,
    credits: 40,
    background:
      'Runs the line at the Airlock Canteen. She feeds half the colony every evening and hears everything said over the trays.',
    goal: {
      kind: 'improve_relationship',
      description: 'Get closer to Tobias Okafor',
      priority: 0.55,
      predicate: 'affinity_at_least',
      target: 'tobias',
      targetQuantity: 0.7,
      drive: 'befriend',
    },
  },
  {
    key: 'elias',
    name: 'Elias Thorne',
    familyName: 'Thorne',
    ageBand: 'adult',
    occupation: 'hauler',
    faction: 'union',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.35, 0.8, 0.6, 0.3, 0.45, 0.55],
    values: [0.3, 0.97, 0.25, 0.6, 0.35],
    skill: 58,
    credits: 9,
    health: 64,
    background:
      'A hauler with a bad lung from the last decompression. He is the only wage in a household of four, and the pantry is nearly bare.',
    goal: {
      kind: 'protect_person',
      description: 'Make sure Wren Thorne never goes hungry',
      priority: 0.85,
      predicate: 'target_safe',
      target: 'household:2',
    },
    household: [
      { name: 'Agnes Thorne', ageBand: 'elder', occupation: 'resident' },
      { name: 'Wren Thorne', ageBand: 'young', occupation: 'resident' },
      { name: 'Pip Thorne', ageBand: 'young', occupation: 'resident' },
    ],
    pantryFactor: 0.12,
  },
  {
    key: 'nadia',
    name: 'Nadia Haddad',
    familyName: 'Haddad',
    ageBand: 'young',
    occupation: 'dock_hand',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.88, 0.45, 0.3, 0.7, 0.75, 0.5],
    values: [0.8, 0.25, 0.65, 0.3, 0.9],
    skill: 62,
    credits: 75,
    background:
      'Unloads shuttles at the Landing Pad and watches what the cargo sells for on the concourse. She is saving for a stall of her own.',
    goal: {
      kind: 'change_job',
      description: 'Leave the docks and open a stall on the Exchange',
      priority: 0.7,
      predicate: 'occupation_is',
      targetOccupation: 'trader',
    },
  },
];

export const FACTIONS = [
  {
    key: 'founders',
    name: "Founders' Compact",
    color: '#4F8FE8',
    stance: 'guard',
    leader: 'imani',
    officers: ['dmitri', 'marcus', 'mira'],
    description: 'The old families and officials. They trust rules, ledgers and a full reserve.',
  },
  {
    key: 'union',
    name: "Diggers' Union",
    color: '#E8843C',
    stance: 'open',
    leader: 'joao',
    officers: ['yusuf', 'hana', 'kenji'],
    description: 'Well crews, quarry hands and fabricators. They want bigger rations and a say in the council.',
  },
  {
    key: 'exchange',
    name: 'Free Exchange League',
    color: '#3CCB7F',
    stance: 'trade',
    leader: 'soledad',
    officers: ['tobias', 'nadia'],
    description: 'Traders and dock hands. They want open trade and the council out of the market.',
  },
] as const;

/** Authored ties between key characters. Each is created in both directions with small asymmetry. */
export const KEY_TIES: { a: string; b: string; kind: string; affinity: number; trust: number; fear?: number }[] = [
  { a: 'imani', b: 'hana', kind: 'rival', affinity: -0.45, trust: -0.3 },
  { a: 'soledad', b: 'tobias', kind: 'rival', affinity: -0.6, trust: -0.45 },
  { a: 'joao', b: 'dmitri', kind: 'rival', affinity: -0.5, trust: -0.5 },
  { a: 'mira', b: 'yusuf', kind: 'friend', affinity: 0.8, trust: 0.75 },
  { a: 'imani', b: 'dmitri', kind: 'colleague', affinity: 0.45, trust: 0.7 },
  { a: 'imani', b: 'marcus', kind: 'colleague', affinity: 0.4, trust: 0.65 },
  { a: 'hana', b: 'joao', kind: 'friend', affinity: 0.55, trust: 0.6 },
  { a: 'joao', b: 'yusuf', kind: 'colleague', affinity: 0.5, trust: 0.55 },
  { a: 'priya', b: 'dmitri', kind: 'acquaintance', affinity: -0.15, trust: -0.25 },
  { a: 'lucia', b: 'tobias', kind: 'friend', affinity: 0.6, trust: 0.55 },
  { a: 'lucia', b: 'mira', kind: 'friend', affinity: 0.5, trust: 0.5 },
  { a: 'anneliese', b: 'elias', kind: 'acquaintance', affinity: 0.4, trust: 0.5 },
  { a: 'nadia', b: 'soledad', kind: 'acquaintance', affinity: 0.2, trust: 0.1 },
  { a: 'nadia', b: 'tobias', kind: 'friend', affinity: 0.45, trust: 0.4 },
  { a: 'kenji', b: 'yusuf', kind: 'colleague', affinity: 0.35, trust: 0.5 },
  { a: 'marcus', b: 'joao', kind: 'rival', affinity: -0.35, trust: -0.3, fear: 0.2 },
  { a: 'elias', b: 'joao', kind: 'friend', affinity: 0.5, trust: 0.55 },
  { a: 'anneliese', b: 'imani', kind: 'acquaintance', affinity: 0.3, trust: 0.45 },
];
