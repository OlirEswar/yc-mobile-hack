/**
 * Families and pets. Partners (propose), children born into households who grow up into young
 * colonists choosing careers, inheritance of traits, values, grudges and credits, orphans and
 * guardians; pets adopted, named, cared for, lost and grieved.
 */
import type { Id } from '../_generated/dataModel';
import { MAX_POPULATION, OCCUPATIONS, SPRITE_VARIANTS } from '../../shared/colony';
import type { SpriteArchetype } from '../../shared/colony';
import { CHILD_NAMES, PET_SPECIES } from '../../shared/society';
import { clamp, pick, round2 } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import { firstName, locName } from '../engine/conditions';
import {
  adjustRelationship,
  dayOf,
  emitEvent,
  enqueueCognition,
  learnBelief,
  loadAgent,
  loadHousehold,
  loadMind,
  registerAgent,
  touch,
  touchHousehold,
  touchMind,
  tiesOf,
} from '../engine/core';
import type { AgentDoc, EventId, MindDoc, Tx } from '../engine/core';
import { presentWith, tie } from '../engine/social';
import { GROW_UP_TICKS, PREGNANCY_TICKS, act, listNames, loadMeta, roll, saveMeta, shiftStatus, societyOf } from './store';
import type { Meta } from './store';
import { startObsession } from './obsession';

const familyName = (name: string): string => name.split(' ').slice(-1)[0];

// ---------- inserting new people ----------

export type NewPerson = {
  name: string;
  spriteId: string;
  ageBand: 'child' | 'young' | 'adult' | 'elder';
  occupation: string;
  homeLocationId: string;
  locationId: string;
  householdId?: Id<'households'>;
  traits: AgentDoc['traits'];
  values: MindDoc['values'];
  skills: Record<string, number>;
  background: string;
  persona: NonNullable<MindDoc['persona']>;
  inv?: Partial<AgentDoc['inv']>;
  dayOffset: number;
  parentIds?: Id<'agents'>[];
  bornTick?: number;
  mood?: string;
  activity?: string;
  activityLabel?: string;
};

/** Inserts an agent and mind with the seed's conventions and registers them in the roster and index. */
export async function insertPerson(tx: Tx, p: NewPerson): Promise<{ a: AgentDoc; mind: MindDoc }> {
  const seq = tx.world.nextSeq;
  tx.world.nextSeq += 1;
  tx.world.population = { ...tx.world.population, alive: tx.world.population.alive + 1 };
  const def = OCCUPATIONS.find((o) => o.id === p.occupation);
  const primary = PRIMARY_SKILL[p.occupation] ?? 'craft';
  const agentId = await tx.ctx.db.insert('agents', {
    worldId: tx.world._id,
    seq,
    name: p.name,
    spriteId: p.spriteId,
    occupation: p.occupation,
    householdId: p.householdId,
    alive: true,
    locationId: p.locationId,
    homeLocationId: p.homeLocationId,
    workLocationId: p.ageBand === 'child' ? undefined : def?.workLocationId,
    activity: p.activity ?? 'idle',
    activityLabel: p.activityLabel ?? 'Looking around',
    busyUntilTick: tx.tick + 1,
    dueTick: tx.tick + 1,
    mood: p.mood ?? 'calm',
    health: 100,
    needs: { hunger: 20, thirst: 20, fatigue: 10, safety: 10, social: 30 },
    needsTick: tx.tick,
    updatedAtVersion: tx.version,
    inv: { food: 0, water: 0, parts: 0, medicine: 0, credits: 0, ...p.inv },
    traits: p.traits,
    skill: p.skills[primary] ?? 10,
    dayOffset: p.dayOffset,
    q: [],
    planEpoch: 0,
    standing: 0,
    topics: [],
    lastLevyDay: dayOf(tx.tick),
    failStreak: 0,
  });
  const mindId = await tx.ctx.db.insert('minds', {
    worldId: tx.world._id,
    agentId,
    ageBand: p.ageBand,
    background: p.background,
    values: p.values,
    skills: p.skills,
    goals: [{ id: 'g1', kind: 'survive', description: 'Stay fed, watered and safe', priority: 0.6, source: 'needs', status: 'active', createdAtTick: tx.tick, predicate: 'needs_ok' }],
    stateVersion: 0,
    llmCooldownUntilTick: 0,
    thefts: 0,
    nextGoalSeq: 2,
    society: {
      status: p.ageBand === 'child' ? 20 : 25,
      fame: 0,
      orgIds: [],
      parentIds: p.parentIds ?? [],
      childIds: [],
      bornTick: p.bornTick,
      jobHistory: p.ageBand === 'child' ? [] : [{ occupation: p.occupation, fromTick: tx.tick }],
      inspiration: 0,
    },
    persona: p.persona,
  });
  await tx.ctx.db.patch(agentId, { mindId });
  const a = (await tx.ctx.db.get(agentId))!;
  await registerAgent(tx, a);
  const mind = (await loadMind(tx, a))!;
  if (p.householdId) {
    const h = await loadHousehold(tx, p.householdId);
    if (h) {
      h.memberIds.push(agentId);
      h.rationDue = { food: h.rationDue.food + 1, water: h.rationDue.water + 2 };
      touchHousehold(tx, h);
    }
  }
  return { a, mind };
}

// ---------- partners ----------

/** Ask someone present to marry, or (already partners) to raise a child together. */
export async function propose(tx: Tx, a: AgentDoc, mind: MindDoc, targetId: string): Promise<number> {
  const b = await presentWith(tx, a, targetId);
  if (!b) return -1;
  const bm = await loadMind(tx, b);
  if (!bm || bm.ageBand === 'child' || mind.ageBand === 'child') return -1;
  const s = societyOf(tx, a, mind);
  const bs = societyOf(tx, b, bm);
  const meta = await loadMeta(tx);
  if (s.partnerId === b._id) {
    const yes = bm.values.family * 0.6 + (roll(tx, b.seq, 'child') * 0.5) > 0.5 && s.childIds.length < 3;
    act(tx, a, 'talking', 'Asking ' + b.name + ' about a child', b._id, 'What if we had a little one?');
    b.speech = yes ? 'Yes. Let us.' : 'Not yet. Not like this.';
    b.interactingWithId = a._id;
    touch(tx, b);
    if (yes && !meta.wantChild.includes(a._id)) {
      meta.wantChild.push(a._id);
      await saveMeta(tx);
    }
    await emitEvent(tx, { category: 'social', eventType: yes ? 'family_plan' : 'family_plan_refused', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: yes ? a.name + ' and ' + b.name + ' have decided to raise a child together.' : b.name + ' told ' + a.name + ' it is not the time for a child.', salience: yes ? 0.5 : 0.4, visibility: 'local' });
    return 2;
  }
  if (s.partnerId || bs.partnerId || s.parentIds.includes(b._id) || bs.parentIds.includes(a._id)) return -1;
  const t = await tie(tx, b._id, a._id);
  if (t?.kind === 'family') return -1;
  meta.lastProposalTick = tx.tick;
  await saveMeta(tx);
  const statusGap = ((mind.society?.status ?? 30) - bs.status) / 100;
  const chance = clamp(-0.35 + (t?.affinity ?? 0) * 0.8 + (t?.trust ?? 0) * 0.35 + bm.values.family * 0.2 + statusGap * bm.values.status * 0.5, 0.02, 0.92);
  const yes = roll(tx, a.seq, 'propose') < chance;
  act(tx, a, 'talking', 'Asking ' + b.name + ' to marry', b._id, 'Will you be my partner, here, for good?');
  b.interactingWithId = a._id;
  b.speech = yes ? 'Yes. Yes!' : 'I... no. I am sorry.';
  touch(tx, b);
  if (!yes) {
    a.mood = 'humiliated';
    shiftStatus(tx, mind, -2);
    await adjustRelationship(tx, a, b, { affinity: -0.1 });
    const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'proposal_refused', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' asked ' + b.name + ' to marry at ' + locName(a.locationId) + ', and was turned down.', salience: 0.6, visibility: 'local', witnesses: 'location' });
    if (a.traits.stubbornness > 0.65 && !s.obsession) {
      await startObsession(tx, a, mind, { kind: 'person', target: b._id, text: 'winning ' + b.name + ' back' }, eventId);
    }
    return 2;
  }
  await marry(tx, a, mind, b, bm);
  return 3;
}

export async function marry(tx: Tx, a: AgentDoc, mind: MindDoc, b: AgentDoc, bm: MindDoc, options: { quiet?: boolean } = {}): Promise<EventId | undefined> {
  const s = societyOf(tx, a, mind);
  const bs = societyOf(tx, b, bm);
  s.partnerId = b._id;
  bs.partnerId = a._id;
  touchMind(tx, mind);
  touchMind(tx, bm);
  await adjustRelationship(tx, a, b, { affinity: 0.2, trust: 0.2, kind: 'family' });
  await adjustRelationship(tx, b, a, { affinity: 0.2, trust: 0.2, kind: 'family' });
  if (a.householdId !== b.householdId && b.householdId) {
    const from = await loadHousehold(tx, a.householdId);
    const to = await loadHousehold(tx, b.householdId);
    if (from && to) {
      from.memberIds = from.memberIds.filter((id) => id !== a._id);
      from.rationDue = { food: Math.max(0, from.rationDue.food - 1), water: Math.max(0, from.rationDue.water - 2) };
      to.memberIds.push(a._id);
      to.rationDue = { food: to.rationDue.food + 1, water: to.rationDue.water + 2 };
      touchHousehold(tx, from);
      touchHousehold(tx, to);
      a.householdId = to._id;
      a.homeLocationId = to.homeLocationId;
    }
  }
  a.mood = 'hopeful';
  b.mood = 'hopeful';
  touch(tx, a);
  touch(tx, b);
  shiftStatus(tx, mind, 2);
  shiftStatus(tx, bm, 2);
  const meta = await loadMeta(tx);
  meta.couples.push([a._id, b._id]);
  await saveMeta(tx);
  if (options.quiet) return undefined;
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'marriage',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' asked ' + b.name + ' to marry at ' + locName(a.locationId) + ', and ' + firstName(b.name) + ' said yes.',
    salience: 0.76,
    visibility: 'public',
    witnesses: 'location',
  });
  return eventId;
}

// ---------- children ----------

function childPersona(child: string, parents: AgentDoc[], tick: number): NonNullable<MindDoc['persona']> {
  const p = parents.map((x) => firstName(x.name));
  return {
    epithet: 'the child of ' + listNames(p),
    want: 'to be as brave as ' + p[0],
    need: 'to be seen for who they are',
    fear: 'the dark outside the domes',
    flaw: 'trusts too easily',
    voice: 'Asks questions without stopping and repeats what the grown-ups say.',
    strategies: ['beg', 'charm'],
    arc: { stage: 'setup', note: child + ' was born in the colony on Sol ' + (Math.floor(tick / 144) + 1) + '.' },
    key: false,
  };
}

const blend = (x: number, y: number, r: number): number => round2(clamp((x + y) / 2 + (r - 0.5) * 0.3, 0.02, 0.98));

/** A child is born to a couple: traits, values and grudges inherited, a place in the household. */
export async function birth(tx: Tx, carrier: AgentDoc, partner: AgentDoc | null, cause?: EventId): Promise<AgentDoc | null> {
  if (tx.world.population.alive >= MAX_POPULATION) return null;
  const cm = await loadMind(tx, carrier);
  const pm = partner ? await loadMind(tx, partner) : null;
  if (!cm) return null;
  const parents = partner ? [carrier, partner] : [carrier];
  const other = partner ?? carrier;
  const otherMind = pm ?? cm;
  const r = (salt: string) => roll(tx, carrier.seq, 'birth' + salt);
  const first = pick(CHILD_NAMES, r('name'));
  const name = first + ' ' + familyName(carrier.name);
  const traits = {} as AgentDoc['traits'];
  for (const k of Object.keys(carrier.traits) as (keyof AgentDoc['traits'])[]) traits[k] = blend(carrier.traits[k], other.traits[k], r(k));
  const values = {} as MindDoc['values'];
  for (const k of Object.keys(cm.values) as (keyof MindDoc['values'])[]) values[k] = blend(cm.values[k], otherMind.values[k], r('v' + k));
  const { a: child, mind } = await insertPerson(tx, {
    name,
    spriteId: 'civilian_' + Math.floor(r('sprite') * SPRITE_VARIANTS),
    ageBand: 'child',
    occupation: 'resident',
    homeLocationId: carrier.homeLocationId,
    locationId: carrier.homeLocationId,
    householdId: carrier.householdId,
    traits,
    values,
    skills: { craft: 5, persuasion: 10 },
    background: 'Born in the colony to ' + listNames(parents.map((p) => p.name)) + '.',
    persona: childPersona(first, parents, tx.tick),
    dayOffset: carrier.dayOffset,
    parentIds: parents.map((p) => p._id),
    bornTick: tx.tick,
    mood: 'content',
    activity: 'sleeping',
    activityLabel: 'Asleep in a cot',
  });
  for (const p of parents) {
    const m = p === carrier ? cm : pm!;
    const ps = societyOf(tx, p, m);
    ps.childIds.push(child._id);
    touchMind(tx, m);
    shiftStatus(tx, m, 3);
    p.mood = 'proud';
    touch(tx, p);
    await adjustRelationship(tx, p, child, { affinity: 0.85, trust: 0.7, kind: 'family' });
    await adjustRelationship(tx, child, p, { affinity: 0.8, trust: 0.8, kind: 'family' });
  }
  const meta = await loadMeta(tx);
  meta.children.push(child._id);
  meta.wantChild = meta.wantChild.filter((id) => !parents.some((p) => p._id === id));
  await saveMeta(tx);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'birth',
    actorId: carrier._id,
    participantIds: [child._id, ...(partner ? [partner._id] : [])],
    locationId: carrier.homeLocationId,
    summary: listNames(parents.map((p) => p.name)) + ' welcomed a child, ' + name + ', in ' + locName(carrier.homeLocationId) + '.',
    salience: 0.8,
    causationEventId: cause,
    visibility: 'public',
  });
  await inheritGrudge(tx, child, parents, eventId);
  return child;
}

/** Children pick up their parents' worst grudge. */
async function inheritGrudge(tx: Tx, child: AgentDoc, parents: AgentDoc[], eventId: EventId): Promise<void> {
  for (const p of parents) {
    const ties = await tiesOf(tx, p._id, 12);
    const worst = ties.filter((t) => t.toAlive && t.affinity < -0.3).sort((x, y) => x.affinity - y.affinity)[0];
    if (!worst) continue;
    const rival = await loadAgent(tx, worst.toAgentId);
    if (!rival?.alive) continue;
    await adjustRelationship(tx, child, rival, { affinity: -0.25, trust: -0.2 });
    await learnBelief(tx, child, { kind: 'grudge', text: firstName(p.name) + ' says ' + rival.name + ' is not to be trusted.', valence: -1, confidence: 0.5, sourceType: 'told', subjectAgentId: rival._id, subjectName: rival.name, sourceAgentId: p._id, sourceName: p.name, originEventId: eventId });
    return;
  }
}

/** What a young adult becomes: what they studied, what their parents did, or what their nature suggests. */
function careerFor(mind: MindDoc, a: AgentDoc, parentJobs: string[]): string {
  const byskill = Object.entries(PRIMARY_SKILL).filter(([occ]) => occ !== 'resident' && occ !== 'councilor' && occ !== 'quartermaster');
  let best: { occ: string; score: number } = { occ: parentJobs.find((j) => j !== 'resident' && j !== 'councilor' && j !== 'quartermaster') ?? 'hauler', score: 12 };
  for (const [occ, skill] of byskill) {
    const s = (mind.skills[skill] ?? 0) + (parentJobs.includes(occ) ? 8 : 0) + (occ === 'researcher' ? a.traits.curiosity * 10 : 0) + (occ === 'medic' ? a.traits.empathy * 8 : 0);
    if (s > best.score) best = { occ, score: s };
  }
  return best.occ;
}

/** A child comes of age: a young adult with a career. */
export async function growUp(tx: Tx, a: AgentDoc, mind: MindDoc): Promise<void> {
  const s = societyOf(tx, a, mind);
  const parents: AgentDoc[] = [];
  for (const id of s.parentIds) {
    const p = await loadAgent(tx, id);
    if (p) parents.push(p);
  }
  const occ = careerFor(mind, a, parents.map((p) => p.occupation));
  const def = OCCUPATIONS.find((o) => o.id === occ)!;
  const skill = PRIMARY_SKILL[occ];
  mind.ageBand = 'young';
  mind.skills[skill] = Math.max(mind.skills[skill] ?? 0, 30);
  s.jobHistory.push({ occupation: occ, fromTick: tx.tick });
  s.status = Math.max(s.status, 25);
  if (mind.persona) mind.persona = { ...mind.persona, epithet: 'a young ' + def.label.toLowerCase() + ', born in the colony', arc: { stage: 'rising', note: 'Grew up and chose to become a ' + def.label.toLowerCase() + '.' } };
  touchMind(tx, mind);
  a.occupation = occ;
  a.workLocationId = def.workLocationId;
  a.skill = mind.skills[skill];
  a.spriteId = (def.archetype as SpriteArchetype) + '_' + (a.seq % SPRITE_VARIANTS);
  a.mood = 'hopeful';
  touch(tx, a);
  const meta = await loadMeta(tx);
  meta.children = meta.children.filter((id) => id !== a._id);
  await saveMeta(tx);
  const same = parents.some((p) => p.occupation === occ);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'came_of_age',
    actorId: a._id,
    participantIds: parents.map((p) => p._id),
    summary: a.name + ((s.bornTick ?? 0) >= 0 ? ', born on Sol ' + (Math.floor((s.bornTick ?? 0) / 144) + 1) + ',' : '') + ' has grown up and chosen to become a ' + def.label.toLowerCase() + (same ? ', like ' + firstName(parents.find((p) => p.occupation === occ)!.name) : parents.length ? ', not what ' + listNames(parents.map((p) => firstName(p.name))) + ' expected' : '') + '.',
    salience: 0.72,
    visibility: 'public',
  });
  await enqueueCognition(tx, a, { kind: 'plan', trigger: 'grew up and became a ' + def.label.toLowerCase(), priority: 0.6, lane: 'normal', eventId });
}

/** Births due, couples deciding to have children, children growing up, orphans finding guardians. */
export async function familiesHourly(tx: Tx, meta: Meta): Promise<void> {
  for (const p of [...meta.pregnancies]) {
    if (p.dueTick > tx.tick) continue;
    meta.pregnancies = meta.pregnancies.filter((x) => x !== p);
    const carrier = await loadAgent(tx, p.carrierId as Id<'agents'>);
    if (!carrier?.alive) continue;
    const partner = await loadAgent(tx, p.partnerId as Id<'agents'>);
    await birth(tx, carrier, partner?.alive ? partner : null, p.eventId as EventId | undefined);
  }
  for (const id of [...meta.children]) {
    const a = await loadAgent(tx, id as Id<'agents'>);
    if (!a?.alive) {
      meta.children = meta.children.filter((x) => x !== id);
      continue;
    }
    const mind = await loadMind(tx, a);
    const born = mind?.society?.bornTick ?? 0;
    if (mind && mind.ageBand === 'child' && tx.tick - born >= GROW_UP_TICKS) await growUp(tx, a, mind);
  }
  await saveMeta(tx);
}

/** Once a day: couples who want a child conceive, and orphans are taken in. */
export async function familiesDaily(tx: Tx, people: Map<string, { a: AgentDoc; mind: MindDoc }>, meta: Meta): Promise<void> {
  meta.couples = meta.couples.filter(([x, y]) => people.has(x) && people.has(y));
  for (const [x, y] of meta.couples) {
    if (meta.pregnancies.length >= 3 || tx.world.population.alive + meta.pregnancies.length >= MAX_POPULATION - 1) break;
    if (meta.pregnancies.some((p) => p.carrierId === x || p.carrierId === y)) continue;
    const px = people.get(x)!;
    const py = people.get(y)!;
    if (px.mind.ageBand === 'elder' || py.mind.ageBand === 'elder' || px.mind.ageBand === 'child') continue;
    const kids = px.mind.society?.childIds.length ?? 0;
    const wants = meta.wantChild.includes(x) || meta.wantChild.includes(y);
    const chance = wants ? 0.9 : kids >= 2 ? 0.01 : 0.03 + (px.mind.values.family + py.mind.values.family) * 0.03;
    if (roll(tx, px.a.seq, 'conceive') >= chance) continue;
    const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'expecting', actorId: px.a._id, participantIds: [py.a._id], summary: px.a.name + ' and ' + py.a.name + ' are expecting a child.', salience: 0.55, visibility: 'public' });
    meta.pregnancies.push({ carrierId: x, partnerId: y, dueTick: tx.tick + PREGNANCY_TICKS, eventId });
  }
  for (const id of meta.children) {
    const child = people.get(id);
    if (!child?.mind.society) continue;
    const s = child.mind.society;
    if (s.parentIds.some((p) => people.has(p))) continue;
    const guardian = [...people.values()]
      .filter((p) => p.mind.ageBand !== 'child' && p.a._id !== id && (p.a.householdId === child.a.householdId || p.a.traits.empathy > 0.7))
      .sort((p, q) => (q.a.householdId === child.a.householdId ? 1 : 0) - (p.a.householdId === child.a.householdId ? 1 : 0) || q.a.traits.empathy - p.a.traits.empathy)[0];
    if (!guardian) continue;
    s.parentIds.push(guardian.a._id);
    touchMind(tx, child.mind);
    societyOf(tx, guardian.a, guardian.mind).childIds.push(child.a._id);
    touchMind(tx, guardian.mind);
    shiftStatus(tx, guardian.mind, 4);
    await adjustRelationship(tx, guardian.a, child.a, { affinity: 0.5, trust: 0.4, kind: 'family' });
    await adjustRelationship(tx, child.a, guardian.a, { affinity: 0.4, trust: 0.4, kind: 'family' });
    await emitEvent(tx, { category: 'social', eventType: 'guardian', actorId: guardian.a._id, participantIds: [child.a._id], summary: 'Orphaned ' + child.a.name + ' has been taken in by ' + guardian.a.name + '.', salience: 0.66, visibility: 'public' });
  }
}

// ---------- pets ----------

export async function adoptPet(tx: Tx, a: AgentDoc, mind: MindDoc, speciesArg: string | undefined): Promise<number> {
  const meta = await loadMeta(tx);
  const owned = await tx.ctx.db.query('pets').withIndex('by_owner', (q) => q.eq('ownerId', a._id)).collect();
  if (owned.filter((p) => p.alive).length >= 2) return -1;
  const avail = PET_SPECIES.filter((s) => (!s.requires || meta.discovered.includes(s.requires)) && (s.where ? a.locationId === s.where : meta.strays > 0));
  const species = avail.find((s) => s.key === speciesArg) ?? avail[0];
  if (!species) return -1;
  if (!species.where) meta.strays -= 1;
  const used = new Set(owned.map((p) => p.name));
  const name = species.names.find((n, i) => !used.has(n) && roll(tx, a.seq, 'petname' + i) < 0.5) ?? pick(species.names, roll(tx, a.seq, 'petname'));
  const id = await tx.ctx.db.insert('pets', { worldId: tx.world._id, ownerId: a._id, name, species: species.key, alive: true, bornTick: tx.tick - 30, bond: 0.4 });
  meta.pets.push(id);
  await saveMeta(tx);
  a.needs.social = Math.max(0, a.needs.social - 20);
  a.mood = 'content';
  act(tx, a, 'giving', 'Taking in a ' + species.label + ' and naming it ' + name);
  shiftStatus(tx, mind, 0.5);
  await emitEvent(tx, { category: 'social', eventType: 'pet_adopted', actorId: a._id, locationId: a.locationId, summary: a.name + ' took in a ' + (species.where ? '' : 'stray ') + species.label + ' and named it ' + name + '.', salience: 0.45, visibility: 'local', witnesses: 'location' });
  return 2;
}

/** Look after a pet or a child: bonds deepen, loneliness eases, a hungry child is fed. */
export async function care(tx: Tx, a: AgentDoc, mind: MindDoc, targetId: string | undefined): Promise<number> {
  if (!targetId) return -1;
  const petId = tx.ctx.db.normalizeId('pets', targetId);
  if (petId) {
    const pet = await tx.ctx.db.get(petId);
    if (!pet || !pet.alive || pet.ownerId !== a._id) return -1;
    await tx.ctx.db.patch(petId, { bond: round2(Math.min(1, pet.bond + 0.08)) });
    a.needs.social = Math.max(0, a.needs.social - 18);
    a.needs.safety = Math.max(0, a.needs.safety - 10);
    if (a.mood === 'lonely' || a.mood === 'anxious' || a.mood === 'calm') a.mood = 'content';
    act(tx, a, 'resting', 'Playing with ' + pet.name);
    return 3;
  }
  const child = await loadAgent(tx, targetId as Id<'agents'>);
  if (!child?.alive || child.locationId !== a.locationId) return -1;
  const cm = await loadMind(tx, child);
  if (!cm?.society?.parentIds.includes(a._id) && !mind.society?.childIds.includes(child._id)) return -1;
  for (const res of ['food', 'water'] as const) {
    const need = res === 'food' ? child.needs.hunger : child.needs.thirst;
    if (need < 45) continue;
    const h = await loadHousehold(tx, a.householdId);
    if (a.inv[res] >= 1) a.inv[res] -= 1;
    else if (h && h.pantry[res] >= 1) {
      h.pantry[res] -= 1;
      touchHousehold(tx, h);
    } else continue;
    if (res === 'food') child.needs.hunger = Math.max(0, child.needs.hunger - 42);
    else child.needs.thirst = Math.max(0, child.needs.thirst - 45);
  }
  child.needs.social = Math.max(0, child.needs.social - 30);
  child.needs.safety = Math.max(0, child.needs.safety - 20);
  if (cm) {
    const skill = PRIMARY_SKILL[a.occupation] ?? 'craft';
    cm.skills[skill] = round2(Math.min(60, (cm.skills[skill] ?? 0) + 0.6));
    touchMind(tx, cm);
  }
  touch(tx, child);
  a.needs.social = Math.max(0, a.needs.social - 15);
  act(tx, a, 'giving', 'Looking after ' + firstName(child.name), child._id, pick(['Eat up.', 'Tell me about your day.', 'Hold still.', 'That is my brave one.'], roll(tx, a.seq, 'careline')));
  await adjustRelationship(tx, child, a, { affinity: 0.03, trust: 0.03 });
  return 3;
}

/** Once a day: pets eat, bonds fade without care, the old die, owners grieve, the ownerless are rehomed. */
export async function petsDaily(tx: Tx, meta: Meta, people: Map<string, { a: AgentDoc; mind: MindDoc }>): Promise<void> {
  const keep: string[] = [];
  for (const id of meta.pets) {
    const pid = tx.ctx.db.normalizeId('pets', id);
    const pet = pid ? await tx.ctx.db.get(pid) : null;
    if (!pet || !pet.alive) continue;
    const owner = pet.ownerId ? people.get(pet.ownerId) : undefined;
    if (!owner) {
      const heir = pet.ownerId ? await heirOf(tx, pet.ownerId, people) : undefined;
      await tx.ctx.db.patch(pet._id, { ownerId: heir?.a._id });
      if (heir) await emitEvent(tx, { category: 'social', eventType: 'pet_inherited', actorId: heir.a._id, summary: heir.a.name + ' took in ' + pet.name + ', who had no one left.', salience: 0.4, visibility: 'local' });
      else meta.strays += 1;
      if (heir) keep.push(id);
      continue;
    }
    keep.push(id);
    const ate = owner.a.inv.food >= 0.3;
    if (ate) {
      owner.a.inv.food = round2(owner.a.inv.food - 0.3);
      touch(tx, owner.a);
    }
    const bond = round2(clamp(pet.bond - (ate ? 0.03 : 0.12), 0, 1));
    const age = (tx.tick - pet.bornTick) / 144;
    const dies = roll(tx, owner.a.seq, 'petdeath' + id) < 0.01 + Math.max(0, age - 20) * 0.01 + (bond < 0.1 ? 0.03 : 0);
    if (!dies) {
      await tx.ctx.db.patch(pet._id, { bond });
      continue;
    }
    await tx.ctx.db.patch(pet._id, { alive: false, bond });
    keep.pop();
    await petGrief(tx, owner.a, owner.mind, pet.name, bond < 0.1 ? 'of neglect' : 'in the night');
  }
  meta.pets = keep;
  if (meta.built.some((b) => b.key === 'pet_shelter')) meta.strays = Math.min(4, meta.strays + 1);
}

export async function petGrief(tx: Tx, owner: AgentDoc, mind: MindDoc, petName: string, how: string, cause?: EventId): Promise<EventId> {
  owner.mood = 'grieving';
  owner.needs.social = Math.min(100, owner.needs.social + 25);
  touch(tx, owner);
  mind.values.family = round2(Math.min(1, mind.values.family + 0.02));
  touchMind(tx, mind);
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'pet_died', actorId: owner._id, locationId: owner.locationId, summary: petName + ', ' + owner.name + "'s companion, died " + how + '. ' + firstName(owner.name) + ' is heartbroken.', salience: 0.55, causationEventId: cause, visibility: 'local' });
  return eventId;
}

async function heirOf(tx: Tx, deadId: string, people: Map<string, { a: AgentDoc; mind: MindDoc }>) {
  const dead = await loadAgent(tx, deadId as Id<'agents'>);
  const m = dead ? await loadMind(tx, dead) : null;
  const ids = [m?.society?.partnerId, ...(m?.society?.childIds ?? [])].filter((x): x is Id<'agents'> => !!x);
  for (const id of ids) if (people.has(id)) return people.get(id);
  return undefined;
}

/** When someone dies: credits pass to partner and children, the partner is widowed, children may be orphaned. */
export async function inheritance(tx: Tx, dead: AgentDoc, deathEventId: EventId): Promise<void> {
  const m = await loadMind(tx, dead);
  if (!m?.society) return;
  const s = m.society;
  const heirs: AgentDoc[] = [];
  for (const id of [s.partnerId, ...s.childIds].filter((x): x is Id<'agents'> => !!x)) {
    const h = await loadAgent(tx, id);
    if (h?.alive) heirs.push(h);
  }
  if (s.partnerId) {
    const partner = await loadAgent(tx, s.partnerId);
    const pm = partner ? await loadMind(tx, partner) : null;
    if (pm?.society) {
      pm.society.partnerId = undefined;
      touchMind(tx, pm);
    }
    const meta = await loadMeta(tx);
    meta.couples = meta.couples.filter(([x, y]) => x !== dead._id && y !== dead._id);
    meta.pregnancies = meta.pregnancies.filter((p) => p.carrierId !== dead._id);
    await saveMeta(tx);
  }
  if (heirs.length === 0 || dead.inv.credits < 1) return;
  const share = round2(dead.inv.credits / heirs.length);
  for (const h of heirs) {
    h.inv.credits = round2(h.inv.credits + share);
    touch(tx, h);
  }
  const total = Math.round(dead.inv.credits);
  dead.inv.credits = 0;
  touch(tx, dead);
  await emitEvent(tx, { category: 'economy', eventType: 'inheritance', actorId: heirs[0]._id, participantIds: heirs.map((h) => h._id), summary: listNames(heirs.map((h) => h.name)) + ' inherited ' + total + ' credits from ' + dead.name + '.', salience: total > 80 ? 0.5 : 0.35, causationEventId: deathEventId, visibility: 'local' });
}
