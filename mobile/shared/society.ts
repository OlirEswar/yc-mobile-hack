/**
 * Static catalogues of the society layer (docs/STORY_SPEC.md 8): discoveries, structures, art kinds,
 * pet species, organization kinds and random events. Plain data shared by the backend (which gives
 * every entry its mechanical effect in convex/society) and any client that wants names and blurbs.
 */
import type { LocationId } from './colony';

// ---------- discoveries ----------

export type DiscoveryField = 'water' | 'farming' | 'fabrication' | 'medicine' | 'energy' | 'habitat' | 'social' | 'culture' | 'mystery';

/**
 * What a discovery or structure does to the world. The backend applies these every hour or day:
 * production adds a share of a site's normal hourly output, stock adds goods daily, the multipliers
 * speed up research, study, building and art, event scales how often a random event happens.
 */
export type Mechanic =
  | { kind: 'unlock' }
  | { kind: 'production'; resource: 'water' | 'food' | 'parts' | 'medicine' | 'all'; bonus: number }
  | { kind: 'research'; bonus: number }
  | { kind: 'study'; bonus: number }
  | { kind: 'build'; bonus: number }
  | { kind: 'art'; bonus: number }
  | { kind: 'fame'; bonus: number }
  | { kind: 'health'; amount: number }
  | { kind: 'repair'; amount: number }
  | { kind: 'safety'; amount: number }
  | { kind: 'treasury'; amount: number }
  | { kind: 'stock'; location: LocationId; resource: 'food' | 'water' | 'parts' | 'medicine'; amount: number }
  | { kind: 'event'; event: string; weight: number }
  | { kind: 'windfall'; goods: Partial<Record<'food' | 'water' | 'parts' | 'medicine', number>> }
  | { kind: 'revelation' };

export type DiscoveryDef = {
  key: string;
  name: string;
  field: DiscoveryField;
  /** 0 is what the founders brought; 5 is the edge of the possible. */
  tier: number;
  prerequisites: string[];
  /** Skilled hours of experimenting needed. */
  effort: number;
  /** What it changes, one sentence for the almanac. */
  effect: string;
  /** Short key naming the mechanical effect, for logs and the LLM. */
  effectKey: string;
  mechanics: Mechanic[];
};

const d = (key: string, name: string, field: DiscoveryField, tier: number, prerequisites: string[], effect: string, effectKey: string, mechanics: Mechanic[]): DiscoveryDef => ({
  key,
  name,
  field,
  tier,
  prerequisites,
  effort: [0, 10, 18, 28, 40, 55][tier],
  effect,
  effectKey,
  mechanics,
});

const unlock: Mechanic[] = [{ kind: 'unlock' }];

export const DISCOVERIES: DiscoveryDef[] = [
  // tier 0: what the founders brought with them
  d('ice_drilling', 'Ice drilling', 'water', 0, [], 'Water can be cut from the crater ice.', 'unlock', unlock),
  d('hydroponics', 'Hydroponics', 'farming', 0, [], 'Food grows on racks under lamps.', 'unlock', unlock),
  d('regolith_printing', 'Regolith printing', 'fabrication', 0, [], 'Moon dust can be printed into parts.', 'unlock', unlock),
  d('field_medicine', 'Field medicine', 'medicine', 0, [], 'Wounds and fevers can be treated.', 'unlock', unlock),
  d('solar_power', 'Solar power', 'energy', 0, [], 'The rim panels keep the lights on.', 'unlock', unlock),
  d('pressure_domes', 'Pressure domes', 'habitat', 0, [], 'Air can be held in under a dome.', 'unlock', unlock),

  // water and ice
  d('thermal_drill_bits', 'Thermal drill bits', 'water', 1, ['ice_drilling'], 'Heated bits cut ice faster: the wells give a tenth more water.', 'water+10%', [{ kind: 'production', resource: 'water', bonus: 0.1 }]),
  d('greywater_reclamation', 'Greywater reclamation', 'water', 1, ['ice_drilling'], 'Wash water can be cleaned and drunk again; reclaimers can be built.', 'water+5%', [{ kind: 'production', resource: 'water', bonus: 0.05 }]),
  d('ice_core_reading', 'Ice core reading', 'water', 2, ['thermal_drill_bits'], 'The layers in the ice tell where the rich seams are.', 'research+10%', [{ kind: 'research', bonus: 0.1 }, { kind: 'event', event: 'rich_ice_strike', weight: 2 }]),
  d('deep_crater_survey', 'Deep crater survey', 'water', 2, ['ice_core_reading'], 'A map of the deep ice: more water, and more shifting ground.', 'water+15%', [{ kind: 'production', resource: 'water', bonus: 0.15 }, { kind: 'event', event: 'moonquake', weight: 1.4 }]),
  d('cryo_distillation', 'Cryo distillation', 'water', 3, ['greywater_reclamation', 'deep_crater_survey'], 'Ice is purified in the cold itself; the wells give much more.', 'water+15%', [{ kind: 'production', resource: 'water', bonus: 0.15 }]),
  d('vapor_capture', 'Vapor capture', 'water', 3, ['greywater_reclamation'], 'Breath and sweat are wrung from the air: the depot gains water every day.', 'depot water +8/day', [{ kind: 'stock', location: 'depot', resource: 'water', amount: 8 }]),

  // farming
  d('nutrient_film', 'Nutrient film', 'farming', 1, ['hydroponics'], 'A thin film of feed water: racks yield a tenth more food.', 'food+10%', [{ kind: 'production', resource: 'food', bonus: 0.1 }]),
  d('fungal_protein', 'Fungal protein', 'farming', 1, ['hydroponics'], 'Mushrooms grown in the dark add to every meal.', 'food+8%', [{ kind: 'production', resource: 'food', bonus: 0.08 }]),
  d('fermentation', 'Fermentation', 'farming', 1, ['hydroponics'], 'Spoiled mash becomes something worth drinking; stills can be built.', 'unlock still', unlock),
  d('dwarf_wheat', 'Dwarf wheat', 'farming', 2, ['nutrient_film'], 'Wheat bred for low gravity: food +12%.', 'food+12%', [{ kind: 'production', resource: 'food', bonus: 0.12 }]),
  d('light_spectrum_tuning', 'Light spectrum tuning', 'farming', 2, ['nutrient_film', 'solar_power'], 'The lamps are tuned to what the plants want: food +10%.', 'food+10%', [{ kind: 'production', resource: 'food', bonus: 0.1 }]),
  d('insect_farming', 'Insect farming', 'farming', 2, ['fungal_protein'], 'Crickets turn scraps into protein, and some people keep them as pets.', 'food+8%', [{ kind: 'production', resource: 'food', bonus: 0.08 }]),
  d('closed_loop_garden', 'Closed-loop garden', 'farming', 3, ['dwarf_wheat', 'greywater_reclamation'], 'A garden that waters itself; greenhouse domes can be built.', 'food+10%', [{ kind: 'production', resource: 'food', bonus: 0.1 }]),
  d('blight_resistance', 'Blight resistance', 'farming', 3, ['dwarf_wheat'], 'The crops shrug off the rust blight.', 'blight x0.2', [{ kind: 'event', event: 'crop_blight', weight: 0.2 }]),

  // fabrication
  d('sintered_tools', 'Sintered tools', 'fabrication', 1, ['regolith_printing'], 'Tools baked from dust: the works turn out a tenth more parts.', 'parts+10%', [{ kind: 'production', resource: 'parts', bonus: 0.1 }]),
  d('basalt_fiber', 'Basalt fiber', 'fabrication', 1, ['regolith_printing'], 'Rock spun into rope and cloth: building goes faster.', 'build+20%', [{ kind: 'build', bonus: 0.2 }]),
  d('printed_circuits', 'Printed circuits', 'fabrication', 2, ['sintered_tools'], 'Circuit boards made at home: parts +10%, and signal dishes can be built.', 'parts+10%', [{ kind: 'production', resource: 'parts', bonus: 0.1 }]),
  d('rover_autopilot', 'Rover autopilot', 'fabrication', 2, ['printed_circuits'], 'Rovers find their own way home.', 'lost rover x0.3', [{ kind: 'event', event: 'lost_rover', weight: 0.3 }]),
  d('exosuit_patching', 'Exosuit patching', 'fabrication', 2, ['basalt_fiber'], 'Suits seal their own small holes.', 'micrometeor x0.5', [{ kind: 'event', event: 'micrometeor', weight: 0.5 }]),
  d('robotic_arms', 'Robotic arms', 'fabrication', 3, ['printed_circuits', 'sintered_tools'], 'Arms that never tire: parts +15% and faster building.', 'parts+15%', [{ kind: 'production', resource: 'parts', bonus: 0.15 }, { kind: 'build', bonus: 0.2 }]),
  d('self_repairing_seals', 'Self-repairing seals', 'fabrication', 3, ['exosuit_patching'], 'Seals that knit themselves: damage mends a little every day.', 'repair 5%/day', [{ kind: 'repair', amount: 0.05 }, { kind: 'event', event: 'air_leak', weight: 0.3 }]),

  // medicine
  d('regolith_lung_treatment', 'Regolith lung treatment', 'medicine', 1, ['field_medicine'], 'The dust cough can be treated: the sick recover faster.', 'health +2/day', [{ kind: 'health', amount: 2 }]),
  d('antiviral_cultures', 'Antiviral cultures', 'medicine', 2, ['regolith_lung_treatment'], 'Cultures that fight fevers: outbreaks are rarer and medicine more plentiful.', 'outbreak x0.4', [{ kind: 'event', event: 'disease_outbreak', weight: 0.4 }, { kind: 'production', resource: 'medicine', bonus: 0.1 }]),
  d('synthetic_painkillers', 'Synthetic painkillers', 'medicine', 2, ['field_medicine'], 'The pharmacy makes its own painkillers: medicine +15%.', 'medicine+15%', [{ kind: 'production', resource: 'medicine', bonus: 0.15 }]),
  d('safe_birthing', 'Safe birthing', 'medicine', 2, ['field_medicine'], 'Births in low gravity are far safer.', 'birth complications x0.2', [{ kind: 'event', event: 'birth_complication', weight: 0.2 }]),
  d('low_g_bone_therapy', 'Low-g bone therapy', 'medicine', 3, ['regolith_lung_treatment'], 'Bones are kept strong: everyone heals faster.', 'health +3/day', [{ kind: 'health', amount: 3 }]),
  d('radiation_gene_screening', 'Radiation gene screening', 'medicine', 4, ['antiviral_cultures', 'low_g_bone_therapy'], 'Damage is caught before it spreads: health and medicine improve.', 'health +4/day', [{ kind: 'health', amount: 4 }, { kind: 'production', resource: 'medicine', bonus: 0.1 }]),

  // energy
  d('panel_dust_shedding', 'Panel dust shedding', 'energy', 1, ['solar_power'], 'Panels shake off dust: storm damage heals faster.', 'repair 3%/day', [{ kind: 'repair', amount: 0.03 }]),
  d('battery_banks', 'Battery banks', 'energy', 2, ['solar_power'], 'Stored power rides out the dark: blackouts are rare.', 'blackout x0.3', [{ kind: 'event', event: 'blackout', weight: 0.3 }]),
  d('reactor_diagnostics', 'Reactor diagnostics', 'energy', 2, ['battery_banks'], 'Faults are seen before they become another Long Dark.', 'reactor scare x0.3', [{ kind: 'event', event: 'reactor_scare', weight: 0.3 }]),
  d('microwave_beaming', 'Microwave beaming', 'energy', 3, ['reactor_diagnostics', 'printed_circuits'], 'Power beamed to the wells and the works: water and parts +5%.', 'water,parts+5%', [{ kind: 'production', resource: 'water', bonus: 0.05 }, { kind: 'production', resource: 'parts', bonus: 0.05 }]),
  d('fusion_whisper', 'The fusion whisper', 'energy', 5, ['microwave_beaming', 'deep_crater_survey'], 'A tiny, stable fusion flame: every site produces more.', 'all+10%', [{ kind: 'production', resource: 'all', bonus: 0.1 }]),

  // habitat
  d('regolith_bricks', 'Regolith bricks', 'habitat', 1, ['pressure_domes'], 'Bricks of fused dust: building is faster, stages and playgrounds possible.', 'build+20%', [{ kind: 'build', bonus: 0.2 }]),
  d('pressure_monitoring', 'Pressure monitoring', 'habitat', 1, ['pressure_domes'], 'Every dome reports its leaks.', 'air leak x0.5', [{ kind: 'event', event: 'air_leak', weight: 0.5 }]),
  d('sound_dampening', 'Sound dampening', 'habitat', 2, ['regolith_bricks'], 'The domes stop ringing; people sleep and feel safer.', 'safety', [{ kind: 'safety', amount: 6 }]),
  d('radiation_shielding', 'Radiation shielding', 'habitat', 2, ['regolith_bricks'], 'Thicker walls: everyone is a little healthier.', 'health +1/day', [{ kind: 'health', amount: 1 }]),
  d('lava_tube_mapping', 'Lava tube mapping', 'habitat', 3, ['pressure_monitoring', 'deep_crater_survey'], 'Old lava tubes under the rim: room to grow, and to hide.', 'strange signal x1.5', [{ kind: 'event', event: 'strange_signal', weight: 1.5 }, { kind: 'event', event: 'cache_found', weight: 2 }]),

  // social technology
  d('ration_ledgers', 'Open ration ledgers', 'social', 1, [], 'Everyone can see the ledgers: the treasury stops leaking.', 'treasury +15/day', [{ kind: 'treasury', amount: 15 }]),
  d('colony_charter', 'A colony charter', 'social', 2, ['ration_ledgers'], 'Written rights: feuds cool down.', 'feud x0.5', [{ kind: 'event', event: 'old_feud', weight: 0.5 }, { kind: 'safety', amount: 3 }]),
  d('credit_union', 'Credit union', 'social', 2, ['ration_ledgers'], 'A colony bank: the treasury grows.', 'treasury +25/day', [{ kind: 'treasury', amount: 25 }]),
  d('mediation_circles', 'Mediation circles', 'social', 2, [], 'Disputes are talked out in a circle: fear eases.', 'safety', [{ kind: 'safety', amount: 5 }, { kind: 'event', event: 'old_feud', weight: 0.6 }]),
  d('apprenticeship', 'Apprenticeship', 'social', 2, [], 'Masters take apprentices: everyone learns faster; school rooms possible.', 'study+25%', [{ kind: 'study', bonus: 0.25 }]),
  d('open_curriculum', 'The open curriculum', 'social', 3, ['apprenticeship'], 'Anyone may learn anything: study is faster still.', 'study+25%', [{ kind: 'study', bonus: 0.25 }]),
  d('mutual_aid_rolls', 'Mutual aid rolls', 'social', 3, ['credit_union', 'mediation_circles'], 'Nobody goes hungry unseen: the canteen gets food every day.', 'canteen food +6/day', [{ kind: 'stock', location: 'canteen', resource: 'food', amount: 6 }]),

  // culture and the arts
  d('regolith_pigment', 'Regolith pigment', 'culture', 1, [], 'Paint from the grey dust in a dozen colours: art improves.', 'art+10%', [{ kind: 'art', bonus: 0.1 }]),
  d('low_g_acoustics', 'Low-g acoustics', 'culture', 1, [], 'How sound carries under a dome: songs ring truer.', 'art+10%', [{ kind: 'art', bonus: 0.1 }]),
  d('shadow_puppetry', 'Shadow puppetry', 'culture', 1, [], 'Stories told in lamp shadow, for the children first.', 'art+5%', [{ kind: 'art', bonus: 0.05 }]),
  d('printed_instruments', 'Printed instruments', 'culture', 2, ['low_g_acoustics', 'sintered_tools'], 'Violins and drums from the printers: performances draw crowds.', 'fame+20%', [{ kind: 'fame', bonus: 0.2 }, { kind: 'art', bonus: 0.1 }]),
  d('colony_archive', 'The colony archive', 'culture', 2, [], 'Every log and letter kept in one place; old secrets surface.', 'old logs x2', [{ kind: 'fame', bonus: 0.1 }, { kind: 'event', event: 'long_dark_log', weight: 2 }]),
  d('festival_calendar', 'The festival calendar', 'culture', 2, ['colony_archive'], 'Days the colony keeps together: festivals come more often.', 'festival x2', [{ kind: 'event', event: 'festival_day', weight: 2 }]),
  d('regolith_luminescence', 'Regolith luminescence', 'culture', 2, ['regolith_pigment'], 'Dust that glows in the dark: murals light the tubes at night.', 'art+10%', [{ kind: 'art', bonus: 0.1 }]),
  d('holography', 'Holography', 'culture', 3, ['printed_circuits', 'regolith_pigment'], 'Light sculptures: holos become an art, and fame travels further.', 'fame+20%', [{ kind: 'fame', bonus: 0.2 }]),

  // the strange and the Long Dark
  d('dark_crater_echoes', 'Dark crater echoes', 'mystery', 2, ['ice_core_reading'], 'Something under the crater floor answers the drills.', 'signal x2', [{ kind: 'event', event: 'strange_signal', weight: 2 }, { kind: 'research', bonus: 0.05 }]),
  d('the_eleventh_log', 'The eleventh log', 'mystery', 3, ['dark_crater_echoes', 'colony_archive'], 'The last log of the Long Dark is decoded: someone knew the reactor would fail.', 'revelation', [{ kind: 'revelation' }]),
  d('crystalline_ice_lattice', 'Crystalline ice lattice', 'mystery', 3, ['deep_crater_survey', 'dark_crater_echoes'], 'Ice that is almost a crystal: water +10%, and the ground grows restless.', 'water+10%', [{ kind: 'production', resource: 'water', bonus: 0.1 }, { kind: 'event', event: 'moonquake', weight: 1.5 }]),
  d('signal_decoding', 'Signal decoding', 'mystery', 4, ['dark_crater_echoes', 'printed_circuits'], 'The crater signal is a beacon, and ships listen for it.', 'stranger x2', [{ kind: 'event', event: 'shuttle_stranger', weight: 2 }, { kind: 'research', bonus: 0.1 }]),
  d('buried_hab_module', 'The buried hab module', 'mystery', 4, ['lava_tube_mapping', 'the_eleventh_log'], 'A habitat module lost in the Long Dark is found in the tubes, still stocked.', 'windfall', [{ kind: 'windfall', goods: { parts: 60, medicine: 12, food: 40 } }]),
  d('lunar_time_sense', 'Lunar time sense', 'mystery', 5, ['signal_decoding', 'the_eleventh_log'], 'A way of reading the Moon itself: research accelerates.', 'research+20%', [{ kind: 'research', bonus: 0.2 }]),
];

export const DISCOVERY_BY_KEY: Record<string, DiscoveryDef> = Object.fromEntries(DISCOVERIES.map((x) => [x.key, x]));

/** Where each field is best studied. */
export const FIELD_LOCATIONS: Record<DiscoveryField, LocationId> = {
  water: 'ice_wells',
  farming: 'hydroponics',
  fabrication: 'workshop',
  medicine: 'medbay',
  energy: 'solar_farm',
  habitat: 'observatory',
  social: 'plaza',
  culture: 'canteen',
  mystery: 'observatory',
};

/** The skill that drives research in each field. */
export const FIELD_SKILLS: Record<DiscoveryField, string> = {
  water: 'drilling',
  farming: 'farming',
  fabrication: 'engineering',
  medicine: 'healing',
  energy: 'engineering',
  habitat: 'engineering',
  social: 'persuasion',
  culture: 'art',
  mystery: 'science',
};

// ---------- structures ----------

export type StructureDef = {
  key: string;
  name: string;
  /** Goods taken when the build starts (from the builder, their organization, or the depot for public works). */
  cost: Partial<Record<'food' | 'water' | 'parts' | 'credits', number>>;
  /** Discovery needed first, if any. */
  requires?: string;
  /** Skilled hours of building. */
  effort: number;
  locations: LocationId[];
  /** Built with colony parts from the depot when the builder has none: a public work. */
  public: boolean;
  /** Which organization kind it naturally belongs to, if any. */
  orgKind?: string;
  /** What it does, one sentence. */
  effect: string;
  mechanics: StructureMechanic[];
};

export type StructureMechanic =
  | Mechanic
  | { kind: 'pantry'; food: number }
  | { kind: 'memorial' }
  | { kind: 'perform'; bonus: number }
  | { kind: 'ritual'; bonus: number }
  | { kind: 'strength'; bonus: number }
  | { kind: 'income'; credits: number }
  | { kind: 'honor' }
  | { kind: 'social'; amount: number }
  | { kind: 'strays'; amount: number }
  | { kind: 'recruit'; bonus: number }
  | { kind: 'defense'; bonus: number };

export const STRUCTURES: StructureDef[] = [
  { key: 'grow_rack', name: 'private grow rack', cost: { parts: 3, water: 4 }, requires: 'hydroponics', effort: 4, locations: ['habitat_a', 'habitat_b', 'hydroponics'], public: false, effect: 'Feeds its household a little every day.', mechanics: [{ kind: 'pantry', food: 1.5 }] },
  { key: 'water_reclaimer', name: 'water reclaimer', cost: { parts: 10 }, requires: 'greywater_reclamation', effort: 12, locations: ['habitat_a', 'habitat_b'], public: true, effect: 'Cleans greywater: the depot gains water every day.', mechanics: [{ kind: 'stock', location: 'depot', resource: 'water', amount: 10 }] },
  { key: 'memorial_wall', name: 'memorial wall', cost: { parts: 5, credits: 15 }, effort: 8, locations: ['plaza', 'habitat_a'], public: true, effect: 'A wall of names: the grieving find peace there sooner.', mechanics: [{ kind: 'memorial' }, { kind: 'safety', amount: 2 }] },
  { key: 'theatre_stage', name: 'theatre stage', cost: { parts: 12, credits: 30 }, requires: 'regolith_bricks', effort: 12, locations: ['canteen', 'plaza'], public: false, orgKind: 'troupe', effect: 'Performances there draw bigger crowds and more fame.', mechanics: [{ kind: 'perform', bonus: 0.6 }] },
  { key: 'chapel', name: 'chapel', cost: { parts: 8, credits: 25 }, effort: 10, locations: ['habitat_a', 'plaza'], public: false, orgKind: 'cult', effect: 'Rituals there comfort more deeply and bind members tighter.', mechanics: [{ kind: 'ritual', bonus: 0.5 }, { kind: 'safety', amount: 2 }] },
  { key: 'school_room', name: 'school room', cost: { parts: 10, credits: 20 }, requires: 'apprenticeship', effort: 10, locations: ['observatory', 'habitat_b'], public: true, orgKind: 'school', effect: 'Lessons there teach a third faster.', mechanics: [{ kind: 'study', bonus: 0.3 }] },
  { key: 'militia_armory', name: 'militia armory', cost: { parts: 16, credits: 40 }, requires: 'sintered_tools', effort: 12, locations: ['plaza', 'habitat_b'], public: false, orgKind: 'militia', effect: 'Its owners hit harder in raids and hold their ground.', mechanics: [{ kind: 'strength', bonus: 0.5 }] },
  { key: 'still', name: 'still', cost: { parts: 6, food: 8 }, requires: 'fermentation', effort: 6, locations: ['habitat_b', 'canteen'], public: false, effect: 'Turns mash into liquor and credits, and liquor into brawls.', mechanics: [{ kind: 'income', credits: 10 }, { kind: 'event', event: 'old_feud', weight: 1.5 }] },
  { key: 'greenhouse_dome', name: 'greenhouse dome', cost: { parts: 24, water: 15 }, requires: 'closed_loop_garden', effort: 20, locations: ['hydroponics'], public: true, orgKind: 'guild', effect: 'A second dome of crops: food +20%.', mechanics: [{ kind: 'production', resource: 'food', bonus: 0.2 }] },
  { key: 'signal_dish', name: 'signal dish', cost: { parts: 20 }, requires: 'printed_circuits', effort: 14, locations: ['observatory'], public: true, effect: 'Talks to passing ships and listens to the crater.', mechanics: [{ kind: 'event', event: 'shuttle_stranger', weight: 2 }, { kind: 'research', bonus: 0.1 }] },
  { key: 'statue', name: 'statue', cost: { parts: 10, credits: 25 }, requires: 'regolith_printing', effort: 10, locations: ['plaza'], public: false, effect: 'Honours a person: their name grows with every passer-by.', mechanics: [{ kind: 'honor' }] },
  { key: 'black_market_cache', name: 'black-market cache', cost: { parts: 4, credits: 15 }, effort: 5, locations: ['landing_pad', 'habitat_b'], public: false, orgKind: 'gang', effect: 'A hidden store: its owners turn a quiet profit every day.', mechanics: [{ kind: 'income', credits: 14 }] },
  { key: 'barricade', name: 'breakaway barricade', cost: { parts: 14 }, effort: 8, locations: ['quarry', 'ice_wells', 'habitat_b', 'landing_pad', 'solar_farm', 'habitat_a'], public: false, orgKind: 'breakaway', effect: 'Holds a claimed territory against the council and raiders.', mechanics: [{ kind: 'defense', bonus: 0.6 }] },
  { key: 'playground', name: 'playground', cost: { parts: 8 }, requires: 'regolith_bricks', effort: 8, locations: ['habitat_a', 'habitat_b'], public: true, effect: 'Children play and parents breathe: loneliness eases there.', mechanics: [{ kind: 'social', amount: 20 }] },
  { key: 'pet_shelter', name: 'pet shelter', cost: { parts: 6, food: 5 }, effort: 6, locations: ['habitat_a', 'habitat_b'], public: false, effect: 'Takes in strays, so there is always an animal needing a home.', mechanics: [{ kind: 'strays', amount: 1 }, { kind: 'event', event: 'pet_escapes', weight: 0.5 }] },
  { key: 'telescope_upgrade', name: 'telescope upgrade', cost: { parts: 16, credits: 30 }, requires: 'sintered_tools', effort: 14, locations: ['observatory'], public: true, orgKind: 'school', effect: 'Sharper eyes on the sky: research +25%.', mechanics: [{ kind: 'research', bonus: 0.25 }] },
  { key: 'clinic_annex', name: 'clinic annex', cost: { parts: 14, credits: 25 }, requires: 'regolith_lung_treatment', effort: 12, locations: ['medbay'], public: true, effect: 'More beds and a still for tinctures: medicine +20%, the sick heal faster.', mechanics: [{ kind: 'production', resource: 'medicine', bonus: 0.2 }, { kind: 'health', amount: 1 }] },
  { key: 'drill_rig', name: 'deep drill rig', cost: { parts: 20 }, requires: 'thermal_drill_bits', effort: 16, locations: ['ice_wells'], public: true, orgKind: 'company', effect: 'A second rig at the wells: water +15%.', mechanics: [{ kind: 'production', resource: 'water', bonus: 0.15 }] },
  { key: 'recycler', name: 'parts recycler', cost: { parts: 8 }, requires: 'sintered_tools', effort: 10, locations: ['workshop'], public: true, orgKind: 'company', effect: 'Scrap goes back into the printers: parts +12%.', mechanics: [{ kind: 'production', resource: 'parts', bonus: 0.12 }] },
  { key: 'solar_extension', name: 'solar array extension', cost: { parts: 18 }, requires: 'panel_dust_shedding', effort: 14, locations: ['solar_farm'], public: true, effect: 'Spare panels: storm damage is patched over every day.', mechanics: [{ kind: 'repair', amount: 0.05 }] },
  { key: 'long_dark_shrine', name: 'shrine to the eleven', cost: { parts: 3, credits: 8 }, effort: 4, locations: ['habitat_a', 'plaza', 'ice_wells'], public: false, orgKind: 'cult', effect: 'Eleven lamps for the dead of the Long Dark; the frightened come to it.', mechanics: [{ kind: 'recruit', bonus: 0.3 }] },
];

export const STRUCTURE_BY_KEY: Record<string, StructureDef> = Object.fromEntries(STRUCTURES.map((s) => [s.key, s]));

// ---------- arts ----------

export type ArtKindDef = { key: string; label: string; verb: string; performable: boolean; requires?: string };

export const ART_KINDS: ArtKindDef[] = [
  { key: 'mural', label: 'mural', verb: 'painted', performable: false },
  { key: 'song', label: 'song', verb: 'wrote', performable: true },
  { key: 'poem', label: 'poem', verb: 'wrote', performable: true },
  { key: 'sculpture', label: 'sculpture', verb: 'carved', performable: false, requires: 'regolith_printing' },
  { key: 'play', label: 'play', verb: 'wrote', performable: true },
  { key: 'story', label: 'story', verb: 'wrote', performable: true },
  { key: 'holo', label: 'holo', verb: 'composed', performable: true, requires: 'holography' },
];
export const ART_KIND_KEYS = ART_KINDS.map((k) => k.key);

// ---------- pets ----------

export type PetSpeciesDef = { key: string; label: string; names: string[]; requires?: string; where?: LocationId };

export const PET_SPECIES: PetSpeciesDef[] = [
  { key: 'cat', label: 'cat', names: ['Biscuit', 'Crater', 'Mooncake', 'Pixel', 'Ash', 'Tycho', 'Nova'] },
  { key: 'dog', label: 'dog', names: ['Regolith', 'Rover', 'Buzz', 'Laika', 'Dusty', 'Bolt'] },
  { key: 'lab_rat', label: 'lab rat', names: ['Subject Nine', 'Whiskers', 'Professor', 'Gnaw'], where: 'observatory' },
  { key: 'cricket_colony', label: 'cricket colony', names: ['The Choir', 'The Chorus', 'Little Engines'], requires: 'insect_farming', where: 'hydroponics' },
  { key: 'gecko', label: 'gecko', names: ['Sticky', 'Ember', 'Apollo', 'Moss'] },
];
export const PET_SPECIES_KEYS = PET_SPECIES.map((s) => s.key);

// ---------- organizations ----------

export type OrgKindDef = {
  key: string;
  label: string;
  /** Where it meets when the founder names nowhere else. */
  home: LocationId;
  /** Name patterns; {place} and {name} are filled in. */
  names: string[];
  creeds: string[];
  /** Credits each member owes per day. */
  dues: number;
};

export const ORG_KINDS: Record<string, OrgKindDef> = {
  company: { key: 'company', label: 'company', home: 'workshop', names: ['{name} & Daughters', '{place} Works Ltd.', 'Rimline Contracting', 'Deepcut Ice Co.', 'Grey Dust Fabrication'], creeds: ['Profit for the people who do the work.', 'Better tools, better pay, no council middlemen.', 'Whoever builds it should own it.'], dues: 0 },
  guild: { key: 'guild', label: 'guild', home: 'hydroponics', names: ["The {place} Growers' Guild", 'The Green Ring', 'The Lamp Keepers', 'Guild of the Racks'], creeds: ['Share the harvest, keep the craft.', 'No grower goes hungry while a rack stands.'], dues: 2 },
  cult: { key: 'cult', label: 'cult', home: 'habitat_a', names: ['The Vigil of the Long Dark', 'The Eleven Lamps', 'Children of the Crater', 'The Quiet Watch'], creeds: ['The eleven who died in the Long Dark are still watching, and they are owed.', 'The crater speaks to those who listen.', 'The dark comes back. Be ready.'], dues: 2 },
  gang: { key: 'gang', label: 'gang', home: 'landing_pad', names: ['The Pad Rats', 'The Airlock Boys', 'The Dust Choir', 'The Night Shift'], creeds: ['Take care of your own; the council never will.', 'Everything has a price, and we set it.'], dues: 3 },
  militia: { key: 'militia', label: 'militia', home: 'plaza', names: ["The Rim Watch", "The Diggers' Guard", 'The Volunteer Wardens', 'The Iron Shift'], creeds: ['If security will not protect us, we will.', 'Nobody steals from the colony on our watch.'], dues: 2 },
  party: { key: 'party', label: 'party', home: 'plaza', names: ['The Open Ledger Party', 'The New Charter', 'The Commons League'], creeds: ['Open the ledgers and let everyone vote.', 'The council belongs to all of us.'], dues: 1 },
  school: { key: 'school', label: 'school', home: 'observatory', names: ['The Observatory School', 'The Lamp School', '{name} Academy'], creeds: ['Every child should know how the colony works.', 'Knowledge is the only reserve that never runs dry.'], dues: 0 },
  troupe: { key: 'troupe', label: 'troupe', home: 'canteen', names: ['The Airlock Players', 'The Rust Choir', 'The Lamplight Company', 'The Low-G Players'], creeds: ['Songs for the people who keep the lights on.', 'Laugh, or the dark wins.'], dues: 1 },
  breakaway: { key: 'breakaway', label: 'breakaway colony', home: 'quarry', names: ['Free {place}', 'The {place} Commune', 'New Shackleton', 'The Rim Republic'], creeds: ['We govern ourselves now.', 'The council left us to die once. Never again.'], dues: 0 },
};
export const ORG_KIND_KEYS = Object.keys(ORG_KINDS);

/** Rules a breakaway can declare in its territory, with what they do there. */
export const BREAKAWAY_RULES: Record<string, string> = {
  share_all: 'Everything is shared: members pool their food and water.',
  keep_the_ice: 'What is produced here stays here, not in the council depot.',
  no_security: 'Council security is not welcome.',
  tithe: 'Every member gives a tenth of their credits to the common purse.',
  open_door: 'Anyone hungry may eat at our table.',
  elect_leader: 'The leader is chosen by the members, every day.',
};
export const BREAKAWAY_RULE_KEYS = Object.keys(BREAKAWAY_RULES);

/** Every action org_action accepts. */
export const ORG_ACTIONS = ['meeting', 'dues', 'raid', 'protect', 'trade_deal', 'ritual', 'expel', 'declare_rules', 'aid', 'work'] as const;
export type OrgAction = (typeof ORG_ACTIONS)[number];

/** Skills anyone can study. */
export const STUDY_SKILLS = ['farming', 'drilling', 'mining', 'engineering', 'trade', 'logistics', 'persuasion', 'security', 'healing', 'science', 'cooking', 'craft', 'art'] as const;

// ---------- random events ----------

export type RandomEventDef = {
  key: string;
  name: string;
  category: 'environment' | 'social' | 'health';
  /** Relative chance among the events whose conditions hold. Discoveries and structures scale it. */
  weight: number;
  /** World conditions that must hold: children, pets, pregnancy, artists, orgs, gang, breakaway, couples. */
  requires?: string[];
  /** Days before the same event may come again. */
  gapDays: number;
  /** What happens, one sentence. */
  about: string;
};

export const RANDOM_EVENTS: RandomEventDef[] = [
  { key: 'moonquake', name: 'Moonquake', category: 'environment', weight: 6, gapDays: 3, about: 'The ground shakes; a building is damaged and someone may be hurt.' },
  { key: 'micrometeor', name: 'Micrometeor strike', category: 'environment', weight: 6, gapDays: 2, about: 'A pebble from space punches through an exposed site and maybe a suit.' },
  { key: 'disease_outbreak', name: 'Fever outbreak', category: 'health', weight: 5, gapDays: 4, about: 'A fever spreads through a habitat ring; the weak may die without medicine.' },
  { key: 'shuttle_stranger', name: 'A stranger arrives', category: 'social', weight: 4, gapDays: 3, about: 'An unscheduled shuttle leaves behind a stranger with a past.' },
  { key: 'strange_signal', name: 'Strange signal', category: 'environment', weight: 4, gapDays: 3, about: 'A signal from the crater floor; some cannot stop thinking about it.' },
  { key: 'reactor_scare', name: 'Reactor scare', category: 'environment', weight: 4, gapDays: 4, about: 'The reactor alarm sounds and the colony remembers the Long Dark.' },
  { key: 'rich_ice_strike', name: 'Rich ice strike', category: 'environment', weight: 4, gapDays: 3, about: 'A miner hits a seam of clean ice: water floods into the depot.' },
  { key: 'festival_day', name: 'Festival day', category: 'social', weight: 4, gapDays: 3, about: 'The colony takes a day off to sing, eat and remember.' },
  { key: 'pet_escapes', name: 'A pet escapes', category: 'social', weight: 4, requires: ['pets'], gapDays: 2, about: 'A beloved pet slips out of the habitat; its owner searches desperately.' },
  { key: 'birth_complication', name: 'Birth complication', category: 'health', weight: 5, requires: ['pregnancy'], gapDays: 2, about: 'A pregnancy goes badly; mother and child are in danger.' },
  { key: 'artist_breakthrough', name: "Artist's breakthrough", category: 'social', weight: 3, requires: ['artists'], gapDays: 3, about: 'A struggling artist is suddenly, fiercely inspired.' },
  { key: 'blackout', name: 'Blackout', category: 'environment', weight: 4, gapDays: 3, about: 'The power fails for hours: research is lost and fear spreads.' },
  { key: 'air_leak', name: 'Air leak', category: 'environment', weight: 4, gapDays: 3, about: 'A habitat seal hisses; everyone inside runs for the tubes.' },
  { key: 'lost_rover', name: 'Lost rover', category: 'environment', weight: 3, gapDays: 3, about: 'A rover crew goes silent out on the surface.' },
  { key: 'long_dark_log', name: 'An old Long Dark log surfaces', category: 'social', weight: 3, gapDays: 4, about: 'A log from the Long Dark turns up and points a finger at someone.' },
  { key: 'child_missing', name: 'A child goes missing', category: 'social', weight: 3, requires: ['children'], gapDays: 3, about: 'A child wanders off into the tubes; the colony searches.' },
  { key: 'stray_litter', name: 'A litter of strays', category: 'social', weight: 3, gapDays: 3, about: 'A stowaway cat has kittens behind the depot; homes are needed.' },
  { key: 'cache_found', name: 'An old cache', category: 'environment', weight: 2, gapDays: 4, about: 'A forgotten supply cache from the founding days is found.' },
  { key: 'workshop_fire', name: 'Fire in the works', category: 'environment', weight: 3, gapDays: 4, about: 'A printer catches fire; someone runs in to put it out.' },
  { key: 'crop_blight', name: 'Rust blight', category: 'environment', weight: 3, gapDays: 4, about: 'Rust blight hits the racks and food is lost.' },
  { key: 'visiting_trader', name: 'A visiting trader', category: 'social', weight: 3, gapDays: 3, about: 'An independent trader sets down with medicine and gossip from Earth.' },
  { key: 'comet', name: 'A comet', category: 'environment', weight: 2, gapDays: 5, about: 'A comet crosses the sky; artists and dreamers are moved.' },
  { key: 'old_feud', name: 'An old feud flares', category: 'social', weight: 4, gapDays: 2, about: 'Two old rivals come to blows in public.' },
  { key: 'anonymous_gift', name: 'An anonymous gift', category: 'social', weight: 2, gapDays: 3, about: 'Someone leaves credits at the door of the poorest family.' },
  { key: 'ghost_sighting', name: 'A ghost in the tubes', category: 'social', weight: 2, gapDays: 4, about: 'Someone swears they saw one of the eleven in the tubes at night.' },
  { key: 'water_contamination', name: 'Bad water', category: 'health', weight: 2, gapDays: 4, about: 'A batch of depot water is contaminated and must be dumped.' },
];

export const RANDOM_EVENT_BY_KEY: Record<string, RandomEventDef> = Object.fromEntries(RANDOM_EVENTS.map((e) => [e.key, e]));

/** Names for children born in the colony. */
export const CHILD_NAMES = ['Luna', 'Kai', 'Selene', 'Orion', 'Mara', 'Tycho', 'Ilse', 'Ren', 'Juno', 'Elio', 'Noor', 'Cass', 'Teo', 'Wren', 'Ada', 'Sol', 'Mika', 'Iris', 'Ezra', 'Lia'];
/** Names for strangers off unscheduled shuttles. */
export const STRANGER_NAMES = ['Vesna Kraljic', 'Idris Okonkwo', 'Margit Saar', 'Anselm Duvall', 'Rhee Soo-ah', 'Calla Moreau', 'Bastien Ruiz', 'Oksana Petrenko', 'Thaddeus Grey', 'Zainab Hollis'];
