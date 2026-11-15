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

/** The daily budget comes from the owner's plan (shared/plans.ts), not from here. */
export const DEFAULT_LLM_CONFIG = {
  maxConcurrent: 3,
  /** 12 simulated hours between normal LLM plans for one agent. */
  cooldownTicks: 72,
  focusReserve: 6,
  crisisReserve: 8,
  speechPerDay: 12,
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
