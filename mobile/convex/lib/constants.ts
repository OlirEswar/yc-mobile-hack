/** Tuning numbers for the simulation. Everything here is a starting value meant to be adjusted. */
import type { LocationId, TradedResourceId } from '../../shared/colony';

export const DEFAULT_SEED = 20261115;
/** Scheduler key for the dead: never due. */
export const NEVER_DUE = 1e12;
export const HEARTBEAT_FRESH_MS = 60_000;

export const BASE_PRICES: Record<TradedResourceId, number> = { food: 3, water: 2, parts: 5, medicine: 8 };

/** Stock levels the market treats as normal. Prices rise as public stock falls below them. */
export const NORMAL_STOCK: Record<TradedResourceId, number> = { food: 280, water: 420, parts: 60, medicine: 18 };

export const INITIAL_STOCKPILES: Partial<Record<LocationId, Record<string, number>>> = {
  depot: { food: 280, water: 420, parts: 60, medicine: 4 },
  canteen: { food: 26, water: 32 },
  medbay: { medicine: 18 },
  ice_wells: { water: 40 },
  landing_pad: { parts: 0, medicine: 0 },
};

export const INITIAL_TREASURY = 12_000;

/**
 * LLM calls per sim day (144 ticks, 8 real minutes at 1x). The followed colonist comes first: a plan
 * for every decision (about one per 10 to 20 in-game minutes of waking activity) plus monologue
 * lines, about 150 a day once fast-forward skips the night; storyline climaxes and big events share
 * the crisis reserve; everyone else gets the rest. Questions to colonists have their own allowance
 * per session (focus.ts). gpt-6-luna is cheap, so this is a few cents per sim day.
 */
export const DEFAULT_LLM_CONFIG = {
  budgetPerDay: 260,
  maxConcurrent: 4,
  /** 12 simulated hours between normal LLM plans for one agent. Focus and crisis plans ignore it. */
  cooldownTicks: 72,
  focusReserve: 150,
  crisisReserve: 40,
  speechPerDay: 40,
};

/** Bounds for the create-character power. */
export const MAX_STARTING: Record<string, number> = { food: 20, water: 20, parts: 20, medicine: 10, credits: 300 };
export const MAX_GRANT: Record<string, number> = { food: 500, water: 500, parts: 300, medicine: 100, credits: 2000 };

export const RATE_LIMITS = {
  powersPerWindow: 12,
  powerWindowMs: 30_000,
  createsPerWindow: 4,
  createWindowMs: 60_000,
  maxWorlds: 40,
};

// ---------- tick engine ----------

/** Most agents a single tick steps; the rest stay due and run on the next tick. */
export const AGENT_STEPS_PER_TICK = 45;
/** world:skipToNotable advances at most this far, and stops early past this many agent steps. */
export const SKIP_MAX_TICKS = 36;
export const SKIP_STEP_BUDGET = 1100;
/** Salience at which world:skipToNotable stops for an event nobody asked about. */
export const NOTABLE_SALIENCE = 0.7;

// ---------- needs and bodies ----------

/** Need pressure added per 10-minute tick, by what the agent is doing. Negative relieves. */
export const NEED_RATES = {
  awake: { hunger: 0.4, thirst: 0.55, fatigue: 0.48, social: 0.32 },
  working: { hunger: 0.46, thirst: 0.62, fatigue: 0.6, social: 0.16 },
  resting: { hunger: 0.34, thirst: 0.48, fatigue: -0.7, social: 0.2 },
  asleep: { hunger: 0.18, thirst: 0.26, fatigue: -2.1, social: 0 },
};
/** Pressure removed by one unit of food or water. */
export const MEAL_RELIEF = 42;
export const DRINK_RELIEF = 45;
/** Health lost per tick spent at 100 hunger or thirst, and regained per tick when fed and watered. */
export const STARVE_DAMAGE = 0.28;
export const THIRST_DAMAGE = 0.45;
export const HEALTH_REGEN = 0.05;

// ---------- economy ----------

/** Household ration per living member per day, by ration level (0 full, 1 reduced, 2 emergency). */
export const RATIONS: { food: number; water: number }[] = [
  { food: 1.6, water: 2 },
  { food: 1.1, water: 1.3 },
  { food: 0.7, water: 0.8 },
];
/** A pantry holds at most this many days of rations per member; the depot hands out no more. */
export const PANTRY_DAYS = 2.5;

/** Output per worker-hour at a staffed, undamaged, powered site. */
export const PRODUCTION = {
  water: 4.3,
  food: 1.9,
  /** Water the grow racks drink per unit of food. */
  foodWater: 0.45,
  regolith: 3,
  /** Parts from two regolith each. */
  parts: 0.7,
  medicine: 0.09,
  /** Regolith hauled from the quarry to the works per depot worker-hour, plus the conveyor. */
  haul: 3,
  conveyor: 4,
  /** Units a cook moves from the depot to the canteen per hour. */
  cookRestock: 10,
  /** Units a dock hand moves from the pad to the depot per hour. */
  dockMove: 8,
};
/** The farms stop drawing depot water below this, so drinking water lasts longer than crops. */
export const FARM_WATER_FLOOR = 60;
export const CANTEEN_TARGET = { food: 40, water: 40 };
/** The Exchange counter sells depot stock only above these floors. */
export const RESERVE_FLOOR: Record<TradedResourceId, number> = { food: 70, water: 110, parts: 12, medicine: 2 };
export const WAGE_PER_HOUR = 1.2;
/** Share of credits above LEVY_FREE taken once a day for the treasury. */
export const LEVY_RATE = 0.02;
export const LEVY_FREE = 40;
/** A price move this large (relative to the last announced price) is news. */
export const PRICE_NEWS = 0.3;
export const SHUTTLE_EVERY_DAYS = 3;
/** Daily stock use the reserve is measured against, per living colonist. */
export const DAILY_USE = { food: 1.5, water: 2.2 };
/** Reserve ratio (depot stock over NORMAL_STOCK) below which each council stance votes to cut rations to reduced, then emergency. */
export const CUT_AT: Record<string, [number, number]> = { guard: [0.6, 0.3], trade: [0.45, 0.2], open: [0.3, 0.12] };
/** Reserve ratio above which the open-handed ask the council for a bonus ration, and each stance's price for agreeing. */
export const BONUS_AT = 0.95;
export const BONUS_YES_AT: Record<string, number> = { open: 0.95, trade: 1.2, guard: 1.5 };
