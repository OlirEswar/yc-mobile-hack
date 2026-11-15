/**
 * Sudden events and lived experience. A scheduler fires a random happening every half to whole sim
 * day (quakes, strangers, fevers, signals, festivals, lost pets, old logs...), weighted by the state
 * of the colony and never the same twice in a row; each one is a root cause that later events point
 * back to. Reactions to what happened since the last tick turn experience into change: inheritance,
 * scandal, gratitude, grief, prophecy, inspiration, and the values and beliefs people carry after.
 */
import type { Doc, Id } from '../_generated/dataModel';
import { MAX_POPULATION, OCCUPATIONS, SPRITE_VARIANTS } from '../../shared/colony';
import type { SpriteArchetype } from '../../shared/colony';
import { RANDOM_EVENTS, RANDOM_EVENT_BY_KEY, STRANGER_NAMES } from '../../shared/society';
import type { RandomEventDef } from '../../shared/society';
import { clamp, pick, randInt, round2 } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import { ROSTER_DEAD, ROSTER_TRANSIT } from '../seed/insert';
import { addStock, firstName, locName, stock } from '../engine/conditions';
import { adjustRelationship, agentIndex, agentsAt, emitEvent, encodeStep, enqueueCognition, interrupt, killAgent, learnBelief, loadAgent, loadMind, setPlan, touch, touchMind, tiesOf } from '../engine/core';
import type { AgentDoc, EventId, MindDoc, Tx } from '../engine/core';
import { eventWeight } from './craft';
import { insertPerson, inheritance, petGrief, birth } from './family';
import { endObsession, fulfil, startObsession } from './obsession';
import { DAY, INFANT_TICKS, activeOrgs, loadMeta, pickWeighted, roll, saveMeta, shiftStatus, societyOf } from './store';
import type { Meta } from './store';
import { isArtist } from './culture';

type Run = (tx: Tx, meta: Meta) => Promise<EventId | null>;

// ---------- sampling people cheaply ----------

/** Up to n living, present agents chosen at random from the roster, optionally filtered. */
async function sample(tx: Tx, n: number, salt: string, keep?: (a: AgentDoc, m: MindDoc) => boolean, tries = 24): Promise<{ a: AgentDoc; mind: MindDoc }[]> {
  const index = await agentIndex(tx);
  const out: { a: AgentDoc; mind: MindDoc }[] = [];
  const total = tx.rosterSt.length;
  if (total === 0) return out;
  const start = Math.floor(roll(tx, 0, 'sample' + salt) * total);
  for (let i = 0, looked = 0; i < total && out.length < n && looked < tries; i++) {
    const seq = (start + i * 7) % total;
    const st = tx.rosterSt[seq];
    if (st === ROSTER_DEAD || st === ROSTER_TRANSIT || !index[seq]) continue;
    looked += 1;
    const a = await loadAgent(tx, index[seq]);
    const mind = a ? await loadMind(tx, a) : null;
    if (!a?.alive || !mind || out.some((x) => x.a._id === a._id)) continue;
    if (!keep || keep(a, mind)) out.push({ a, mind });
  }
  return out;
}

async function peopleAt(tx: Tx, loc: string, asleep = true): Promise<AgentDoc[]> {
  const out: AgentDoc[] = [];
  for (const id of (await agentsAt(tx, loc, { includeAsleep: asleep })).slice(0, 14)) {
    const a = await loadAgent(tx, id);
    if (a?.alive) out.push(a);
  }
  return out;
}

const frighten = (tx: Tx, a: AgentDoc, amount: number) => {
  a.needs.safety = Math.min(100, a.needs.safety + amount);
  if (a.mood !== 'grieving') a.mood = 'afraid';
  touch(tx, a);
};

async function hurt(tx: Tx, a: AgentDoc, amount: number, cause: string, eventId: EventId): Promise<boolean> {
  a.health = Math.max(0, a.health - amount);
  touch(tx, a);
  if (a.health > 0) return false;
  await killAgent(tx, a, { cause, summary: a.name + ' died: ' + cause + '.', causationEventId: eventId, category: 'environment' });
  return true;
}

async function root(tx: Tx, key: string, e: { summary: string; locationId?: string; actorId?: Id<'agents'>; participantIds?: Id<'agents'>[]; salience: number; banner?: boolean }): Promise<EventId> {
  const def = RANDOM_EVENT_BY_KEY[key];
  const { eventId } = await emitEvent(tx, { category: def.category, eventType: def.key, visibility: 'public', witnesses: e.locationId ? 'location' : undefined, ...e });
  return eventId;
}

const INTERIOR = ['habitat_a', 'habitat_b', 'workshop', 'depot', 'hydroponics', 'medbay', 'canteen', 'plaza'];
const EXPOSED = ['ice_wells', 'quarry', 'solar_farm', 'landing_pad'];
const R = (tx: Tx, salt: string) => roll(tx, 'event', salt);

// ---------- the events ----------

const RUNS: Record<string, Run> = {
  async moonquake(tx, meta) {
    const loc = pick(INTERIOR, R(tx, 'mq'));
    const sev = round2(0.15 + R(tx, 'mqs') * 0.2);
    tx.world.damage[loc] = round2(clamp((tx.world.damage[loc] ?? 0) + sev, 0, 1));
    const there = await peopleAt(tx, loc);
    const id = await root(tx, 'moonquake', { summary: 'A moonquake shook the colony; ' + locName(loc) + ' took the worst of it, with cracked walls and buckled floors.', locationId: loc, participantIds: there.map((a) => a._id), salience: 0.78 });
    const hurtNames: string[] = [];
    for (const a of there) {
      frighten(tx, a, 40);
      if (roll(tx, a.seq, 'mqhurt') < 0.3) {
        hurtNames.push(a.name);
        await hurt(tx, a, 18 + R(tx, 'mqh' + a.seq) * 20, 'crushed in the moonquake at ' + locName(loc), id);
      }
    }
    if (hurtNames.length) await emitEvent(tx, { category: 'health', eventType: 'injury', participantIds: there.filter((a) => hurtNames.includes(a.name)).map((a) => a._id), locationId: loc, summary: hurtNames.slice(0, 3).join(', ') + (hurtNames.length > 1 ? ' were' : ' was') + ' hurt when the ceiling came down at ' + locName(loc) + '.', salience: 0.6, causationEventId: id, visibility: 'public' });
    meta.fearUntil = tx.tick + DAY;
    return id;
  },
  async micrometeor(tx) {
    const counts = await Promise.all(EXPOSED.map(async (loc) => ({ loc, n: (await agentsAt(tx, loc)).length })));
    const busy = counts.filter((x) => x.n > 0);
    const loc = pick(busy.length && R(tx, 'mmb') < 0.7 ? busy : counts, R(tx, 'mm')).loc;
    tx.world.damage[loc] = round2(clamp((tx.world.damage[loc] ?? 0) + 0.12, 0, 1));
    const there = await peopleAt(tx, loc, false);
    const victim = there.length ? pick(there, R(tx, 'mmv')) : null;
    const id = await root(tx, 'micrometeor', { summary: 'A micrometeor punched through ' + locName(loc) + (victim ? ' and through ' + victim.name + "'s suit" : '') + '.', locationId: loc, actorId: victim?._id, salience: victim ? 0.76 : 0.6 });
    if (victim) {
      frighten(tx, victim, 50);
      await hurt(tx, victim, 30 + R(tx, 'mmd') * 40, 'a micrometeor through the suit at ' + locName(loc), id);
    }
    return id;
  },
  async disease_outbreak(tx) {
    const home = pick(['habitat_a', 'habitat_b'], R(tx, 'do'));
    const sick = (await peopleAt(tx, home)).slice(0, 5);
    if (sick.length < 2) sick.push(...(await sample(tx, 3, 'sick')).map((p) => p.a));
    const id = await root(tx, 'disease_outbreak', { summary: 'A fever is running through ' + locName(home) + ': ' + sick.slice(0, 3).map((a) => firstName(a.name)).join(', ') + (sick.length > 3 ? ' and others are' : ' are') + ' down with it.', locationId: home, participantIds: sick.map((a) => a._id), salience: 0.75 });
    const medicine = stock(tx.world, 'medbay', 'medicine');
    const treated = Math.min(sick.length, Math.floor(medicine));
    addStock(tx.world, 'medbay', 'medicine', -treated);
    for (const [i, a] of sick.entries()) await hurt(tx, a, i < treated ? 12 : 28, 'the fever in ' + locName(home), id);
    if (treated < sick.length) await emitEvent(tx, { category: 'health', eventType: 'medicine_short', locationId: 'medbay', summary: 'The Med Bay ran out of fever medicine with ' + (sick.length - treated) + ' still untreated.', salience: 0.62, causationEventId: id, visibility: 'public' });
    return id;
  },
  async shuttle_stranger(tx, meta) {
    if (tx.world.population.alive >= MAX_POPULATION - 1) return null;
    const used = new Set<string>();
    for (const id of (await agentIndex(tx)).slice(-20)) {
      const a = id ? await loadAgent(tx, id) : null;
      if (a) used.add(a.name);
    }
    const name = STRANGER_NAMES.find((n, i) => !used.has(n) && R(tx, 'sn' + i) < 0.6) ?? STRANGER_NAMES.find((n) => !used.has(n));
    if (!name) return null;
    const jobs = ['medic', 'fabricator', 'trader', 'researcher', 'ice_miner', 'solar_tech'];
    const occ = pick(jobs, R(tx, 'sj'));
    const def = OCCUPATIONS.find((o) => o.id === occ)!;
    const secrets = [
      { kind: 'long_dark_survivor', text: 'Was aboard the shuttle everyone believes was lost in the Long Dark, and knows why it never landed.', want: 'to find out who is still alive from that night', fear: 'being recognised' },
      { kind: 'deserter', text: 'Deserted from an Earth security cutter and is travelling under a false name.', want: 'to disappear somewhere nobody asks questions', fear: 'the next shuttle bringing someone who knows' },
      { kind: 'heir', text: 'Holds a consortium deed that could make them owner of the ice wells.', want: 'to see what the deed is really worth', fear: 'being robbed before they can use it' },
      { kind: 'grief', text: "Came looking for a sibling who died in the Long Dark, and blames the colony's founders.", want: 'to learn how their sibling died', fear: 'that the answer is worse than they imagine' },
    ];
    const s = pick(secrets, R(tx, 'ss'));
    const r = (k: string) => round2(0.2 + R(tx, 'st' + k) * 0.7);
    const householdId = await tx.ctx.db.insert('households', { worldId: tx.world._id, name: name + "'s bunk", homeLocationId: 'habitat_b', memberIds: [], pantry: { food: 2, water: 3 }, rationDue: { food: 0, water: 0 }, rationDay: Math.floor(tx.tick / DAY) });
    const { a } = await insertPerson(tx, {
      name,
      spriteId: (def.archetype as SpriteArchetype) + '_' + Math.floor(R(tx, 'ssp') * SPRITE_VARIANTS),
      ageBand: 'adult',
      occupation: occ,
      homeLocationId: 'habitat_b',
      locationId: 'landing_pad',
      householdId,
      traits: { ambition: r('a'), empathy: r('e'), caution: r('c'), curiosity: r('u'), sociability: r('s'), stubbornness: r('t') },
      values: { wealth: r('w'), family: r('f'), status: r('x'), harmony: r('h'), freedom: r('r') },
      skills: { [PRIMARY_SKILL[occ]]: 55, persuasion: 40 },
      background: 'Stepped off an unscheduled shuttle with one bag and no explanation.',
      persona: { epithet: 'the stranger off the unscheduled shuttle', want: s.want, need: 'to stop running', fear: s.fear, flaw: 'trusts nobody', voice: 'Answers questions with questions. Watches the door.', secret: { kind: s.kind, text: s.text }, strategies: ['work', 'trade', 'scheme'], arc: { stage: 'setup', note: 'Just arrived; nobody knows why.' }, key: false },
      inv: { credits: 80, food: 2, water: 2 },
      dayOffset: 0,
      mood: 'wary',
      activityLabel: 'Just stepped off a shuttle nobody expected',
    });
    const id = await root(tx, 'shuttle_stranger', { summary: 'An unscheduled shuttle touched down at the Landing Pad and left behind ' + name + ', a ' + def.label.toLowerCase() + ' who will not say why they came.', locationId: 'landing_pad', actorId: a._id, salience: 0.8, banner: true });
    await setPlan(tx, a, { intent: 'Find a bunk and keep my head down', source: 'routine', steps: [encodeStep('go', 'habitat_b')], labels: ['Looking for a bunk in Habitat Ring B'], causeEventId: id });
    await enqueueCognition(tx, a, { kind: 'plan', trigger: 'arrived in the colony with a secret', priority: 0.6, lane: 'normal', eventId: id });
    meta.inspiration = { eventId: id, summary: 'the stranger', tick: tx.tick, kind: 'stranger' };
    return id;
  },
  async strange_signal(tx, meta) {
    const id = await root(tx, 'strange_signal', { summary: 'The Observatory picked up a signal from the crater floor: a slow, regular pulse, eleven beats, then silence.', locationId: 'observatory', salience: 0.74 });
    for (const p of await sample(tx, 2, 'sig', (a, m) => a.traits.curiosity > 0.65 && !m.society?.obsession && m.ageBand !== 'child')) {
      await startObsession(tx, p.a, p.mind, { kind: 'long_dark', text: 'the signal from the crater' }, id);
    }
    meta.fearUntil = tx.tick + DAY;
    await prophecy(tx, id, 'the dead are calling from the crater');
    return id;
  },
  async reactor_scare(tx, meta) {
    tx.world.damage.solar_farm = round2(clamp((tx.world.damage.solar_farm ?? 0) + 0.12, 0, 1));
    const id = await root(tx, 'reactor_scare', { summary: 'The reactor alarm screamed for eleven minutes before anyone could silence it. Everyone old enough remembered the Long Dark.', locationId: 'solar_farm', salience: 0.82, banner: true });
    for (const loc of ['plaza', 'canteen', 'solar_farm']) for (const a of await peopleAt(tx, loc, false)) frighten(tx, a, 35);
    meta.fearUntil = tx.tick + DAY;
    const techs = await sample(tx, 1, 'rs', (a) => a.occupation === 'solar_tech' || a.occupation === 'fabricator');
    if (techs[0]) {
      shiftStatus(tx, techs[0].mind, 4);
      await emitEvent(tx, { category: 'environment', eventType: 'reactor_safe', actorId: techs[0].a._id, summary: techs[0].a.name + ' traced the alarm to a cracked sensor. The reactor is fine, this time.', salience: 0.55, causationEventId: id, visibility: 'public' });
    }
    await prophecy(tx, id, 'the Long Dark is coming back');
    return id;
  },
  async rich_ice_strike(tx) {
    const miners = (await peopleAt(tx, 'ice_wells', false)).filter((a) => a.occupation === 'ice_miner');
    const lucky = miners[0] ?? (await sample(tx, 1, 'ice', (a) => a.occupation === 'ice_miner'))[0]?.a;
    if (!lucky) return null;
    const water = randInt(R(tx, 'iw'), 110, 190);
    addStock(tx.world, 'depot', 'water', water);
    const m = await loadMind(tx, lucky);
    if (m) {
      shiftStatus(tx, m, 6);
      societyOf(tx, lucky, m).fame = round2(Math.min(1, m.society!.fame + 0.1));
    }
    lucky.mood = 'euphoric';
    touch(tx, lucky);
    return await root(tx, 'rich_ice_strike', { summary: lucky.name + ' hit a seam of clean ice at the Ice Wells; ' + water + ' units of water are flowing into the depot.', locationId: 'ice_wells', actorId: lucky._id, salience: 0.72 });
  },
  async festival_day(tx) {
    const id = await root(tx, 'festival_day', { summary: 'The council declared a festival day: lamps in the plaza, music in the canteen, and work can wait.', locationId: 'plaza', salience: 0.68 });
    const crowd = await sample(tx, 14, 'fest');
    let performers = 0;
    for (const p of crowd) {
      p.a.needs.social = Math.max(0, p.a.needs.social - 30);
      if (p.a.mood === 'calm' || p.a.mood === 'anxious' || p.a.mood === 'lonely') p.a.mood = 'hopeful';
      touch(tx, p.a);
      if (isArtist(p.mind) && performers < 2 && p.a.activity !== 'sleeping') {
        performers += 1;
        societyOf(tx, p.a, p.mind).inspiration = 0.6;
        touchMind(tx, p.mind);
        interrupt(tx, p.a, [encodeStep('go', 'plaza'), encodeStep('perform', 4)]);
      }
    }
    return id;
  },
  async pet_escapes(tx, meta) {
    if (meta.pets.length === 0) return null;
    const petId = tx.ctx.db.normalizeId('pets', pick(meta.pets, R(tx, 'pe')));
    const pet = petId ? await tx.ctx.db.get(petId) : null;
    if (!pet?.alive || !pet.ownerId || meta.missing.some((m) => m.id === pet._id)) return null;
    const owner = await loadAgent(tx, pet.ownerId);
    const om = owner ? await loadMind(tx, owner) : null;
    if (!owner?.alive || !om) return null;
    const id = await root(tx, 'pet_escapes', { summary: pet.name + ', ' + owner.name + "'s " + pet.species.replace(/_/g, ' ') + ', slipped out through a service hatch and has not come back.', actorId: owner._id, salience: 0.58 });
    meta.missing.push({ kind: 'pet', id: pet._id, ownerId: owner._id, sinceTick: tx.tick, resolveTick: tx.tick + randInt(R(tx, 'per'), 18, 54), eventId: id });
    owner.mood = 'anxious';
    touch(tx, owner);
    await startObsession(tx, owner, om, { kind: 'pet', target: pet._id, text: 'finding ' + pet.name }, id);
    return id;
  },
  async birth_complication(tx, meta) {
    const p = meta.pregnancies[0];
    if (!p) return null;
    const carrier = await loadAgent(tx, p.carrierId as Id<'agents'>);
    if (!carrier?.alive) return null;
    const id = await root(tx, 'birth_complication', { summary: carrier.name + ' was rushed to the Med Bay: the pregnancy has gone badly wrong.', locationId: 'medbay', actorId: carrier._id, salience: 0.8 });
    const r = R(tx, 'bc');
    if (r < 0.65) {
      meta.pregnancies = meta.pregnancies.filter((x) => x !== p);
      const partner = await loadAgent(tx, p.partnerId as Id<'agents'>);
      await birth(tx, carrier, partner?.alive ? partner : null, id);
      carrier.health = Math.max(10, carrier.health - 30);
      touch(tx, carrier);
    } else {
      meta.pregnancies = meta.pregnancies.filter((x) => x !== p);
      const partner = await loadAgent(tx, p.partnerId as Id<'agents'>);
      for (const x of [carrier, partner]) {
        if (!x?.alive) continue;
        x.mood = 'grieving';
        touch(tx, x);
        const xm = await loadMind(tx, x);
        if (xm) await experience(tx, x, xm, 'bereaved', id);
      }
      await emitEvent(tx, { category: 'health', eventType: 'child_lost', actorId: carrier._id, participantIds: partner ? [partner._id] : [], summary: carrier.name + (partner ? ' and ' + partner.name : '') + ' lost the baby.', salience: 0.75, causationEventId: id, visibility: 'public' });
    }
    return id;
  },
  async artist_breakthrough(tx) {
    const [p] = await sample(tx, 1, 'ab', (a, m) => (m.skills.art ?? 0) >= 25 && (m.society?.fame ?? 0) < 0.35 && a.activity !== 'sleeping');
    if (!p) return null;
    const s = societyOf(tx, p.a, p.mind);
    s.inspiration = 1;
    p.mind.skills.art = round2(Math.min(100, (p.mind.skills.art ?? 25) + 8));
    touchMind(tx, p.mind);
    const id = await root(tx, 'artist_breakthrough', { summary: 'Something cracked open in ' + p.a.name + ' overnight; ' + firstName(p.a.name) + ' has not stopped working since dawn.', actorId: p.a._id, salience: 0.55 });
    interrupt(tx, p.a, [encodeStep('create_art', pick(['mural', 'song', 'poem', 'play'], R(tx, 'abk')))]);
    return id;
  },
  async blackout(tx, meta) {
    tx.world.damage.solar_farm = round2(clamp((tx.world.damage.solar_farm ?? 0) + 0.15, 0, 1));
    const rows = await tx.ctx.db.query('research').withIndex('by_world_key', (q) => q.eq('worldId', tx.world._id)).take(40);
    const lost = rows.filter((r) => r.progress > 1).sort((x, y) => y.progress - x.progress).slice(0, 3);
    for (const r of lost) await tx.ctx.db.patch(r._id, { progress: round2(r.progress * 0.85) });
    meta.fearUntil = tx.tick + DAY / 2;
    for (const a of await peopleAt(tx, 'plaza', false)) frighten(tx, a, 25);
    return await root(tx, 'blackout', { summary: 'The lights went out across the colony for three hours.' + (lost.length ? ' Weeks of unsaved research at the Observatory went with them.' : ''), salience: 0.72 });
  },
  async air_leak(tx) {
    const home = pick(['habitat_a', 'habitat_b'], R(tx, 'al'));
    tx.world.damage[home] = round2(clamp((tx.world.damage[home] ?? 0) + 0.2, 0, 1));
    const there = await peopleAt(tx, home);
    const id = await root(tx, 'air_leak', { summary: 'A seal in ' + locName(home) + ' blew; the air hissed out and everyone inside ran for the tubes.', locationId: home, participantIds: there.map((a) => a._id), salience: 0.76 });
    const hero = there.filter((a) => a.traits.caution < 0.5 || a.occupation === 'fabricator' || a.occupation === 'solar_tech').sort((x, y) => y.traits.empathy - x.traits.empathy)[0];
    for (const a of there) {
      if (a === hero) continue;
      frighten(tx, a, 45);
      interrupt(tx, a, [encodeStep('flee', 'medbay'), encodeStep('rest', 3)]);
    }
    if (hero) {
      const hm = await loadMind(tx, hero);
      if (hm) await experience(tx, hero, hm, 'saved', id);
      const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'heroism', actorId: hero._id, participantIds: there.filter((a) => a !== hero).map((a) => a._id), locationId: home, summary: hero.name + ' stayed behind in ' + locName(home) + ' and patched the blown seal with a jacket and sealant while the air ran out.', salience: 0.74, causationEventId: id, visibility: 'public' });
      for (const a of there.filter((x) => x !== hero).slice(0, 6)) await learnBelief(tx, a, { kind: 'hero', text: hero.name + ' saved us when the seal blew in ' + locName(home) + '.', valence: 1, confidence: 0.9, sourceType: 'observed', subjectAgentId: hero._id, subjectName: hero.name, truthEventId: eventId, originEventId: eventId });
      await hurt(tx, hero, 15, 'suffocation while sealing a breach in ' + locName(home), id);
    }
    return id;
  },
  async lost_rover(tx, meta) {
    const [p] = await sample(tx, 1, 'lr', (a) => ['ice_miner', 'quarry_hand', 'hauler', 'dock_hand', 'solar_tech'].includes(a.occupation) && a.activity !== 'sleeping' && !a.move, 40);
    if (!p) return null;
    const id = await root(tx, 'lost_rover', { summary: p.a.name + "'s rover went silent beyond the rim. The last message was a single word: \"stuck\".", actorId: p.a._id, salience: 0.78, banner: true });
    interrupt(tx, p.a, [encodeStep('wait', 18)]);
    p.a.activityLabel = 'Stranded beyond the rim with a dead rover';
    p.a.needs.safety = 90;
    p.a.mood = 'afraid';
    touch(tx, p.a);
    meta.missing.push({ kind: 'rover', id: p.a._id, sinceTick: tx.tick, resolveTick: tx.tick + randInt(R(tx, 'lrr'), 10, 18), eventId: id });
    for (const rid of [p.mind.society?.partnerId, ...(p.mind.society?.childIds ?? [])].filter((x): x is Id<'agents'> => !!x)) {
      const kin = await loadAgent(tx, rid);
      if (kin?.alive) await enqueueCognition(tx, kin, { kind: 'plan', trigger: p.a.name + ' is lost on the surface', priority: 0.8, lane: 'crisis', eventId: id });
    }
    return id;
  },
  async long_dark_log(tx, meta) {
    const [p] = await sample(tx, 1, 'ld', (a, m) => m.ageBand === 'elder' || a.occupation === 'councilor' || a.factionId === 'founders' || /long dark|reactor/i.test(m.persona?.secret?.text ?? ''), 40);
    if (!p) return null;
    const what = pick(['ordered the reactor crew home early the night it failed', 'signed off on skipping the coolant inspection', 'turned the lost shuttle away from the pad', 'kept a sealed crate of medicine while people died'], R(tx, 'ldw'));
    const id = await root(tx, 'long_dark_log', { summary: 'A water-damaged log from the Long Dark turned up in a depot crate. It says ' + p.a.name + ' ' + what + '.', participantIds: [p.a._id], salience: 0.8, banner: true });
    for (const h of await sample(tx, 6, 'ldh', (a) => a._id !== p.a._id)) {
      await learnBelief(tx, h.a, { kind: 'suspect', text: p.a.name + ' ' + what + ' during the Long Dark.', valence: -1, confidence: round2(0.4 + h.a.traits.stubbornness * 0.3), sourceType: 'told', subjectAgentId: p.a._id, subjectName: p.a.name, originEventId: id });
    }
    shiftStatus(tx, p.mind, -8);
    meta.scandals[p.a._id] = tx.tick;
    await enqueueCognition(tx, p.a, { kind: 'plan', trigger: 'an old Long Dark log accuses me', priority: 0.85, lane: 'crisis', eventId: id });
    meta.inspiration = { eventId: id, summary: 'the Long Dark log', tick: tx.tick, kind: 'long_dark' };
    return id;
  },
  async child_missing(tx, meta) {
    const childId = meta.children.find((id, i) => R(tx, 'cm' + i) < 0.6) ?? meta.children[0];
    const child = childId ? await loadAgent(tx, childId as Id<'agents'>) : null;
    const cm = child ? await loadMind(tx, child) : null;
    if (!child?.alive || !cm || tx.tick - (cm.society?.bornTick ?? 0) < INFANT_TICKS || meta.missing.some((m) => m.id === child._id)) return null;
    const id = await root(tx, 'child_missing', { summary: child.name + ' wandered off into the maintenance tubes and has not been seen for hours.', actorId: child._id, salience: 0.8, banner: true });
    interrupt(tx, child, [encodeStep('wait', 12)]);
    child.activityLabel = 'Lost in the maintenance tubes';
    touch(tx, child);
    meta.missing.push({ kind: 'child', id: child._id, sinceTick: tx.tick, resolveTick: tx.tick + randInt(R(tx, 'cmr'), 6, 12), eventId: id });
    for (const pid of cm.society?.parentIds ?? []) {
      const parent = await loadAgent(tx, pid);
      const pm = parent ? await loadMind(tx, parent) : null;
      if (parent?.alive && pm) {
        frighten(tx, parent, 60);
        await startObsession(tx, parent, pm, { kind: 'child', target: child._id, text: 'finding ' + firstName(child.name) }, id);
      }
    }
    return id;
  },
  async stray_litter(tx, meta) {
    meta.strays += 3;
    return await root(tx, 'stray_litter', { summary: 'A stowaway cat had kittens behind the depot shelving. Three of them need homes.', locationId: 'depot', salience: 0.42 });
  },
  async cache_found(tx) {
    const [p] = await sample(tx, 1, 'cf', (a) => ['hauler', 'quarry_hand', 'dock_hand', 'ice_miner'].includes(a.occupation));
    addStock(tx.world, 'depot', 'parts', 30);
    addStock(tx.world, 'medbay', 'medicine', 5);
    if (p) shiftStatus(tx, p.mind, 3);
    return await root(tx, 'cache_found', { summary: (p ? p.a.name : 'A hauler') + ' found a forgotten supply cache from the founding days: thirty parts and a box of medicine.', actorId: p?.a._id, salience: 0.6 });
  },
  async workshop_fire(tx) {
    tx.world.damage.workshop = round2(clamp((tx.world.damage.workshop ?? 0) + 0.25, 0, 1));
    const there = await peopleAt(tx, 'workshop', false);
    const id = await root(tx, 'workshop_fire', { summary: 'A printer caught fire in the Fabrication Works and smoke filled the hall.', locationId: 'workshop', participantIds: there.map((a) => a._id), salience: 0.74 });
    const hero = there.sort((x, y) => x.traits.caution - y.traits.caution)[0];
    for (const a of there) if (a !== hero) frighten(tx, a, 35);
    if (hero) {
      const hm = await loadMind(tx, hero);
      if (hm) await experience(tx, hero, hm, 'saved', id);
      await emitEvent(tx, { category: 'social', eventType: 'heroism', actorId: hero._id, locationId: 'workshop', summary: hero.name + ' ran into the smoke with an extinguisher and put the fire out.', salience: 0.66, causationEventId: id, visibility: 'public' });
      await hurt(tx, hero, 18, 'burns from the fire at the Fabrication Works', id);
    }
    return id;
  },
  async crop_blight(tx) {
    const lost = Math.round(stock(tx.world, 'depot', 'food') * 0.12);
    addStock(tx.world, 'depot', 'food', -lost);
    tx.world.damage.hydroponics = round2(clamp((tx.world.damage.hydroponics ?? 0) + 0.12, 0, 1));
    for (const a of await peopleAt(tx, 'hydroponics', false)) frighten(tx, a, 15);
    return await root(tx, 'crop_blight', { summary: 'Rust blight spread through the Hydroponics racks; ' + lost + ' units of food had to be burned.', locationId: 'hydroponics', salience: 0.66 });
  },
  async visiting_trader(tx) {
    addStock(tx.world, 'medbay', 'medicine', 6);
    addStock(tx.world, 'landing_pad', 'parts', 10);
    tx.world.prices.medicine = round2(tx.world.prices.medicine * 0.75);
    return await root(tx, 'visiting_trader', { summary: 'An independent trader set down at the Landing Pad with medicine, spare parts and news: Earth has stopped asking about Shackleton.', locationId: 'landing_pad', salience: 0.52 });
  },
  async comet(tx) {
    for (const p of await sample(tx, 10, 'comet')) {
      if (isArtist(p.mind)) {
        societyOf(tx, p.a, p.mind).inspiration = round2(Math.min(1, p.mind.society!.inspiration + 0.6));
        touchMind(tx, p.mind);
      }
    }
    return await root(tx, 'comet', { summary: 'A comet crossed the black sky over the rim, tail and all. People stood in the observation tubes for hours.', locationId: 'observatory', salience: 0.55 });
  },
  async old_feud(tx) {
    for (const p of await sample(tx, 8, 'feud', (a) => a.activity !== 'sleeping')) {
      const ties = await tiesOf(tx, p.a._id, 10);
      const t = ties.find((x) => x.toAlive && x.affinity < -0.35);
      const b = t ? await loadAgent(tx, t.toAgentId) : null;
      if (!b?.alive || b.move) continue;
      const together = b.locationId === p.a.locationId;
      const id = await root(tx, 'old_feud', {
        summary: together ? p.a.name + ' and ' + b.name + ' came to blows at ' + locName(b.locationId) + ' over something years old.' : p.a.name + ' stormed off to find ' + b.name + ', swearing to settle an old score.',
        locationId: p.a.locationId,
        actorId: p.a._id,
        participantIds: [b._id],
        salience: together ? 0.66 : 0.55,
      });
      if (together) {
        for (const x of [p.a, b]) {
          x.health = Math.max(5, x.health - 8);
          x.mood = 'angry';
          touch(tx, x);
        }
        await adjustRelationship(tx, b, p.a, { affinity: -0.15, trust: -0.1 });
      } else interrupt(tx, p.a, [encodeStep('go', b.locationId), encodeStep('talk', b._id)]);
      await adjustRelationship(tx, p.a, b, { affinity: -0.1 });
      return id;
    }
    return null;
  },
  async anonymous_gift(tx) {
    const people = await sample(tx, 12, 'gift');
    const poor = people.filter((p) => p.mind.ageBand !== 'child').sort((x, y) => x.a.inv.credits - y.a.inv.credits)[0];
    const rich = people.filter((p) => p.a.inv.credits > 120 && p.a.traits.empathy > 0.5).sort((x, y) => y.a.inv.credits - x.a.inv.credits)[0];
    if (!poor || !rich || poor === rich) return null;
    rich.a.inv.credits = round2(rich.a.inv.credits - 40);
    poor.a.inv.credits = round2(poor.a.inv.credits + 40);
    touch(tx, rich.a);
    touch(tx, poor.a);
    await experience(tx, poor.a, poor.mind, 'helped');
    return await root(tx, 'anonymous_gift', { summary: 'Someone left forty credits in an envelope at ' + poor.a.name + "'s door. Nobody has owned up to it.", actorId: poor.a._id, salience: 0.5 });
  },
  async ghost_sighting(tx, meta) {
    const [p] = await sample(tx, 1, 'ghost', (a) => a.activity !== 'sleeping');
    if (!p) return null;
    frighten(tx, p.a, 45);
    const id = await root(tx, 'ghost_sighting', { summary: p.a.name + ' swears they saw one of the eleven dead of the Long Dark standing in a tube junction, in a suit, not moving.', actorId: p.a._id, salience: 0.58 });
    await learnBelief(tx, p.a, { kind: 'custom', worldKey: 'ghost', text: 'The dead of the Long Dark walk the tubes at night.', valence: 0, confidence: 0.8, sourceType: 'observed', originEventId: id });
    meta.fearUntil = tx.tick + DAY / 2;
    await prophecy(tx, id, 'the eleven are restless');
    return id;
  },
  async water_contamination(tx) {
    const lost = Math.round(stock(tx.world, 'depot', 'water') * 0.1);
    addStock(tx.world, 'depot', 'water', -lost);
    const id = await root(tx, 'water_contamination', { summary: 'A batch of depot water came up cloudy and sour; ' + lost + ' units had to be dumped.', locationId: 'depot', salience: 0.64 });
    for (const p of await sample(tx, 2, 'sour')) await hurt(tx, p.a, 10, 'bad water', id);
    return id;
  },
};

/** A cult reads a disaster as a sign: its leader preaches, and it gains standing with the frightened. */
async function prophecy(tx: Tx, cause: EventId, sign: string): Promise<void> {
  const cult = (await activeOrgs(tx)).find((o) => o.kind === 'cult' && o.leaderId);
  if (!cult) return;
  const leader = await loadAgent(tx, cult.leaderId!);
  if (!leader?.alive || leader.activity === 'sleeping') return;
  interrupt(tx, leader, [encodeStep('go', 'plaza'), encodeStep('preach', cult._id)]);
  await emitEvent(tx, { category: 'social', eventType: 'prophecy', actorId: leader._id, summary: leader.name + ' of ' + cult.name + ' says it is a sign: ' + sign + '.', salience: 0.6, causationEventId: cause, visibility: 'public' });
}

// ---------- the scheduler ----------

export function eligibleEvents(tx: Tx, meta: Meta, flags: Record<string, boolean>): RandomEventDef[] {
  const recentKeys = meta.recent.slice(-3).map((r) => r.key);
  return RANDOM_EVENTS.filter((e) => {
    if (recentKeys.includes(e.key)) return false;
    const last = [...meta.recent].reverse().find((r) => r.key === e.key);
    if (last && tx.tick - last.tick < e.gapDays * DAY) return false;
    return (e.requires ?? []).every((r) => flags[r] !== false);
  });
}

/** Fires a sudden event when one is due. Runs hourly; schedules the next one half a day to a day later. */
export async function randomEventsHourly(tx: Tx, meta: Meta): Promise<EventId | null> {
  if (tx.tick < meta.nextEventTick) return null;
  const flags = { pets: meta.pets.length > 0, pregnancy: meta.pregnancies.length > 0, children: meta.children.length > 0 };
  const pool = eligibleEvents(tx, meta, flags);
  let fired: EventId | null = null;
  for (let attempt = 0; attempt < 3 && !fired; attempt++) {
    const def = pickWeighted(pool, (e) => e.weight * eventWeight(meta, e.key), R(tx, 'pick' + attempt));
    if (!def) break;
    pool.splice(pool.indexOf(def), 1);
    fired = await RUNS[def.key](tx, meta);
    if (fired) meta.recent = [...meta.recent, { key: def.key, tick: tx.tick }].slice(-12);
  }
  meta.nextEventTick = tx.tick + randInt(R(tx, 'next'), 72, 144);
  await saveMeta(tx);
  return fired;
}

export const RANDOM_EVENT_KEYS = Object.keys(RUNS);
export async function fireRandomEvent(tx: Tx, key: string): Promise<EventId | null> {
  const meta = await loadMeta(tx);
  const id = await RUNS[key]?.(tx, meta);
  if (id) meta.recent = [...meta.recent, { key, tick: tx.tick }].slice(-12);
  await saveMeta(tx);
  return id ?? null;
}

/** Lost pets, children and rover crews are found, or not. */
export async function missingHourly(tx: Tx, meta: Meta): Promise<void> {
  for (const m of [...meta.missing]) {
    if (tx.tick < m.resolveTick) continue;
    meta.missing = meta.missing.filter((x) => x !== m);
    const good = R(tx, 'found' + m.id) < (m.kind === 'child' ? 0.92 : m.kind === 'rover' ? 0.8 : 0.7);
    if (m.kind === 'pet') {
      const pid = tx.ctx.db.normalizeId('pets', m.id);
      const pet = pid ? await tx.ctx.db.get(pid) : null;
      const owner = m.ownerId ? await loadAgent(tx, m.ownerId as Id<'agents'>) : null;
      const om = owner ? await loadMind(tx, owner) : null;
      if (!pet || !owner?.alive || !om) continue;
      if (good) {
        await tx.ctx.db.patch(pet._id, { bond: round2(Math.min(1, pet.bond + 0.2)) });
        owner.mood = 'euphoric';
        touch(tx, owner);
        const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'pet_found', actorId: owner._id, summary: owner.name + ' found ' + pet.name + ' curled up in a warm vent above ' + locName(pick(INTERIOR, R(tx, 'vent'))) + ', thin but alive.', salience: 0.5, causationEventId: m.eventId as EventId, visibility: 'local' });
        await fulfil(tx, owner, om, 'pet', pet._id, eventId);
      } else {
        await tx.ctx.db.patch(pet._id, { alive: false });
        meta.pets = meta.pets.filter((x) => x !== pet._id);
        const eventId = await petGrief(tx, owner, om, pet.name, 'somewhere out in the cold', m.eventId as EventId);
        if (om.society?.obsession?.kind === 'pet') await endObsession(tx, owner, om, false, eventId);
      }
      continue;
    }
    const lost = await loadAgent(tx, m.id as Id<'agents'>);
    if (!lost?.alive) continue;
    const [finder] = await sample(tx, 1, 'finder' + m.id, (a) => a._id !== lost._id && a.activity !== 'sleeping' && (m.kind === 'rover' ? ['security', 'ice_miner', 'quarry_hand', 'solar_tech', 'hauler'].includes(a.occupation) : true), 40);
    if (good) {
      lost.busyUntilTick = tx.tick;
      lost.q = [];
      lost.mood = 'shaken';
      touch(tx, lost);
      const { eventId } = await emitEvent(tx, {
        category: 'social',
        eventType: m.kind === 'child' ? 'child_found' : 'rescue',
        actorId: finder?.a._id,
        participantIds: [lost._id],
        summary: m.kind === 'child' ? (finder ? finder.a.name : 'A maintenance crew') + ' found ' + lost.name + ' asleep in a tube junction, cold and frightened but unhurt.' : (finder ? finder.a.name : 'A rescue crew') + ' drove out past the rim and brought ' + lost.name + ' home alive.',
        salience: 0.74,
        causationEventId: m.eventId as EventId,
        visibility: 'public',
      });
      if (finder) {
        shiftStatus(tx, finder.mind, 6);
        await experience(tx, finder.a, finder.mind, 'saved', eventId);
      }
      const lm = await loadMind(tx, lost);
      for (const pid of [...(lm?.society?.parentIds ?? []), lm?.society?.partnerId].filter((x): x is Id<'agents'> => !!x)) {
        const kin = await loadAgent(tx, pid);
        const km = kin ? await loadMind(tx, kin) : null;
        if (!kin?.alive || !km) continue;
        kin.mood = 'grateful';
        touch(tx, kin);
        if (finder) await adjustRelationship(tx, kin, finder.a, { affinity: 0.4, trust: 0.3, obligation: 0.4 });
        await fulfil(tx, kin, km, 'child', lost._id, eventId);
      }
    } else if (m.kind === 'child') {
      lost.health = Math.max(20, lost.health - 30);
      lost.busyUntilTick = tx.tick;
      lost.q = [];
      touch(tx, lost);
      const { eventId } = await emitEvent(tx, { category: 'health', eventType: 'child_found', actorId: finder?.a._id, participantIds: [lost._id], summary: lost.name + ' was found at the bottom of a ventilation shaft with a broken arm.', salience: 0.72, causationEventId: m.eventId as EventId, visibility: 'public' });
      const lm = await loadMind(tx, lost);      for (const pid of lm?.society?.parentIds ?? []) {
        const kin = await loadAgent(tx, pid);
        const km = kin ? await loadMind(tx, kin) : null;
        if (kin?.alive && km) await fulfil(tx, kin, km, 'child', lost._id, eventId);
      }
    } else {
      await killAgent(tx, lost, { cause: 'lost on the surface beyond the rim', summary: 'The rescue crew found ' + lost.name + "'s rover with the air run out.", causationEventId: m.eventId as EventId, category: 'environment' });
    }
  }
}

// ---------- experience changes people ----------

export type Experience = 'helped' | 'betrayed' | 'saved' | 'humiliated' | 'inspired' | 'bereaved' | 'robbed';

/** What someone lived through shifts who they are: values, traits, status, and a lesson they keep. */
export async function experience(tx: Tx, a: AgentDoc, mind: MindDoc, kind: Experience, cause?: EventId): Promise<void> {
  const t = a.traits;
  const v = mind.values;
  const shift = (x: number, d: number) => round2(clamp(x + d, 0, 1));
  const lessons: Record<Experience, { text: string; line: string }> = {
    helped: { text: 'People can be kind when it matters.', line: 'Since that kindness, ' + firstName(a.name) + ' is a little softer with others.' },
    betrayed: { text: 'Trust is how they get you.', line: firstName(a.name) + ' trusts people a little less than before.' },
    saved: { text: 'I did not freeze when it counted.', line: firstName(a.name) + ' stands a little taller since that day.' },
    humiliated: { text: 'They laughed at me. I remember every face.', line: 'The humiliation has left ' + firstName(a.name) + ' bitter and watchful.' },
    inspired: { text: 'There is more to life here than work and rations.', line: firstName(a.name) + ' has started looking at the colony differently.' },
    bereaved: { text: 'Hold on to the people you have.', line: 'Grief has turned ' + firstName(a.name) + ' toward family.' },
    robbed: { text: 'Lock everything. Count everything.', line: 'Since the theft, ' + firstName(a.name) + ' counts every ration twice.' },
  };
  if (kind === 'helped') {
    t.empathy = shift(t.empathy, 0.03);
    v.harmony = shift(v.harmony, 0.02);
  } else if (kind === 'betrayed') {
    v.harmony = shift(v.harmony, -0.04);
    t.caution = shift(t.caution, 0.04);
  } else if (kind === 'saved') {
    t.caution = shift(t.caution, -0.03);
    shiftStatus(tx, mind, 6);
  } else if (kind === 'humiliated') {
    t.stubbornness = shift(t.stubbornness, 0.04);
    v.status = shift(v.status, 0.03);
    shiftStatus(tx, mind, -4);
  } else if (kind === 'inspired') {
    t.curiosity = shift(t.curiosity, 0.03);
    societyOf(tx, a, mind).inspiration = shift(mind.society!.inspiration, 0.3);
  } else if (kind === 'bereaved') {
    v.family = shift(v.family, 0.04);
    v.wealth = shift(v.wealth, -0.02);
  } else {
    t.caution = shift(t.caution, 0.04);
    t.empathy = shift(t.empathy, -0.02);
  }
  touch(tx, a);
  touchMind(tx, mind);
  await learnBelief(tx, a, { kind: 'lesson', worldKey: 'lesson:' + kind, text: lessons[kind].text, valence: 0, confidence: 0.7, sourceType: 'observed', originEventId: cause, private: true });
  await emitEvent(tx, { category: 'social', eventType: 'changed', actorId: a._id, summary: lessons[kind].line, salience: 0.32, causationEventId: cause, visibility: 'private', facts: { experience: kind } });
}

// ---------- reacting to what happened ----------

const VIOLENT = /murder|kill|stab|shot|poison|strangl|attack|beat|violen|blood/i;

/** Reacts to every event since the last reaction: once per transaction, before anyone steps. */
export async function reactToEvents(tx: Tx, meta: Meta): Promise<void> {
  const since = Math.max(meta.seenVersion, tx.world.version - 6);
  const events = await tx.ctx.db
    .query('events')
    .withIndex('by_world_version', (q) => q.eq('worldId', tx.world._id).gt('version', since).lte('version', tx.world.version))
    .take(120);
  meta.seenVersion = tx.world.version;
  for (const e of events) {
    if (e.salience < 0.3) continue;
    await react(tx, meta, e);
    if (e.salience >= 0.78 && !['art_created', 'performance', 'obsession', 'changed'].includes(e.eventType) && (!meta.inspiration || meta.inspiration.tick < e.tick)) {
      meta.inspiration = { eventId: e._id, summary: e.summary.slice(0, 80), tick: e.tick, kind: e.eventType };
    }
  }
  await saveMeta(tx);
}

async function react(tx: Tx, meta: Meta, e: Doc<'events'>): Promise<void> {
  const first = e.participantIds[0];
  const load = async (id?: Id<'agents'>) => {
    const a = id ? await loadAgent(tx, id) : null;
    const m = a ? await loadMind(tx, a) : null;
    return a && m ? { a, m } : null;
  };
  switch (e.eventType) {
    case 'death': {
      const dead = e.actorId ? await loadAgent(tx, e.actorId) : null;
      if (!dead) return;
      await inheritance(tx, dead, e._id);
      const dm = await loadMind(tx, dead);
      const kin = [dm?.society?.partnerId, ...(dm?.society?.childIds ?? []), ...(dm?.society?.parentIds ?? [])].filter((x): x is Id<'agents'> => !!x);
      const cause = String((e.facts as { cause?: string } | undefined)?.cause ?? '');
      for (const id of kin.slice(0, 4)) {
        const k = await load(id);
        if (!k?.a.alive) continue;
        await experience(tx, k.a, k.m, 'bereaved', e._id);
        if (VIOLENT.test(cause) && k.a.traits.stubbornness > 0.55) {
          const ties = await tiesOf(tx, dead._id, 12);
          const rival = ties.filter((t) => t.toAlive && t.affinity < -0.15).sort((x, y) => x.affinity - y.affinity)[0];
          if (rival && rival.toAgentId !== k.a._id) await startObsession(tx, k.a, k.m, { kind: 'revenge', target: rival.toAgentId, text: 'making ' + rival.toName + ' pay for ' + firstName(dead.name) }, e._id);
        }
      }
      meta.children = meta.children.filter((id) => id !== dead._id);
      return;
    }
    case 'arrest':
    case 'theft_foiled': {
      const culprit = await load(e.eventType === 'arrest' ? first : e.actorId);
      if (!culprit) return;
      shiftStatus(tx, culprit.m, e.eventType === 'arrest' ? -10 : -6);
      meta.scandals[culprit.a._id] = tx.tick;
      await experience(tx, culprit.a, culprit.m, 'humiliated', e._id);
      if (e.eventType === 'arrest' && culprit.a.occupation !== 'resident' && !culprit.a.role && roll(tx, culprit.a.seq, 'fired') < 0.4) {
        const old = OCCUPATIONS.find((o) => o.id === culprit.a.occupation)!;
        culprit.a.occupation = 'resident';
        culprit.a.workLocationId = OCCUPATIONS.find((o) => o.id === 'resident')!.workLocationId;
        touch(tx, culprit.a);
        societyOf(tx, culprit.a, culprit.m).jobHistory.push({ occupation: 'resident', fromTick: tx.tick });
        tx.world.vacancies.push({ occupation: old.id, sinceTick: tx.tick, eventId: e._id });
        await emitEvent(tx, { category: 'economy', eventType: 'fired', actorId: culprit.a._id, summary: culprit.a.name + ' lost the job as ' + old.label.toLowerCase() + ' after the arrest.', salience: 0.55, causationEventId: e._id, visibility: 'public' });
      }
      if (e.eventType === 'theft_foiled') {
        const guard = await load(first);
        if (guard) shiftStatus(tx, guard.m, 3);
      }
      return;
    }
    case 'theft': {
      const victim = await load(first);
      if (victim && roll(tx, victim.a.seq, 'robbed') < 0.5) await experience(tx, victim.a, victim.m, 'robbed', e._id);
      if (e.participantIds.length > 1) {
        const thief = await load(e.actorId);
        if (thief) shiftStatus(tx, thief.m, -3);
      }
      return;
    }
    case 'accusation': {
      const accused = await load(first);
      if (accused) shiftStatus(tx, accused.m, -3);
      return;
    }
    case 'gift':
    case 'treatment': {
      const giver = await load(e.actorId);
      if (giver) shiftStatus(tx, giver.m, 1);
      const got = await load(first);
      if (got && roll(tx, got.a.seq, 'helped') < 0.35) await experience(tx, got.a, got.m, 'helped', e._id);
      return;
    }
    case 'promotion':
    case 'council_seat':
    case 'leadership_change': {
      const who = await load(e.actorId);
      if (who) shiftStatus(tx, who.m, 8);
      return;
    }
    case 'storm':
    case 'drought': {
      meta.fearUntil = tx.tick + DAY;
      await prophecy(tx, e._id, e.eventType === 'storm' ? 'the sky itself is angry with the colony' : 'the ice is being taken back');
      return;
    }
    case 'performance': {
      for (const id of e.participantIds.slice(0, 3)) {
        const p = await load(id);
        if (p && roll(tx, p.a.seq, 'inspired') < 0.3) await experience(tx, p.a, p.m, 'inspired', e._id);
      }
      return;
    }
    case 'org_raid':
    case 'racket_sabotage': {
      const victim = await load(first);
      if (victim && roll(tx, victim.a.seq, 'betrayed') < 0.5) await experience(tx, victim.a, victim.m, 'betrayed', e._id);
      return;
    }
  }
}
