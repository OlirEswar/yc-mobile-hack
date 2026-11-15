/**
 * Executes plan steps. startStep begins a step and returns how many ticks it occupies (0 for an
 * instant step, FAILED when it cannot be done); finishStep applies what a timed step achieves when
 * it ends. Success is decided from real state: who is present, stock, credits, skill, witnesses.
 * Interactions resolve when they start, so their speech bubbles show while they last.
 */
import { ROUTES, findPath, routeKey } from '../../shared/colony';
import type { TradedResourceId } from '../../shared/colony';
import type { ActivityKind } from '../../shared/types';
import { BASE_PRICES, DRINK_RELIEF, MEAL_RELIEF, PANTRY_DAYS, RATIONS, RESERVE_FLOOR, WAGE_PER_HOUR } from '../lib/constants';
import { clamp, rand, round2 } from '../lib/rng';
import {
  addStock,
  blockedRoutes,
  droughtSeverity,
  firstName,
  isLocation,
  locName,
  scarcityCause,
  stock,
  stormAt,
} from './conditions';
import {
  adjustRelationship,
  agentsAt,
  decodeStep,
  emitEvent,
  encodeStep,
  enqueueCognition,
  interrupt,
  learnBelief,
  loadAgent,
  loadFactions,
  loadHousehold,
  loadMind,
  touch,
  touchFaction,
  touchHousehold,
  touchMind,
} from './core';
import type { AgentDoc, AgentId, EventId, HouseholdDoc, Tx } from './core';
import { simState } from './state';
import {
  getBelief,
  markActed,
  maybeSplitFaction,
  presentWith,
  spreadBelief,
  tie,
  trustWeight,
  truthAbout,
  beliefsOf,
  effectiveConfidence,
  ACCUSABLE,
} from './social';
import { accuseLine, beliefLine, denyLine, reply, smallTalk, workLabel } from './text';

export const FAILED = -1;

const RESOURCES = ['food', 'water', 'parts', 'medicine', 'credits'] as const;
type Res = (typeof RESOURCES)[number];
const isRes = (r: string): r is Res => (RESOURCES as readonly string[]).includes(r);
const isTraded = (r: string): r is TradedResourceId => r === 'food' || r === 'water' || r === 'parts' || r === 'medicine';
const SECURITY = new Set(['security', 'quartermaster']);

const roll = (tx: Tx, a: AgentDoc, salt: string): number => rand(tx.world.seed, tx.tick, a.seq, salt);
const int = (s: string | undefined, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};
const units = (n: number, res: string): string => n + ' ' + res;

function act(tx: Tx, a: AgentDoc, activity: ActivityKind, label: string, withId?: AgentId, speech?: string): void {
  a.activity = activity;
  a.activityLabel = label;
  a.interactingWithId = withId;
  a.speech = speech;
  touch(tx, a);
}

/** Shows a short line over someone else's head without changing what they are doing. */
function say(tx: Tx, b: AgentDoc, withId: AgentId, speech: string): void {
  b.interactingWithId = withId;
  b.speech = speech;
  touch(tx, b);
}

/** Abandons the plan with a legible reason. The planner picks something else next tick. */
async function fail(tx: Tx, a: AgentDoc, label: string): Promise<number> {
  a.q = [];
  a.failStreak += 1;
  act(tx, a, 'idle', label);
  if (a.failStreak === 3) {
    await enqueueCognition(tx, a, { kind: 'plan', trigger: 'plans keep failing: ' + label, priority: 0.5, lane: 'normal' });
  }
  return FAILED;
}

/** Starts a step. label is the plan's display label for it, when the plan has one. */
export async function startStep(tx: Tx, a: AgentDoc, encoded: string, label?: string): Promise<number> {
  const step = decodeStep(encoded);
  if (!step) return fail(tx, a, 'Gave up on something that made no sense');
  a.interactingWithId = undefined;
  a.speech = undefined;
  const [x, y, z] = step.args;
  switch (step.type) {
    case 'go':
      return go(tx, a, x, label, false);
    case 'flee':
      return go(tx, a, x, label, true);
    case 'work':
      return work(tx, a, int(x, 1, 36, 12), label);
    case 'eat':
      return consume(tx, a, 'food');
    case 'drink':
      return consume(tx, a, 'water');
    case 'sleep': {
      const home = a.locationId === a.homeLocationId;
      act(tx, a, 'sleeping', home ? 'Asleep at home' : 'Dozing at ' + locName(a.locationId));
      return int(x, 1, 60, 36);
    }
    case 'rest':
      act(tx, a, 'resting', label ?? 'Resting at ' + locName(a.locationId));
      return int(x, 1, 24, 3);
    case 'wait':
      act(tx, a, 'idle', label ?? 'Waiting at ' + locName(a.locationId));
      return int(x, 1, 24, 2);
    case 'ration':
      return ration(tx, a);
    case 'buy':
      return buy(tx, a, x, int(y, 1, 30, 2));
    case 'sell':
      return sell(tx, a, x, int(y, 1, 30, 2));
    case 'talk':
      return talk(tx, a, x, y);
    case 'give':
      return give(tx, a, x, y, int(z, 1, 50, 1));
    case 'steal':
      return steal(tx, a, x, y, int(z, 1, 10, 2));
    case 'help':
      return help(tx, a, x);
    case 'investigate':
      return investigateStart(tx, a, x);
    case 'accuse':
      return accuse(tx, a, x, y);
    case 'petition':
      return petition(tx, a, x);
    case 'repair':
      return repairStart(tx, a, x);
    case 'mourn':
      return mourn(tx, a, x);
    default:
      return fail(tx, a, 'Did not know how to ' + step.type);
  }
}

/** Applies what a timed step achieved, when it ends uninterrupted. */
export async function finishStep(tx: Tx, a: AgentDoc, encoded: string, startTick: number): Promise<void> {
  const step = decodeStep(encoded);
  if (!step) return;
  const elapsed = Math.max(1, tx.tick - startTick);
  if (step.type === 'work') await workDone(tx, a, elapsed);
  else if (step.type === 'investigate') await investigateDone(tx, a, step.args[0]);
  else if (step.type === 'repair') await repairDone(tx, a, step.args[0], elapsed);
  else if (step.type === 'mourn') a.mood = 'sombre';
  else if (step.type === 'go' || step.type === 'flee') a.move = undefined;
}

// ---------- movement ----------

async function go(tx: Tx, a: AgentDoc, to: string, label: string | undefined, fleeing: boolean): Promise<number> {
  if (!isLocation(to)) return fail(tx, a, 'Tried to go somewhere that does not exist');
  if (a.locationId === to) return 0;
  const blocked = blockedRoutes(tx.world);
  // Someone caught outside may always run for the nearest airlock.
  if (fleeing) for (const r of ROUTES) if (r.a === a.locationId || r.b === a.locationId) blocked.delete(routeKey(r.a, r.b));
  const path = findPath(a.locationId as typeof to, to, blocked);
  if (!path) return fail(tx, a, 'Could not reach ' + locName(to) + ': the surface route is closed by the storm');
  a.move = { from: a.locationId, to, departTick: tx.tick, arriveTick: tx.tick + path.ticks };
  a.locationId = to;
  act(tx, a, fleeing ? 'fleeing' : 'walking', label ?? (fleeing ? 'Running for cover at ' : 'Walking to ') + locName(to));
  return path.ticks;
}

// ---------- work ----------

async function work(tx: Tx, a: AgentDoc, ticks: number, label: string | undefined): Promise<number> {
  if (!a.workLocationId || a.locationId !== a.workLocationId) return fail(tx, a, 'Meant to work but is not at ' + locName(a.workLocationId ?? 'plaza'));
  if (stormAt(tx.world, a.locationId) > 0) return fail(tx, a, 'Work at ' + locName(a.locationId) + ' stopped by the storm');
  act(tx, a, 'working', label ?? workLabel(a));
  return ticks;
}

async function workDone(tx: Tx, a: AgentDoc, ticks: number): Promise<void> {
  const econ = tx.world.econ;
  const wage = round2((WAGE_PER_HOUR * ticks) / 6);
  if (econ.treasury >= wage) {
    econ.treasury = round2(econ.treasury - wage);
    a.inv.credits = round2(a.inv.credits + wage);
  } else econ.wagesUnpaid = round2(econ.wagesUnpaid + wage);
  a.skill = Math.min(100, a.skill + 0.02 * ticks);
  touch(tx, a);
  if (a.occupation === 'trader') await restock(tx, a);
  if (a.occupation === 'quartermaster') await countDepot(tx, a);
  if (a.occupation === 'medic' && a.locationId === 'medbay') await treatPatients(tx, a);
  if (a.occupation === 'ice_miner' && droughtSeverity(tx.world) > 0 && tx.world.causes.drought) {
    await learnBelief(tx, a, {
      kind: 'scarcity',
      worldKey: 'scarcity:water',
      text: 'The ice wells are running dry.',
      valence: -1,
      confidence: 0.9,
      sourceType: 'observed',
      originEventId: tx.world.causes.drought,
    });
  }
}

/** Traders top up their stall from the depot at a wholesale price. The greedy buy far more when water is scarce. */
async function restock(tx: Tx, a: AgentDoc): Promise<void> {
  const scarce = droughtSeverity(tx.world) > 0 || tx.world.prices.water >= BASE_PRICES.water * 1.5;
  const greedy = (a.markup ?? 0.2) >= 0.3 && scarce;
  for (const res of ['water', 'food'] as const) {
    const target = greedy && res === 'water' ? 36 : 10;
    const want = Math.floor(target - a.inv[res]);
    if (want < 3) continue;
    const price = tx.world.prices[res] * 0.85;
    const n = Math.min(want, Math.floor(stock(tx.world, 'depot', res) - RESERVE_FLOOR[res]), Math.floor(a.inv.credits / price));
    if (n <= 0) continue;
    const cost = Math.ceil(n * price);
    a.inv.credits = round2(a.inv.credits - cost);
    a.inv[res] += n;
    tx.world.econ.treasury = round2(tx.world.econ.treasury + cost);
    addStock(tx.world, 'depot', res, -n);
    if (n >= 15) {
      const { eventId, witnessIds } = await emitEvent(tx, {
        category: 'economy',
        eventType: 'stockpiling',
        actorId: a._id,
        locationId: 'depot',
        summary: a.name + ' bought ' + units(n, res) + ' from the depot at wholesale and stacked it behind the stall, betting the price will climb.',
        salience: 0.5,
        causationEventId: scarcityCause(tx.world, res),
        witnesses: 'location',
      });
      // Whoever watched the crates go out of the depot in a drought starts to talk about it.
      for (const id of witnessIds.slice(0, 4)) {
        const w = id === a._id ? null : await loadAgent(tx, id);
        if (!w || w.occupation === 'trader') continue;
        await learnBelief(tx, w, {
          kind: 'hoarding',
          text: a.name + ' is hoarding water behind the stall while the wells run dry.',
          valence: -1,
          confidence: round2(0.35 + 0.25 * w.traits.stubbornness + 0.15 * (1 - w.traits.empathy)),
          sourceType: 'inference',
          subjectAgentId: a._id,
          subjectName: a.name,
          originEventId: eventId,
        });
      }
    }
  }
  touch(tx, a);
}

/** The quartermaster's count finds what went missing unseen and opens a case. */
async function countDepot(tx: Tx, a: AgentDoc): Promise<void> {
  const sim = await simState(tx);
  const lost = (['water', 'food', 'parts'] as const).filter((r) => sim.missing[r] >= 1);
  if (lost.length === 0) return;
  const what = lost.map((r) => units(Math.round(sim.missing[r]), r)).join(' and ');
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'supplies_missing',
    actorId: a._id,
    locationId: 'depot',
    summary: a.name + "'s count at the Supply Depot came up " + what + ' short. Someone has been stealing from the reserve.',
    salience: 0.62,
    causationEventId: sim.missingEventId,
    visibility: 'public',
    witnesses: 'location',
  });
  sim.cases.push({ eventId, locationId: 'depot', tick: tx.tick });
  sim.missing = { food: 0, water: 0, parts: 0 };
  sim.missingEventId = undefined;
  a.mood = 'angry';
}

async function treatPatients(tx: Tx, medic: AgentDoc): Promise<void> {
  let treated = 0;
  for (const id of await agentsAt(tx, 'medbay', { exclude: [medic._id], includeAsleep: true })) {
    if (treated >= 2 || stock(tx.world, 'medbay', 'medicine') < 1) return;
    const patient = await loadAgent(tx, id);
    if (!patient?.alive || patient.health >= 80) continue;
    await treat(tx, medic, patient, 'medbay');
    treated += 1;
  }
}

async function treat(tx: Tx, medic: AgentDoc, patient: AgentDoc, from: 'medbay' | 'own'): Promise<void> {
  if (from === 'medbay') addStock(tx.world, 'medbay', 'medicine', -1);
  else medic.inv.medicine -= 1;
  const before = patient.health;
  patient.health = Math.min(100, patient.health + 25 + medic.skill * 0.1);
  touch(tx, patient);
  await adjustRelationship(tx, patient, medic, { affinity: 0.12, trust: 0.1, obligation: 0.15 });
  await emitEvent(tx, {
    category: 'health',
    eventType: 'treatment',
    actorId: medic._id,
    participantIds: [patient._id],
    locationId: medic.locationId,
    summary: medic.name + ' treated ' + patient.name + (before < 40 ? ', who was in a bad way,' : '') + ' at ' + locName(medic.locationId) + '.',
    salience: before < 40 ? 0.5 : 0.25,
  });
}

// ---------- eating and drinking ----------

async function consume(tx: Tx, a: AgentDoc, res: 'food' | 'water'): Promise<number> {
  const econ = tx.world.econ;
  econ.demand[res] += 1;
  const verb = res === 'food' ? 'Eating' : 'Drinking';
  let label: string | undefined;
  if (a.inv[res] >= 1) {
    a.inv[res] -= 1;
    label = verb + (res === 'food' ? ' from own supplies' : ' from own flask');
  } else if (a.locationId === a.homeLocationId) {
    const household = await loadHousehold(tx, a.householdId);
    if (household?.missing) await noticePantryTheft(tx, a, household);
    if (household && household.pantry[res] >= 1) {
      household.pantry[res] = round2(household.pantry[res] - 1);
      touchHousehold(tx, household);
      label = verb + ' at home';
    }
  } else if (a.locationId === 'canteen' && stock(tx.world, 'canteen', res) >= 1) {
    const fee = Math.max(1, Math.round(tx.world.prices[res] * 0.5));
    if (a.inv.credits < fee) {
      econ.unmet[res] += 1;
      return fail(tx, a, 'Could not pay ' + fee + ' credits at the canteen');
    }
    a.inv.credits = round2(a.inv.credits - fee);
    econ.treasury = round2(econ.treasury + fee);
    addStock(tx.world, 'canteen', res, -1);
    label = res === 'food' ? 'Having a meal at the Airlock Canteen' : 'Having a drink at the Airlock Canteen';
  }
  if (!label) {
    econ.unmet[res] += 1;
    return fail(tx, a, 'Found nothing to ' + (res === 'food' ? 'eat' : 'drink') + ' at ' + locName(a.locationId));
  }
  if (res === 'food') a.needs.hunger = Math.max(0, a.needs.hunger - MEAL_RELIEF);
  else a.needs.thirst = Math.max(0, a.needs.thirst - DRINK_RELIEF);
  act(tx, a, res === 'food' ? 'eating' : 'drinking', label);
  return res === 'food' ? 2 : 1;
}

/** Someone at home finds the pantry short and blames the person they trust least. */
async function noticePantryTheft(tx: Tx, a: AgentDoc, household: HouseholdDoc): Promise<void> {
  const missing = household.missing!;
  household.missing = undefined;
  touchHousehold(tx, household);
  const what = [missing.food >= 1 ? units(Math.round(missing.food), 'food') : '', missing.water >= 1 ? units(Math.round(missing.water), 'water') : ''].filter(Boolean).join(' and ');
  const ties = await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', a._id))
    .order('desc')
    .take(14);
  const distrusted = ties.filter((t) => t.toAlive && t.kind !== 'family' && t.trust < 0).sort((x, y) => x.trust - y.trust)[0];
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'theft_discovered',
    actorId: a._id,
    participantIds: household.memberIds,
    locationId: a.locationId,
    summary:
      a.name + ' found ' + household.name + (household.name.endsWith('s') ? "' pantry " : "'s pantry ") + what + ' short.' +
      (distrusted ? ' ' + firstName(a.name) + ' is sure it was ' + distrusted.toName + ', whom ' + firstName(a.name) + ' has never trusted.' : ' Someone has been in their stores.'),
    salience: 0.55,
    causationEventId: missing.eventId,
  });
  const sim = await simState(tx);
  sim.cases.push({ eventId, locationId: a.locationId, tick: tx.tick });
  a.mood = 'suspicious';
  if (!distrusted) return;
  await learnBelief(tx, a, {
    kind: 'thief',
    text: distrusted.toName + ' has been stealing from our pantry.',
    valence: -1,
    confidence: 0.35 + 0.3 * a.traits.stubbornness,
    sourceType: 'inference',
    subjectAgentId: distrusted.toAgentId,
    subjectName: distrusted.toName,
    originEventId: eventId,
  });
}

// ---------- rations and the market ----------

async function ration(tx: Tx, a: AgentDoc): Promise<number> {
  if (a.locationId !== 'depot') return fail(tx, a, 'Not at the Supply Depot to collect a ration');
  const household = await loadHousehold(tx, a.householdId);
  if (!household) return fail(tx, a, 'Has no household ration card');
  const day = Math.floor(tx.tick / 144);
  if (household.rationDay > day) return fail(tx, a, 'Already collected today\'s ration for ' + household.name);
  const level = clamp(tx.world.econ.rationLevel, 0, 2);
  const members = household.memberIds.length;
  const got = { food: 0, water: 0 };
  const due = { food: 0, water: 0 };
  for (const res of ['food', 'water'] as const) {
    const cap = members * RATIONS[0][res] * PANTRY_DAYS;
    due[res] = Math.round(members * RATIONS[level][res]);
    const n = Math.max(0, Math.min(due[res], Math.floor(cap - household.pantry[res]), Math.floor(stock(tx.world, 'depot', res))));
    got[res] = n;
    household.pantry[res] = round2(household.pantry[res] + n);
    addStock(tx.world, 'depot', res, -n);
  }
  household.rationDay = day + 1;
  touchHousehold(tx, household);
  const label = 'Collecting the ' + household.name.replace(/^The /, '') + ' ration at the Supply Depot';
  act(tx, a, 'trading', label);
  const depotShort = (res: 'food' | 'water') => got[res] < due[res] && stock(tx.world, 'depot', res) < 1;
  if (depotShort('water') || depotShort('food')) {
    a.mood = 'angry';
    await emitEvent(tx, {
      category: 'economy',
      eventType: 'ration_shortfall',
      actorId: a._id,
      locationId: 'depot',
      summary: a.name + ' queued at the Supply Depot and came away with ' + got.water + ' of ' + due.water + ' water and ' + got.food + ' of ' + due.food + ' food for ' + household.name + '.',
      salience: 0.55,
      causationEventId: scarcityCause(tx.world, depotShort('water') ? 'water' : 'food'),
      witnesses: 'location',
    });
  }
  return 2;
}

/** A seller's price, and what it feels like to this buyer given how they get on. */
type Offer = { seller: AgentDoc | null; price: number; felt: number };

async function buy(tx: Tx, a: AgentDoc, res: string, qty: number): Promise<number> {
  if (a.locationId !== 'market') return fail(tx, a, 'Not at the Exchange to buy anything');
  if (!isTraded(res)) return fail(tx, a, 'Nobody sells ' + res + ' at the Exchange');
  const market = tx.world.prices[res];
  const offers: Offer[] = [];
  for (const id of await agentsAt(tx, 'market', { exclude: [a._id] })) {
    const b = await loadAgent(tx, id);
    if (!b || b.occupation !== 'trader' || b.inv[res] < 1) continue;
    const affinity = (await tie(tx, a._id, b._id))?.affinity ?? 0;
    // People pay a little more to buy from someone they like, and walk past someone they despise.
    if (affinity <= -0.5) continue;
    const price = Math.round(market * (1 + (b.markup ?? 0.2)) * 10) / 10;
    offers.push({ seller: b, price, felt: price * (1 - affinity * 0.25) });
  }
  if (stock(tx.world, 'depot', res) - RESERVE_FLOOR[res] >= 1) {
    const price = Math.round(market * 1.15 * 10) / 10;
    offers.push({ seller: null, price, felt: price });
  }
  if (offers.length === 0) return fail(tx, a, 'Nobody at the Exchange had ' + res + ' to sell');
  offers.sort((x, y) => x.felt - y.felt);
  const { seller, price } = offers[0];
  const available = seller ? seller.inv[res] : stock(tx.world, 'depot', res) - RESERVE_FLOOR[res];
  const n = Math.min(qty, Math.floor(available), Math.floor(a.inv.credits / price));
  if (n <= 0) return fail(tx, a, 'Could not afford ' + res + ' at ' + price + ' credits');
  const total = Math.ceil(n * price);
  a.inv.credits = round2(a.inv.credits - total);
  a.inv[res] += n;
  if (seller) {
    seller.inv[res] -= n;
    seller.inv.credits = round2(seller.inv.credits + total);
    touch(tx, seller);
  } else {
    addStock(tx.world, 'depot', res, -n);
    tx.world.econ.treasury = round2(tx.world.econ.treasury + total);
  }
  const from = seller ? seller.name : 'the Exchange counter';
  const steep = price >= BASE_PRICES[res] * 1.8;
  act(tx, a, 'trading', 'Buying ' + units(n, res) + ' from ' + from, seller?._id, steep ? total + ' credits? Fine. Fine.' : undefined);
  const disputed = !!seller && price >= market * 1.25 && steep && a.traits.stubbornness > 0.5 && roll(tx, a, 'dispute') < 0.6;
  if (disputed && seller) {
    a.speech = total + ' credits for ' + res + '? You are bleeding us dry, ' + firstName(seller.name) + '.';
    say(tx, seller, a._id, 'Then go thirsty. Price is the price.');
    a.mood = 'angry';
    await adjustRelationship(tx, a, seller, { affinity: -0.15, trust: -0.1 });
    const { eventId } = await emitEvent(tx, {
      category: 'economy',
      eventType: 'trade_dispute',
      actorId: a._id,
      participantIds: [seller._id],
      locationId: 'market',
      summary: a.name + ' argued with ' + seller.name + ' over ' + price + ' credits a unit for ' + res + ', paid it anyway, and stormed off.',
      salience: 0.45,
      causationEventId: scarcityCause(tx.world, res),
      witnesses: 'location',
    });
    await learnBelief(tx, a, {
      kind: 'untrustworthy',
      text: seller.name + ' overcharges whenever supplies run short.',
      valence: -1,
      confidence: 0.6,
      sourceType: 'observed',
      subjectAgentId: seller._id,
      subjectName: seller.name,
      originEventId: eventId,
      truthEventId: eventId,
    });
    return 1;
  }
  if (seller) {
    say(tx, seller, a._id, steep ? 'Scarce times, friend.' : 'Pleasure doing business.');
    await adjustRelationship(tx, a, seller, { affinity: steep ? -0.03 : 0.02 });
  }
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'trade',
    actorId: a._id,
    participantIds: seller ? [seller._id] : [],
    locationId: 'market',
    summary: a.name + ' bought ' + units(n, res) + ' from ' + from + ' for ' + total + ' credits' + (steep ? ', more than double the usual price.' : '.'),
    salience: steep ? 0.35 : 0.15,
    causationEventId: steep ? scarcityCause(tx.world, res) : undefined,
  });
  return 1;
}

async function sell(tx: Tx, a: AgentDoc, res: string, qty: number): Promise<number> {
  if (a.locationId !== 'market') return fail(tx, a, 'Not at the Exchange to sell anything');
  if (!isTraded(res)) return fail(tx, a, 'Nobody buys ' + res + ' at the Exchange');
  const n = Math.min(qty, Math.floor(a.inv[res]));
  if (n <= 0) return fail(tx, a, 'Had no ' + res + ' left to sell');
  const market = tx.world.prices[res];
  let buyer: AgentDoc | null = null;
  for (const id of await agentsAt(tx, 'market', { exclude: [a._id] })) {
    const b = await loadAgent(tx, id);
    if (b && b.occupation === 'trader' && b.inv.credits >= n * market * 0.8) {
      buyer = b;
      break;
    }
  }
  const total = Math.floor(n * market * (buyer ? 0.8 : 0.7));
  a.inv[res] -= n;
  a.inv.credits = round2(a.inv.credits + total);
  if (buyer) {
    buyer.inv[res] += n;
    buyer.inv.credits = round2(buyer.inv.credits - total);
    say(tx, buyer, a._id, 'I can move that. ' + total + ' credits.');
  } else {
    addStock(tx.world, 'depot', res, n);
    tx.world.econ.treasury = round2(tx.world.econ.treasury - total);
  }
  act(tx, a, 'trading', 'Selling ' + units(n, res) + ' to ' + (buyer ? buyer.name : 'the Exchange counter'), buyer?._id);
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'trade',
    actorId: a._id,
    participantIds: buyer ? [buyer._id] : [],
    locationId: 'market',
    summary: a.name + ' sold ' + units(n, res) + ' to ' + (buyer ? buyer.name : 'the Exchange counter') + ' for ' + total + ' credits.',
    salience: 0.15,
  });
  return 1;
}

// ---------- talk ----------

/** Picks someone to talk to here: a friend if one is around, else whoever is closest to hand. */
async function partnerHere(tx: Tx, a: AgentDoc): Promise<AgentDoc | null> {
  const here = await agentsAt(tx, a.locationId, { exclude: [a._id] });
  if (here.length === 0) return null;
  const ties = await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', a._id))
    .order('desc')
    .take(16);
  const present = new Set<string>(here);
  const friend = ties.find((t) => present.has(t.toAgentId) && t.affinity > 0.1);
  const id = friend ? friend.toAgentId : here[Math.floor(roll(tx, a, 'partner') * here.length)];
  return await presentWith(tx, a, id);
}

async function talk(tx: Tx, a: AgentDoc, who: string | undefined, topic: string | undefined): Promise<number> {
  const b = who === 'any' || !who ? await partnerHere(tx, a) : await presentWith(tx, a, who);
  if (!b) {
    const namedId = who && who !== 'any' ? tx.ctx.db.normalizeId('agents', who) : null;
    const named = namedId ? await loadAgent(tx, namedId) : null;
    return fail(tx, a, named ? 'Looked for ' + named.name + ' at ' + locName(a.locationId) + ' but they were not there' : 'Found nobody to talk to at ' + locName(a.locationId));
  }
  a.needs.social = Math.max(0, a.needs.social - 28);
  b.needs.social = Math.max(0, b.needs.social - 15);
  const r = roll(tx, a, 'talk');
  if (topic?.startsWith('ask:')) return ask(tx, a, b, topic.slice(4));
  if (topic === 'campaign') return campaign(tx, a, b);
  if (topic === 'join') return join(tx, a, b);
  const before = await tie(tx, a._id, b._id);
  const warmth = 0.03 + 0.04 * a.traits.sociability;
  const after = await adjustRelationship(tx, a, b, { affinity: warmth, trust: 0.01 });
  const fromB = await adjustRelationship(tx, b, a, { affinity: 0.02 + 0.03 * b.traits.sociability });

  const key = topic && topic !== 'any' ? topic : chooseTopic(tx, a, b);
  const belief = key ? await getBelief(tx, a._id, key) : null;
  const shareable = belief && effectiveConfidence(belief, tx.tick) >= 0.3 && belief.subjectAgentId !== b._id && (!belief.private || (before?.affinity ?? 0) >= 0.5);
  if (belief && shareable) {
    const outcome = await spreadBelief(tx, a, b, belief);
    const line = beliefLine(belief.kind, belief.text, belief.subjectName, r);
    const answer = outcome.kind === 'defended' ? 'defend' : outcome.kind === 'doubted' ? 'doubt' : 'agree';
    act(tx, a, 'talking', 'Telling ' + b.name + ' what they heard' + (belief.subjectName ? ' about ' + belief.subjectName : ''), b._id, line);
    say(tx, b, a._id, reply(answer, belief.subjectName, r));
    const aboutPerson = !!belief.subjectAgentId;
    if (outcome.kind === 'defended') {
      // The first time it is a defence; the time it tips into dislike it is a falling-out; in between it is old news.
      const now = (await tie(tx, b._id, a._id))?.affinity ?? 0;
      const fallingOut = fromB.affinity > -0.25 && now <= -0.25;
      await emitEvent(tx, {
        category: 'social',
        eventType: fallingOut ? 'falling_out' : 'rumor_rejected',
        actorId: b._id,
        participantIds: [a._id, belief.subjectAgentId!],
        locationId: a.locationId,
        summary: fallingOut
          ? b.name + ' has had enough of ' + a.name + ' running down ' + belief.subjectName + '. The two of them are barely speaking.'
          : b.name + ' stood up for ' + belief.subjectName + ' when ' + a.name + ' repeated that "' + belief.text + '"',
        salience: fallingOut ? 0.55 : fromB.affinity < 0 ? 0.25 : 0.4,
        causationEventId: belief.originEventId,
      });
    } else if (aboutPerson || outcome.kind === 'learned') {
      const fresh = outcome.kind === 'learned' && outcome.created;
      await emitEvent(tx, {
        category: 'social',
        eventType: aboutPerson ? 'rumor_spread' : 'conversation',
        actorId: a._id,
        participantIds: [b._id, ...(belief.subjectAgentId ? [belief.subjectAgentId] : [])],
        locationId: a.locationId,
        summary: a.name + ' told ' + b.name + ': "' + belief.text + '"' + (outcome.kind === 'doubted' ? ' ' + firstName(b.name) + ' did not buy it.' : ''),
        salience: !aboutPerson || !fresh ? 0.15 : belief.valence > 0 ? 0.22 : belief.originEventId && belief.hops === 0 ? 0.45 : belief.originEventId ? 0.32 : 0.22,
        causationEventId: belief.originEventId,
        facts: { beliefKey: belief.key, hops: belief.hops + 1 },
      });
      if (fresh && aboutPerson && belief.hops <= 1 && belief.valence < 0) {
        await enqueueCognition(tx, a, { kind: 'speech', trigger: 'telling ' + b.name + ' that ' + belief.text, priority: 0.3, lane: 'normal', eventId: belief.originEventId });
      }
    }
  } else {
    act(tx, a, 'talking', 'Chatting with ' + b.name, b._id, smallTalk(r));
    say(tx, b, a._id, reply('small', undefined, r));
    await emitEvent(tx, {
      category: 'social',
      eventType: 'conversation',
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: a.name + ' and ' + b.name + ' talked at ' + locName(a.locationId) + '.',
      salience: 0.1,
    });
  }
  if (after.kind === 'friend' && before?.kind !== 'friend' && before?.kind !== 'family') {
    await emitEvent(tx, {
      category: 'social',
      eventType: 'friendship',
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: a.name + ' and ' + b.name + ' have become friends, one conversation at ' + locName(a.locationId) + ' at a time.',
      salience: 0.38,
    });
  }
  return 2;
}

/** Picks a conversation topic from what the speaker has on their mind, weighted by how much it matters to them. */
function chooseTopic(tx: Tx, a: AgentDoc, b: AgentDoc): string | undefined {
  const topics = a.topics.filter((k) => !k.endsWith(':' + b._id));
  if (topics.length === 0 || roll(tx, a, 'topic?') > 0.35 + a.traits.sociability * 0.5) return undefined;
  return topics[Math.floor(roll(tx, a, 'topic') * topics.length * 0.999) % topics.length];
}

async function ask(tx: Tx, a: AgentDoc, b: AgentDoc, res: string): Promise<number> {
  if (res !== 'food' && res !== 'water') return fail(tx, a, 'Asked ' + b.name + ' for something nobody has');
  const r = await tie(tx, b._id, a._id);
  const willing = (r?.affinity ?? 0) * 0.6 + b.traits.empathy * 0.5 + (r?.obligation ?? 0) * 0.3 > 0.45;
  const spare = b.inv[res] >= 2 ? Math.min(2, Math.floor(b.inv[res] / 2)) : 0;
  if (willing && spare > 0) {
    act(tx, a, 'talking', 'Asking ' + b.name + ' for ' + res, b._id, 'Could you spare some ' + res + '? I am all out.');
    return transfer(tx, b, a, res, spare, 'Here. Do not tell anyone.');
  }
  act(tx, a, 'talking', 'Asking ' + b.name + ' for ' + res, b._id, 'Could you spare some ' + res + '?');
  say(tx, b, a._id, spare > 0 ? 'Sorry. I need it myself.' : 'I have nothing to give.');
  await adjustRelationship(tx, a, b, { affinity: spare > 0 ? -0.06 : 0 });
  return 1;
}

/** The speaker argues their politics and asks for support. Persuasive people win friends doing it. */
async function campaign(tx: Tx, a: AgentDoc, b: AgentDoc): Promise<number> {
  const mind = await loadMind(tx, a);
  const persuasion = (mind?.skills.persuasion ?? 40) / 100;
  const factions = await loadFactions(tx);
  const stance = factions.find((f) => f.key === a.factionId)?.stance;
  const key = stance === 'guard' ? 'policy_guard' : stance === 'open' ? 'policy_open' : undefined;
  const belief = key ? await getBelief(tx, a._id, key) : null;
  const sameSide = !!a.factionId && a.factionId === b.factionId;
  const won = persuasion * 0.6 + (sameSide ? 0.3 : 0) + roll(tx, a, 'campaign') * 0.3 > 0.55;
  await adjustRelationship(tx, b, a, { affinity: won ? 0.06 + persuasion * 0.06 : -0.03, trust: won ? 0.05 : 0 });
  if (belief && won) await spreadBelief(tx, a, b, belief);
  const line = stance === 'open' ? 'Full rations for the people who fill the depot. Stand with me.' : stance === 'guard' ? 'Somebody has to keep the reserve safe. I will.' : 'Get the council out of the market and we all do better.';
  act(tx, a, 'talking', 'Canvassing ' + b.name + ' for support', b._id, line);
  say(tx, b, a._id, won ? 'You have my vote.' : 'We will see.');
  return 2;
}

async function join(tx: Tx, a: AgentDoc, leader: AgentDoc): Promise<number> {
  const factions = await loadFactions(tx);
  const faction = factions.find((f) => f.leaderAgentId === leader._id);
  if (!faction || a.factionId === faction.key) return fail(tx, a, leader.name + ' had no faction to offer');
  const r = await tie(tx, leader._id, a._id);
  if ((r?.affinity ?? 0) < 0) {
    act(tx, a, 'talking', 'Asking to join the ' + faction.name, leader._id, 'I want in.');
    say(tx, leader, a._id, 'Not you. Not yet.');
    return 2;
  }
  const old = factions.find((f) => f.key === a.factionId);
  if (old) {
    old.memberCount = Math.max(0, old.memberCount - 1);
    touchFaction(tx, old);
  }
  a.factionId = faction.key;
  faction.memberCount += 1;
  touchFaction(tx, faction);
  await adjustRelationship(tx, a, leader, { affinity: 0.1, trust: 0.1 });
  act(tx, a, 'talking', 'Joining the ' + faction.name, leader._id, 'Count me in.');
  say(tx, leader, a._id, 'Welcome. We look after our own.');
  await emitEvent(tx, {
    category: 'politics',
    eventType: 'faction_join',
    actorId: a._id,
    participantIds: [leader._id],
    locationId: a.locationId,
    summary: a.name + ' joined the ' + faction.name + (old ? ', leaving the ' + old.name : '') + ', with ' + leader.name + "'s blessing.",
    salience: old ? 0.6 : 0.45,
  });
  return 2;
}

// ---------- giving, helping, stealing ----------

async function transfer(tx: Tx, from: AgentDoc, to: AgentDoc, res: Res, n: number, line: string): Promise<number> {
  from.inv[res] = round2(from.inv[res] - n);
  to.inv[res] = round2(to.inv[res] + n);
  const needy = (res === 'water' && to.needs.thirst >= 65) || (res === 'food' && to.needs.hunger >= 65);
  await adjustRelationship(tx, to, from, { affinity: needy ? 0.18 : 0.1, trust: 0.08, obligation: 0.2 });
  await adjustRelationship(tx, from, to, { affinity: 0.04 });
  say(tx, from, to._id, line);
  touch(tx, to);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'gift',
    actorId: from._id,
    participantIds: [to._id],
    locationId: from.locationId,
    summary: from.name + ' gave ' + units(n, res) + ' to ' + to.name + (needy ? ', who badly needed it.' : '.'),
    salience: needy ? 0.42 : 0.25,
    causationEventId: needy ? scarcityCause(tx.world, res) : undefined,
  });
  if (needy) {
    await learnBelief(tx, to, {
      kind: 'hero',
      text: from.name + ' shares what they have with people in need.',
      valence: 1,
      confidence: 0.7,
      sourceType: 'observed',
      subjectAgentId: from._id,
      subjectName: from.name,
      originEventId: eventId,
      truthEventId: eventId,
    });
  }
  return 1;
}

async function give(tx: Tx, a: AgentDoc, who: string, res: string, qty: number): Promise<number> {
  const b = await presentWith(tx, a, who);
  if (!b) return fail(tx, a, 'Wanted to give something to someone who was not there');
  if (!isRes(res)) return fail(tx, a, 'Had nothing like that to give');
  const n = Math.min(qty, Math.floor(a.inv[res]));
  if (n <= 0) return fail(tx, a, 'Had no ' + res + ' left to give ' + b.name);
  act(tx, a, 'giving', 'Giving ' + units(n, res) + ' to ' + b.name, b._id);
  return transfer(tx, a, b, res, n, res === 'credits' ? 'Take it. Pay me back when you can.' : 'Here. You need it more than I do.');
}

async function help(tx: Tx, a: AgentDoc, who: string): Promise<number> {
  const b = await presentWith(tx, a, who);
  if (!b) return fail(tx, a, 'Came to help someone who was not there');
  if (a.occupation === 'medic' && b.health < 90) {
    const from = a.locationId === 'medbay' && stock(tx.world, 'medbay', 'medicine') >= 1 ? 'medbay' : a.inv.medicine >= 1 ? 'own' : null;
    if (!from) return fail(tx, a, 'Had no medicine left to treat ' + b.name);
    act(tx, a, 'helping', 'Treating ' + b.name, b._id, 'Hold still. This will sting.');
    await treat(tx, a, b, from);
    return 3;
  }
  const res: Res = b.needs.thirst >= b.needs.hunger ? 'water' : 'food';
  if (a.inv[res] < 1) return fail(tx, a, 'Had nothing to share with ' + b.name);
  act(tx, a, 'helping', 'Helping ' + b.name, b._id);
  return transfer(tx, a, b, res, 1, 'Drink. Slowly.');
}

async function steal(tx: Tx, a: AgentDoc, target: string, res: string, qty: number): Promise<number> {
  if (!isRes(res)) return fail(tx, a, 'Found nothing worth taking');
  let victim: AgentDoc | null = null;
  let household: HouseholdDoc | null = null;
  let where: string;
  let available: number;
  if (target === 'depot') {
    if (a.locationId !== 'depot' || res === 'credits') return fail(tx, a, 'Could not get at the depot stores');
    where = 'the Supply Depot';
    available = stock(tx.world, 'depot', res);
  } else if (target.startsWith('pantry:')) {
    const id = tx.ctx.db.normalizeId('households', target.slice(7));
    household = id ? await loadHousehold(tx, id) : null;
    if (!household || a.locationId !== household.homeLocationId || (res !== 'food' && res !== 'water')) return fail(tx, a, 'Could not get into that pantry');
    where = household.name + (household.name.endsWith('s') ? "' pantry" : "'s pantry");
    available = household.pantry[res];
  } else {
    victim = await presentWith(tx, a, target);
    if (!victim) return fail(tx, a, 'Lost sight of the mark');
    where = victim.name;
    available = victim.inv[res];
  }
  const n = Math.min(qty, Math.floor(available));
  if (n <= 0) return fail(tx, a, 'Found nothing to take from ' + where);

  const seen: AgentDoc[] = [];
  for (const id of (await agentsAt(tx, a.locationId, { exclude: [a._id] })).slice(0, 10)) {
    const w = await loadAgent(tx, id);
    if (!w) continue;
    const onDuty = SECURITY.has(w.occupation) && w.activity === 'working';
    const p = 0.12 + w.traits.caution * 0.25 + (onDuty ? 0.45 : 0) + (w._id === victim?._id ? 0.3 : 0);
    if (rand(tx.world.seed, tx.tick, w.seq, 'notice:' + a.seq) < p) seen.push(w);
  }
  const guard = seen.find((w) => SECURITY.has(w.occupation) && w.activity === 'working');
  const cause = scarcityCause(tx.world, res);
  const mind = await loadMind(tx, a);
  if (mind) {
    mind.thefts += 1;
    touchMind(tx, mind);
  }
  const sim = await simState(tx);
  if (guard && rand(tx.world.seed, tx.tick, guard.seq, 'stop') < 0.6) {
    act(tx, a, 'stealing', 'Caught reaching into ' + where, guard._id, 'I was only looking!');
    say(tx, guard, a._id, 'Put it back, ' + firstName(a.name) + '. Now.');
    a.mood = 'humiliated';
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: 'theft_foiled',
      actorId: a._id,
      participantIds: [guard._id, ...seen.map((w) => w._id)],
      locationId: a.locationId,
      summary: guard.name + ' caught ' + a.name + ' trying to take ' + units(n, res) + ' from ' + where + '.',
      salience: 0.72,
      causationEventId: cause,
      visibility: 'public',
      witnesses: 'location',
    });
    await witnessTheft(tx, a, seen, eventId);
    sim.cases.push({ eventId, suspectId: a._id, locationId: a.locationId, tick: tx.tick });
    return 1;
  }
  if (target === 'depot') addStock(tx.world, 'depot', res, -n);
  else if (household && (res === 'food' || res === 'water')) {
    household.pantry[res] = round2(household.pantry[res] - n);
    touchHousehold(tx, household);
  } else if (victim) {
    victim.inv[res] = round2(victim.inv[res] - n);
    touch(tx, victim);
  }
  a.inv[res] = round2(a.inv[res] + n);
  a.mood = 'anxious';
  act(tx, a, 'stealing', 'Taking ' + units(n, res) + ' from ' + where, victim?._id);
  const names = seen.map((w) => w.name);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'theft',
    actorId: a._id,
    participantIds: [...(victim ? [victim._id] : []), ...seen.map((w) => w._id)],
    locationId: a.locationId,
    summary:
      a.name + ' stole ' + units(n, res) + ' from ' + where + '.' +
      (names.length === 0 ? ' Nobody saw.' : ' ' + (names.length === 1 ? names[0] + ' saw it happen.' : names.slice(0, 2).join(' and ') + ' saw it happen.')),
    salience: names.length > 0 ? 0.72 : 0.55,
    causationEventId: cause,
    visibility: names.length > 0 ? 'public' : 'private',
  });
  if (seen.length > 0) {
    await witnessTheft(tx, a, seen, eventId);
    sim.cases.push({ eventId, suspectId: a._id, locationId: a.locationId, tick: tx.tick });
  } else if (target === 'depot' && (res === 'food' || res === 'water' || res === 'parts')) {
    sim.missing[res] += n;
    sim.missingEventId = eventId;
  } else if (household) {
    household.missing = { food: (household.missing?.food ?? 0) + (res === 'food' ? n : 0), water: (household.missing?.water ?? 0) + (res === 'water' ? n : 0), eventId };
  }
  return 1;
}

/** Witnesses of a theft know who did it. Guards act on it at once; the bold confront; the rest talk. */
async function witnessTheft(tx: Tx, thief: AgentDoc, seen: AgentDoc[], eventId: EventId): Promise<void> {
  for (const w of seen) {
    const learned = await learnBelief(tx, w, {
      kind: 'thief',
      text: thief.name + ' has been stealing.',
      valence: -1,
      confidence: 0.9,
      sourceType: 'observed',
      subjectAgentId: thief._id,
      subjectName: thief.name,
      originEventId: eventId,
      truthEventId: eventId,
    });
    await adjustRelationship(tx, w, thief, { affinity: -0.15, trust: -0.3 });
    const bold = SECURITY.has(w.occupation) || (w.traits.stubbornness > 0.6 && w.traits.caution < 0.5);
    if (bold) interrupt(tx, w, [encodeStep('accuse', thief._id, learned.key)]);
  }
}

// ---------- investigation and accusation ----------

/** The belief about subject that the investigator most wants settled. */
async function suspicionAbout(tx: Tx, a: AgentDoc, subjectId: string) {
  const held = await beliefsOf(tx, a._id);
  return held
    .filter((b) => b.subjectAgentId === subjectId && b.valence < 0 && ACCUSABLE.has(b.kind))
    .sort((x, y) => y.confidence - x.confidence)[0];
}

async function investigateStart(tx: Tx, a: AgentDoc, who: string): Promise<number> {
  const id = tx.ctx.db.normalizeId('agents', who);
  const b = id ? await loadAgent(tx, id) : null;
  if (!b || !b.alive || b._id === a._id) return fail(tx, a, 'Had nobody to look into');
  act(tx, a, 'investigating', 'Asking around about ' + b.name + ' at ' + locName(a.locationId));
  return 4;
}

async function investigateDone(tx: Tx, a: AgentDoc, who: string): Promise<void> {
  const id = tx.ctx.db.normalizeId('agents', who);
  const b = id ? await loadAgent(tx, id) : null;
  if (!b || !b.alive) return;
  const belief = await suspicionAbout(tx, a, b._id);
  const sim = await simState(tx);
  const openCase = sim.cases.find((c) => c.suspectId === b._id) ?? sim.cases.find((c) => !c.suspectId);
  const kind = belief?.kind ?? (openCase ? 'thief' : undefined);
  if (!kind) return;
  const { truth, detail, settled } = await truthAbout(tx, kind, b);
  const cause = belief ? belief.originEventId : openCase?.eventId;
  const what = kindPhrase(kind);
  if (belief && (truth !== true || settled)) await markActed(tx, belief);
  if (truth === null || settled) {
    await emitEvent(tx, {
      category: 'social',
      eventType: 'investigation',
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: settled ? a.name + ' asked around about ' + b.name + ' and heard ' + detail + '.' : a.name + ' asked around about ' + b.name + ' but learned nothing certain.',
      salience: settled ? 0.35 : 0.25,
      causationEventId: cause,
    });
    return;
  }
  if (truth) {
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: 'investigation',
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: a.name + ' found proof that ' + b.name + ' ' + what + ': ' + detail + '.',
      salience: 0.72,
      causationEventId: cause,
      visibility: 'public',
    });
    const proven = b.name + ' ' + what + ': ' + detail + '.';
    if (belief) await tx.ctx.db.patch(belief._id, { text: proven });
    const learned = await learnBelief(tx, a, {
      kind,
      text: proven,
      valence: -1,
      confidence: 0.95,
      sourceType: 'observed',
      subjectAgentId: b._id,
      subjectName: b.name,
      originEventId: belief?.originEventId ?? eventId,
      truthEventId: eventId,
    });
    a.mood = 'suspicious';
    if (a.occupation === 'security' || a.traits.stubbornness > 0.55) {
      a.q = [encodeStep('go', b.locationId), encodeStep('accuse', b._id, learned.key), ...a.q].slice(0, 24);
    }
    return;
  }
  const source = belief?.sourceAgentId ? await loadAgent(tx, belief.sourceAgentId) : null;
  if (belief) await tx.ctx.db.patch(belief._id, { confidence: round2(belief.confidence * 0.25) });
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'investigation',
    actorId: a._id,
    participantIds: [b._id, ...(source ? [source._id] : [])],
    locationId: a.locationId,
    summary:
      a.name + ' looked into whether ' + b.name + ' ' + what + ' and found ' + detail + '.' +
      (source ? ' ' + firstName(a.name) + ' no longer trusts ' + source.name + ', who passed the story on.' : ''),
    salience: source ? 0.52 : 0.42,
    causationEventId: cause,
    visibility: 'public',
  });
  await learnBelief(tx, a, {
    kind: 'innocent',
    text: 'The story about ' + b.name + ' is not true.',
    valence: 0.6,
    confidence: 0.85,
    sourceType: 'observed',
    subjectAgentId: b._id,
    subjectName: b.name,
    originEventId: belief?.originEventId,
    truthEventId: eventId,
  });
  if (source) await adjustRelationship(tx, a, source, { trust: -0.3, affinity: -0.1 });
}

const kindPhrase = (kind: string): string =>
  ({ thief: 'has been stealing', hoarding: 'is hoarding supplies', saboteur: 'sabotaged the drills', corrupt: 'is skimming credits', suspect: 'had a hand in the death', untrustworthy: 'cannot be trusted' })[kind] ?? 'is what people say';

async function accuse(tx: Tx, a: AgentDoc, who: string, key: string | undefined): Promise<number> {
  const b = await presentWith(tx, a, who);
  if (!b) return fail(tx, a, 'Went to confront someone who was not there');
  const belief = key ? await getBelief(tx, a._id, key) : await suspicionAbout(tx, a, b._id);
  if (!belief || belief.subjectAgentId !== b._id) return fail(tx, a, 'Had nothing to accuse ' + b.name + ' of');
  if (belief.acted !== undefined && tx.tick - belief.acted < 12) return 0;
  const { truth, settled } = await truthAbout(tx, belief.kind, b);
  if (settled) {
    await markActed(tx, belief);
    return fail(tx, a, 'Learned that ' + b.name + ' has already answered for it');
  }
  const r = roll(tx, a, 'accuse');
  const factions = await loadFactions(tx);
  const leads = factions.find((f) => f.leaderAgentId === b._id);
  const prominent = !!b.role || !!leads;
  const enforcer = a.occupation === 'security';
  const witnesses = (await agentsAt(tx, a.locationId, { exclude: [a._id, b._id] })).slice(0, 8);
  act(tx, a, 'talking', 'Confronting ' + b.name + ' about ' + (belief.kind === 'hoarding' ? 'the hoarding' : belief.kind === 'thief' ? 'the thefts' : 'what they did'), b._id, accuseLine(belief.kind, b.name, r));
  say(tx, b, a._id, denyLine(truth === true, a.name, r));
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'accusation',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' publicly accused ' + b.name + ' at ' + locName(a.locationId) + ': "' + belief.text + '"',
    salience: 0.62 + (prominent ? 0.13 : 0) + (enforcer ? 0.05 : 0),
    causationEventId: belief.originEventId ?? belief.truthEventId,
    visibility: 'public',
    witnesses,
  });
  await markActed(tx, belief);
  const sim = await simState(tx);
  sim.accused = { ...sim.accused, [b._id]: tx.tick };
  const believers: AgentDoc[] = [];
  for (const id of witnesses) {
    const w = await loadAgent(tx, id);
    if (!w) continue;
    const toB = await tie(tx, w._id, b._id);
    if ((toB?.affinity ?? 0) >= 0.45) {
      await adjustRelationship(tx, w, a, { affinity: -0.1, trust: -0.05 });
      continue;
    }
    const toA = await tie(tx, w._id, a._id);
    const confidence = belief.confidence * trustWeight(toA) * (enforcer ? 1 : 0.75) * (1 - w.traits.caution * 0.3);
    if (confidence < 0.15) continue;
    await learnBelief(tx, w, {
      kind: belief.kind,
      text: belief.text,
      valence: belief.valence,
      confidence,
      sourceType: 'told',
      subjectAgentId: b._id,
      subjectName: b.name,
      sourceAgentId: a._id,
      sourceName: a.name,
      originEventId: belief.originEventId ?? eventId,
      hops: belief.hops + 1,
    });
    believers.push(w);
  }
  await adjustRelationship(tx, b, a, { affinity: truth === true ? -0.2 : -0.35, trust: -0.3 });
  b.mood = truth === true ? 'humiliated' : 'angry';
  a.mood = 'angry';
  touch(tx, b);
  if (enforcer && truth === true && (belief.kind === 'thief' || (belief.kind === 'hoarding' && b.role !== 'quartermaster'))) await arrest(tx, a, b, belief.kind, eventId);
  if (leads) await maybeSplitFaction(tx, b, believers, eventId);
  await enqueueCognition(tx, b, { kind: 'plan', trigger: 'publicly accused by ' + a.name + ': ' + belief.text, priority: 0.7, lane: 'crisis', eventId });
  return 2;
}

/**
 * Security deals with a proven case: a thief is fined and half of what they carry goes back to the
 * depot; a hoarder has most of the stash seized. Either way the case is closed until it happens again.
 */
async function arrest(tx: Tx, officer: AgentDoc, culprit: AgentDoc, kind: string, accusationId: EventId): Promise<void> {
  const hoarding = kind === 'hoarding';
  const fine = hoarding ? 0 : Math.min(Math.floor(culprit.inv.credits), 25);
  culprit.inv.credits = round2(culprit.inv.credits - fine);
  tx.world.econ.treasury = round2(tx.world.econ.treasury + fine);
  const returned = (['water', 'food'] as const).map((res) => {
    const n = Math.floor(culprit.inv[res] * (hoarding ? 0.7 : 0.5));
    culprit.inv[res] -= n;
    addStock(tx.world, 'depot', res, n);
    return n;
  });
  const sim = await simState(tx);
  sim.punished = { ...sim.punished, [culprit._id]: tx.tick };
  if (!hoarding) {
    // Unattributed thefts are put down to the thief who was caught, rightly or not.
    sim.cases = sim.cases.filter((c) => c.suspectId !== undefined && c.suspectId !== culprit._id);
    const mind = await loadMind(tx, culprit);
    if (mind) {
      mind.thefts = 0;
      touchMind(tx, mind);
    }
  }
  culprit.mood = 'humiliated';
  touch(tx, culprit);
  const goods = [returned[0] ? units(returned[0], 'water') : '', returned[1] ? units(returned[1], 'food') : ''].filter(Boolean).join(' and ');
  await emitEvent(tx, {
    category: 'politics',
    eventType: 'arrest',
    actorId: officer._id,
    participantIds: [culprit._id],
    locationId: officer.locationId,
    summary: hoarding
      ? officer.name + ' searched ' + culprit.name + "'s stash and hauled " + (goods || 'what was left') + ' back to the depot for the ration line.'
      : officer.name + ' fined ' + culprit.name + ' ' + fine + ' credits for theft' + (goods ? ' and sent ' + goods + ' back to the depot.' : '.'),
    salience: 0.7,
    causationEventId: accusationId,
    visibility: 'public',
  });
}

// ---------- politics ----------

const PETITIONS: Record<string, { line: string; summary: (name: string, level: number) => string }> = {
  rations_open: {
    line: 'Full rations for the people who fill the depot!',
    summary: (n, level) => n + (level > 0 ? ' stood up in the Commons Plaza and demanded the council restore full rations.' : ' stood up in the Commons Plaza and demanded the council open the depot reserve.'),
  },
  rations_guard: { line: 'Cut the rations now, or we bury people later.', summary: (n) => n + ' urged the council to cut rations before the reserve runs dry.' },
  seat: { line: 'Give me a seat and I will fight for you.', summary: (n) => n + ' asked the council for a seat at the table.' },
  trade: { line: 'Get the council out of the market!', summary: (n) => n + ' demanded the council stop meddling with the Exchange.' },
};

async function petition(tx: Tx, a: AgentDoc, topic: string): Promise<number> {
  if (a.locationId !== 'plaza') return fail(tx, a, 'Not at the Commons Plaza to address the council');
  const spec = PETITIONS[topic];
  if (!spec) return fail(tx, a, 'Had no clear cause to raise with the council');
  const sim = await simState(tx);
  if (sim.petitions.some((p) => p.agentId === a._id && p.topic === topic)) return fail(tx, a, 'Already raised this with the council');
  const cause = topic === 'rations_open' ? tx.world.causes.rations ?? tx.world.causes.drought : topic === 'rations_guard' ? scarcityCause(tx.world, 'water') : undefined;
  const witnesses = (await agentsAt(tx, 'plaza', { exclude: [a._id] })).slice(0, 6);
  const voices = sim.petitions.filter((p) => p.topic === topic).length;
  act(tx, a, 'talking', 'Addressing the council at the Commons Plaza', undefined, spec.line);
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'petition',
    actorId: a._id,
    locationId: 'plaza',
    summary: spec.summary(a.name, tx.world.econ.rationLevel) + (voices > 0 ? ' ' + (voices === 1 ? 'One other has' : voices + ' others have') + ' said the same today.' : ''),
    salience: voices === 0 ? 0.5 : 0.3,
    causationEventId: cause,
    visibility: 'public',
    witnesses,
  });
  sim.petitions.push({ topic, agentId: a._id, tick: tx.tick, eventId });
  if (topic === 'rations_open' || topic === 'rations_guard') {
    const key = topic === 'rations_open' ? 'policy_open' : 'policy_guard';
    for (const id of witnesses.slice(0, 4)) {
      const w = await loadAgent(tx, id);
      if (!w) continue;
      const toA = await tie(tx, w._id, a._id);
      if (trustWeight(toA) < 0.5) continue;
      await learnBelief(tx, w, {
        kind: key,
        worldKey: key,
        text: key === 'policy_open' ? 'The depot reserve should be opened to the people who fill it.' : 'The depot reserve must be kept back for hard times.',
        valence: 0,
        confidence: 0.3 + 0.3 * trustWeight(toA),
        sourceType: 'told',
        sourceAgentId: a._id,
        sourceName: a.name,
        originEventId: eventId,
        hops: 1,
      });
    }
  }
  return 3;
}

// ---------- repair and grief ----------

async function repairStart(tx: Tx, a: AgentDoc, loc: string): Promise<number> {
  if (!isLocation(loc) || a.locationId !== loc) return fail(tx, a, 'Not at ' + locName(loc) + ' to repair it');
  const damage = tx.world.damage[loc] ?? 0;
  if (damage <= 0.005) return fail(tx, a, locName(loc) + ' needs no repairs');
  if (stormAt(tx.world, loc) > 0) return fail(tx, a, 'Cannot repair ' + locName(loc) + ' while the storm is still on it');
  if (stock(tx.world, 'depot', 'parts') < 2) return fail(tx, a, 'No spare parts in the depot to fix ' + locName(loc));
  addStock(tx.world, 'depot', 'parts', -2);
  act(tx, a, 'working', 'Repairing ' + locName(loc) + ' (' + Math.round(damage * 100) + '% damaged)');
  return 6;
}

async function repairDone(tx: Tx, a: AgentDoc, loc: string, ticks: number): Promise<void> {
  const before = tx.world.damage[loc] ?? 0;
  if (before <= 0) return;
  const engineer = a.occupation === 'fabricator' || a.occupation === 'solar_tech';
  const after = Math.max(0, before - ((0.05 * ticks) / 6) * (engineer ? 1.6 : 0.8) * (0.5 + a.skill / 100));
  if (after <= 0.01) {
    delete tx.world.damage[loc];
    await emitEvent(tx, {
      category: 'action',
      eventType: 'repaired',
      actorId: a._id,
      locationId: loc,
      summary: a.name + ' finished repairs at ' + locName(loc) + '. It is running at full strength again.',
      salience: 0.55,
      causationEventId: tx.world.causes.storm,
      witnesses: 'location',
    });
    a.mood = 'proud';
  } else tx.world.damage[loc] = round2(after);
}

async function mourn(tx: Tx, a: AgentDoc, who: string): Promise<number> {
  const id = tx.ctx.db.normalizeId('agents', who);
  const dead = id ? await loadAgent(tx, id) : null;
  if (!dead) return 0;
  a.mood = 'grieving';
  act(tx, a, 'mourning', 'Mourning ' + dead.name);
  await emitEvent(tx, {
    category: 'social',
    eventType: 'grief',
    actorId: a._id,
    participantIds: [dead._id],
    locationId: a.locationId,
    summary: a.name + ' is mourning ' + dead.name + ' at ' + locName(a.locationId) + '.',
    salience: 0.35,
  });
  return 6;
}

/** True when the step would consume or fetch the resource, so a crisis does not need a new plan. */
export function addressesNeed(steps: string[], res: 'food' | 'water'): boolean {
  const verb = res === 'food' ? 'eat' : 'drink';
  return steps.some(
    (s) => s === verb || s === 'ration' || s.startsWith('buy|' + res) || (s.startsWith('steal|') && s.includes('|' + res + '|')) || (s.startsWith('talk|') && s.endsWith('ask:' + res)),
  );
}

