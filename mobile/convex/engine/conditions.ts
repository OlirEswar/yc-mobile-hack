/**
 * Read-only views of the world that the planner, the executor and the world systems share: the
 * personal clock, standing conditions (storms, drought), blocked routes, reserves and names.
 */
import { LOCATIONS, LOCATION_IDS, ROUTES, TICKS_PER_DAY, routeKey } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { DAILY_USE, NORMAL_STOCK } from '../lib/constants';
import type { AgentDoc, EventId, Tx, WorldDoc } from './core';

export const isLocation = (id: string): id is LocationId => (LOCATION_IDS as readonly string[]).includes(id);
export const locName = (id: string): string => (isLocation(id) ? LOCATIONS[id].name : id);
export const firstName = (name: string): string => name.split(' ')[0];
/** Lower-cases the first letter so a sentence can continue into it, unless it starts with a name. */
export const lowerFirst = (text: string, name: string): string => (text.startsWith(firstName(name)) || /^[A-Z][a-z]+ [A-Z]/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

/** Ticks since the agent's personal day began: 0 is waking time, 96 bedtime. */
export function personalTick(a: AgentDoc, tick: number): number {
  return (((tick - a.dayOffset) % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
}

/** Active effects of a type at the world's current tick. */
export function activeEffects(world: WorldDoc, type: string): WorldDoc['activeEffects'] {
  return world.activeEffects.filter((e) => e.type === type && e.startTick <= world.tick && world.tick < e.endTick);
}

/** Severity of the drought now, 0 when there is none. */
export function droughtSeverity(world: WorldDoc): number {
  return Math.max(0, ...activeEffects(world, 'drought').map((e) => e.severity));
}

/** Severity of a storm over an exposed location now, 0 when it is sheltered or calm. */
export function stormAt(world: WorldDoc, loc: string): number {
  if (!isLocation(loc) || !LOCATIONS[loc].exposed) return 0;
  let worst = 0;
  for (const e of activeEffects(world, 'storm')) {
    if (e.locationIds.length === 0 || e.locationIds.includes(loc)) worst = Math.max(worst, e.severity);
  }
  return worst;
}

/** Surface routes that touch a storm-struck location. */
export function blockedRoutes(world: WorldDoc): Set<string> {
  const blocked = new Set<string>();
  for (const r of ROUTES) if (r.surface && (stormAt(world, r.a) > 0 || stormAt(world, r.b) > 0)) blocked.add(routeKey(r.a, r.b));
  return blocked;
}

/** The nearest pressurised location, for anyone caught outside. */
export function shelterFrom(loc: string): LocationId {
  for (const r of ROUTES) {
    if (r.a === loc && !LOCATIONS[r.b].exposed) return r.b;
    if (r.b === loc && !LOCATIONS[r.a].exposed) return r.a;
  }
  return 'plaza';
}

/** Days the depot reserve of a resource lasts at normal use. */
export function reserveDays(world: WorldDoc, res: 'food' | 'water'): number {
  return stock(world, 'depot', res) / Math.max(1, world.population.alive * DAILY_USE[res]);
}

/** Depot stock of the scarcer of food and water as a share of its normal level: 1 is healthy. */
export function reserveRatio(world: WorldDoc): number {
  return Math.min(stock(world, 'depot', 'water') / NORMAL_STOCK.water, stock(world, 'depot', 'food') / NORMAL_STOCK.food);
}

export const stock = (world: WorldDoc, loc: string, res: string): number => world.stockpiles[loc]?.[res] ?? 0;

/** Adds (or removes, with a negative amount) public stock at a location. Never below zero. */
export function addStock(world: WorldDoc, loc: string, res: string, amount: number): void {
  const pile = (world.stockpiles[loc] ??= {});
  pile[res] = Math.max(0, Math.round(((pile[res] ?? 0) + amount) * 100) / 100);
}

/** The event that best explains scarcity-driven behaviour right now, for cause chains. */
export function scarcityCause(world: WorldDoc, res?: string): EventId | undefined {
  const c = world.causes;
  return (res ? c['price_' + res] : undefined) ?? c.drought ?? c.rations ?? c.storm;
}

/** Sitting councilors, the chair first. */
export function councilIds(tx: Tx): string[] {
  const chair = tx.world.roles.chair;
  const seats = tx.world.sim?.council ?? [];
  return chair ? [chair, ...seats.filter((id) => id !== chair)] : [...seats];
}
