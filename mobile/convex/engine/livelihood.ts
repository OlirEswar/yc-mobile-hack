/**
 * Ways to get by beyond a wage and a ration: a private grow rack, scavenging the surface, begging,
 * borrowing and paying back, bartering, the black market at the Landing Pad, and a hidden stash.
 * Each is resolved against real stock, skill, trust and witnesses.
 */
import { LOCATIONS } from '../../shared/colony';
import { BASE_PRICES } from '../lib/constants';
import { pick, rand, round1, round2 } from '../lib/rng';
import { FAILED, act, fail, isRes, isTraded, roll, say, units } from './act';
import type { Res } from './act';
import { droughtSeverity, firstName, isLocation, locName, scarcityCause, stormAt } from './conditions';
import { adjustRelationship, agentsAt, emitEvent, killAgent, learnBelief, loadAgent, loadHousehold, loadMind, touch, touchHousehold, touchMind } from './core';
import type { AgentDoc, Tx } from './core';
import { addDebt, addDeed, debtsTo, ledgerOf } from './ledger';
import { partyFor } from './people';
import { getBelief, tie } from './social';
import { line } from './text';

const value = (tx: Tx, res: Res): number => (res === 'credits' ? 1 : tx.world.prices[res]);
const pressing = (b: AgentDoc, res: Res): number => (res === 'food' ? b.needs.hunger : res === 'water' ? b.needs.thirst : 0);
const dayLabel = (tick: number): string => 'Sol ' + (Math.floor(tick / 144) + 1);

// ---------- grow ----------

/** A private rack under a bunk or in a corner of the bays: one water in, a little food out over a session. */
export async function growStart(tx: Tx, a: AgentDoc, ticks: number): Promise<number> {
  const atHome = a.locationId === a.homeLocationId;
  if (!atHome && a.locationId !== 'hydroponics') return fail(tx, a, 'No grow rack to tend at ' + locName(a.locationId));
  if (a.inv.water >= 1) a.inv.water -= 1;
  else {
    const household = atHome ? await loadHousehold(tx, a.householdId) : null;
    if (!household || household.pantry.water < 1) return fail(tx, a, 'No water to spare for the grow rack');
    household.pantry.water = round2(household.pantry.water - 1);
    touchHousehold(tx, household);
  }
  const crop = pick(['beans', 'lettuce', 'potatoes', 'kale', 'peppers', 'herbs'], roll(tx, a, 'crop'));
  act(tx, a, 'working', atHome ? 'Tending a rack of ' + crop + ' at home in ' + locName(a.locationId) : 'Tending a private tray of ' + crop + ' at the Hydroponics Bays');
  return ticks;
}

export async function growDone(tx: Tx, a: AgentDoc, elapsed: number): Promise<void> {
  const mind = await loadMind(tx, a);
  const farming = mind?.skills.farming ?? 15;
  const food = round1((elapsed / 12) * (0.7 + farming / 100) * (a.locationId === 'hydroponics' ? 1.2 : 1));
  a.inv.food = round2(a.inv.food + food);
  if (mind) {
    mind.skills.farming = Math.min(100, farming + 0.3);
    touchMind(tx, mind);
  }
  touch(tx, a);
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'harvest',
    actorId: a._id,
    locationId: a.locationId,
    summary: a.name + ' picked ' + food + ' food off ' + (a.locationId === 'hydroponics' ? 'a private tray at the Hydroponics Bays' : 'the rack in ' + locName(a.locationId)) + (droughtSeverity(tx.world) > 0 ? ', fed with water most people are hoarding.' : '.'),
    salience: droughtSeverity(tx.world) > 0 ? 0.3 : 0.18,
  });
}

// ---------- scavenge ----------

const FINDS = [
  { what: 'a sealed Artemis-Meridian cargo pod, still stamped with the consortium logo', parts: 4, medicine: 2, credits: 0, story: true },
  { what: 'a dead miner\'s helmet tag from the Long Dark, half buried in the regolith', parts: 1, medicine: 0, credits: 0, story: true },
  { what: 'a lost credit chit worth more than a month of wages', parts: 0, medicine: 0, credits: 40, story: true },
  { what: 'a crate of medical kits that fell off an old shuttle', parts: 0, medicine: 3, credits: 0, story: true },
];

export async function scavengeStart(tx: Tx, a: AgentDoc, loc: string): Promise<number> {
  if (!isLocation(loc) || !LOCATIONS[loc].exposed) return fail(tx, a, 'There is nothing to scavenge at ' + locName(loc));
  if (a.locationId !== loc) return fail(tx, a, 'Not out at ' + locName(loc) + ' to scavenge');
  act(tx, a, 'investigating', 'Picking through the debris at ' + locName(loc) + (stormAt(tx.world, loc) > 0 ? ' with rocks falling' : ''));
  return 4;
}

export async function scavengeDone(tx: Tx, a: AgentDoc, loc: string): Promise<void> {
  const storm = stormAt(tx.world, loc);
  const risk = 0.02 + storm * 0.5 + (1 - a.traits.caution) * 0.04 + (tx.world.damage[loc] ?? 0) * 0.1;
  if (roll(tx, a, 'scav-hurt') < risk) {
    const hurt = Math.round(15 + roll(tx, a, 'scav-wound') * 20 + storm * 30);
    a.health = Math.max(0, a.health - hurt);
    a.mood = 'shaken';
    touch(tx, a);
    const cause = storm > 0 ? tx.world.causes.storm : undefined;
    if (a.health <= 0) {
      await killAgent(tx, a, { cause: 'a fall while scavenging', summary: a.name + ' died scavenging at ' + locName(loc) + ', crushed under shifting debris.', causationEventId: cause, category: 'action' });
      return;
    }
    await emitEvent(tx, {
      category: 'health',
      eventType: 'injury',
      actorId: a._id,
      locationId: loc,
      summary: a.name + ' was hurt scavenging at ' + locName(loc) + (storm > 0 ? ' when debris from the storm came down' : ': a suit seal tore on jagged scrap') + ' and limped back with nothing.',
      salience: 0.55,
      causationEventId: cause,
      witnesses: 'location',
    });
    return;
  }
  const r = roll(tx, a, 'scav-find');
  if (r < 0.01 + a.traits.curiosity * 0.015) {
    const find = FINDS[Math.floor(roll(tx, a, 'scav-which') * FINDS.length)];
    a.inv.parts += find.parts;
    a.inv.medicine += find.medicine;
    a.inv.credits = round2(a.inv.credits + find.credits);
    a.mood = 'hopeful';
    touch(tx, a);
    await emitEvent(tx, {
      category: 'action',
      eventType: 'rare_find',
      actorId: a._id,
      locationId: loc,
      summary: a.name + ' found ' + find.what + ' while scavenging at ' + locName(loc) + '.',
      salience: 0.7,
      visibility: 'public',
      facts: { parts: find.parts, medicine: find.medicine, credits: find.credits },
    });
    return;
  }
  const parts = r < 0.75 ? 1 + Math.floor(roll(tx, a, 'scav-n') * 3) : 0;
  const credits = parts === 0 && r < 0.9 ? 3 + Math.floor(roll(tx, a, 'scav-cr') * 8) : 0;
  a.inv.parts += parts;
  a.inv.credits = round2(a.inv.credits + credits);
  touch(tx, a);
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'scavenge',
    actorId: a._id,
    locationId: loc,
    summary:
      parts > 0
        ? a.name + ' pulled ' + units(parts, 'parts') + ' out of the scrap at ' + locName(loc) + ' to sell.'
        : credits > 0
          ? a.name + ' found ' + credits + ' credits in a dropped chit at ' + locName(loc) + '.'
          : a.name + ' spent an hour picking over ' + locName(loc) + ' and found nothing worth carrying.',
    salience: 0.15,
  });
}

// ---------- begging ----------

export async function beg(tx: Tx, a: AgentDoc, who: string | undefined, resArg: string | undefined): Promise<number> {
  const res: Res = resArg === 'water' || resArg === 'credits' ? resArg : 'food';
  const b = await partyFor(tx, a, who, (x, r) => x.inv[res] + (r?.affinity ?? 0) * 5 + x.traits.empathy * 3);
  if (!b) return fail(tx, a, 'Found nobody at ' + locName(a.locationId) + ' to ask for ' + res);
  const r = roll(tx, a, 'beg');
  const toA = await tie(tx, b._id, a._id);
  const spare = res === 'credits' ? (b.inv.credits >= 15 ? Math.min(6, Math.floor(b.inv.credits * 0.1)) : 0) : b.inv[res] >= 2 ? 1 : 0;
  const desperate = pressing(a, res) >= 70 || a.health < 50 ? 0.15 : 0;
  const willing = b.traits.empathy * 0.6 + (toA?.affinity ?? 0) * 0.4 + (toA?.obligation ?? 0) * 0.3 + desperate - pressing(b, res) / 300 + (rand(tx.world.seed, tx.tick, b.seq, 'alms') - 0.5) * 0.3;
  act(tx, a, 'talking', 'Begging ' + b.name + ' for ' + res, b._id, line('beg.ask', r, { you: b.name, res }));
  const witnesses = (await agentsAt(tx, a.locationId, { exclude: [a._id, b._id] })).slice(0, 4);
  if (spare > 0 && willing > 0.4) {
    b.inv[res] = round2(b.inv[res] - spare);
    a.inv[res] = round2(a.inv[res] + spare);
    say(tx, b, a._id, line('beg.yes', r, { you: a.name }));
    await adjustRelationship(tx, a, b, { affinity: 0.15, trust: 0.08, obligation: 0.12 });
    if (b.traits.empathy < 0.4) await adjustRelationship(tx, b, a, { affinity: -0.04 });
    await emitEvent(tx, {
      category: 'social',
      eventType: 'charity',
      actorId: b._id,
      participantIds: [a._id],
      locationId: a.locationId,
      summary: a.name + ' begged at ' + locName(a.locationId) + ' and ' + b.name + ' handed over ' + units(spare, res) + (desperate ? '. ' + firstName(a.name) + ' looked like they had not eaten in days.' : '.'),
      salience: desperate ? 0.38 : 0.25,
      causationEventId: scarcityCause(tx.world, res),
      witnesses,
    });
    return 1;
  }
  say(tx, b, a._id, line('beg.no', r, { you: a.name }));
  a.mood = witnesses.length > 1 ? 'humiliated' : a.mood;
  await adjustRelationship(tx, a, b, { affinity: spare > 0 ? -0.08 : -0.02 });
  await emitEvent(tx, {
    category: 'social',
    eventType: 'begging',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' asked ' + b.name + ' for ' + res + ' at ' + locName(a.locationId) + ' and was turned away' + (spare > 0 ? ', though ' + firstName(b.name) + ' had plenty.' : '.'),
    salience: 0.22,
    witnesses,
  });
  return FAILED;
}

// ---------- debts ----------

export async function borrow(tx: Tx, a: AgentDoc, who: string | undefined, resArg: string | undefined, qty: number): Promise<number> {
  if (!isRes(resArg)) return fail(tx, a, 'Wanted to borrow something nobody lends');
  const res = resArg;
  const n = res === 'credits' ? qty : Math.min(qty, 6);
  const b = await partyFor(tx, a, who, (x, r) => (r?.trust ?? 0) + (r?.affinity ?? 0) + (x.inv[res] >= n + 1 ? 1 : 0));
  if (!b) return fail(tx, a, 'Nobody at ' + locName(a.locationId) + ' to borrow from');
  const r = roll(tx, a, 'borrow');
  const toA = await tie(tx, b._id, a._id);
  const mind = await loadMind(tx, a);
  if (!mind) return fail(tx, a, 'Could not make a promise anyone would hold');
  const overdue = debtsTo(mind, b._id).some((d) => d.dueTick < tx.tick);
  const spare = res === 'credits' ? b.inv.credits - 5 : b.inv[res] - 1;
  const willing = (toA?.trust ?? 0) * 0.5 + (toA?.affinity ?? 0) * 0.4 + b.traits.empathy * 0.25 + (b.occupation === 'trader' ? 0.1 : 0) - (overdue ? 0.5 : 0) + (rand(tx.world.seed, tx.tick, b.seq, 'lend') - 0.5) * 0.3;
  act(tx, a, 'talking', 'Asking ' + b.name + ' for a loan of ' + units(n, res), b._id, line('borrow.ask', r, { you: b.name, res, n }));
  if (spare < n || willing < 0.25) {
    say(tx, b, a._id, line('borrow.no', overdue ? 0 : r, { you: a.name }));
    await adjustRelationship(tx, a, b, { affinity: -0.05 });
    await emitEvent(tx, {
      category: 'social',
      eventType: 'loan_refused',
      actorId: b._id,
      participantIds: [a._id],
      locationId: a.locationId,
      summary: b.name + ' would not lend ' + a.name + ' ' + units(n, res) + (overdue ? ': ' + firstName(a.name) + ' still owes from last time.' : spare < n ? '; there was none to spare.' : '.'),
      salience: overdue ? 0.4 : 0.2,
    });
    return FAILED;
  }
  b.inv[res] = round2(b.inv[res] - n);
  a.inv[res] = round2(a.inv[res] + n);
  touch(tx, b);
  say(tx, b, a._id, line('borrow.yes', r, { you: a.name }));
  const { eventId } = await emitEvent(tx, {
    category: 'economy',
    eventType: 'loan',
    actorId: b._id,
    participantIds: [a._id],
    locationId: a.locationId,
    summary: b.name + ' lent ' + a.name + ' ' + units(n, res) + ' at ' + locName(a.locationId) + ', to be paid back within two sols.',
    salience: 0.3,
    causationEventId: res === 'credits' ? undefined : scarcityCause(tx.world, res),
  });
  const debt = addDebt(tx, mind, b, res, n, eventId);
  touchMind(tx, mind);
  await adjustRelationship(tx, a, b, { obligation: 0.25, affinity: 0.05 });
  await learnBelief(tx, b, {
    kind: 'debt',
    text: a.name + ' owes ' + b.name + ' ' + units(debt.qty, res) + ', borrowed on ' + dayLabel(debt.tick) + '.',
    valence: -0.05,
    confidence: 1,
    sourceType: 'observed',
    subjectAgentId: a._id,
    subjectName: a.name,
    originEventId: eventId,
    truthEventId: eventId,
    private: true,
  });
  return 1;
}

/** Pays back what the debtor can of what they owe the lender: in kind first, then in credits at market price. */
export async function repay(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const mind = await loadMind(tx, a);
  const b = await partyFor(tx, a, who, (x) => (debtsTo(mind, x._id).length > 0 ? 1 : -1));
  if (!b || !mind) return fail(tx, a, 'The person owed was not at ' + locName(a.locationId));
  const debts = debtsTo(mind, b._id);
  if (debts.length === 0) return fail(tx, a, 'Owed ' + b.name + ' nothing');
  const paid: string[] = [];
  let whole = true;
  for (const d of debts) {
    const res = d.res as Res;
    let n = Math.min(d.qty, Math.floor(a.inv[res] * 100) / 100);
    if (res === 'food' || res === 'water') n = Math.min(n, Math.max(0, a.inv[res] - (pressing(a, res) > 60 ? 1 : 0)));
    if (n > 0) {
      a.inv[res] = round2(a.inv[res] - n);
      b.inv[res] = round2(b.inv[res] + n);
      d.qty = round2(d.qty - n);
      paid.push(units(round1(n), res));
    }
    if (d.qty > 0 && res !== 'credits') {
      const cash = Math.min(Math.floor(a.inv.credits), Math.ceil(d.qty * value(tx, res)));
      if (cash > 0) {
        a.inv.credits = round2(a.inv.credits - cash);
        b.inv.credits = round2(b.inv.credits + cash);
        d.qty = round2(Math.max(0, d.qty - cash / value(tx, res)));
        paid.push(cash + ' credits');
      }
    }
    if (d.qty > 0.05) whole = false;
  }
  const ledger = ledgerOf(mind);
  const settled = debts.filter((d) => d.qty <= 0.05);
  ledger.owes = ledger.owes.filter((d) => !settled.includes(d));
  touchMind(tx, mind);
  touch(tx, b);
  if (paid.length === 0) return fail(tx, a, 'Had nothing to pay ' + b.name + ' back with');
  const late = debts.some((d) => d.dueTick < tx.tick || d.pressed > 0);
  const r = roll(tx, a, 'repay');
  act(tx, a, 'giving', 'Paying ' + b.name + ' back', b._id, line(whole ? 'repay.give' : 'repay.partial', r, { you: b.name }));
  say(tx, b, a._id, line('repay.thanks', r, { you: a.name }));
  await adjustRelationship(tx, a, b, { obligation: whole ? -0.3 : -0.1 });
  await adjustRelationship(tx, b, a, { affinity: whole ? 0.1 : 0.03, trust: whole ? 0.15 : 0.05, fear: -0.2 });
  const belief = await getBelief(tx, b._id, 'debt:' + a._id);
  if (belief) {
    const left = ledger.owes.filter((d) => d.to === b._id).map((d) => units(round1(d.qty), d.res)).join(' and ');
    await tx.ctx.db.patch(belief._id, { text: whole ? a.name + ' paid back everything owed to ' + b.name + '.' : a.name + ' still owes ' + b.name + ' ' + left + '.', valence: whole ? 0.2 : -0.05, acted: tx.tick });
  }
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'debt_repaid',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' paid ' + b.name + ' back ' + paid.join(' and ') + (whole ? (late ? ', late but in full.' : ', in full.') : ', only part of what is owed.'),
    salience: late ? 0.42 : 0.28,
    causationEventId: debts[0].eventId,
  });
  return 1;
}

// ---------- barter ----------

export async function barter(tx: Tx, a: AgentDoc, who: string | undefined, giveRes: string | undefined, giveQty: number, wantRes: string | undefined, wantQty: number): Promise<number> {
  if (!isRes(giveRes) || !isRes(wantRes) || giveRes === wantRes) return fail(tx, a, 'Could not make sense of the swap');
  const b = await partyFor(tx, a, who, (x) => x.inv[wantRes] - wantQty);
  if (!b) return fail(tx, a, 'Nobody at ' + locName(a.locationId) + ' to trade with');
  if (a.inv[giveRes] < giveQty) return fail(tx, a, 'Did not have ' + units(giveQty, giveRes) + ' to swap');
  const keep = wantRes === 'food' || wantRes === 'water' ? 1 : 0;
  const r = roll(tx, a, 'barter');
  act(tx, a, 'trading', 'Offering ' + b.name + ' ' + units(giveQty, giveRes) + ' for ' + units(wantQty, wantRes), b._id, line('barter.offer', r, { you: b.name, res: giveRes, n: giveQty }));
  const toA = await tie(tx, b._id, a._id);
  const need = (res: Res) => 1 + pressing(b, res) / 100;
  const offered = giveQty * value(tx, giveRes) * need(giveRes);
  const asked = wantQty * value(tx, wantRes) * need(wantRes) * (1.1 - (toA?.affinity ?? 0) * 0.2);
  if (b.inv[wantRes] - keep < wantQty || offered < asked) {
    say(tx, b, a._id, line('barter.no', r));
    await emitEvent(tx, {
      category: 'economy',
      eventType: 'barter_refused',
      actorId: b._id,
      participantIds: [a._id],
      locationId: a.locationId,
      summary: b.name + ' turned down ' + a.name + "'s offer of " + units(giveQty, giveRes) + ' for ' + units(wantQty, wantRes) + '.',
      salience: 0.15,
    });
    return FAILED;
  }
  a.inv[giveRes] = round2(a.inv[giveRes] - giveQty);
  b.inv[giveRes] = round2(b.inv[giveRes] + giveQty);
  b.inv[wantRes] = round2(b.inv[wantRes] - wantQty);
  a.inv[wantRes] = round2(a.inv[wantRes] + wantQty);
  touch(tx, b);
  say(tx, b, a._id, line('barter.yes', r, { you: a.name }));
  await adjustRelationship(tx, b, a, { affinity: 0.04, trust: 0.04 });
  await adjustRelationship(tx, a, b, { affinity: 0.04, trust: 0.04 });
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'barter',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' swapped ' + units(giveQty, giveRes) + ' for ' + units(wantQty, wantRes) + ' with ' + b.name + ', no credits changing hands.',
    salience: 0.2,
  });
  return 1;
}

// ---------- the black market ----------

/** Off-book trade with shuttle crews at the pad: sells what the smuggler carries, or buys cheap if they carry none. */
export async function smuggle(tx: Tx, a: AgentDoc, resArg: string | undefined, qty: number): Promise<number> {
  if (a.locationId !== 'landing_pad') return fail(tx, a, 'The crews only deal at the Landing Pad');
  if (!isTraded(resArg)) return fail(tx, a, 'The crews do not deal in that');
  if (stormAt(tx.world, 'landing_pad') > 0) return fail(tx, a, 'No crew will open a hatch in this storm');
  const res = resArg;
  const shuttleDay = Math.floor(tx.tick / 144) - tx.world.econ.lastShuttleDay <= 1;
  const market = tx.world.prices[res];
  const selling = a.inv[res] >= Math.min(qty, 2);
  let n: number;
  let total: number;
  if (selling) {
    n = Math.min(qty, Math.floor(a.inv[res]));
    total = Math.floor(n * market * (shuttleDay ? 1.45 : 1.25));
    a.inv[res] -= n;
    a.inv.credits = round2(a.inv.credits + total);
  } else {
    const price = Math.max(BASE_PRICES[res] * 0.6, market * (shuttleDay ? 0.65 : 0.8));
    n = Math.min(qty, 6, Math.floor(a.inv.credits / price));
    if (n <= 0) return fail(tx, a, 'Could not afford what the crews were selling');
    total = Math.ceil(n * price);
    a.inv.credits = round2(a.inv.credits - total);
    a.inv[res] += n;
  }
  const mind = await loadMind(tx, a);
  if (mind) {
    addDeed(mind, 'smuggler');
    touchMind(tx, mind);
  }
  act(tx, a, 'trading', (selling ? 'Selling ' : 'Buying ') + units(n, res) + ' off the books behind a cargo sled', undefined, line('smuggle', roll(tx, a, 'smuggle')));
  const seen: AgentDoc[] = [];
  for (const id of (await agentsAt(tx, 'landing_pad', { exclude: [a._id] })).slice(0, 8)) {
    const w = await loadAgent(tx, id);
    if (!w) continue;
    const onDuty = w.occupation === 'security' && w.activity === 'working';
    if (rand(tx.world.seed, tx.tick, w.seq, 'smug:' + a.seq) < 0.12 + w.traits.caution * 0.2 + (onDuty ? 0.4 : 0) + (w.occupation === 'dock_hand' ? 0.12 : 0)) seen.push(w);
  }
  const { eventId } = await emitEvent(tx, {
    category: 'economy',
    eventType: 'smuggling',
    actorId: a._id,
    participantIds: seen.map((w) => w._id),
    locationId: 'landing_pad',
    summary:
      a.name + (selling ? ' sold ' : ' bought ') + units(n, res) + ' off the books to a shuttle crew at the Landing Pad for ' + total + ' credits' +
      (seen.length ? '. ' + seen[0].name + ' saw the crates change hands.' : ', and nobody logged it.'),
    salience: seen.length ? 0.55 : 0.4,
    causationEventId: scarcityCause(tx.world, res),
    visibility: seen.length ? 'local' : 'private',
  });
  for (const w of seen) {
    await learnBelief(tx, w, {
      kind: 'smuggler',
      text: a.name + ' trades off the books with shuttle crews at the Landing Pad.',
      valence: -0.6,
      confidence: 0.85,
      sourceType: 'observed',
      subjectAgentId: a._id,
      subjectName: a.name,
      originEventId: eventId,
      truthEventId: eventId,
    });
  }
  return 2;
}

// ---------- hiding ----------

export async function hide(tx: Tx, a: AgentDoc, resArg: string | undefined, qty: number): Promise<number> {
  if (a.locationId !== a.homeLocationId) return fail(tx, a, 'Nowhere to hide anything at ' + locName(a.locationId));
  if (!isRes(resArg)) return fail(tx, a, 'Had nothing like that to hide');
  const res = resArg;
  const n = Math.min(qty, Math.floor(a.inv[res]));
  if (n <= 0) return fail(tx, a, 'Had no ' + res + ' to put away');
  const mind = await loadMind(tx, a);
  if (!mind) return fail(tx, a, 'Could not find a hiding place');
  const stash = ledgerOf(mind).stash;
  a.inv[res] -= n;
  stash[res] = round2(stash[res] + n);
  touchMind(tx, mind);
  const spot = pick(['behind a loose wall panel', 'inside a dead air filter', 'under the bunk frame', 'in a sealed boot', 'in the vent above the door'], roll(tx, a, 'spot'));
  act(tx, a, 'idle', 'Tucking ' + units(n, res) + ' away ' + spot, undefined, line('hide', roll(tx, a, 'hide')));
  const household = await loadHousehold(tx, a.householdId);
  const noticer = await nosyHousemate(tx, a, household?.memberIds ?? []);
  const { eventId } = await emitEvent(tx, {
    category: 'economy',
    eventType: 'stash',
    actorId: a._id,
    participantIds: noticer ? [noticer._id] : [],
    locationId: a.locationId,
    summary: a.name + ' hid ' + units(n, res) + ' ' + spot + ' at home' + (noticer ? ', and ' + noticer.name + ' noticed.' : '.'),
    salience: noticer ? 0.4 : 0.22,
    causationEventId: scarcityCause(tx.world, res),
    visibility: 'private',
  });
  if (noticer && (res === 'food' || res === 'water')) {
    await learnBelief(tx, noticer, {
      kind: 'hoarding',
      text: a.name + ' keeps ' + res + ' hidden ' + spot + ' instead of sharing it.',
      valence: -1,
      confidence: 0.8,
      sourceType: 'observed',
      subjectAgentId: a._id,
      subjectName: a.name,
      originEventId: eventId,
      truthEventId: eventId,
    });
  }
  return 1;
}

async function nosyHousemate(tx: Tx, a: AgentDoc, memberIds: AgentDoc['_id'][]): Promise<AgentDoc | null> {
  for (const id of memberIds) {
    if (id === a._id) continue;
    const m = await loadAgent(tx, id);
    if (m?.alive && m.locationId === a.locationId && m.activity !== 'sleeping' && rand(tx.world.seed, tx.tick, m.seq, 'nosy') < 0.2 + m.traits.curiosity * 0.4) return m;
  }
  return null;
}

/** Takes one unit from the hidden stash, for eating or drinking at home. */
export async function fromStash(tx: Tx, a: AgentDoc, res: 'food' | 'water'): Promise<boolean> {
  if (a.locationId !== a.homeLocationId) return false;
  const mind = await loadMind(tx, a);
  const stash = mind?.ledger?.stash;
  if (!mind || !stash || stash[res] < 1) return false;
  stash[res] = round2(stash[res] - 1);
  touchMind(tx, mind);
  return true;
}
