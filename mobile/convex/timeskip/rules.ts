/**
 * The macro rules: how a colony lives through weeks and years when nobody is steering. Each rule
 * reads the people and the society state of the chapter, rolls yearly odds scaled to the chapter's
 * length, and acts through the legal effects (./effects.ts) and the live helpers, so the outcome is
 * persona-driven (traits, values, flaws, wants) and consistent with the society layer.
 */
import type { Id } from '../_generated/dataModel';
import { MAX_POPULATION, OCCUPATIONS, SPRITE_VARIANTS, TICKS_PER_DAY, TRADED_RESOURCES } from '../../shared/colony';
import type { SpriteArchetype } from '../../shared/colony';
import { ART_KINDS, DISCOVERY_BY_KEY, FIELD_SKILLS, STRUCTURES, STRUCTURE_BY_KEY } from '../../shared/society';
import type { DiscoveryDef } from '../../shared/society';
import { addStock, reserveRatio, stock } from '../engine/conditions';
import { adjustRelationship, dayOf, tiesOf, tieTo, touch, touchMind } from '../engine/core';
import type { AgentId, EventId } from '../engine/core';
import { fillVacancies } from '../engine/council';
import { BASE_PRICES, CANTEEN_TARGET, NORMAL_STOCK, RESERVE_FLOOR } from '../lib/constants';
import { clamp, round2 } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import type { SeedAgent } from '../seed/build';
import { FAMILY_NAMES, FIRST_NAMES } from '../seed/names';
import { generatedPersona } from '../seed/personas';
import { availableDiscoveries, bonusFor, discover, eventWeight } from '../society/craft';
import { createArtDone } from '../society/culture';
import { RANDOM_EVENT_KEYS, experience, fireRandomEvent } from '../society/events';
import { birth, growUp, insertPerson } from '../society/family';
import { chooseLeader, foundingDesire, kindAffinity, rankOf, removeMember } from '../society/orgs';
import { activeOrgs, saveOrg, shiftStatus, societyOf, targetStatus } from '../society/store';
import type { OrgDoc } from '../society/store';
import {
  affair,
  die,
  expose,
  feud,
  found,
  leave,
  reconcile,
  recruitInto,
  romance,
  secede,
  separate,
  settleDebt,
  takeChair,
  takeJob,
  wed,
} from './effects';
import { adults, ageOf, count, first, happens, living, pickOne, roll, setAdultAge, tell, tickOn, weighted, within } from './model';
import type { Chapter, Person } from './model';
import { TICKS_PER_YEAR } from './spans';

const isChild = (p: Person) => p.mind.ageBand === 'child';
const free = (ch: Chapter, p: Person) => !ch.moved.has(p.a._id);
const occLabel = (id: string) => OCCUPATIONS.find((o) => o.id === id)?.label.toLowerCase() ?? id;

/** Runs every macro rule once for the chapter, in an order where causes come before their effects. */
export async function runRules(ch: Chapter): Promise<void> {
  if (ch.index === 0) await settleIn(ch);
  await aging(ch);
  await health(ch);
  await suddenEvents(ch);
  await births(ch);
  await love(ch);
  await grudges(ch);
  await debts(ch);
  await secrets(ch);
  await organizations(ch);
  await leadership(ch);
  await work(ch);
  await culture(ch);
  await research(ch);
  await building(ch);
  await obsessions(ch);
  await migration(ch);
  await economy(ch);
}

// ---------- the first chapter ----------

/** Gives every adult a real age, ends standing effects, and delivers the babies already on the way. */
async function settleIn(ch: Chapter): Promise<void> {
  for (const p of ch.people.values()) {
    societyOf(ch.tx, p.a, p.mind);
    if (isChild(p) || (p.mind.society?.bornTick !== undefined && p.mind.society.bornTick < -TICKS_PER_DAY * 30)) continue;
    const r = roll(ch, p.a.seq, 'age');
    const years = p.mind.ageBand === 'young' ? 18 + r * 11 : p.mind.ageBand === 'elder' ? 62 + r * 16 : 30 + r * 30;
    setAdultAge(ch, p, years);
  }
  for (const preg of [...ch.meta.pregnancies]) {
    const carrier = living(ch, preg.carrierId);
    const partner = living(ch, preg.partnerId);
    ch.meta.pregnancies = ch.meta.pregnancies.filter((x) => x !== preg);
    if (!carrier) continue;
    tickOn(ch);
    const child = await birth(ch.tx, carrier.a, partner?.a ?? null, preg.eventId as EventId | undefined);
    if (child) adopt(ch, child._id);
  }
  ch.meta.missing = [];
}

function adopt(ch: Chapter, id: AgentId): void {
  const a = ch.tx.agents.get(id);
  const mind = a?.mindId ? ch.tx.minds.get(a.mindId) : undefined;
  if (a && mind) ch.people.set(id, { a, mind });
  count(ch, 'born');
}

// ---------- growing up and growing old ----------

async function aging(ch: Chapter): Promise<void> {
  for (const p of [...ch.people.values()]) {
    const years = ageOf(ch, p);
    const next = years + ch.dtY;
    if (isChild(p)) {
      educate(ch, p, years);
      if (next < 18) continue;
      tickOn(ch);
      await growUp(ch.tx, p.a, p.mind);
      setAdultAge(ch, p, 18);
      const s = p.mind.society!;
      s.education = { studying: undefined, progress: 0, mastered: [...(s.education?.mastered ?? []), PRIMARY_SKILL[p.a.occupation] ?? 'craft'].slice(-4) };
      count(ch, 'cameOfAge');
      continue;
    }
    if (p.mind.ageBand === 'young' && next >= 30) p.mind.ageBand = 'adult';
    else if (p.mind.ageBand === 'adult' && next >= 62) p.mind.ageBand = 'elder';
    else continue;
    touchMind(ch.tx, p.mind);
  }
}

/** Children learn: the school, their parents' trades, and what their nature leans toward. */
function educate(ch: Chapter, p: Person, years: number): void {
  if (years < 5) return;
  const t = p.a.traits;
  const sk = p.mind.skills;
  const gain = (k: string, n: number) => (sk[k] = round2(Math.min(60, (sk[k] ?? 0) + n * ch.dtY)));
  gain('science', 2 + t.curiosity * 6);
  gain('craft', 3);
  gain('persuasion', 1 + t.sociability * 4);
  gain('art', (t.curiosity + t.sociability) * 2.5 * (roll(ch, p.a.seq, 'artkid') < 0.4 ? 2 : 0.5));
  for (const pid of p.mind.society?.parentIds ?? []) {
    const parent = living(ch, pid);
    const skill = parent ? PRIMARY_SKILL[parent.a.occupation] : undefined;
    if (skill) gain(skill, 3.5);
  }
  const best = Object.entries(sk).sort((x, y) => y[1] - x[1])[0];
  const s = societyOf(ch.tx, p.a, p.mind);
  s.education = { studying: best?.[0], progress: round2(clamp(years / 18, 0, 1)), mastered: s.education?.mastered ?? [] };
  touchMind(ch.tx, p.mind);
}

// ---------- bodies ----------

const MORTALITY: [number, number][] = [
  [18, 0.001],
  [40, 0.003],
  [60, 0.008],
  [70, 0.03],
  [80, 0.07],
  [200, 0.16],
];
const EXPOSED = new Set(['ice_miner', 'quarry_hand', 'solar_tech', 'dock_hand']);

async function health(ch: Chapter): Promise<void> {
  const candidates: { p: Person; kind: 'illness' | 'accident' | 'age'; r: number }[] = [];
  for (const p of ch.people.values()) {
    const years = ageOf(ch, p);
    const elder = p.mind.ageBand === 'elder';
    p.a.health = round2(clamp(p.a.health + (elder ? -3 : 4) * ch.dtY * 4, 20, 100));
    touch(ch.tx, p.a);
    const base = MORTALITY.find(([upTo]) => years < upTo)![1] * (p.a.health < 50 ? 2 : 1) * (ch.crisis ? 1.6 : 1);
    if (happens(ch, base, p.a.seq, 'mortal')) candidates.push({ p, kind: years >= 70 ? 'age' : 'illness', r: roll(ch, p.a.seq, 'order') });
    else if (EXPOSED.has(p.a.occupation) && happens(ch, 0.004 + (1 - p.a.traits.caution) * 0.004, p.a.seq, 'accident')) candidates.push({ p, kind: 'accident', r: roll(ch, p.a.seq, 'order') });
  }
  for (const c of candidates.sort((x, y) => x.r - y.r)) {
    if (!ch.people.has(c.p.a._id)) continue;
    if (!(await die(ch, c.p, c.kind))) break;
  }
}

// ---------- sudden events ----------

type Sudden = { key: string; weight: number; run: (ch: Chapter) => Promise<EventId | null> };

const FLAVOUR = ['festival_day', 'strange_signal', 'reactor_scare', 'long_dark_log', 'artist_breakthrough', 'visiting_trader', 'comet', 'anonymous_gift', 'ghost_sighting', 'cache_found', 'stray_litter'];

async function suddenEvents(ch: Chapter): Promise<void> {
  const expected = ch.dtY * 5;
  let n = Math.floor(expected) + (roll(ch, 0, 'sudden-n') < expected - Math.floor(expected) ? 1 : 0);
  n = Math.min(n, 3);
  const pool: Sudden[] = [
    { key: 'epidemic', weight: 1 * eventWeight(ch.meta, 'disease_outbreak'), run: epidemic },
    { key: 'accident', weight: 1.6, run: accident },
    { key: 'moonquake', weight: 1 * eventWeight(ch.meta, 'moonquake'), run: quake },
    { key: 'ship', weight: 1.6 * eventWeight(ch.meta, 'shuttle_stranger'), run: (c) => ship(c) },
    { key: 'shortage', weight: ch.tx.world.econ.rationLevel >= 2 ? 0.3 : 1, run: shortage },
    { key: 'boom', weight: ch.tx.world.econ.rationLevel > 0 ? 1.6 : 0.8, run: boom },
    ...FLAVOUR.filter((k) => RANDOM_EVENT_KEYS.includes(k)).map((k) => ({ key: k, weight: 0.35 * eventWeight(ch.meta, k), run: async (c: Chapter) => (tickOn(c), await fireRandomEvent(c.tx, k)) })),
  ];
  for (let i = 0; i < n; i++) {
    const pick = weighted(pool, (s) => s.weight, roll(ch, i, 'sudden'));
    if (!pick) break;
    pool.splice(pool.indexOf(pick), 1);
    await pick.run(ch);
  }
}

async function epidemic(ch: Chapter): Promise<EventId | null> {
  const ring = roll(ch, 1, 'ring') < 0.5 ? 'habitat_a' : 'habitat_b';
  const medicine = stock(ch.tx.world, 'medbay', 'medicine') + stock(ch.tx.world, 'depot', 'medicine');
  const id = await tell(ch, { category: 'health', eventType: 'epidemic', locationId: ring, summary: 'A fever went through ' + (ring === 'habitat_a' ? 'Ring A' : 'Ring B') + (medicine > 12 ? '; the medics had enough medicine for most.' : ', and the medicine ran out in the second week.'), salience: 0.78 });
  addStock(ch.tx.world, 'medbay', 'medicine', -Math.min(stock(ch.tx.world, 'medbay', 'medicine'), 8));
  const weak = [...ch.people.values()].filter((p) => p.a.homeLocationId === ring && (p.mind.ageBand === 'elder' || p.a.health < 60)).sort((x, y) => x.a.health - y.a.health);
  const deaths = medicine > 12 ? (roll(ch, 2, 'fever') < 0.3 ? 1 : 0) : 1 + Math.floor(roll(ch, 3, 'fever') * 2);
  for (const p of weak.slice(0, deaths)) await die(ch, p, 'illness', { cause: id, words: 'the fever' });
  const medic = [...ch.people.values()].find((p) => p.a.occupation === 'medic');
  if (medic) shiftStatus(ch.tx, medic.mind, 4);
  return id;
}

async function accident(ch: Chapter): Promise<EventId | null> {
  const exposed = [...ch.people.values()].filter((p) => EXPOSED.has(p.a.occupation));
  const victim = weighted(exposed, (p) => 1.2 - p.a.traits.caution, roll(ch, 4, 'victim'));
  if (!victim) return null;
  const where = victim.a.workLocationId ?? 'ice_wells';
  const what = where === 'quarry' ? 'A wall of the quarry came down' : where === 'solar_farm' ? 'A panel array tore loose in a micrometeor shower' : where === 'landing_pad' ? 'A cargo sled broke free on the pad' : 'A drill head shattered at the Ice Wells';
  const id = await tell(ch, { category: 'environment', eventType: 'accident', actorId: victim.a._id, locationId: where, summary: what + ' with ' + victim.a.name + ' beneath it.', salience: 0.72 });
  if (roll(ch, 5, 'fatal') < 0.35) {
    await die(ch, victim, 'accident', { cause: id, words: 'the accident at ' + (where === 'quarry' ? 'the quarry' : where === 'solar_farm' ? 'the solar farm' : where === 'landing_pad' ? 'the pad' : 'the wells') });
    return id;
  }
  victim.a.health = Math.max(25, victim.a.health - 35);
  touch(ch.tx, victim.a);
  const rescuer = weighted([...ch.people.values()].filter((p) => p !== victim && p.a.workLocationId === where), (p) => 0.4 + p.a.traits.empathy - p.a.traits.caution * 0.5, roll(ch, 6, 'hero'));
  if (rescuer) {
    await adjustRelationship(ch.tx, victim.a, rescuer.a, { affinity: 0.4, trust: 0.4, obligation: 0.4 });
    const saved = await tell(ch, { category: 'social', eventType: 'heroism', actorId: rescuer.a._id, participantIds: [victim.a._id], summary: rescuer.a.name + ' dug ' + victim.a.name + ' out with their hands. ' + first(victim.a.name) + ' lived.', salience: 0.68, causationEventId: id });
    await experience(ch.tx, rescuer.a, rescuer.mind, 'saved', saved);
  }
  return id;
}

async function quake(ch: Chapter): Promise<EventId | null> {
  const sites = ['ice_wells', 'quarry', 'habitat_b', 'workshop', 'solar_farm', 'habitat_a'];
  const loc = pickOne(sites, roll(ch, 7, 'quake'))!;
  ch.tx.world.damage[loc] = round2(clamp((ch.tx.world.damage[loc] ?? 0) + 0.35, 0, 1));
  const id = await tell(ch, { category: 'environment', eventType: 'moonquake', locationId: loc, summary: 'A moonquake cracked the ground under ' + locWord(loc) + '; it took weeks to make it safe again.', salience: 0.74 });
  if (roll(ch, 8, 'quakedeath') < 0.2) {
    const here = [...ch.people.values()].filter((p) => p.a.workLocationId === loc || p.a.homeLocationId === loc);
    const victim = pickOne(here, roll(ch, 9, 'qv'));
    if (victim) await die(ch, victim, 'accident', { cause: id, words: 'the quake' });
  }
  return id;
}

const locWord = (loc: string): string => ({ ice_wells: 'the Ice Wells', quarry: 'the quarry', habitat_a: 'Ring A', habitat_b: 'Ring B', workshop: 'the works', solar_farm: 'the solar farm', depot: 'the depot', plaza: 'the plaza' })[loc] ?? loc;

const SHIPS = ['Perseverance', 'Halcyon', 'Second Chance', 'Meridian Ghost', 'Kestrel', 'Long Haul', 'Tycho Queen', 'Saint Brendan'];

/** A shuttle brings newcomers, each with a full persona from the seed's character generator, and cargo. */
export async function ship(ch: Chapter, n?: number): Promise<EventId | null> {
  const room = MAX_POPULATION - ch.tx.world.population.alive;
  const count_ = Math.min(room, n ?? 1 + Math.floor(roll(ch, 10, 'arrivals') * 3));
  addStock(ch.tx.world, 'depot', 'parts', 20);
  addStock(ch.tx.world, 'medbay', 'medicine', 6);
  if (count_ <= 0) return null;
  const arrived: Person[] = [];
  for (let i = 0; i < count_; i++) {
    const p = await newcomer(ch, i);
    if (p) arrived.push(p);
  }
  if (arrived.length === 0) return null;
  const name = pickOne(SHIPS, roll(ch, 11, 'ship'))!;
  const who = arrived.map((p) => p.a.name + ', ' + (p.mind.persona?.epithet ?? 'a ' + occLabel(p.a.occupation)));
  count(ch, 'arrived', arrived.length);
  return await tell(ch, { category: 'social', eventType: 'arrival', actorId: arrived[0].a._id, participantIds: arrived.slice(1).map((p) => p.a._id), locationId: 'landing_pad', summary: 'The shuttle ' + name + ' brought ' + (arrived.length === 1 ? 'a new face: ' : arrived.length + ' new faces: ') + who.join('; ') + '.', salience: 0.72 });
}

async function newcomer(ch: Chapter, i: number): Promise<Person | null> {
  const tx = ch.tx;
  const r = (salt: string) => roll(ch, 1000 + i, 'nc' + salt);
  const taken = new Set([...ch.people.values()].map((p) => p.a.name));
  let name = '';
  for (let k = 0; k < 12 && (!name || taken.has(name)); k++) name = pickOne(FIRST_NAMES, r('f' + k))! + ' ' + pickOne(FAMILY_NAMES, r('l' + k))!;
  if (taken.has(name)) return null;
  const vacancy = tx.world.vacancies.find((v) => v.occupation !== 'councilor' && v.occupation !== 'resident')?.occupation;
  const occupation = vacancy ?? pickOne(['medic', 'fabricator', 'trader', 'researcher', 'ice_miner', 'solar_tech', 'hydroponicist', 'dock_hand', 'cook', 'security'], r('occ'))!;
  const def = OCCUPATIONS.find((o) => o.id === occupation)!;
  const ageBand = r('age') < 0.55 ? 'young' : r('age2') < 0.9 ? 'adult' : 'elder';
  const home = r('home') < 0.6 ? 'habitat_b' : 'habitat_a';
  const v = (k: string) => round2(0.15 + r(k) * 0.7);
  const traits = { ambition: v('a'), empathy: v('e'), caution: v('c'), curiosity: v('u'), sociability: v('s'), stubbornness: v('t') };
  const values = { wealth: v('w'), family: v('fa'), status: v('st'), harmony: v('h'), freedom: v('fr') };
  const primary = PRIMARY_SKILL[occupation] ?? 'craft';
  const skill = Math.round(ageBand === 'young' ? 32 + r('sk') * 15 : 48 + r('sk') * 25);
  const spriteId = (def.archetype as SpriteArchetype) + '_' + Math.floor(r('sp') * SPRITE_VARIANTS);
  const seq = tx.world.nextSeq;
  const seed: SeedAgent = {
    seq,
    name,
    familyName: name.split(' ').slice(-1)[0],
    ageBand,
    occupation,
    household: 0,
    home,
    workLocationId: def.workLocationId,
    spriteId,
    traits,
    values,
    skills: { [primary]: skill, persuasion: Math.round(20 + traits.sociability * 40) },
    skill,
    dayOffset: 0,
    background: 'Came up from Earth on a supply shuttle, ' + (r('why') < 0.5 ? 'with a contract and not much else' : 'running from something they do not talk about') + '.',
    inv: { food: 2, water: 2, parts: 0, medicine: 0, credits: Math.round(40 + r('cr') * 120) },
    health: ageBand === 'elder' ? 80 : 100,
    goals: [{ kind: 'earn_wealth', description: 'Make something of the move', priority: 0.6, source: 'personality', predicate: 'credits_at_least', targetQuantity: 150 + Math.round(r('g') * 150) }],
    thefts: 0,
  };
  const persona = generatedPersona(seed, { household: { name: name + "'s bunk", home, members: [seq], pantry: { food: 2, water: 3 }, family: false }, agents: [], edges: [], usedEpithets: new Set(), next: () => r('p' + Math.random().toString().slice(2, 6)) });
  const householdId = await tx.ctx.db.insert('households', { worldId: tx.world._id, name: name + "'s bunk", homeLocationId: home, memberIds: [], pantry: { food: 2, water: 3 }, rationDue: { food: 0, water: 0 }, rationDay: dayOf(tx.tick) });
  const { a, mind } = await insertPerson(tx, {
    name,
    spriteId,
    ageBand,
    occupation,
    homeLocationId: home,
    locationId: home,
    householdId,
    traits,
    values,
    skills: seed.skills,
    background: seed.background,
    persona: { epithet: persona.epithet, want: persona.want, need: persona.need, fear: persona.fear, flaw: persona.flaw, voice: persona.voice, secret: persona.secret, strategies: persona.strategies, arc: { stage: 'setup', note: persona.arc }, key: false },
    inv: seed.inv,
    dayOffset: 0,
    mood: 'wary',
  });
  const p = { a, mind };
  ch.people.set(a._id, p);
  setAdultAge(ch, p, ageBand === 'young' ? 19 + r('yrs') * 10 : ageBand === 'adult' ? 31 + r('yrs') * 25 : 62 + r('yrs') * 8);
  tx.world.vacancies = tx.world.vacancies.filter((x) => x.occupation !== vacancy || x !== tx.world.vacancies.find((y) => y.occupation === vacancy));
  return p;
}

async function shortage(ch: Chapter): Promise<EventId | null> {
  const res = roll(ch, 12, 'short') < 0.5 ? 'food' : 'water';
  const lost = Math.round(stock(ch.tx.world, 'depot', res) * 0.55);
  addStock(ch.tx.world, 'depot', res, -lost);
  const id = await tell(ch, { category: 'economy', eventType: 'shortage', locationId: 'depot', summary: res === 'food' ? 'Rust blight took the racks one by one; the depot lost more than half its food, and the queues at the canteen grew long and quiet.' : 'A bad batch of meltwater had to be dumped; for weeks the colony counted every cup.', salience: 0.76 });
  await setRations(ch, Math.min(2, ch.tx.world.econ.rationLevel + 1), id);
  const qm = living(ch, ch.tx.world.roles.quartermaster);
  if (qm) shiftStatus(ch.tx, qm.mind, -4);
  return id;
}

async function boom(ch: Chapter): Promise<EventId | null> {
  const miners = [...ch.people.values()].filter((p) => p.a.occupation === 'ice_miner' || p.a.occupation === 'hydroponicist');
  const lucky = pickOne(miners, roll(ch, 13, 'lucky'));
  const water = lucky?.a.occupation === 'ice_miner';
  addStock(ch.tx.world, 'depot', 'water', water ? 220 : 60);
  addStock(ch.tx.world, 'depot', 'food', water ? 40 : 160);
  ch.tx.world.econ.treasury = round2(ch.tx.world.econ.treasury + 400);
  if (lucky) {
    const s = societyOf(ch.tx, lucky.a, lucky.mind);
    s.fame = round2(Math.min(1, s.fame + 0.12));
    shiftStatus(ch.tx, lucky.mind, 6);
  }
  const id = await tell(ch, { category: 'economy', eventType: 'boom', actorId: lucky?.a._id, summary: lucky ? (water ? lucky.a.name + ' hit a seam of clean ice so rich the wells ran day and night; for a season, nobody counted cups.' : lucky.a.name + "'s new racks gave the best harvest the colony had seen; the depot filled to the rafters.") : 'A good season: the depot filled and the shuttles paid well.', salience: 0.7 });
  if (ch.tx.world.econ.rationLevel > 0) await setRations(ch, ch.tx.world.econ.rationLevel - 1, id);
  return id;
}

async function setRations(ch: Chapter, level: number, cause?: EventId): Promise<void> {
  const econ = ch.tx.world.econ;
  if (level === econ.rationLevel) return;
  const cut = level > econ.rationLevel;
  econ.rationLevel = level;
  const chair = living(ch, ch.tx.world.roles.chair);
  await tell(ch, { category: 'politics', eventType: 'ration_change', actorId: chair?.a._id, summary: cut ? (level === 2 ? 'The council put the colony on emergency rations.' : 'The council cut the daily ration.') : level === 0 ? 'Full rations again, at last.' : 'The council eased the ration a little.', salience: cut ? 0.72 : 0.6, causationEventId: cause });
  if (chair) shiftStatus(ch.tx, chair.mind, cut ? -3 : 3);
}

// ---------- families ----------

async function births(ch: Chapter): Promise<void> {
  const pop = ch.tx.world.population.alive;
  const crowd = clamp((MAX_POPULATION - pop) / 25, 0, 1);
  if (crowd <= 0) return;
  for (const [x, y] of [...ch.meta.couples]) {
    const a = living(ch, x);
    const b = living(ch, y);
    if (!a || !b || a.mind.ageBand === 'elder' || b.mind.ageBand === 'elder' || isChild(a)) continue;
    if (ageOf(ch, a) > 46) continue;
    const kids = a.mind.society?.childIds.length ?? 0;
    const want = (a.mind.values.family + b.mind.values.family) / 2;
    const rate = (0.1 + want * 0.25) * (kids === 0 ? 1.2 : kids === 1 ? 0.9 : kids === 2 ? 0.35 : 0.05) * crowd * (ch.meta.wantChild.includes(x) || ch.meta.wantChild.includes(y) ? 2 : 1);
    if (!happens(ch, rate, a.a.seq, 'conceive')) continue;
    if (ch.tx.world.population.alive >= MAX_POPULATION) return;
    tickOn(ch);
    const child = await birth(ch.tx, a.a, b.a);
    if (child) adopt(ch, child._id);
  }
}

async function love(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  const singles = adults(ch).filter((p) => !p.mind.society?.partnerId && p.mind.ageBand !== 'elder');
  let budget = Math.ceil(3 * ch.dtY + 1);
  for (const p of singles) {
    if (budget <= 0) break;
    if (!free(ch, p) || p.mind.society?.partnerId) continue;
    const ties = await tiesOf(tx, p.a._id);
    const flame = ties.find((t) => t.kind === 'romance' && t.toAlive && living(ch, t.toAgentId) && !living(ch, t.toAgentId)!.mind.society?.partnerId);
    if (flame) {
      const other = living(ch, flame.toAgentId)!;
      const rate = 0.35 + (p.mind.values.family + other.mind.values.family) * 0.25 + flame.affinity * 0.3;
      if (happens(ch, rate, p.a.seq, 'wed') && (await wed(ch, p, other))) budget -= 1;
      continue;
    }
    if (!happens(ch, 0.18 + p.a.traits.sociability * 0.15 + p.mind.values.family * 0.1, p.a.seq, 'look')) continue;
    const age = ageOf(ch, p);
    const fits = (o: Person) => o !== p && !isChild(o) && !o.mind.society?.partnerId && Math.abs(ageOf(ch, o) - age) <= 16 && !p.mind.society?.parentIds.includes(o.a._id) && !p.mind.society?.childIds.includes(o.a._id);
    const known = ties.filter((t) => t.toAlive && t.kind !== 'family' && t.kind !== 'rival' && t.affinity >= 0.2).map((t) => living(ch, t.toAgentId)).find((o): o is Person => !!o && fits(o));
    const other =
      known ??
      weighted(
        singles.filter(fits),
        (o) => 1.2 - Math.abs(o.a.traits.sociability - p.a.traits.sociability) - Math.abs(o.mind.values.family - p.mind.values.family) + (o.a.homeLocationId === p.a.homeLocationId ? 0.3 : 0) + (o.a.workLocationId === p.a.workLocationId ? 0.4 : 0),
        roll(ch, p.a.seq, 'who'),
      );
    if (other && (await romance(ch, p, other))) budget -= 1;
  }
  for (const [x, y] of [...ch.meta.couples]) {
    const a = living(ch, x);
    const b = living(ch, y);
    if (!a || !b || !free(ch, a) || !free(ch, b)) continue;
    const ab = (await tieTo(tx, a.a._id, b.a._id))?.affinity ?? 0.5;
    const ba = (await tieTo(tx, b.a._id, a.a._id))?.affinity ?? 0.5;
    const cold = Math.min(ab, ba);
    const rate = 0.015 + (cold < 0.15 ? 0.3 : 0) + (1 - (a.mind.values.harmony + b.mind.values.harmony) / 2) * 0.03;
    if (happens(ch, rate, a.a.seq, 'split')) {
      const leaver = a.a.traits.stubbornness + a.mind.values.freedom > b.a.traits.stubbornness + b.mind.values.freedom ? a : b;
      await separate(ch, leaver, leaver === a ? b : a);
      continue;
    }
    for (const [p, partner] of [[a, b], [b, a]] as const) {
      const lean = (1 - p.a.traits.caution) * 0.5 + p.a.traits.sociability * 0.3 + (p.mind.persona?.flaw && /restless|wander|tempt|bored|reckless/i.test(p.mind.persona.flaw) ? 0.3 : 0) + (cold < 0.3 ? 0.3 : 0);
      if (!happens(ch, 0.012 + lean * 0.04, p.a.seq, 'stray')) continue;
      const lover = (await tiesOf(tx, p.a._id)).map((t) => (t.toAgentId !== partner.a._id && t.kind !== 'family' && t.affinity >= 0.3 ? living(ch, t.toAgentId) : undefined)).find((o): o is Person => !!o && !isChild(o));
      if (lover) {
        await affair(ch, p, lover);
        break;
      }
    }
  }
}

// ---------- grudges ----------

async function grudges(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  const pairs = new Map<string, { a: Person; b: Person; affinity: number }>();
  for (const p of adults(ch)) {
    for (const t of await tiesOf(tx, p.a._id, 6)) {
      if (t.affinity > -0.35 || !t.toAlive) continue;
      const o = living(ch, t.toAgentId);
      if (!o) continue;
      const key = [p.a._id, o.a._id].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, { a: p, b: o, affinity: t.affinity });
    }
  }
  const sorted = [...pairs.values()].sort((x, y) => x.affinity - y.affinity).slice(0, 6);
  for (const { a, b, affinity } of sorted) {
    if (!ch.people.has(a.a._id) || !ch.people.has(b.a._id) || !free(ch, a) || !free(ch, b)) continue;
    const soft = (a.a.traits.empathy + b.a.traits.empathy) / 2 + (a.mind.values.harmony + b.mind.values.harmony) / 4;
    const hard = (1 - Math.min(a.a.traits.empathy, b.a.traits.empathy)) * 0.6 + Math.max(a.a.traits.stubbornness, b.a.traits.stubbornness) * 0.4;
    const r = roll(ch, a.a.seq * 1000 + b.a.seq, 'grudge');
    if (r < within(ch, soft * 0.3)) {
      await reconcile(ch, a.a.traits.empathy >= b.a.traits.empathy ? a : b, a.a.traits.empathy >= b.a.traits.empathy ? b : a);
    } else if (r < within(ch, soft * 0.3 + hard * 0.25)) {
      const brute = a.a.traits.empathy <= b.a.traits.empathy ? a : b;
      const victim = brute === a ? b : a;
      if (affinity <= -0.65 && brute.a.traits.empathy < 0.35 && roll(ch, brute.a.seq, 'blood') < within(ch, 0.12)) await die(ch, victim, 'violence', { by: brute });
      else await feud(ch, brute, victim);
    }
  }
  if (happens(ch, 0.5, 0, 'newfeud')) {
    const ambitious = adults(ch).filter((p) => p.a.traits.ambition > 0.6 && free(ch, p));
    const a = pickOne(ambitious, roll(ch, 1, 'nf-a'));
    const b = a ? pickOne(ambitious.filter((o) => o !== a && (o.a.occupation === a.a.occupation || o.a.workLocationId === a.a.workLocationId)), roll(ch, 2, 'nf-b')) : undefined;
    if (a && b) await feud(ch, a, b, a.a.name + ' and ' + b.a.name + ' wanted the same things, and the colony was too small for both of them to have them.');
  }
}

// ---------- debts, secrets and blackmail ----------

async function debts(ch: Chapter): Promise<void> {
  for (const p of [...ch.people.values()]) {
    const owes = p.mind.ledger?.owes ?? [];
    const lenders = [...new Set(owes.map((d) => d.to))];
    for (const to of lenders) {
      const lender = living(ch, to);
      if (!lender) {
        p.mind.ledger!.owes = p.mind.ledger!.owes.filter((d) => d.to !== to);
        touchMind(ch.tx, p.mind);
        continue;
      }
      if (!happens(ch, 0.7, p.a.seq, 'debt' + lender.a.seq)) continue;
      const value = owes.filter((d) => d.to === to).reduce((s, d) => s + d.qty * (d.res === 'credits' ? 1 : 3), 0);
      const how = p.a.inv.credits >= value && roll(ch, p.a.seq, 'honest') < 0.4 + p.a.traits.caution * 0.4 ? 'repaid' : lender.a.traits.empathy > 0.65 ? 'forgiven' : 'defaulted';
      await settleDebt(ch, p, lender, how);
    }
  }
}

const DISQUALIFYING = new Set(['embezzler', 'thief', 'saboteur', 'smuggler', 'traitor', 'forger', 'informer', 'killer']);

async function secrets(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  let acted = 0;
  for (const p of [...ch.people.values()]) {
    if (acted >= 3) break;
    const secret = p.mind.persona?.secret;
    if (!secret || secret.exposedAtTick !== undefined || !ch.people.has(p.a._id)) continue;
    const holders = (await tx.ctx.db.query('beliefs').withIndex('by_world_key', (q) => q.eq('worldId', tx.world._id).eq('key', secret.kind + ':' + p.a._id)).take(6))
      .map((b) => living(ch, b.agentId))
      .filter((h): h is Person => !!h && h !== p);
    const holder = holders.sort((x, y) => x.a.traits.empathy - y.a.traits.empathy)[0];
    if (holder && happens(ch, 0.3, p.a.seq, 'leverage')) {
      acted += 1;
      const greedy = holder.a.traits.empathy < 0.45 && (holder.a.traits.ambition > 0.5 || holder.mind.values.wealth > 0.55);
      if (greedy && roll(ch, holder.a.seq, 'bm') < 0.6) {
        const take = Math.round(Math.min(p.a.inv.credits * 0.5, 120));
        p.a.inv.credits = round2(p.a.inv.credits - take);
        holder.a.inv.credits = round2(holder.a.inv.credits + take);
        touch(tx, p.a);
        touch(tx, holder.a);
        await adjustRelationship(tx, p.a, holder.a, { affinity: -0.4, fear: 0.4, trust: -0.4 });
        ch.moved.add(p.a._id);
        await tell(ch, { category: 'social', eventType: 'blackmail', actorId: holder.a._id, participantIds: [p.a._id], summary: holder.a.name + ' knew what ' + p.a.name + ' had done, and made them pay for silence' + (take > 0 ? ', ' + take + ' credits at a time.' : '.'), salience: 0.62, visibility: 'private' });
        continue;
      }
      const id = await expose(ch, p, holder);
      if (id && DISQUALIFYING.has(secret.kind) && roll(ch, p.a.seq, 'exile') < 0.35) await leave(ch, p, 'exile', undefined, undefined, id);
      continue;
    }
    if (happens(ch, 0.04 + (p.a.traits.empathy > 0.65 ? 0.05 : 0), p.a.seq, 'surface')) {
      acted += 1;
      const digger = p.a.traits.empathy > 0.65 ? undefined : weighted([...ch.people.values()].filter((o) => o !== p && !isChild(o)), (o) => (o.a.occupation === 'security' ? 2 : 0) + o.a.traits.curiosity, roll(ch, p.a.seq, 'digger'));
      const id = await expose(ch, p, digger);
      if (id && DISQUALIFYING.has(secret.kind) && roll(ch, p.a.seq, 'exile') < 0.3) await leave(ch, p, 'exile', undefined, undefined, id);
    }
  }
}

// ---------- organizations ----------

async function organizations(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  for (const org of [...(await activeOrgs(tx))]) {
    if (org.status !== 'active') continue;
    org.memberIds = org.memberIds.filter((id) => ch.people.has(id));
    org.officerIds = org.officerIds.filter((id) => ch.people.has(id));
    if (org.memberIds.length === 0) {
      await saveOrg(tx, org);
      await import('../society/orgs').then((m) => m.disband(tx, org, 'nobody was left in it'));
      continue;
    }
    if (!org.leaderId || !ch.people.has(org.leaderId)) {
      org.leaderId = undefined;
      tickOn(ch);
      if (!(await chooseLeader(tx, org))) continue;
    }
    const dues = org.kind === 'company' ? 60 : 25;
    org.treasury = round2(Math.max(0, org.treasury + ch.dtY * org.memberIds.length * dues - ch.dtY * 40));
    const leader = living(ch, org.leaderId)!;
    const clout = ((leader.mind.society?.status ?? 30) / 100) * 0.6 + (leader.mind.skills.persuasion ?? 30) / 250;
    const n = Math.floor(ch.dtY * (1 + clout * 4) + roll(ch, 1, 'grow' + org._id));
    await recruitInto(ch, org, n);
    for (const id of [...org.memberIds]) {
      const p = living(ch, id);
      if (!p || id === org.leaderId || kindAffinity(org.kind, p.a, p.mind) >= 0.22) continue;
      if (happens(ch, 0.3, p.a.seq, 'drift' + org._id)) await removeMember(tx, org, p.a, p.mind);
    }
    if (org.status !== 'active') continue;
    await saveOrg(tx, org);
    if (org.memberIds.length <= 1 && tx.tick - org.foundedTick > TICKS_PER_YEAR / 3 && happens(ch, 0.8, 1, 'lonely' + org._id)) {
      await (await import('./effects')).applyEffect(ch, { type: 'org_collapse', org: org._id });
      continue;
    }
    const members = org.memberIds.map((id) => living(ch, id)).filter((p): p is Person => !!p);
    const rival = members.filter((p) => p.a._id !== org.leaderId).sort((x, y) => (y.mind.society?.status ?? 0) + y.a.traits.ambition * 20 - (x.mind.society?.status ?? 0) - x.a.traits.ambition * 20)[0];
    const gap = rival ? (rival.mind.society?.status ?? 0) - (leader.mind.society?.status ?? 0) : -99;
    if (rival && members.length >= 4 && gap > 8 && rival.a.traits.ambition > 0.55 && happens(ch, 0.25, rival.a.seq, 'coup')) {
      const effects = await import('./effects');
      if (members.length >= 7 && roll(ch, rival.a.seq, 'splitorcoup') < 0.45) await effects.applyEffect(ch, { type: 'org_split', who: rival.a._id, org: org._id });
      else await effects.applyEffect(ch, { type: 'lead_org', who: rival.a._id, org: org._id });
    }
  }
  await orgRelations(ch);
  await founding(ch);
}

async function orgRelations(ch: Chapter): Promise<void> {
  const { applyEffect } = await import('./effects');
  const orgs = (await activeOrgs(ch.tx)).filter((o) => o.status === 'active');
  for (const x of orgs) {
    for (const y of orgs) {
      if (x._id >= y._id || x.status !== 'active' || y.status !== 'active') continue;
      const enemies = x.rivalIds.includes(y._id) || y.rivalIds.includes(x._id) || (x.kind === 'gang' && y.kind === 'militia') || (x.kind === 'militia' && y.kind === 'gang') || (x.kind === 'breakaway' && y.kind === 'militia');
      if (enemies && happens(ch, 0.35, 1, 'war' + x._id + y._id)) {
        await applyEffect(ch, { type: 'org_war', org: x._id, org2: y._id });
        continue;
      }
      if (x.kind === y.kind && x.memberIds.length <= 4 && y.memberIds.length <= 4 && x.leaderId && y.leaderId && !enemies) {
        const t = await tieTo(ch.tx, y.leaderId, x.leaderId);
        if ((t?.affinity ?? 0) > 0.1 && happens(ch, 0.3, 1, 'merge' + x._id + y._id)) await applyEffect(ch, { type: 'org_merge', org: x._id, org2: y._id });
      }
    }
  }
  const breakaway = orgs.find((o) => o.kind === 'breakaway' && o.status === 'active' && o.rules?.length);
  if (breakaway && happens(ch, 0.3, 2, 'standoff')) {
    const officers = [...ch.people.values()].filter((p) => p.a.occupation === 'security');
    const chief = living(ch, ch.tx.world.roles.security_chief) ?? officers[0];
    if (!chief) return;
    const strong = officers.length * (0.8 + roll(ch, 3, 'crack') * 0.6) > breakaway.memberIds.length;
    const leader = living(ch, breakaway.leaderId);
    if (strong) {
      breakaway.rules = (breakaway.rules ?? []).filter((r) => r !== 'no_security' && r !== 'keep_the_ice');
      breakaway.reputation = round2(clamp(breakaway.reputation - 0.15, -1, 1));
      if (leader) shiftStatus(ch.tx, leader.mind, -5);
      await saveOrg(ch.tx, breakaway);
      await tell(ch, { category: 'politics', eventType: 'crackdown', actorId: chief.a._id, participantIds: breakaway.memberIds.slice(0, 5), summary: chief.a.name + ' led security into the territory of ' + breakaway.name + ' and tore down its rules; nobody was killed, and nobody forgot.', salience: 0.78 });
    } else {
      if (leader) shiftStatus(ch.tx, leader.mind, 5);
      breakaway.reputation = round2(clamp(breakaway.reputation + 0.08, -1, 1));
      await saveOrg(ch.tx, breakaway);
      await tell(ch, { category: 'politics', eventType: 'standoff', actorId: chief.a._id, participantIds: breakaway.memberIds.slice(0, 5), summary: chief.a.name + ' brought officers to the barricade of ' + breakaway.name + ', counted the faces behind it, and went home. ' + breakaway.name + ' still governs itself.', salience: 0.74 });
    }
  }
}

async function founding(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  const orgs = await activeOrgs(tx);
  const leaders = new Set(orgs.map((o) => o.leaderId));
  const wants = adults(ch)
    .filter((p) => !leaders.has(p.a._id) && free(ch, p))
    .map((p) => ({ p, d: foundingDesire(p.a, p.mind, tx.world.econ.rationLevel) }))
    .filter((x): x is { p: Person; d: { kind: string; score: number } } => !!x.d && x.d.score >= 0.4);
  const founder = weighted(wants, (x) => x.d.score, roll(ch, 1, 'founder'));
  if (founder && happens(ch, 0.7, 1, 'found')) {
    if (founder.d.kind === 'breakaway') await secede(ch, founder.p);
    else await found(ch, founder.p, founder.d.kind);
  }
  if (!orgs.some((o) => o.kind === 'breakaway')) {
    const rebel = adults(ch)
      .filter((p) => p.mind.values.freedom > 0.62 && p.a.traits.stubbornness > 0.5 && free(ch, p))
      .sort((x, y) => y.mind.values.freedom + y.a.traits.ambition - x.mind.values.freedom - x.a.traits.ambition)[0];
    if (rebel && happens(ch, 0.05 + tx.world.econ.rationLevel * 0.12 + (ch.crisis ? 0.15 : 0), rebel.a.seq, 'secede')) await secede(ch, rebel);
  }
}

// ---------- the council ----------

async function leadership(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  const score = (p: Person) => (p.mind.society?.status ?? 30) + (p.mind.skills.persuasion ?? 30) / 4 + p.a.traits.ambition * 12 + (p.a.occupation === 'councilor' ? 8 : 0);
  const chair = living(ch, tx.world.roles.chair);
  const contenders = adults(ch).filter((p) => p.mind.ageBand !== 'child' && (p.mind.society?.status ?? 0) >= 40 && p !== chair);
  const best = contenders.sort((x, y) => score(y) - score(x))[0];
  if (!chair && best) await takeChair(ch, best);
  else if (chair && best && score(best) > score(chair) + 6 && happens(ch, 0.3, best.a.seq, 'election')) await takeChair(ch, best);
  tickOn(ch);
  await fillVacancies(tx);
}

// ---------- work and money ----------

const WAGE_LEVEL: Record<string, number> = { councilor: 220, medic: 190, quartermaster: 190, researcher: 170, security: 150, trader: 200, fabricator: 140, solar_tech: 140, hydroponicist: 120, cook: 110, ice_miner: 130, quarry_hand: 100, dock_hand: 100, hauler: 100, resident: 40 };

async function work(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  let hires = 0;
  for (const p of [...ch.people.values()]) {
    if (isChild(p)) continue;
    const primary = PRIMARY_SKILL[p.a.occupation] ?? 'craft';
    p.mind.skills[primary] = round2(Math.min(95, (p.mind.skills[primary] ?? 20) + ch.dtY * (p.mind.ageBand === 'young' ? 4 : 1.5)));
    p.a.skill = p.mind.skills[primary];
    const eq = WAGE_LEVEL[p.a.occupation] ?? 100;
    p.a.inv.credits = round2(Math.max(0, p.a.inv.credits + (eq * (0.7 + p.a.traits.ambition * 0.6) - p.a.inv.credits) * Math.min(1, ch.dtY * 1.5)));
    touch(tx, p.a);
    touchMind(tx, p.mind);
    if (p.a.occupation === 'resident' && p.mind.ageBand !== 'elder' && hires < 3 && happens(ch, 0.6, p.a.seq, 'hire')) {
      const bySkill = Object.entries(PRIMARY_SKILL).filter(([occ]) => !['resident', 'councilor', 'quartermaster'].includes(occ));
      const vacancy = tx.world.vacancies.find((v) => !v.role && v.occupation !== 'resident' && v.occupation !== 'councilor')?.occupation;
      const occ = vacancy ?? bySkill.sort((x, y) => (p.mind.skills[y[1]] ?? 0) - (p.mind.skills[x[1]] ?? 0) + (roll(ch, p.a.seq, y[0]) - roll(ch, p.a.seq, x[0])) * 10)[0][0];
      if (await takeJob(ch, p, occ)) hires += 1;
    } else if (p.a.traits.ambition > 0.72 && !p.a.role && p.mind.ageBand !== 'elder' && happens(ch, 0.03, p.a.seq, 'career')) {
      const better = ['trader', 'researcher', 'medic', 'security'].filter((o) => o !== p.a.occupation && (WAGE_LEVEL[o] ?? 0) > (WAGE_LEVEL[p.a.occupation] ?? 0));
      const occ = pickOne(better, roll(ch, p.a.seq, 'careerpick'));
      if (occ) await takeJob(ch, p, occ);
    }
  }
}

// ---------- status, fame and art ----------

async function culture(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  const orgs = await activeOrgs(tx);
  for (const p of ch.people.values()) {
    const s = societyOf(tx, p.a, p.mind);
    s.fame = round2(Math.max(0, s.fame * (1 - 0.06 * ch.dtY)));
    const target = targetStatus(p.a, p.mind, rankOf(orgs, p.a._id));
    s.status = round2(s.status + (target - s.status) * Math.min(1, 0.5 * ch.dtY));
    touchMind(tx, p.mind);
  }
  const artists = adults(ch).filter((p) => (p.mind.skills.art ?? 0) >= 30).sort((x, y) => roll(ch, x.a.seq, 'art') - roll(ch, y.a.seq, 'art')).slice(0, 3);
  const kinds = ART_KINDS.filter((k) => !k.requires || ch.meta.discovered.includes(k.requires));
  for (const p of artists) {
    if (!happens(ch, 1.4, p.a.seq, 'create')) continue;
    tickOn(ch);
    await createArtDone(tx, p.a, pickOne(kinds, roll(ch, p.a.seq, 'kind'))!.key);
    const s = p.mind.society!;
    if (s.fame < 0.6 && (p.mind.skills.art ?? 0) >= 55 && happens(ch, 0.12 + s.inspiration * 0.2, p.a.seq, 'breakthrough')) {
      const { applyEffect } = await import('./effects');
      await applyEffect(ch, { type: 'rise', who: p.a._id });
    } else if (s.fame >= 0.35 && ageOf(ch, p) > 50 && happens(ch, 0.08, p.a.seq, 'fade')) {
      const { applyEffect } = await import('./effects');
      await applyEffect(ch, { type: 'fall', who: p.a._id, beat: p.a.name + "'s name began to fade; the young sang other people's songs now." });
    }
  }
}

// ---------- discovery and building ----------

async function research(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  const frontier = availableDiscoveries(ch.meta.discovered).filter((d) => d.tier >= 1);
  if (frontier.length === 0) return;
  const people = [...ch.people.values()];
  const researchers = people.filter((p) => p.a.occupation === 'researcher');
  const pool = ch.dtY * (10 + researchers.reduce((s, p) => s + 2 + (p.mind.skills.science ?? 30) / 15, 0)) * (1 + bonusFor(ch.meta, 'research'));
  const fieldWeight = (d: DiscoveryDef) => {
    const skill = FIELD_SKILLS[d.field];
    const skilled = people.filter((p) => (p.mind.skills[skill] ?? 0) >= 45).length;
    const obsessed = people.some((p) => p.mind.society?.obsession?.kind === 'discovery' && p.mind.society.obsession.target === d.key) ? 3 : 0;
    return (1 + skilled * 0.3 + obsessed) / (1 + d.tier * 0.6);
  };
  const targets: DiscoveryDef[] = [];
  for (let i = 0; i < 2; i++) {
    const t = weighted(frontier.filter((d) => !targets.includes(d)), fieldWeight, roll(ch, i, 'research'));
    if (t) targets.push(t);
  }
  for (const [i, d] of targets.entries()) {
    const share = pool * (i === 0 ? 0.7 : 0.3);
    const row = await tx.ctx.db.query('research').withIndex('by_world_key', (q) => q.eq('worldId', tx.world._id).eq('key', d.key)).first();
    const progress = round2((row?.progress ?? 0) + share);
    const skill = FIELD_SKILLS[d.field];
    const contributors = people.filter((p) => !isChild(p)).sort((x, y) => (y.mind.skills[skill] ?? 0) + (y.a.occupation === 'researcher' ? 15 : 0) - (x.mind.skills[skill] ?? 0) - (x.a.occupation === 'researcher' ? 15 : 0)).slice(0, 2);
    if (progress >= d.effort) {
      if (row) await tx.ctx.db.delete(row._id);
      tickOn(ch);
      await discover(tx, d.key, contributors.map((p) => p.a._id) as Id<'agents'>[]);
      count(ch, 'discoveries');
    } else if (row) await tx.ctx.db.patch(row._id, { progress, contributorIds: [...new Set([...row.contributorIds, ...contributors.map((p) => p.a._id)])].slice(-6) });
    else await tx.ctx.db.insert('research', { worldId: tx.world._id, key: d.key, progress, contributorIds: contributors.map((p) => p.a._id) });
  }
}

async function building(ch: Chapter): Promise<void> {
  const tx = ch.tx;
  if (!happens(ch, 1.3, 0, 'build')) return;
  const orgs = await activeOrgs(tx);
  const built = ch.meta.built;
  const options = STRUCTURES.filter((s) => {
    if (s.requires && !ch.meta.discovered.includes(s.requires)) return false;
    const n = built.filter((b) => b.key === s.key).length;
    if (n >= (s.key === 'grow_rack' ? 3 : s.locations.length > 1 ? 2 : 1)) return false;
    if (s.orgKind && !s.public && !orgs.some((o) => o.kind === s.orgKind)) return false;
    return stock(tx.world, 'depot', 'parts') - (s.cost.parts ?? 0) >= RESERVE_FLOOR.parts && tx.world.econ.treasury >= (s.cost.credits ?? 0);
  });
  const def = weighted(options, (s) => (s.public ? 1.5 : 1) + (s.orgKind && orgs.some((o) => o.kind === s.orgKind) ? 1 : 0), roll(ch, 1, 'what'));
  if (!def) return;
  const loc = def.locations.find((l) => !built.some((b) => b.key === def.key && b.loc === l)) ?? def.locations[0];
  const owner = def.orgKind ? orgs.find((o) => o.kind === def.orgKind) : undefined;
  const builders = [...ch.people.values()].filter((p) => !isChild(p)).sort((x, y) => Math.max(y.mind.skills.engineering ?? 0, y.mind.skills.craft ?? 0) - Math.max(x.mind.skills.engineering ?? 0, x.mind.skills.craft ?? 0) + (owner?.memberIds.includes(y.a._id) ? 20 : 0) - (owner?.memberIds.includes(x.a._id) ? 20 : 0)).slice(0, 3);
  addStock(tx.world, 'depot', 'parts', -(def.cost.parts ?? 0));
  addStock(tx.world, 'depot', 'water', -Math.min(stock(tx.world, 'depot', 'water'), def.cost.water ?? 0));
  addStock(tx.world, 'depot', 'food', -Math.min(stock(tx.world, 'depot', 'food'), def.cost.food ?? 0));
  tx.world.econ.treasury = round2(tx.world.econ.treasury - (def.cost.credits ?? 0));
  let name = def.name;
  let subject: Person | undefined;
  if (def.key === 'statue') {
    subject = [...ch.people.values()].sort((x, y) => (y.mind.society?.fame ?? 0) - (x.mind.society?.fame ?? 0))[0];
    if (subject) name = 'statue of ' + subject.a.name;
  }
  tickOn(ch);
  const structureId = await tx.ctx.db.insert('structures', { worldId: tx.world._id, key: def.key, name, locationId: loc, builderIds: builders.map((p) => p.a._id), ownerOrgId: owner?._id, progress: 1, builtTick: tx.tick });
  const eventId = await tell(ch, { category: 'economy', eventType: 'structure_built', actorId: builders[0]?.a._id, participantIds: builders.slice(1).map((p) => p.a._id), locationId: loc, summary: (builders.length ? builders.map((p) => p.a.name).slice(0, 2).join(' and ') + ' finished the ' : 'The colony finished the ') + name + ' at ' + locWord(loc) + '. ' + STRUCTURE_BY_KEY[def.key].effect, salience: def.public || subject ? 0.66 : 0.56 });
  await tx.ctx.db.patch(structureId, { eventId });
  built.push({ id: structureId, key: def.key, loc, ownerId: builders[0]?.a._id, orgId: owner?._id, subjectId: subject?.a._id });
  for (const b of builders) shiftStatus(tx, b.mind, def.public ? 3 : 2);
  if (subject) {
    const s = societyOf(tx, subject.a, subject.mind);
    s.fame = round2(Math.min(1, s.fame + 0.15));
    shiftStatus(tx, subject.mind, 6);
  }
  count(ch, 'built');
}

// ---------- obsessions ----------

async function obsessions(ch: Chapter): Promise<void> {
  const { applyEffect } = await import('./effects');
  for (const p of [...ch.people.values()]) {
    const ob = p.mind.society?.obsession;
    if (!ob || !free(ch, p)) continue;
    if (!happens(ch, 0.45, p.a.seq, 'obend')) continue;
    const done = (ob.kind === 'discovery' && !!ob.target && ch.meta.discovered.includes(ob.target)) || (ob.kind === 'person' && p.mind.society?.partnerId === ob.target) || (ob.kind === 'revenge' && !!ob.target && !ch.people.has(ob.target)) || (ob.kind === 'masterpiece' && (p.mind.society?.fame ?? 0) >= 0.5) || (ob.kind === 'wealth' && p.a.inv.credits >= 300);
    await applyEffect(ch, { type: 'obsession_end', who: p.a._id, detail: done || roll(ch, p.a.seq, 'obluck') < 0.3 ? 'fulfilled' : 'broken' });
  }
  if (!happens(ch, 0.6, 0, 'newob')) return;
  const prone = adults(ch).filter((p) => !p.mind.society?.obsession && free(ch, p) && (p.a.traits.stubbornness > 0.62 || p.a.traits.curiosity > 0.72));
  const p = pickOne(prone, roll(ch, 1, 'obwho'));
  if (!p) return;
  const frontier = availableDiscoveries(ch.meta.discovered).filter((d) => d.tier >= 1);
  const d = p.a.occupation === 'researcher' || p.a.traits.curiosity > 0.75 ? pickOne(frontier, roll(ch, p.a.seq, 'obd')) : undefined;
  const text = d ? 'working out ' + d.name.toLowerCase() : (p.mind.skills.art ?? 0) >= 35 ? 'making the one work that will outlive them' : p.mind.values.wealth > 0.65 ? 'getting rich enough to never count rations again' : 'what really happened in the Long Dark';
  if (d) {
    const ok = await applyEffect(ch, { type: 'obsession', who: p.a._id, detail: text });
    if (ok && p.mind.society?.obsession) {
      p.mind.society.obsession = { ...p.mind.society.obsession, kind: 'discovery', target: d.key };
      touchMind(ch.tx, p.mind);
    }
  } else await applyEffect(ch, { type: 'obsession', who: p.a._id, detail: text });
}

// ---------- coming and going ----------

async function migration(ch: Chapter): Promise<void> {
  const want = (p: Person) => /ticket home|outbound|earth|leave/i.test(p.mind.persona?.want ?? '');
  const leaver = adults(ch)
    .filter((p) => free(ch, p) && !p.a.role && !ch.keyIds.has(p.a._id))
    .map((p) => ({ p, rate: 0.006 + (want(p) ? 0.08 : 0) + ((p.mind.society?.status ?? 40) < 25 ? 0.01 : 0) + (ch.tx.world.econ.rationLevel >= 2 ? 0.01 : 0) }))
    .find((x) => happens(ch, x.rate, x.p.a.seq, 'leave'));
  if (leaver) await leave(ch, leaver.p, 'depart', want(leaver.p) ? leaver.p.a.name + ' finally had the fare, and took the outbound shuttle home to Earth.' : undefined);
}

// ---------- the economy ----------

async function economy(ch: Chapter): Promise<void> {
  const w = ch.tx.world;
  const pop = Math.max(20, ch.people.size);
  const bonus = (res: string) => {
    let b = 0;
    for (const key of ch.meta.discovered) for (const m of DISCOVERY_BY_KEY[key]?.mechanics ?? []) if (m.kind === 'production' && (m.resource === res || m.resource === 'all')) b += m.bonus;
    for (const s of ch.meta.built) for (const m of STRUCTURE_BY_KEY[s.key]?.mechanics ?? []) if (m.kind === 'production' && (m.resource === res || m.resource === 'all')) b += m.bonus;
    return b;
  };
  const pull = Math.min(1, ch.dtY * 1.6);
  for (const res of TRADED_RESOURCES) {
    const target = NORMAL_STOCK[res] * (0.95 + bonus(res)) * clamp(100 / pop, 0.65, 1.35);
    const loc = res === 'medicine' ? 'medbay' : 'depot';
    const now = stock(w, loc, res);
    addStock(w, loc, res, round2((target - now) * pull));
    w.prices[res] = round2(clamp(BASE_PRICES[res] * clamp(NORMAL_STOCK[res] / Math.max(1, stock(w, loc, res)), 0.6, 3), 1, 60));
  }
  for (const res of ['food', 'water'] as const) w.stockpiles.canteen = { ...(w.stockpiles.canteen ?? {}), [res]: CANTEEN_TARGET[res] };
  w.econ.announcedPrices = { ...w.prices };
  w.econ.treasury = round2(Math.max(0, w.econ.treasury + ch.dtY * (pop * 18 - 1500) + (w.econ.treasury < 3000 ? ch.dtY * 2000 : 0)));
  w.econ.wagesUnpaid = 0;
  for (const loc of Object.keys(w.damage)) {
    w.damage[loc] = round2(w.damage[loc] * (1 - Math.min(1, ch.dtY * 3)));
    if (w.damage[loc] < 0.05) delete w.damage[loc];
  }
  for (const e of [...w.activeEffects]) {
    if (e.endTick > ch.end) continue;
    w.activeEffects = w.activeEffects.filter((x) => x.id !== e.id);
    if (w.causes[e.type] === e.eventId) delete w.causes[e.type];
    await tell(ch, { category: 'environment', eventType: e.type + '_ended', summary: e.type === 'drought' ? 'The drought broke; water ran at the Ice Wells again.' : 'The storm passed, and the crews went out to count the damage.', salience: 0.6, causationEventId: e.eventId });
  }
  const ratio = reserveRatio(w);
  const level = ratio < 0.3 ? 2 : ratio < 0.55 ? 1 : ratio > 0.8 ? 0 : w.econ.rationLevel;
  if (level < w.econ.rationLevel) await setRations(ch, w.econ.rationLevel - 1);
  else if (level > w.econ.rationLevel) await setRations(ch, level);
}
