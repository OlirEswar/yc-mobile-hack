/**
 * Colony-wide systems that run on the clock rather than through an agent's step: standing effects
 * (drought, storm) and their end, hourly production and hauling, market prices, the daily round
 * (case expiry, vacancies, reserve warnings), council sessions and shuttle arrivals. Production
 * counts who is working where from the roster, so it needs no agent reads.
 */
import { LOCATIONS, TICKS_PER_DAY, TICKS_PER_HOUR, TRADED_RESOURCES } from '../../shared/colony';
import { BASE_PRICES, CANTEEN_TARGET, CUT_AT, FARM_WATER_FLOOR, NORMAL_STOCK, PRICE_NEWS, PRODUCTION, SHUTTLE_EVERY_DAYS } from '../lib/constants';
import { clamp, rand, randInt, round1, round2 } from '../lib/rng';
import { ROSTER_WORKING, locChar } from '../seed/insert';
import { activeEffects, addStock, droughtSeverity, locName, reserveDays, reserveRatio, shelterFrom, stock, stormAt } from './conditions';
import { agentsAt, dayOf, emitEvent, encodeStep, hourOf, interrupt, killAgent, loadAgent, touch } from './core';
import type { Tx } from './core';
import { fillVacancies, holdCouncil } from './council';
import { simState } from './state';

/** Runs the systems due at tx.tick. Called once per tick before agents step. */
export async function runSystems(tx: Tx): Promise<void> {
  await standingEffects(tx);
  if (tx.tick % TICKS_PER_HOUR === 0) {
    await hourly(tx);
    if (hourOf(tx.tick) === 19 || (await councilEmergency(tx))) await holdCouncil(tx);
  }
  if (dayOf(tx.tick) > tx.world.lastDailyDay) await daily(tx);
}

// ---------- drought and storm ----------

async function standingEffects(tx: Tx): Promise<void> {
  const sim = await simState(tx);
  const world = tx.world;
  for (const e of [...world.activeEffects]) {
    if (tx.tick >= e.endTick) {
      world.activeEffects = world.activeEffects.filter((x) => x.id !== e.id);
      sim.seenEffects = sim.seenEffects.filter((id) => id !== e.id);
      if (world.causes[e.type] === e.eventId) delete world.causes[e.type];
      const damaged = Object.entries(world.damage).filter(([, d]) => d > 0.05).map(([loc, d]) => locName(loc) + ' ' + Math.round(d * 100) + '%');
      const days = Math.max(1, Math.round((e.endTick - e.startTick) / TICKS_PER_DAY));
      await emitEvent(tx, {
        category: 'environment',
        eventType: e.type + '_ended',
        locationId: e.type === 'drought' ? 'ice_wells' : e.locationIds[0],
        summary:
          e.type === 'drought'
            ? 'Water is flowing at the Ice Wells again after ' + days + (days === 1 ? ' sol' : ' sols') + ' of drought.'
            : 'The storm has passed.' + (damaged.length > 0 ? ' Damage left behind: ' + damaged.join(', ') + '.' : ''),
        salience: 0.6,
        causationEventId: e.eventId,
        visibility: 'public',
      });
      continue;
    }
    if (tx.tick < e.startTick || sim.seenEffects.includes(e.id)) continue;
    sim.seenEffects.push(e.id);
    if (e.type === 'storm') await stormOnset(tx, e);
  }
  if (tx.tick % TICKS_PER_HOUR === 0) await stormHour(tx);
}

/** Everyone caught at a struck location runs for the nearest airlock. */
async function stormOnset(tx: Tx, e: Tx['world']['activeEffects'][number]): Promise<void> {
  const struck = e.locationIds.length > 0 ? e.locationIds : Object.values(LOCATIONS).filter((l) => l.exposed).map((l) => l.id);
  for (const loc of struck) {
    for (const id of await agentsAt(tx, loc, { includeAsleep: true })) {
      const a = await loadAgent(tx, id);
      if (!a?.alive) continue;
      const to = shelterFrom(loc);
      a.needs.safety = Math.min(100, a.needs.safety + 50);
      a.mood = 'afraid';
      interrupt(tx, a, [encodeStep('flee', to), encodeStep('rest', 3)]);
    }
  }
}

/** A storm keeps battering what it hits, and anyone still out in it. */
async function stormHour(tx: Tx): Promise<void> {
  for (const e of activeEffects(tx.world, 'storm')) {
    const struck = e.locationIds.length > 0 ? e.locationIds : Object.values(LOCATIONS).filter((l) => l.exposed).map((l) => l.id);
    for (const loc of struck) {
      tx.world.damage[loc] = round2(clamp((tx.world.damage[loc] ?? 0) + e.severity * 0.03, 0, 1));
      for (const id of await agentsAt(tx, loc, { includeAsleep: true })) {
        const a = await loadAgent(tx, id);
        if (!a?.alive) continue;
        a.health = Math.max(0, a.health - e.severity * 14);
        touch(tx, a);
        if (a.health <= 0) {
          await killAgent(tx, a, { cause: 'caught outside in the storm', summary: a.name + ' was killed by the storm at ' + locName(loc) + '.', causationEventId: e.eventId, category: 'environment' });
        }
      }
    }
  }
}

// ---------- hourly production ----------

/** Number of agents working at a location right now, from the roster. */
function workersAt(tx: Tx, loc: string): number {
  const c = locChar(loc);
  let n = 0;
  for (let seq = 0; seq < tx.rosterLoc.length; seq++) if (tx.rosterLoc[seq] === c && tx.rosterSt[seq] === ROSTER_WORKING) n += 1;
  return n;
}

async function hourly(tx: Tx): Promise<void> {
  const world = tx.world;
  const econ = world.econ;
  const power = 1 - 0.6 * (world.damage.solar_farm ?? 0);
  const factor = (loc: string): number => power * (1 - (world.damage[loc] ?? 0)) * (stormAt(world, loc) > 0 ? 0 : 1);

  const water = workersAt(tx, 'ice_wells') * PRODUCTION.water * factor('ice_wells') * (1 - droughtSeverity(world));
  addStock(world, 'depot', 'water', water);
  econ.produced.water = round2(econ.produced.water + water);

  // The grow racks only get water the depot can spare above the drinking floor.
  const wantFood = workersAt(tx, 'hydroponics') * PRODUCTION.food * factor('hydroponics');
  const spare = Math.max(0, stock(world, 'depot', 'water') - FARM_WATER_FLOOR * (1 + econ.rationLevel * 0.5));
  const food = Math.min(wantFood, spare / PRODUCTION.foodWater);
  addStock(world, 'depot', 'water', -food * PRODUCTION.foodWater);
  addStock(world, 'depot', 'food', food);
  econ.produced.food = round2(econ.produced.food + food);

  const regolith = econ.regolith;
  regolith.quarry = round2(regolith.quarry + workersAt(tx, 'quarry') * PRODUCTION.regolith * factor('quarry'));
  const hauled = Math.min(regolith.quarry, PRODUCTION.conveyor * power + workersAt(tx, 'depot') * PRODUCTION.haul);
  regolith.quarry = round2(regolith.quarry - hauled);
  regolith.workshop = round2(regolith.workshop + hauled);
  const parts = Math.min(regolith.workshop / 2, workersAt(tx, 'workshop') * PRODUCTION.parts * factor('workshop'));
  regolith.workshop = round2(regolith.workshop - parts * 2);
  addStock(world, 'depot', 'parts', parts);
  econ.produced.parts = round2(econ.produced.parts + parts);

  const medicine = workersAt(tx, 'medbay') * PRODUCTION.medicine * factor('medbay');
  addStock(world, 'medbay', 'medicine', medicine);
  econ.produced.medicine = round2(econ.produced.medicine + medicine);

  const cooks = workersAt(tx, 'canteen') * PRODUCTION.cookRestock;
  for (const res of ['food', 'water'] as const) {
    const n = Math.min(cooks, Math.max(0, CANTEEN_TARGET[res] - stock(world, 'canteen', res)), Math.max(0, stock(world, 'depot', res) - 20));
    addStock(world, 'canteen', res, n);
    addStock(world, 'depot', res, -n);
  }

  const dock = workersAt(tx, 'landing_pad') * PRODUCTION.dockMove + 2;
  for (const res of ['parts', 'medicine'] as const) {
    const n = Math.min(dock, stock(world, 'landing_pad', res));
    addStock(world, 'landing_pad', res, -n);
    addStock(world, res === 'medicine' ? 'medbay' : 'depot', res, n);
  }

  await updatePrices(tx);
  if (hourOf(tx.tick) === 10 && dayOf(tx.tick) - econ.lastShuttleDay >= SHUTTLE_EVERY_DAYS) await shuttle(tx);
}

/** Prices follow public stock against normal levels; big moves are news, with the shortage as their cause. */
async function updatePrices(tx: Tx): Promise<void> {
  const world = tx.world;
  for (const res of TRADED_RESOURCES) {
    const held = stock(world, 'depot', res) + (res === 'medicine' ? stock(world, 'medbay', res) : 0);
    const target = BASE_PRICES[res] * clamp(Math.pow(NORMAL_STOCK[res] / Math.max(held, 1), 0.75), 0.6, 8);
    const price = round1(Math.max(0.5, world.prices[res] + (target - world.prices[res]) * 0.35));
    world.prices[res] = price;
    const announced = world.econ.announcedPrices[res];
    if (Math.abs(price - announced) / announced < PRICE_NEWS) continue;
    world.econ.announcedPrices[res] = price;
    const rose = price > announced;
    const cause = (res === 'water' || res === 'food') && world.causes.drought ? world.causes.drought : res === 'parts' && world.causes.storm ? world.causes.storm : undefined;
    const { eventId } = await emitEvent(tx, {
      category: 'economy',
      eventType: 'price_change',
      locationId: 'market',
      summary:
        res.charAt(0).toUpperCase() + res.slice(1) + ' at the Exchange ' + (rose ? 'jumped' : 'fell') + ' to ' + price + ' credits, from ' + announced + ', as the depot holds ' + Math.round(held) + '.',
      salience: rose ? (price >= BASE_PRICES[res] * 2 ? 0.66 : 0.55) : 0.35,
      causationEventId: rose ? cause : undefined,
      visibility: 'public',
      facts: { resource: res, price, previous: announced },
    });
    if (rose) world.causes['price_' + res] = eventId;
    else if (world.causes['price_' + res] && price <= BASE_PRICES[res] * 1.2) delete world.causes['price_' + res];
  }
}

async function shuttle(tx: Tx): Promise<void> {
  const world = tx.world;
  if (stormAt(world, 'landing_pad') > 0) return;
  world.econ.lastShuttleDay = dayOf(tx.tick);
  const r = (salt: string) => rand(world.seed, tx.tick, 'shuttle', salt);
  const parts = randInt(r('parts'), 14, 26);
  const medicine = randInt(r('medicine'), 4, 9);
  addStock(world, 'landing_pad', 'parts', parts);
  addStock(world, 'landing_pad', 'medicine', medicine);
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'shuttle_arrival',
    locationId: 'landing_pad',
    summary: 'A supply shuttle set down at the Landing Pad with ' + parts + ' parts and ' + medicine + ' doses of medicine.',
    salience: 0.45,
    visibility: 'public',
    witnesses: 'location',
  });
}

// ---------- the daily round ----------

async function daily(tx: Tx): Promise<void> {
  const world = tx.world;
  world.lastDailyDay = dayOf(tx.tick);
  const sim = await simState(tx);
  sim.cases = sim.cases.filter((c) => tx.tick - c.tick < 2 * TICKS_PER_DAY);
  sim.petitions = sim.petitions.filter((p) => tx.tick - p.tick < TICKS_PER_DAY);
  world.econ.demand = { food: 0, water: 0, parts: 0, medicine: 0 };
  world.econ.unmet = { food: 0, water: 0, parts: 0, medicine: 0 };
  world.econ.produced = { food: 0, water: 0, parts: 0, medicine: 0 };
  await fillVacancies(tx);
  const days = Math.min(reserveDays(world, 'water'), reserveDays(world, 'food'));
  if (reserveRatio(world) < 0.4) {
    await emitEvent(tx, {
      category: 'economy',
      eventType: 'reserve_low',
      locationId: 'depot',
      summary: 'The Supply Depot is down to ' + Math.round(stock(world, 'depot', 'water')) + ' water and ' + Math.round(stock(world, 'depot', 'food')) + ' food: about ' + round1(days) + ' days at normal use.',
      salience: reserveRatio(world) < 0.2 ? 0.75 : 0.6,
      causationEventId: world.causes.drought ?? world.causes.rations,
      visibility: 'public',
    });
  }
}

/** The council meets out of hours when the reserve is about to run dry and rations are still generous. */
async function councilEmergency(tx: Tx): Promise<boolean> {
  const sim = await simState(tx);
  const level = tx.world.econ.rationLevel;
  return level < 2 && reserveRatio(tx.world) < CUT_AT.open[level] && tx.tick - sim.lastCouncilTick >= 6 * TICKS_PER_HOUR;
}

