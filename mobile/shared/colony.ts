/**
 * Static gameplay data for the colony. Imported by the Convex backend and the client.
 * Pixel geometry lives in ./mapLayout.ts; this file holds ids, topology and rules data only.
 */

export const TICK_MINUTES = 10;
export const TICKS_PER_HOUR = 6;
export const TICKS_PER_DAY = 144;
/** Tick 0 is 06:00 on Sol 1. */
export const START_HOUR = 6;
/** Real milliseconds per tick at 1x speed (one sim day is about 5 real minutes). */
export const TICK_MS_AT_1X = 2083;
export const SPEEDS = [0, 1, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export const SEEDED_POPULATION = 100;
export const MAX_POPULATION = 120;

export function tickToClock(tick: number): { sol: number; hour: number; minute: number; label: string } {
  const total = tick * TICK_MINUTES + START_HOUR * 60;
  const sol = Math.floor(total / (24 * 60)) + 1;
  const minuteOfDay = total % (24 * 60);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { sol, hour, minute, label: `Sol ${sol} ${pad(hour)}:${pad(minute)}` };
}

export const COLONY_NAME = 'Shackleton Colony';

export const RESOURCES = ['food', 'water', 'parts', 'medicine', 'credits'] as const;
export type ResourceId = (typeof RESOURCES)[number];
export const RESOURCE_LABELS: Record<ResourceId, string> = {
  food: 'Food',
  water: 'Water',
  parts: 'Parts',
  medicine: 'Medicine',
  credits: 'Credits',
};
/** Resources with a market price, quoted in credits. */
export const TRADED_RESOURCES = ['food', 'water', 'parts', 'medicine'] as const;
export type TradedResourceId = (typeof TRADED_RESOURCES)[number];

export type LocationKind =
  | 'civic'
  | 'market'
  | 'social'
  | 'farm'
  | 'storage'
  | 'industry'
  | 'medical'
  | 'residential'
  | 'water'
  | 'mine'
  | 'power'
  | 'science'
  | 'port';

export const LOCATION_IDS = [
  'plaza',
  'market',
  'canteen',
  'hydroponics',
  'depot',
  'workshop',
  'medbay',
  'habitat_a',
  'habitat_b',
  'ice_wells',
  'quarry',
  'solar_farm',
  'observatory',
  'landing_pad',
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

export type LocationDef = {
  id: LocationId;
  name: string;
  kind: LocationKind;
  /** True when the location is outside the pressurised tube network and exposed to surface hazards. */
  exposed: boolean;
  /** What the building produces when staffed, if anything. */
  produces?: ResourceId;
  description: string;
};

export const LOCATIONS: Record<LocationId, LocationDef> = {
  plaza: { id: 'plaza', name: 'Commons Plaza', kind: 'civic', exposed: false, description: 'Central dome with the council chamber and the public notice board.' },
  market: { id: 'market', name: 'Exchange Concourse', kind: 'market', exposed: false, description: 'Trading stalls where food, water, parts and medicine change hands for credits.' },
  canteen: { id: 'canteen', name: 'The Airlock Canteen', kind: 'social', exposed: false, description: 'Mess hall and bar. Where the colony eats, drinks and gossips.' },
  hydroponics: { id: 'hydroponics', name: 'Hydroponics Bays', kind: 'farm', exposed: false, produces: 'food', description: 'Grow racks that turn water and light into food.' },
  depot: { id: 'depot', name: 'Supply Depot', kind: 'storage', exposed: false, description: 'The colony reserve of food, water and parts, run by the quartermaster.' },
  workshop: { id: 'workshop', name: 'Fabrication Works', kind: 'industry', exposed: false, produces: 'parts', description: 'Printers and forges that turn regolith into parts.' },
  medbay: { id: 'medbay', name: 'Med Bay', kind: 'medical', exposed: false, produces: 'medicine', description: 'Clinic and pharmacy.' },
  habitat_a: { id: 'habitat_a', name: 'Habitat Ring A', kind: 'residential', exposed: false, description: 'Older family quarters near the farms.' },
  habitat_b: { id: 'habitat_b', name: 'Habitat Ring B', kind: 'residential', exposed: false, description: 'Newer bunk blocks near the works.' },
  ice_wells: { id: 'ice_wells', name: 'Ice Wells', kind: 'water', exposed: true, produces: 'water', description: 'Drill site in the permanently shadowed crater. The only source of water.' },
  quarry: { id: 'quarry', name: 'Regolith Quarry', kind: 'mine', exposed: true, description: 'Open-pit regolith dig that feeds the Fabrication Works.' },
  solar_farm: { id: 'solar_farm', name: 'Solar Farm', kind: 'power', exposed: true, description: 'Panel field on the crater rim that powers the colony.' },
  observatory: { id: 'observatory', name: 'Observatory Lab', kind: 'science', exposed: false, description: 'Research dome and telescope.' },
  landing_pad: { id: 'landing_pad', name: 'Landing Pad', kind: 'port', exposed: true, description: 'Where shuttles land. New arrivals and off-world cargo come through here.' },
};

/** Undirected walkable connections. `ticks` is the travel time for one traversal. */
export type RouteDef = { a: LocationId; b: LocationId; ticks: number; surface: boolean };

export const ROUTES: RouteDef[] = [
  { a: 'plaza', b: 'observatory', ticks: 1, surface: false },
  { a: 'plaza', b: 'canteen', ticks: 1, surface: false },
  { a: 'plaza', b: 'market', ticks: 1, surface: false },
  { a: 'plaza', b: 'depot', ticks: 1, surface: false },
  { a: 'observatory', b: 'solar_farm', ticks: 1, surface: true },
  { a: 'observatory', b: 'landing_pad', ticks: 1, surface: true },
  { a: 'market', b: 'landing_pad', ticks: 1, surface: true },
  { a: 'canteen', b: 'solar_farm', ticks: 1, surface: true },
  { a: 'canteen', b: 'hydroponics', ticks: 1, surface: false },
  { a: 'market', b: 'workshop', ticks: 1, surface: false },
  { a: 'depot', b: 'hydroponics', ticks: 1, surface: false },
  { a: 'depot', b: 'workshop', ticks: 1, surface: false },
  { a: 'depot', b: 'medbay', ticks: 1, surface: false },
  { a: 'medbay', b: 'habitat_a', ticks: 1, surface: false },
  { a: 'medbay', b: 'habitat_b', ticks: 1, surface: false },
  { a: 'hydroponics', b: 'habitat_a', ticks: 1, surface: false },
  { a: 'workshop', b: 'habitat_b', ticks: 1, surface: false },
  { a: 'habitat_a', b: 'ice_wells', ticks: 1, surface: true },
  { a: 'habitat_b', b: 'quarry', ticks: 1, surface: true },
  { a: 'ice_wells', b: 'quarry', ticks: 2, surface: true },
];

export type PathResult = { nodes: LocationId[]; ticks: number };

/**
 * Shortest path over ROUTES by travel ticks. Deterministic: ties resolve by LOCATION_IDS order.
 * `blocked` lists route keys (see routeKey) that cannot be used, for obstacles and storms.
 */
export function findPath(from: LocationId, to: LocationId, blocked?: ReadonlySet<string>): PathResult | null {
  if (from === to) return { nodes: [from], ticks: 0 };
  const dist = new Map<LocationId, number>();
  const prev = new Map<LocationId, LocationId>();
  const done = new Set<LocationId>();
  dist.set(from, 0);
  while (true) {
    let current: LocationId | undefined;
    let best = Infinity;
    for (const id of LOCATION_IDS) {
      const d = dist.get(id);
      if (d !== undefined && !done.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === undefined) return null;
    if (current === to) break;
    done.add(current);
    for (const route of ROUTES) {
      if (route.a !== current && route.b !== current) continue;
      if (blocked?.has(routeKey(route.a, route.b))) continue;
      const next = route.a === current ? route.b : route.a;
      const candidate = best + route.ticks;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, current);
      }
    }
  }
  const nodes: LocationId[] = [to];
  while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0])!);
  return { nodes, ticks: dist.get(to)! };
}

export function routeKey(a: LocationId, b: LocationId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Character art archetypes. A spriteId is `${archetype}_${variant}` with variant 0..SPRITE_VARIANTS-1. */
export const SPRITE_ARCHETYPES = [
  'farmer',
  'miner',
  'engineer',
  'medic',
  'scientist',
  'merchant',
  'guard',
  'official',
  'worker',
  'civilian',
] as const;
export type SpriteArchetype = (typeof SPRITE_ARCHETYPES)[number];
export const SPRITE_VARIANTS = 6;
export type SpriteId = `${SpriteArchetype}_${number}`;
export const SPRITE_IDS: SpriteId[] = SPRITE_ARCHETYPES.flatMap((archetype) =>
  Array.from({ length: SPRITE_VARIANTS }, (_, variant) => `${archetype}_${variant}` as SpriteId),
);

export type OccupationDef = {
  id: string;
  label: string;
  workLocationId: LocationId;
  archetype: SpriteArchetype;
};

export const OCCUPATIONS: OccupationDef[] = [
  { id: 'hydroponicist', label: 'Hydroponicist', workLocationId: 'hydroponics', archetype: 'farmer' },
  { id: 'ice_miner', label: 'Ice Miner', workLocationId: 'ice_wells', archetype: 'miner' },
  { id: 'quarry_hand', label: 'Quarry Hand', workLocationId: 'quarry', archetype: 'miner' },
  { id: 'fabricator', label: 'Fabricator', workLocationId: 'workshop', archetype: 'engineer' },
  { id: 'solar_tech', label: 'Solar Technician', workLocationId: 'solar_farm', archetype: 'engineer' },
  { id: 'trader', label: 'Trader', workLocationId: 'market', archetype: 'merchant' },
  { id: 'quartermaster', label: 'Quartermaster', workLocationId: 'depot', archetype: 'official' },
  { id: 'councilor', label: 'Councilor', workLocationId: 'plaza', archetype: 'official' },
  { id: 'security', label: 'Security Officer', workLocationId: 'plaza', archetype: 'guard' },
  { id: 'medic', label: 'Medic', workLocationId: 'medbay', archetype: 'medic' },
  { id: 'researcher', label: 'Researcher', workLocationId: 'observatory', archetype: 'scientist' },
  { id: 'cook', label: 'Canteen Cook', workLocationId: 'canteen', archetype: 'worker' },
  { id: 'dock_hand', label: 'Dock Hand', workLocationId: 'landing_pad', archetype: 'worker' },
  { id: 'hauler', label: 'Hauler', workLocationId: 'depot', archetype: 'worker' },
  { id: 'resident', label: 'Resident', workLocationId: 'plaza', archetype: 'civilian' },
];

export const TRAIT_KEYS = ['ambition', 'empathy', 'caution', 'curiosity', 'sociability', 'stubbornness'] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export const VALUE_KEYS = ['wealth', 'family', 'status', 'harmony', 'freedom'] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];
export const NEED_KEYS = ['hunger', 'thirst', 'fatigue', 'safety', 'social'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

/**
 * Quick picks for the rumor and whisper powers. `text` uses {name} for the subject.
 * The backend gives each key a mechanical meaning; free text is also allowed with key 'custom'.
 */
export type IdeaPreset = { key: string; label: string; text: string; valence: -1 | 0 | 1; needsSubject: boolean };

export const RUMOR_PRESETS: IdeaPreset[] = [
  { key: 'hoarding', label: 'Hoarding supplies', text: '{name} is secretly hoarding food and water.', valence: -1, needsSubject: true },
  { key: 'thief', label: 'Thief', text: '{name} has been stealing from the Supply Depot.', valence: -1, needsSubject: true },
  { key: 'saboteur', label: 'Saboteur', text: '{name} sabotaged the ice drills.', valence: -1, needsSubject: true },
  { key: 'corrupt', label: 'Corrupt', text: '{name} takes bribes and skims credits.', valence: -1, needsSubject: true },
  { key: 'hero', label: 'Quiet hero', text: '{name} has been giving their own rations to hungry families.', valence: 1, needsSubject: true },
  { key: 'custom', label: 'Write your own', text: '', valence: 0, needsSubject: true },
];

export const WHISPER_PRESETS: IdeaPreset[] = [
  { key: 'suspect_hoarding', label: 'Suspect hoarding', text: 'You suspect {name} is hiding supplies.', valence: -1, needsSubject: true },
  { key: 'distrust', label: 'Distrust someone', text: '{name} cannot be trusted.', valence: -1, needsSubject: true },
  { key: 'befriend', label: 'Seek a friend', text: 'You should get closer to {name}.', valence: 1, needsSubject: true },
  { key: 'seek_power', label: 'Seek power', text: 'You deserve a seat on the council.', valence: 0, needsSubject: false },
  { key: 'get_rich', label: 'Get rich', text: 'You should be the richest person in the colony.', valence: 0, needsSubject: false },
  { key: 'share', label: 'Share what you have', text: 'Those with plenty should give to those without.', valence: 1, needsSubject: false },
  { key: 'custom', label: 'Write your own', text: '', valence: 0, needsSubject: false },
];
