/**
 * Building and invention. Structures from the catalogue are built from real goods (the builder's,
 * their organization's, or depot parts for public works) over several sessions and then change the
 * world every hour or day. Experiments push research toward discoveries; a discovery is a eureka
 * moment with a real effect: better yields, faster learning, rarer disasters, new options.
 */
import type { Id } from '../_generated/dataModel';
import { DISCOVERIES, DISCOVERY_BY_KEY, FIELD_LOCATIONS, FIELD_SKILLS, STRUCTURE_BY_KEY } from '../../shared/society';
import type { DiscoveryDef, Mechanic, StructureMechanic } from '../../shared/society';
import { FARM_WATER_FLOOR, PRODUCTION } from '../lib/constants';
import { clamp, round2 } from '../lib/rng';
import { ROSTER_WORKING, locChar } from '../seed/insert';
import { addStock, droughtSeverity, locName, stock, stormAt } from '../engine/conditions';
import { agentIndex, emitEvent, enqueueCognition, learnBelief, loadAgent, loadHousehold, loadMind, touch, touchHousehold, touchMind, tiesOf } from '../engine/core';
import type { AgentDoc, EventId, MindDoc, Tx } from '../engine/core';
import { allAgents } from '../engine/state';
import { orgsOf } from './orgs';
import { fulfil } from './obsession';
import { act, listNames, loadMeta, orgById, roll, saveMeta, saveOrg, shiftStatus, societyOf } from './store';
import type { Meta } from './store';

// ---------- what discoveries and structures add up to ----------

function mechanicsOf(meta: Meta, at?: string): { m: StructureMechanic; built?: { loc: string; key: string } }[] {
  const out: { m: StructureMechanic; built?: { loc: string; key: string } }[] = [];
  for (const key of meta.discovered) for (const m of DISCOVERY_BY_KEY[key]?.mechanics ?? []) out.push({ m });
  for (const b of meta.built) for (const m of STRUCTURE_BY_KEY[b.key]?.mechanics ?? []) out.push({ m, built: { loc: b.loc, key: b.key } });
  return at === undefined ? out : out.filter((x) => !x.built || x.built.loc === at || !['study', 'research', 'perform', 'ritual'].includes(x.m.kind));
}

/** Total multiplier bonus of a kind (research, study, build, art, fame) for someone at a location. */
export function bonusFor(meta: Meta, kind: 'research' | 'study' | 'build' | 'art' | 'fame' | 'perform', at?: string): number {
  let total = 0;
  for (const { m } of mechanicsOf(meta, at)) if (m.kind === kind && 'bonus' in m) total += m.bonus;
  return total;
}

/** How much more or less likely a random event is, from what the colony knows and has built. */
export function eventWeight(meta: Meta, key: string): number {
  let w = 1;
  for (const { m } of mechanicsOf(meta)) if (m.kind === 'event' && m.event === key) w *= m.weight;
  return w;
}

/** Discoveries whose prerequisites are all known and that nobody has made yet. */
export function availableDiscoveries(discovered: string[]): DiscoveryDef[] {
  return DISCOVERIES.filter((d) => d.tier > 0 && !discovered.includes(d.key) && d.prerequisites.every((p) => discovered.includes(p)));
}

// ---------- hourly and daily effects ----------

function workersAt(tx: Tx, loc: string): number {
  const c = locChar(loc);
  let n = 0;
  for (let seq = 0; seq < tx.rosterLoc.length; seq++) if (tx.rosterLoc[seq] === c && tx.rosterSt[seq] === ROSTER_WORKING) n += 1;
  return n;
}

/** Extra hourly output from production bonuses, on top of what the engine's crews produce. */
export function productionHourly(tx: Tx, meta: Meta): void {
  const bonus = { water: 0, food: 0, parts: 0, medicine: 0 };
  for (const { m } of mechanicsOf(meta)) {
    if (m.kind !== 'production') continue;
    if (m.resource === 'all') for (const k of Object.keys(bonus) as (keyof typeof bonus)[]) bonus[k] += m.bonus;
    else bonus[m.resource] += m.bonus;
  }
  const world = tx.world;
  const power = 1 - 0.6 * (world.damage.solar_farm ?? 0);
  const factor = (loc: string) => power * (1 - (world.damage[loc] ?? 0)) * (stormAt(world, loc) > 0 ? 0 : 1);
  const water = workersAt(tx, 'ice_wells') * PRODUCTION.water * factor('ice_wells') * (1 - droughtSeverity(world)) * bonus.water;
  if (water > 0) addStock(world, 'depot', 'water', water);
  const spare = Math.max(0, stock(world, 'depot', 'water') - FARM_WATER_FLOOR * (1 + world.econ.rationLevel * 0.5));
  const food = Math.min(workersAt(tx, 'hydroponics') * PRODUCTION.food * factor('hydroponics') * bonus.food, spare / PRODUCTION.foodWater);
  if (food > 0) {
    addStock(world, 'depot', 'water', -food * PRODUCTION.foodWater);
    addStock(world, 'depot', 'food', food);
  }
  const parts = workersAt(tx, 'workshop') * PRODUCTION.parts * factor('workshop') * bonus.parts;
  if (parts > 0) addStock(world, 'depot', 'parts', parts);
  const medicine = workersAt(tx, 'medbay') * PRODUCTION.medicine * factor('medbay') * bonus.medicine;
  if (medicine > 0) addStock(world, 'medbay', 'medicine', medicine);
}

/** The observatory staff's shifts push the colony's most advanced open research forward. */
export async function observatoryHourly(tx: Tx, meta: Meta): Promise<void> {
  const c = locChar('observatory');
  const index = await agentIndex(tx);
  const staff: Id<'agents'>[] = [];
  for (let seq = 0; seq < tx.rosterLoc.length; seq++) if (tx.rosterLoc[seq] === c && tx.rosterSt[seq] === ROSTER_WORKING && index[seq]) staff.push(index[seq]);
  if (staff.length === 0) return;
  const rows = await researchRows(tx);
  const open = availableDiscoveries(meta.discovered).filter((d) => d.field === 'mystery' || d.field === 'habitat' || d.field === 'energy' || d.field === 'water');
  const target = open.sort((x, y) => (rows.get(y.key)?.progress ?? 0) / y.effort - (rows.get(x.key)?.progress ?? 0) / x.effort)[0];
  if (!target) return;
  await addProgress(tx, meta, target, staff.length * 0.12 * (1 + bonusFor(meta, 'research', 'observatory')), staff.slice(0, 3));
}

/** Once a day: health, repairs, calm, treasury, stock, pantries, incomes, playgrounds, statues and memorials. */
export async function mechanicsDaily(tx: Tx, meta: Meta, people: Map<string, { a: AgentDoc; mind: MindDoc }>): Promise<void> {
  let health = 0;
  let repair = 0;
  let safety = 0;
  for (const { m, built } of mechanicsOf(meta)) {
    if (m.kind === 'health') health += m.amount;
    else if (m.kind === 'repair') repair += m.amount;
    else if (m.kind === 'safety') safety += m.amount;
    else if (m.kind === 'treasury') tx.world.econ.treasury = round2(tx.world.econ.treasury + m.amount);
    else if (m.kind === 'stock') addStock(tx.world, m.location, m.resource, m.amount);
    else if (built && m.kind === 'social') for (const p of people.values()) if (p.a.homeLocationId === built.loc && p.mind.ageBand === 'child') p.a.needs.social = Math.max(0, p.a.needs.social - m.amount);
  }
  for (const b of meta.built) {
    const def = STRUCTURE_BY_KEY[b.key];
    for (const m of def?.mechanics ?? []) {
      if (m.kind === 'pantry' && b.ownerId) {
        const owner = people.get(b.ownerId);
        const h = owner ? await loadHousehold(tx, owner.a.householdId) : null;
        if (h) {
          h.pantry.food = round2(h.pantry.food + m.food);
          touchHousehold(tx, h);
        }
      } else if (m.kind === 'income') {
        const org = b.orgId ? await orgById(tx, b.orgId) : null;
        if (org && org.status === 'active') {
          org.treasury = round2(org.treasury + m.credits);
          await saveOrg(tx, org);
        } else if (b.ownerId && people.has(b.ownerId)) {
          people.get(b.ownerId)!.a.inv.credits = round2(people.get(b.ownerId)!.a.inv.credits + m.credits);
        }
      } else if (m.kind === 'honor' && b.subjectId && people.has(b.subjectId)) {
        shiftStatus(tx, people.get(b.subjectId)!.mind, 1);
      } else if (m.kind === 'memorial') {
        for (const p of people.values()) if (p.a.mood === 'grieving' && roll(tx, p.a.seq, 'memorial') < 0.5) p.a.mood = 'sombre';
      }
    }
  }
  for (const p of people.values()) {
    let changed = false;
    if (health > 0 && p.a.health < 100) {
      p.a.health = Math.min(100, p.a.health + health);
      changed = true;
    }
    if (safety > 0 && p.a.needs.safety > 0) {
      p.a.needs.safety = Math.max(0, p.a.needs.safety - safety);
      changed = true;
    }
    if (changed) touch(tx, p.a);
  }
  if (repair > 0) for (const [loc, dmg] of Object.entries(tx.world.damage)) tx.world.damage[loc] = round2(Math.max(0, dmg - repair));
}

// ---------- research ----------

async function researchRows(tx: Tx) {
  const rows = await tx.ctx.db.query('research').withIndex('by_world_key', (q) => q.eq('worldId', tx.world._id)).take(80);
  return new Map(rows.map((r) => [r.key, r]));
}

/** What this person would work on: their obsession, what they have started, what their skills suit. */
async function pickResearch(tx: Tx, meta: Meta, a: AgentDoc, mind: MindDoc): Promise<DiscoveryDef | undefined> {
  const open = availableDiscoveries(meta.discovered);
  if (open.length === 0) return undefined;
  const ob = mind.society?.obsession;
  if (ob?.kind === 'discovery' && ob.target) {
    const d = open.find((x) => x.key === ob.target);
    if (d) return d;
  }
  const rows = await researchRows(tx);
  const scored = open.map((d) => {
    const row = rows.get(d.key);
    const skill = mind.skills[FIELD_SKILLS[d.field]] ?? 10;
    const mine = row?.contributorIds.includes(a._id) ? 25 : 0;
    const place = FIELD_LOCATIONS[d.field] === a.workLocationId ? 15 : 0;
    const dark = ob?.kind === 'long_dark' && d.field === 'mystery' ? 60 : 0;
    return { d, s: skill + mine + place + dark + ((row?.progress ?? 0) / d.effort) * 20 - d.tier * 4 + roll(tx, a.seq, 'res' + d.key) * 10 };
  });
  return scored.sort((x, y) => y.s - x.s)[0].d;
}

async function addProgress(tx: Tx, meta: Meta, d: DiscoveryDef, amount: number, contributors: Id<'agents'>[]): Promise<EventId | undefined> {
  const row = await tx.ctx.db.query('research').withIndex('by_world_key', (q) => q.eq('worldId', tx.world._id).eq('key', d.key)).first();
  const progress = round2((row?.progress ?? 0) + amount);
  const ids = [...new Set([...(row?.contributorIds ?? []), ...contributors])].slice(-8);
  if (row) await tx.ctx.db.patch(row._id, { progress, contributorIds: ids });
  else await tx.ctx.db.insert('research', { worldId: tx.world._id, key: d.key, progress, contributorIds: ids });
  if (progress < d.effort) return undefined;
  return discover(tx, d.key, contributors.length ? contributors : ids.slice(-2));
}

export async function experimentStart(tx: Tx, a: AgentDoc, mind: MindDoc, ticks: number): Promise<number> {
  const meta = await loadMeta(tx);
  const d = await pickResearch(tx, meta, a, mind);
  if (!d) return -1;
  const place = FIELD_LOCATIONS[d.field];
  act(tx, a, 'investigating', (a.locationId === place ? 'Experimenting at ' : 'Tinkering at ') + locName(a.locationId) + ' toward ' + d.name.toLowerCase());
  return ticks;
}

export async function experimentDone(tx: Tx, a: AgentDoc, ticks: number): Promise<void> {
  const mind = await loadMind(tx, a);
  if (!mind) return;
  const meta = await loadMeta(tx);
  const d = await pickResearch(tx, meta, a, mind);
  if (!d) return;
  const skill = mind.skills[FIELD_SKILLS[d.field]] ?? 10;
  const atPlace = FIELD_LOCATIONS[d.field] === a.locationId ? 1.3 : 1;
  const flash = roll(tx, a.seq, 'flash');
  const amount = 0.4 * (ticks / 6) * (0.4 + skill / 70) * (0.6 + a.traits.curiosity * 0.6) * (1 + bonusFor(meta, 'research', a.locationId)) * atPlace * (0.7 + flash * 0.6);
  mind.skills[FIELD_SKILLS[d.field]] = round2(Math.min(100, skill + ticks * 0.04));
  touchMind(tx, mind);
  const row = await tx.ctx.db.query('research').withIndex('by_world_key', (q) => q.eq('worldId', tx.world._id).eq('key', d.key)).first();
  const near = (row?.progress ?? 0) + amount >= d.effort * 0.7;
  const eureka = near && flash > 0.9 ? d.effort : 0;
  await addProgress(tx, meta, d, amount + eureka, [a._id]);
}

/** A discovery is made: the eureka event, the effect on the world, fame for the discoverers. */
export async function discover(tx: Tx, key: string, discovererIds: Id<'agents'>[], cause?: EventId): Promise<EventId | undefined> {
  const d = DISCOVERY_BY_KEY[key];
  const meta = await loadMeta(tx);
  if (!d || meta.discovered.includes(key)) return undefined;
  meta.discovered.push(key);
  const people: AgentDoc[] = [];
  for (const id of discovererIds.slice(0, 3)) {
    const p = await loadAgent(tx, id);
    if (p) people.push(p);
  }
  const where = people[0] ? locName(people[0].locationId) : locName(FIELD_LOCATIONS[d.field]);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'discovery',
    actorId: people[0]?._id,
    participantIds: people.slice(1).map((p) => p._id),
    locationId: people[0]?.locationId,
    summary: (people.length ? listNames(people.map((p) => p.name)) : 'The Observatory staff') + ' worked out ' + d.name.toLowerCase() + ' at ' + where + ': ' + d.effect.charAt(0).toLowerCase() + d.effect.slice(1),
    salience: 0.65 + d.tier * 0.05,
    causationEventId: cause,
    visibility: 'public',
    banner: d.tier >= 1,
    facts: { discovery: key },
  });
  await tx.ctx.db.insert('discoveries', { worldId: tx.world._id, key, tick: tx.tick, discovererIds: people.map((p) => p._id), eventId });
  for (const p of people) {
    const m = await loadMind(tx, p);
    if (!m) continue;
    const s = societyOf(tx, p, m);
    s.fame = round2(Math.min(1, s.fame + 0.1 + d.tier * 0.04));
    shiftStatus(tx, m, 6 + d.tier * 2);
    p.mood = 'euphoric';
    touch(tx, p);
    await fulfil(tx, p, m, 'discovery', key, eventId);
    if (d.field === 'mystery') await fulfil(tx, p, m, 'long_dark', undefined, eventId);
  }
  meta.inspiration = { eventId, summary: d.name, tick: tx.tick, kind: 'discovery' };
  for (const m of d.mechanics) await oneTimeEffect(tx, m, eventId);
  await saveMeta(tx);
  return eventId;
}

async function oneTimeEffect(tx: Tx, m: Mechanic, eventId: EventId): Promise<void> {
  if (m.kind === 'windfall') {
    for (const [res, n] of Object.entries(m.goods)) addStock(tx.world, 'depot', res, n ?? 0);
    return;
  }
  if (m.kind !== 'revelation') return;
  const everyone = (await allAgents(tx)).filter((a) => a.alive);
  let culprit: AgentDoc | undefined;
  let best = -1;
  for (const a of everyone.slice(0, 120)) {
    const mind = await loadMind(tx, a);
    if (!mind) continue;
    const secret = mind.persona?.secret?.text ?? '';
    const score = (/long dark|reactor|shuttle/i.test(secret) ? 10 : 0) + (mind.ageBand === 'elder' ? 2 : 0) + (a.occupation === 'councilor' ? 2 : 0) + (a.factionId === 'founders' ? 1 : 0) + roll(tx, a.seq, 'culprit');
    if (score > best) {
      best = score;
      culprit = a;
    }
  }
  if (!culprit) return;
  const { eventId: rev } = await emitEvent(tx, {
    category: 'social',
    eventType: 'revelation',
    participantIds: [culprit._id],
    summary: 'The decoded eleventh log of the Long Dark names ' + culprit.name + ' as someone who was warned the reactor would fail, and said nothing.',
    salience: 0.9,
    causationEventId: eventId,
    visibility: 'public',
  });
  for (const a of everyone.filter((x) => x._id !== culprit!._id).slice(0, 10)) {
    await learnBelief(tx, a, { kind: 'suspect', text: culprit.name + ' knew the reactor would fail before the Long Dark and kept quiet.', valence: -1, confidence: 0.6, sourceType: 'told', subjectAgentId: culprit._id, subjectName: culprit.name, originEventId: rev });
  }
  const cm = await loadMind(tx, culprit);
  if (cm) {
    shiftStatus(tx, cm, -15);
    const meta = await loadMeta(tx);
    meta.scandals[culprit._id] = tx.tick;
  }
  await enqueueCognition(tx, culprit, { kind: 'plan', trigger: 'the eleventh log named me', priority: 0.85, lane: 'crisis', eventId: rev });
}

// ---------- building ----------

/** Takes a structure's cost from the builder, then their organization, then (for public works) the depot. */
async function pay(tx: Tx, a: AgentDoc, mind: MindDoc, key: string): Promise<{ ok: boolean; orgId?: Id<'organizations'>; from: string }> {
  const def = STRUCTURE_BY_KEY[key];
  const orgs = await orgsOf(tx, mind);
  const org = orgs.find((o) => o.leaderId === a._id && (!def.orgKind || o.kind === def.orgKind)) ?? (def.orgKind ? orgs.find((o) => o.kind === def.orgKind) : undefined);
  const plan: { res: string; n: number; source: 'self' | 'org' | 'depot' }[] = [];
  for (const [res, n] of Object.entries(def.cost)) {
    const need = n ?? 0;
    if (res === 'credits') {
      if (a.inv.credits >= need) plan.push({ res, n: need, source: 'self' });
      else if (org && org.treasury >= need) plan.push({ res, n: need, source: 'org' });
      else return { ok: false, from: '' };
      continue;
    }
    const mine = a.inv[res as 'parts'] ?? 0;
    if (mine >= need) plan.push({ res, n: need, source: 'self' });
    else if (def.public && stock(tx.world, 'depot', res) >= need + 25) plan.push({ res, n: need, source: 'depot' });
    else if (org && org.treasury >= need * (tx.world.prices[res as 'parts'] ?? 5) && stock(tx.world, 'depot', res) >= need + 15) plan.push({ res, n: need, source: 'org' });
    else return { ok: false, from: '' };
  }
  for (const p of plan) {
    if (p.source === 'self') a.inv[p.res as 'parts'] = round2(a.inv[p.res as 'parts'] - p.n);
    else if (p.source === 'depot') addStock(tx.world, 'depot', p.res, -p.n);
    else if (org) {
      const cost = p.res === 'credits' ? p.n : p.n * (tx.world.prices[p.res as 'parts'] ?? 5);
      org.treasury = round2(org.treasury - cost);
      if (p.res !== 'credits') {
        addStock(tx.world, 'depot', p.res, -p.n);
        tx.world.econ.treasury = round2(tx.world.econ.treasury + cost);
      }
    }
  }
  touch(tx, a);
  if (org) await saveOrg(tx, org);
  const from = plan.some((p) => p.source === 'org') ? 'with funds from ' + org!.name : plan.some((p) => p.source === 'depot') ? 'with colony parts' : 'with their own savings';
  return { ok: true, orgId: org && (def.orgKind ? org.kind === def.orgKind : org.leaderId === a._id) ? org._id : undefined, from };
}

async function structuresAt(tx: Tx) {
  return await tx.ctx.db.query('structures').withIndex('by_world', (q) => q.eq('worldId', tx.world._id)).take(100);
}

/** Who a statue honours: the builder's most admired person, or a famous name. */
async function honoree(tx: Tx, a: AgentDoc): Promise<AgentDoc | null> {
  const ties = await tiesOf(tx, a._id, 10);
  const best = ties.filter((t) => t.affinity > 0.3).sort((x, y) => y.affinity - x.affinity)[0];
  return best ? await loadAgent(tx, best.toAgentId) : null;
}

export function canBuildHere(meta: Meta, key: string, loc: string, orgTerritories: string[]): boolean {
  const def = STRUCTURE_BY_KEY[key];
  if (!def) return false;
  if (def.requires && !meta.discovered.includes(def.requires)) return false;
  if (key === 'barricade') return orgTerritories.includes(loc);
  return def.locations.includes(loc as never);
}

export async function buildStart(tx: Tx, a: AgentDoc, mind: MindDoc, key: string): Promise<number> {
  const def = STRUCTURE_BY_KEY[key];
  const meta = await loadMeta(tx);
  const orgs = await orgsOf(tx, mind);
  if (!def || !canBuildHere(meta, key, a.locationId, orgs.flatMap((o) => o.territory ?? []))) return -1;
  const existing = (await structuresAt(tx)).find((s) => s.key === key && s.locationId === a.locationId && s.builtTick === undefined);
  if (existing) {
    act(tx, a, 'helping', 'Building the ' + existing.name + ' at ' + locName(a.locationId));
    return 8;
  }
  const once = ['statue', 'grow_rack', 'still', 'black_market_cache', 'long_dark_shrine'].includes(key);
  if (!once && meta.built.some((b) => b.key === key && b.loc === a.locationId)) return -1;
  if (key === 'grow_rack' && meta.built.some((b) => b.key === key && b.ownerId === a._id)) return -1;
  const paid = await pay(tx, a, mind, key);
  if (!paid.ok) {
    act(tx, a, 'idle', 'Could not gather the materials for a ' + def.name);
    return -1;
  }
  let name = def.name;
  let subject: AgentDoc | null = null;
  if (key === 'statue') {
    subject = await honoree(tx, a);
    name = 'statue of ' + (subject?.name ?? 'the founders');
  }
  const id = await tx.ctx.db.insert('structures', { worldId: tx.world._id, key, name, locationId: a.locationId, builderIds: [a._id], ownerOrgId: paid.orgId, progress: 0 });
  if (subject) {
    meta.subjects[id] = subject._id;
    await saveMeta(tx);
  }
  act(tx, a, 'helping', 'Starting work on a ' + name + ' at ' + locName(a.locationId));
  await emitEvent(tx, { category: 'economy', eventType: 'construction_started', actorId: a._id, locationId: a.locationId, summary: a.name + ' started building a ' + name + ' at ' + locName(a.locationId) + ', ' + paid.from + '.', salience: 0.45, visibility: 'local', witnesses: 'location' });
  return 8;
}

export async function buildDone(tx: Tx, a: AgentDoc, ticks: number): Promise<void> {
  const mind = await loadMind(tx, a);
  if (!mind) return;
  const open = (await structuresAt(tx)).filter((x) => x.locationId === a.locationId && x.builtTick === undefined);
  const s = open.find((x) => x.builderIds.includes(a._id)) ?? open[0];
  if (!s) return;
  const def = STRUCTURE_BY_KEY[s.key];
  const meta = await loadMeta(tx);
  const skill = Math.max(mind.skills.engineering ?? 0, mind.skills.craft ?? 0, 15);
  const progress = round2(clamp(s.progress + ((ticks / 6) * (0.6 + skill / 100) * (1 + bonusFor(meta, 'build'))) / def.effort, 0, 1));
  const builders = s.builderIds.includes(a._id) ? s.builderIds : [...s.builderIds, a._id];
  mind.skills.craft = round2(Math.min(100, (mind.skills.craft ?? 0) + ticks * 0.03));
  touchMind(tx, mind);
  if (progress < 1) {
    await tx.ctx.db.patch(s._id, { progress, builderIds: builders });
    return;
  }
  const names: string[] = [];
  for (const id of builders.slice(0, 3)) {
    const b = await loadAgent(tx, id);
    if (b) names.push(b.name);
  }
  const { eventId } = await emitEvent(tx, {
    category: 'economy',
    eventType: 'structure_built',
    actorId: a._id,
    participantIds: builders.filter((id) => id !== a._id),
    locationId: s.locationId,
    summary: listNames(names) + ' finished the ' + s.name + ' at ' + locName(s.locationId) + '. ' + def.effect,
    salience: s.key === 'barricade' || s.key === 'statue' ? 0.72 : 0.6,
    visibility: 'public',
    witnesses: 'location',
  });
  await tx.ctx.db.patch(s._id, { progress: 1, builderIds: builders, builtTick: tx.tick, eventId });
  const subjectId = meta.subjects[s._id];
  meta.built.push({ id: s._id, key: s.key, loc: s.locationId, ownerId: builders[0], orgId: s.ownerOrgId, subjectId });
  delete meta.subjects[s._id];
  await saveMeta(tx);
  for (const id of builders.slice(0, 4)) {
    const b = await loadAgent(tx, id);
    const bm = b ? await loadMind(tx, b) : null;
    if (!b || !bm) continue;
    shiftStatus(tx, bm, def.public ? 4 : 2);
    await fulfil(tx, b, bm, 'structure', s.key, eventId);
  }
  if (subjectId) {
    const subj = await loadAgent(tx, subjectId as Id<'agents'>);
    const sm = subj ? await loadMind(tx, subj) : null;
    if (subj && sm) {
      societyOf(tx, subj, sm).fame = round2(Math.min(1, sm.society!.fame + 0.15));
      shiftStatus(tx, sm, 6);
    }
  }
}
