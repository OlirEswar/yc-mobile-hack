/**
 * The same need, different answers (docs/STORY_SPEC.md 1.2). When someone needs food, water or
 * credits, every way open to them is enumerated (work and buy, the ration, a grow rack, barter,
 * charming or borrowing from someone who might give, begging, scavenging, the black market,
 * stealing goods or credits, blackmail and bribes) and scored by their persona's strategies (or
 * their traits), skills, ties, leverage held, how each way worked out for them before, how
 * desperate they are and how risky it looks. A seeded roll keeps equal people from choosing alike.
 */
import { BASE_PRICES, RESERVE_FLOOR } from '../lib/constants';
import { clamp } from '../lib/rng';
import { agentsAt, loadAgent } from './core';
import type { AgentDoc, MindDoc, Tx } from './core';
import { isLocation, locName, scarcityCause, stock, stormAt } from './conditions';
import { stashTotal, strategyMemory } from './ledger';
import { Plan, STRATEGIES, chance, findable } from './plan';
import type { Choice, Ctx, Strategy } from './plan';
import { isScandal } from './secrets';
import { intentLine } from './text';

const CRIMES = new Set<Strategy>(['steal', 'scheme', 'smuggle']);

/** How much someone leans on each strategy: persona order first, else what their traits and skills suggest. */
export function strategyWeights(a: AgentDoc, mind: MindDoc): Record<Strategy, number> {
  const listed = (mind.persona?.strategies ?? []).filter((s): s is Strategy => (STRATEGIES as readonly string[]).includes(s));
  const order = listed.length > 0 ? listed : derivedOrder(a, mind);
  const out = {} as Record<Strategy, number>;
  for (const s of STRATEGIES) {
    const i = order.indexOf(s);
    out[s] = i >= 0 ? Math.max(0.45, 1 - i * 0.12) : CRIMES.has(s) ? 0.05 : 0.3;
  }
  return out;
}

function derivedOrder(a: AgentDoc, mind: MindDoc): Strategy[] {
  const t = a.traits;
  const v = mind.values;
  const skill = (k: string) => (mind.skills[k] ?? 20) / 100;
  const fit: Record<Strategy, number> = {
    work: 0.45 + t.ambition * 0.15 + t.caution * 0.2 + (a.occupation === 'resident' ? -0.2 : 0.1),
    grow: skill('farming') * 0.7 + t.caution * 0.1 + (a.occupation === 'hydroponicist' ? 0.3 : 0),
    trade: skill('trade') * 0.5 + v.wealth * 0.3 + (a.occupation === 'trader' ? 0.3 : 0),
    charm: t.sociability * 0.5 + skill('persuasion') * 0.35,
    borrow: t.sociability * 0.3 + (1 - t.caution) * 0.2 + 0.05,
    beg: (1 - t.ambition) * 0.3 + (1 - t.stubbornness) * 0.2 - v.status * 0.2,
    scavenge: t.curiosity * 0.4 + (1 - t.caution) * 0.3 + (a.occupation === 'quarry_hand' || a.occupation === 'solar_tech' ? 0.15 : 0),
    smuggle: (1 - t.caution) * 0.25 + v.wealth * 0.25 + v.freedom * 0.2 + (a.occupation === 'dock_hand' ? 0.25 : 0) - v.harmony * 0.2,
    steal: (1 - t.empathy) * 0.4 + (1 - t.caution) * 0.2 + t.ambition * 0.1 - v.harmony * 0.25,
    scheme: t.ambition * 0.35 + (1 - t.empathy) * 0.3 + skill('persuasion') * 0.2 - v.harmony * 0.25,
  };
  return [...STRATEGIES].sort((x, y) => fit[y] - fit[x]).slice(0, 5);
}

/** What someone wants out of life, read from their persona and goals. Falls back on traits. */
export function drivesOf(a: AgentDoc, mind: MindDoc): Set<string> {
  const p = mind.persona;
  const text = [p?.want, p?.need, p?.arc.note, ...mind.goals.filter((g) => g.status === 'active').map((g) => g.description + ' ' + (g.drive ?? ''))].join(' ').toLowerCase();
  const drives = new Set<string>();
  const has = (re: RegExp) => re.test(text);
  if (has(/love|heart|romance|marr|court|partner|kiss|lonely|together/)) drives.add('romance');
  if (has(/reveng|pay(s)? for|get even|ruin|destroy|bring .* down|grudge|humiliat/)) drives.add('revenge');
  if (has(/council|chair|power|lead|control|seat|influence|vote/)) drives.add('power');
  if (has(/leave|escape|earth|passage|off-world|ticket home|get out/)) drives.add('escape');
  if (has(/protect|keep .* safe|daughter|son|brother|sister|child|family|kids/)) drives.add('protect');
  if (has(/truth|long dark|uncover|find out|expose|prove|secret|what really/)) drives.add('uncover');
  if (has(/rich|credits|money|wealth|debt|fortune|profit/)) drives.add('wealth');
  if (has(/union|strike|crews|workers|wage|fair share|ration/)) drives.add('union');
  if (drives.size > 0) return drives;
  const t = a.traits;
  if (t.sociability > 0.65 && a.needs.social > 50) drives.add('romance');
  if (t.ambition > 0.7) drives.add(mind.values.status > 0.6 ? 'power' : 'wealth');
  if (t.curiosity > 0.75) drives.add('uncover');
  if (mind.values.family > 0.7) drives.add('protect');
  return drives;
}

type Option = { s: Strategy; fit: number; intent: string; plan: Plan; crime?: boolean; risk?: number };

/** How dangerous a crime at a place looks: security on duty there, and how many eyes. */
async function riskAt(tx: Tx, loc: string, self: AgentDoc): Promise<number> {
  const here = await agentsAt(tx, loc, { exclude: [self._id] });
  let guards = 0;
  for (const id of here.slice(0, 8)) {
    const w = await loadAgent(tx, id);
    if (w && (w.occupation === 'security' || w.occupation === 'quartermaster') && w.activity === 'working') guards += 1;
  }
  return clamp(guards * 0.35 + here.length * 0.03, 0, 0.9);
}

/** A household member to steal or beg for, by name, when there is someone at home. */
async function dependant(c: Ctx): Promise<AgentDoc | null> {
  for (const id of c.household?.memberIds ?? []) {
    if (id === c.a._id) continue;
    const m = await loadAgent(c.tx, id);
    if (m?.alive && (m.health < 70 || Math.max(m.needs.hunger, m.needs.thirst) > 55 || chance(c, 'dep') < 0.4)) return m;
  }
  return null;
}

/** The candidate ways of getting food or water right now. */
async function needOptions(c: Ctx, res: 'food' | 'water', need: number): Promise<Option[]> {
  const { a, tx, household } = c;
  const verb = res === 'food' ? 'eat' : 'drink';
  const consume = res === 'food' ? 'Eating' : 'Drinking';
  const price = tx.world.prices[res];
  const r = (salt: string) => chance(c, salt);
  const vars = { me: a.name, res };
  const opts: Option[] = [];
  const add = (o: Option) => opts.push(o);

  if (household && household.rationDay <= c.day && stock(tx.world, 'depot', res) >= 1) {
    const dep = await dependant(c);
    add({ s: 'work', fit: 0.75, intent: intentLine('need.ration', r('i-ration'), { ...vars, dep: dep?.name }), plan: new Plan(a.locationId).go('depot', 'Walking to the Supply Depot').add('ration', [], 'Collecting the household ration').go(a.homeLocationId, 'Carrying the ration home').add(verb, [], consume + ' at home') });
  }
  const fee = Math.max(1, Math.round(price * 0.5));
  if (stock(tx.world, 'canteen', res) >= 1 && a.inv.credits >= fee) {
    add({ s: 'work', fit: 0.7, intent: intentLine('need.canteen', r('i-cant'), vars), plan: new Plan(a.locationId).go('canteen').add(verb, [], consume + ' at the canteen') });
  }
  const marketHas = stock(tx.world, 'depot', res) > RESERVE_FLOOR[res] || price > BASE_PRICES[res];
  if (marketHas && a.inv.credits >= Math.ceil(price * 1.3)) {
    const high = price >= BASE_PRICES[res] * 1.6;
    add({ s: 'work', fit: high ? 0.55 : 0.7, intent: intentLine('need.buy', r('i-buy'), { ...vars, n: 2, why: high ? ' even at ' + Math.round(price * 10) / 10 + ' credits' : '' }), plan: new Plan(a.locationId).go('market', 'Walking to the Exchange Concourse').add('buy', [res, 2], 'Buying 2 ' + res).add(verb, [], consume + ' at the Exchange') });
  }
  if (res === 'food' && need < 85 && (a.inv.water >= 1 || (household?.pantry.water ?? 0) >= 2)) {
    add({ s: 'grow', fit: 0.75 + (c.mind.skills.farming ?? 0) / 300, intent: intentLine('need.grow', r('i-grow'), vars), plan: new Plan(a.locationId).go(a.homeLocationId, 'Going home to the grow rack').add('grow', [9], 'Tending the grow rack at home').add(verb, [], 'Eating what the rack gave') });
  }
  const spare = (['parts', 'medicine', res === 'food' ? 'water' : 'food'] as const).find((x) => a.inv[x] >= (x === 'parts' ? 2 : 3));
  if (spare) {
    const n = spare === 'parts' ? 2 : 2;
    if (spare === 'parts' || spare === 'medicine') {
      add({ s: 'trade', fit: 0.8, intent: intentLine('need.sell', r('i-sell'), { ...vars, res2: spare, n }), plan: new Plan(a.locationId).go('market').add('sell', [spare, n], 'Selling ' + n + ' ' + spare).add('buy', [res, 2], 'Buying 2 ' + res).add(verb, [], consume + ' at the Exchange') });
    } else {
      add({ s: 'trade', fit: 0.8, intent: intentLine('need.barter', r('i-barter'), { ...vars, res2: spare, n }), plan: new Plan(a.locationId).go('market').add('barter', ['any', spare, n, res, 1], 'Swapping ' + spare + ' for ' + res).add(verb, [], consume + ' at the Exchange') });
    }
  }
  const friends = c.ties.filter((t) => t.toAlive && t.kind !== 'rival' && !household?.memberIds.includes(t.toAgentId));
  const fond = friends.filter((t) => t.affinity >= 0.3).sort((x, y) => y.affinity - x.affinity)[0];
  const friend = fond ? await findable(c, fond.toAgentId) : null;
  if (friend && friend.inv[res] >= 2) {
    add({ s: 'charm', fit: 0.6 + fond!.affinity * 0.5, intent: intentLine('need.charm', r('i-charm'), { ...vars, who: friend.name }), plan: new Plan(a.locationId).go(friend.locationId, 'Looking for ' + friend.name).add('talk', [friend._id], 'Chatting with ' + friend.name).add('beg', [friend._id, res], 'Asking ' + friend.name + ' for ' + res).add(verb, [], consume) });
  }
  const trusted = friends.filter((t) => t.trust >= 0.15).sort((x, y) => y.trust - x.trust)[0];
  const lender = trusted ? await findable(c, trusted.toAgentId) : null;
  if (lender && (lender.inv[res] >= 3 || lender.inv.credits >= 15)) {
    const goods = lender.inv[res] >= 3;
    const plan = new Plan(a.locationId).go(lender.locationId, 'Looking for ' + lender.name);
    if (goods) plan.add('borrow', [lender._id, res, 2], 'Borrowing 2 ' + res + ' from ' + lender.name).add(verb, [], consume);
    else plan.add('borrow', [lender._id, 'credits', 12], 'Borrowing 12 credits from ' + lender.name).go('canteen').add(verb, [], consume + ' at the canteen');
    add({ s: 'borrow', fit: 0.6 + trusted!.trust * 0.4, intent: intentLine('need.borrow', r('i-borrow'), { ...vars, who: lender.name, n: 2 }), plan });
  }
  if (need >= 60 || (need >= 40 && c.weights.beg >= 0.45)) {
    const crowd = chance(c, 'crowd') < 0.5 ? 'canteen' : 'plaza';
    add({ s: 'beg', fit: 0.65, intent: intentLine('need.beg', r('i-beg'), { ...vars, place: crowd }), plan: new Plan(a.locationId).go(crowd).add('beg', ['any', res], 'Begging for ' + res).add(verb, [], consume) });
  }
  const site = (['quarry', 'landing_pad', 'solar_farm'] as const).find((l) => stormAt(tx.world, l) === 0 && chance(c, 'site' + l) < 0.6) ?? 'quarry';
  if (need < 85 && stormAt(tx.world, site) === 0) {
    add({ s: 'scavenge', fit: 0.65, intent: intentLine('need.scavenge', r('i-scav'), { ...vars, place: site }), plan: new Plan(a.locationId).go(site).add('scavenge', [site], 'Scavenging at ' + locName(site)).go('market').add('sell', ['parts', 3], 'Selling salvage').add('buy', [res, 2], 'Buying 2 ' + res).add(verb, [], consume) });
  }
  if (stormAt(tx.world, 'landing_pad') === 0 && a.inv.credits >= Math.ceil(price * 1.6)) {
    add({ s: 'smuggle', fit: 0.8, crime: true, risk: await riskAt(tx, 'landing_pad', a), intent: intentLine('need.smuggle', r('i-smug'), vars), plan: new Plan(a.locationId).go('landing_pad', 'Slipping out to the Landing Pad').add('smuggle', [res, 2], 'Buying ' + res + ' off the books').add(verb, [], consume) });
  }
  if (a.occupation !== 'security' && a.occupation !== 'quartermaster') {
    const dep = await dependant(c);
    const forVars = { ...vars, dep: dep?.name };
    if (stock(tx.world, 'depot', res) >= 3) {
      add({ s: 'steal', fit: 0.85, crime: true, risk: await riskAt(tx, 'depot', a), intent: intentLine('need.steal.depot', r('i-steal'), forVars), plan: new Plan(a.locationId).go('depot', 'Slipping over to the Supply Depot').add('steal', ['depot', res, 2 + Math.round(a.traits.ambition * 2)], 'Taking ' + res + ' while nobody watches').add(verb, [], consume) });
    }
    const mark = c.ties.filter((t) => t.toAlive && t.kind !== 'family' && t.kind !== 'friend' && t.kind !== 'romance').sort((x, y) => x.affinity - y.affinity)[0];
    const victim = mark ? await loadAgent(tx, mark.toAgentId) : null;
    if (victim?.alive && victim.householdId && victim.householdId !== a.householdId && victim.locationId !== victim.homeLocationId) {
      add({ s: 'steal', fit: 0.7, crime: true, risk: 0.1, intent: intentLine('need.steal.pantry', r('i-pantry'), { ...forVars, who: victim.name }), plan: new Plan(a.locationId).go(victim.homeLocationId, 'Heading to ' + locName(victim.homeLocationId)).add('steal', ['pantry:' + victim.householdId, res, 2], 'Raiding the pantry of ' + victim.name + "'s household").add(verb, [], consume) });
    }
    const rich = victim && isLocation(victim.locationId) && victim.activity !== 'sleeping' && victim.inv.credits >= 20 && marketHas ? victim : null;
    if (rich) {
      add({ s: 'steal', fit: 0.6, crime: true, risk: await riskAt(tx, rich.locationId, a), intent: intentLine('need.steal.credits', r('i-cred'), { ...vars, who: rich.name, place: rich.locationId }), plan: new Plan(a.locationId).go(rich.locationId, 'Following ' + rich.name).add('steal', [rich._id, 'credits', 12], 'Lifting credits from ' + rich.name).go('market').add('buy', [res, 2], 'Buying 2 ' + res).add(verb, [], consume) });
    }
  }
  const leverage = c.beliefs.find((b) => b.subjectAgentId && b.subjectAgentId !== a._id && b.valence < 0 && isScandal(b.kind) && b.confidence >= 0.55 && (b.acted === undefined || tx.tick - b.acted > 144));
  const mark = leverage ? await findable(c, leverage.subjectAgentId) : null;
  if (mark && leverage && mark.inv.credits >= 12) {
    add({ s: 'scheme', fit: 0.8, crime: true, risk: 0.1, intent: intentLine('need.blackmail', r('i-bm'), { ...vars, who: mark.name }), plan: new Plan(a.locationId).go(mark.locationId, 'Finding ' + mark.name).add('blackmail', [mark._id, leverage.key], 'Leaning on ' + mark.name).go('canteen').add(verb, [], consume + ' at the canteen') });
  }
  const qm = tx.world.roles.quartermaster ? await findable(c, tx.world.roles.quartermaster) : null;
  if (qm && qm.locationId === 'depot' && a.inv.credits >= 8 && qm._id !== a._id) {
    add({ s: 'scheme', fit: 0.6, crime: true, risk: 0.15, intent: intentLine('need.bribe', r('i-bribe'), { ...vars, who: qm.name }), plan: new Plan(a.locationId).go('depot').add('bribe', [qm._id, Math.min(15, Math.floor(a.inv.credits)), 'ration'], 'Slipping ' + qm.name + ' a few credits').add(verb, [], consume) });
  }
  return opts;
}

/** Picks a way to get food or water: a scored Choice, or null when nothing at hand needs deciding. */
export async function meetNeed(c: Ctx, res: 'food' | 'water', score: number, need: number): Promise<Choice | null> {
  const opts = await needOptions(c, res, need);
  if (opts.length === 0) return null;
  const desperation = clamp((need - 60) / 35, 0, 1);
  const honestFit = Math.max(0, ...opts.filter((o) => !o.crime).map((o) => o.fit));
  const morals = c.a.traits.empathy * 0.5 + c.mind.values.harmony * 0.35 + c.a.traits.caution * 0.2;
  let best: { o: Option; v: number } | null = null;
  for (const o of opts) {
    let v = c.weights[o.s] * o.fit + strategyMemory(c.mind, o.s, c.tx.tick) + chance(c, 'strat:' + o.s + o.intent.length) * 0.45;
    if (o.crime) {
      // A crime needs a reason: a criminal bent, or desperation with honest ways closed.
      const bent = c.weights[o.s] >= 0.55 ? 0.25 : 0;
      v += bent + desperation * (1 - honestFit) * 0.6 - morals * 0.45 - (o.risk ?? 0) * (0.4 + c.a.traits.caution * 0.6);
    }
    if (!best || v > best.v) best = { o, v };
  }
  const { o } = best!;
  const urgent = need >= 70;
  return {
    score,
    routine: !urgent && !o.crime && o.s === 'work',
    intent: o.intent,
    steps: o.plan.steps,
    labels: o.plan.labels,
    trigger: urgent || o.s !== 'work' ? (res === 'water' ? 'thirsty' : 'hungry') + ' with ' + Math.floor(c.a.inv.credits) + ' credits and ' + (c.household ? Math.floor(c.household.pantry[res]) : 0) + ' ' + res + ' at home' : undefined,
    causeEventId: o.s === 'work' && !urgent ? undefined : scarcityCause(c.tx.world, res),
    strategy: { s: o.s, res },
    llm: o.crime && urgent ? { kind: 'plan', trigger: (res === 'water' ? 'desperately thirsty' : 'starving') + ', about to ' + o.s, priority: 0.75, lane: 'crisis' } : undefined,
  };
}

/** How badly someone wants credits, 0..1: savings against what they think they need, and debts due. */
export function moneyPressure(c: Ctx): number {
  const comfort = 25 + c.mind.values.wealth * 70 + (c.drives.has('escape') || c.drives.has('wealth') ? 60 : 0);
  const owed = (c.mind.ledger?.owes ?? []).filter((d) => d.res === 'credits').reduce((s, d) => s + d.qty, 0);
  return clamp((comfort + owed - c.a.inv.credits) / comfort, 0, 1);
}

/** Free-time ways to raise credits, chosen by persona like a need. */
export async function raiseMoney(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  const pressure = moneyPressure(c);
  if (!c.free || pressure < 0.35 || a.needs.fatigue > 70) return null;
  const r = (salt: string) => chance(c, salt);
  const vars = { me: a.name };
  const opts: Option[] = [];
  if (a.workLocationId && stormAt(tx.world, a.workLocationId) === 0 && a.occupation !== 'resident') {
    opts.push({ s: 'work', fit: 0.6, intent: intentLine('money.work', r('m-work'), { ...vars, place: a.workLocationId, why: c.drives.has('escape') ? ' for a seat on the next shuttle out' : '' }), plan: new Plan(a.locationId).go(a.workLocationId).add('work', [10], 'Working an extra shift at ' + locName(a.workLocationId)) });
  }
  const goods = (['parts', 'medicine', 'food', 'water'] as const).find((x) => a.inv[x] >= (x === 'food' || x === 'water' ? 5 : 2));
  if (goods) {
    const n = goods === 'food' || goods === 'water' ? Math.floor(a.inv[goods] - 3) : Math.floor(a.inv[goods]);
    opts.push({ s: 'trade', fit: 0.8, intent: intentLine('money.sell', r('m-sell'), { ...vars, res: goods, n }), plan: new Plan(a.locationId).go('market').add('sell', [goods, n], 'Selling ' + n + ' ' + goods) });
    if (stormAt(tx.world, 'landing_pad') === 0) {
      opts.push({ s: 'smuggle', fit: 0.85, crime: true, risk: await riskAt(tx, 'landing_pad', a), intent: intentLine('money.smuggle', r('m-smug'), { ...vars, res: goods, n, why: c.drives.has('escape') ? ' to a ticket off this rock' : '' }), plan: new Plan(a.locationId).go('landing_pad', 'Slipping out to the Landing Pad').add('smuggle', [goods, n], 'Selling ' + goods + ' off the books') });
    }
  }
  const site = (['quarry', 'landing_pad', 'solar_farm'] as const).find((l) => stormAt(tx.world, l) === 0);
  if (site) opts.push({ s: 'scavenge', fit: 0.6, intent: intentLine('money.scavenge', r('m-scav'), { ...vars, place: site }), plan: new Plan(a.locationId).go(site).add('scavenge', [site], 'Scavenging at ' + locName(site)).add('scavenge', [site], 'Still scavenging at ' + locName(site)) });
  if (a.inv.water >= 1 || (c.household?.pantry.water ?? 0) >= 3) opts.push({ s: 'grow', fit: 0.6, intent: intentLine('money.grow', r('m-grow'), vars), plan: new Plan(a.locationId).go(a.homeLocationId).add('grow', [12], 'Tending the grow rack at home') });
  const lenderTie = c.ties.filter((t) => t.toAlive && t.trust >= 0.2).sort((x, y) => y.trust - x.trust)[0];
  const lender = lenderTie ? await findable(c, lenderTie.toAgentId) : null;
  if (lender && lender.inv.credits >= 30 && pressure > 0.5) opts.push({ s: 'borrow', fit: 0.6, intent: intentLine('money.borrow', r('m-borrow'), { ...vars, who: lender.name, n: 20 }), plan: new Plan(a.locationId).go(lender.locationId, 'Looking for ' + lender.name).add('borrow', [lender._id, 'credits', 20], 'Borrowing 20 credits from ' + lender.name) });
  const fondTie = c.ties.filter((t) => t.toAlive && t.affinity >= 0.35 && t.kind !== 'rival').sort((x, y) => y.affinity - x.affinity)[0];
  const patron = fondTie && fondTie.toAgentId !== lender?._id ? await findable(c, fondTie.toAgentId) : null;
  if (patron && patron.inv.credits >= 30) opts.push({ s: 'charm', fit: 0.55 + fondTie!.affinity * 0.4, intent: intentLine('need.charm', r('m-charm'), { ...vars, res: 'credits', who: patron.name }), plan: new Plan(a.locationId).go(patron.locationId, 'Looking for ' + patron.name).add('talk', [patron._id], 'Sweet-talking ' + patron.name).add('beg', [patron._id, 'credits'], 'Asking ' + patron.name + ' for a few credits') });
  if (pressure > 0.6 || c.weights.beg >= 0.45) opts.push({ s: 'beg', fit: 0.5, intent: intentLine('need.beg', r('m-beg'), { ...vars, res: 'credits', place: 'plaza' }), plan: new Plan(a.locationId).go('plaza').add('beg', ['any', 'credits'], 'Asking passers-by for credits') });
  const leverage = c.beliefs.find((b) => b.subjectAgentId && b.subjectAgentId !== a._id && b.valence < 0 && isScandal(b.kind) && b.confidence >= 0.55 && (b.acted === undefined || tx.tick - b.acted > 144));
  const mark = leverage ? await findable(c, leverage.subjectAgentId) : null;
  if (mark && leverage && mark.inv.credits >= 15) opts.push({ s: 'scheme', fit: 0.9, crime: true, risk: 0.1, intent: intentLine('money.blackmail', r('m-bm'), { ...vars, who: mark.name }), plan: new Plan(a.locationId).go(mark.locationId, 'Finding ' + mark.name).add('blackmail', [mark._id, leverage.key], 'Leaning on ' + mark.name) });
  const markTie = c.ties.filter((t) => t.toAlive && t.affinity < 0.1 && t.kind !== 'family').sort((x, y) => x.affinity - y.affinity)[0];
  const victim = markTie ? await findable(c, markTie.toAgentId) : null;
  if (victim && victim.inv.credits >= 25 && a.occupation !== 'security') opts.push({ s: 'steal', fit: 0.65, crime: true, risk: await riskAt(tx, victim.locationId, a), intent: intentLine('money.steal', r('m-steal'), { ...vars, who: victim.name, place: victim.locationId }), plan: new Plan(a.locationId).go(victim.locationId, 'Following ' + victim.name).add('steal', [victim._id, 'credits', 15], 'Lifting credits from ' + victim.name) });
  if (opts.length === 0) return null;
  const morals = a.traits.empathy * 0.5 + c.mind.values.harmony * 0.35 + a.traits.caution * 0.2;
  let best: { o: Option; v: number } | null = null;
  for (const o of opts) {
    let v = c.weights[o.s] * o.fit + strategyMemory(c.mind, o.s, tx.tick) + chance(c, 'money:' + o.s) * 0.45;
    if (o.crime) v += (c.weights[o.s] >= 0.55 ? 0.2 : -0.1) + pressure * 0.2 - morals * 0.5 - (o.risk ?? 0) * (0.4 + a.traits.caution * 0.6);
    if (!best || v > best.v) best = { o, v };
  }
  const { o } = best!;
  return {
    score: 0.2 + pressure * 0.35 + c.mind.values.wealth * 0.1 + (c.drives.has('wealth') || c.drives.has('escape') ? 0.1 : 0),
    routine: o.s === 'work' && pressure < 0.6,
    intent: o.intent,
    steps: o.plan.steps,
    labels: o.plan.labels,
    trigger: 'down to ' + Math.floor(a.inv.credits) + ' credits',
    strategy: { s: o.s, res: 'credits' },
  };
}

/** The hidden stash, if there is one worth going home for. */
export const stashed = (mind: MindDoc, res: 'food' | 'water'): boolean => stashTotal(mind) > 0 && (mind.ledger?.stash[res] ?? 0) >= 1;
