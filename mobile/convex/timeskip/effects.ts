/**
 * The legal macro effects of a timeskip: everything that can happen to a person, a couple or an
 * organization over weeks and years. The LLM chooses among them (validated here against the real
 * state), and the rules choose among them when it cannot. Every effect writes through the same docs
 * and helpers the live simulation uses (killAgent, marry, birth, exposeSecret, the organization
 * helpers...), so the world after a skip is the world the live engine knows how to play.
 */
import type { Doc, Id } from '../_generated/dataModel';
import { LOCATIONS, MAX_POPULATION, OCCUPATIONS, SPRITE_VARIANTS } from '../../shared/colony';
import type { SpriteArchetype } from '../../shared/colony';
import { BREAKAWAY_RULES, BREAKAWAY_RULE_KEYS, ORG_KINDS } from '../../shared/society';
import { adjustRelationship, dayOf, killAgent, learnBelief, loadHousehold, touch, touchHousehold, touchMind, tieTo } from '../engine/core';
import type { AgentId, EventId } from '../engine/core';
import { exposeSecret } from '../engine/secrets';
import { clamp, round2 } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import { experience } from '../society/events';
import { birth, inheritance, marry } from '../society/family';
import { endObsession, startObsession } from '../society/obsession';
import type { ObsessionKind } from '../society/obsession';
import { addMember, chooseLeader, disband, foundOrg, kindAffinity, removeMember } from '../society/orgs';
import { activeOrgs, insertOrg, listNames, saveOrg, shiftStatus, societyOf } from '../society/store';
import type { OrgDoc } from '../society/store';
import { count, first, living, roll, tell, tickOn } from './model';
import type { Chapter, Person } from './model';

export const EFFECT_TYPES = [
  'romance',
  'marry',
  'separate',
  'affair',
  'feud',
  'reconcile',
  'death',
  'depart',
  'exile',
  'birth',
  'expose',
  'debt',
  'found_org',
  'join_org',
  'leave_org',
  'lead_org',
  'org_split',
  'org_merge',
  'org_war',
  'org_collapse',
  'secede',
  'rise',
  'fall',
  'obsession',
  'obsession_end',
  'belief',
  'job',
  'chair',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

/** One effect with its ids resolved. beat is the sentence the chronicle tells, when the LLM wrote one. */
export type Effect = {
  type: EffectType;
  who?: string;
  with?: string;
  org?: string;
  org2?: string;
  storyline?: string;
  detail?: string;
  beat?: string;
};

/** What each effect means, for the LLM prompt. */
export const EFFECT_GUIDE: Record<EffectType, string> = {
  romance: 'who and with fall for each other (both single adults, not family).',
  marry: 'who and with marry (both single adults; usually after a romance).',
  separate: 'who leaves their partner with.',
  affair: 'who, already partnered, starts a secret affair with with.',
  feud: 'who and with become bitter enemies, or an old grudge hardens.',
  reconcile: 'who makes peace with with.',
  death: 'who dies. detail: illness, accident, violence or age. For violence, with is the killer. Rare.',
  depart: 'who leaves the colony for good on an outbound shuttle.',
  exile: 'who is exiled by the council or their own people (after a crime or scandal).',
  birth: 'who and their partner with have a child.',
  expose: "who's hidden secret comes out; with is who exposed it (omit for a confession).",
  debt: 'who settles what they owe with. detail: repaid, forgiven or defaulted.',
  found_org: 'who founds an organization. detail: company, guild, cult, gang, militia, party, school or troupe.',
  join_org: 'who joins org.',
  leave_org: 'who quits org.',
  lead_org: 'who takes over the leadership of org (election or coup).',
  org_split: 'who leads a faction out of org to found a rival splinter.',
  org_merge: 'org and org2 merge into one.',
  org_war: 'org and org2 go to war: raids, sabotage, maybe blood.',
  org_collapse: 'org collapses and disbands.',
  secede: 'who leads a breakaway: a defector government that claims territory and declares its own rules.',
  rise: 'who rises: fame, standing, a reputation made (an artist breaks through, a hero is made).',
  fall: 'who falls: disgrace, a career in ruins, a fading name.',
  obsession: 'who becomes obsessed. detail: with what, in a few words.',
  obsession_end: "who's obsession ends. detail: fulfilled or broken.",
  belief: 'who comes to believe something new through what they lived (detail: the belief in their words; with: who it is about, optional).',
  job: 'who takes up a new occupation. detail: an occupation id.',
  chair: 'who becomes chair of the colony council.',
};

const PAIRED: EffectType[] = ['romance', 'marry', 'separate', 'affair', 'feud', 'reconcile', 'birth', 'debt'];
const ORGED: EffectType[] = ['join_org', 'leave_org', 'lead_org', 'org_split'];
const OCC_IDS = OCCUPATIONS.map((o) => o.id);

const clean = (text: unknown, max: number): string | undefined => {
  if (typeof text !== 'string') return undefined;
  const t = text.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 2 ? t.slice(0, max) : undefined;
};

/** Checks a proposed effect's shape and ids against the chapter's state. Returns null when it cannot apply. */
export async function validEffect(ch: Chapter, raw: unknown): Promise<Effect | null> {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as EffectType;
  if (!(EFFECT_TYPES as readonly string[]).includes(type)) return null;
  const e: Effect = { type, detail: clean(r.detail, 120), beat: clean(r.beat, 260) };
  const person = (x: unknown) => (typeof x === 'string' ? living(ch, ch.tx.ctx.db.normalizeId('agents', x) ?? undefined) : undefined);
  const orgs = await activeOrgs(ch.tx);
  const org = (x: unknown) => (typeof x === 'string' ? orgs.find((o) => o._id === x) : undefined);
  if (!['org_merge', 'org_war', 'org_collapse'].includes(type)) {
    const who = person(r.who);
    if (!who) return null;
    e.who = who.a._id;
  }
  if (PAIRED.includes(type) || (type === 'death' && r.with) || (type === 'expose' && r.with) || (type === 'belief' && r.with)) {
    const other = person(r.with);
    if (!other || other.a._id === e.who) {
      if (PAIRED.includes(type)) return null;
    } else e.with = other.a._id;
  }
  if (ORGED.includes(type) || ['org_merge', 'org_war', 'org_collapse'].includes(type)) {
    const o = org(r.org);
    if (!o) return null;
    e.org = o._id;
  }
  if (type === 'org_merge' || type === 'org_war') {
    const o2 = org(r.org2);
    if (!o2 || o2._id === e.org) return null;
    e.org2 = o2._id;
  }
  if (typeof r.storyline === 'string' && ch.stories.some((s) => s._id === r.storyline)) e.storyline = r.storyline;
  if (type === 'found_org' && !(e.detail && ORG_KINDS[e.detail] && e.detail !== 'breakaway')) return null;
  if (type === 'job' && !(e.detail && OCC_IDS.includes(e.detail))) return null;
  if (type === 'debt' && !['repaid', 'forgiven', 'defaulted'].includes(e.detail ?? '')) e.detail = 'repaid';
  if (type === 'death' && !['illness', 'accident', 'violence', 'age'].includes(e.detail ?? '')) e.detail = 'illness';
  if (type === 'obsession' && !e.detail) return null;
  if (type === 'belief' && !e.detail) return null;
  return e;
}

/** Applies an effect if it still makes sense. Returns the event that tells it, or null. */
export async function applyEffect(ch: Chapter, e: Effect): Promise<EventId | null> {
  const a = living(ch, e.who);
  const b = living(ch, e.with);
  const sid = e.storyline as Id<'storylines'> | undefined;
  const orgs = await activeOrgs(ch.tx);
  const org = orgs.find((o) => o._id === e.org);
  const org2 = orgs.find((o) => o._id === e.org2);
  const id = await run(ch, e, a, b, org, org2, sid);
  if (id && a) ch.moved.add(a.a._id);
  if (id && b) ch.moved.add(b.a._id);
  return id;
}

async function run(ch: Chapter, e: Effect, a: Person | undefined, b: Person | undefined, org: OrgDoc | undefined, org2: OrgDoc | undefined, sid: Id<'storylines'> | undefined): Promise<EventId | null> {
  switch (e.type) {
    case 'romance':
      return a && b ? await romance(ch, a, b, e.beat, sid) : null;
    case 'marry':
      return a && b ? await wed(ch, a, b, e.beat, sid) : null;
    case 'separate':
      return a && b ? await separate(ch, a, b, e.beat, sid) : null;
    case 'affair':
      return a && b ? await affair(ch, a, b, e.beat, sid) : null;
    case 'feud':
      return a && b ? await feud(ch, a, b, e.beat, sid) : null;
    case 'reconcile':
      return a && b ? await reconcile(ch, a, b, e.beat, sid) : null;
    case 'death':
      return a ? await die(ch, a, (e.detail as DeathKind) ?? 'illness', { by: b, beat: e.beat, storylineId: sid }) : null;
    case 'depart':
      return a ? await leave(ch, a, 'depart', e.beat, sid) : null;
    case 'exile':
      return a ? await leave(ch, a, 'exile', e.beat, sid) : null;
    case 'birth':
      return a && b ? await haveChild(ch, a, b, sid) : null;
    case 'expose':
      return a ? await expose(ch, a, b, e.beat, sid) : null;
    case 'debt':
      return a && b ? await settleDebt(ch, a, b, (e.detail as 'repaid' | 'forgiven' | 'defaulted') ?? 'repaid', e.beat, sid) : null;
    case 'found_org':
      return a ? await found(ch, a, e.detail ?? 'troupe', e.beat, sid) : null;
    case 'join_org':
      return a && org ? await join(ch, a, org, e.beat, sid) : null;
    case 'leave_org':
      return a && org ? await quit(ch, a, org, e.beat, sid) : null;
    case 'lead_org':
      return a && org ? await takeOver(ch, a, org, e.beat, sid) : null;
    case 'org_split':
      return a && org ? await split(ch, a, org, e.beat, sid) : null;
    case 'org_merge':
      return org && org2 ? await merge(ch, org, org2, e.beat, sid) : null;
    case 'org_war':
      return org && org2 ? await war(ch, org, org2, e.beat, sid) : null;
    case 'org_collapse':
      return org ? await collapse(ch, org, e.beat, sid) : null;
    case 'secede':
      return a ? await secede(ch, a, e.beat, sid) : null;
    case 'rise':
      return a ? await renown(ch, a, true, e.beat, sid) : null;
    case 'fall':
      return a ? await renown(ch, a, false, e.beat, sid) : null;
    case 'obsession':
      return a ? await obsess(ch, a, e.detail ?? 'the Long Dark', sid) : null;
    case 'obsession_end':
      return a ? await unobsess(ch, a, e.detail === 'fulfilled', sid) : null;
    case 'belief':
      return a ? await convince(ch, a, e.detail ?? '', b, sid) : null;
    case 'job':
      return a ? await takeJob(ch, a, e.detail ?? 'hauler', e.beat, sid) : null;
    case 'chair':
      return a ? await takeChair(ch, a, e.beat, sid) : null;
  }
}

// ---------- people ----------

const isChild = (p: Person) => p.mind.ageBand === 'child';
const partnerOf = (p: Person) => p.mind.society?.partnerId;

async function isFamily(ch: Chapter, a: Person, b: Person): Promise<boolean> {
  const s = a.mind.society;
  if (s?.parentIds.includes(b.a._id) || s?.childIds.includes(b.a._id)) return true;
  const t = await tieTo(ch.tx, a.a._id, b.a._id);
  return t?.kind === 'family' && partnerOf(a) !== b.a._id;
}

export async function romance(ch: Chapter, a: Person, b: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (isChild(a) || isChild(b) || partnerOf(a) === b.a._id || (await isFamily(ch, a, b))) return null;
  if (partnerOf(a) || partnerOf(b)) return await affair(ch, partnerOf(a) ? a : b, partnerOf(a) ? b : a, beat, storylineId);
  await adjustRelationship(ch.tx, a.a, b.a, { affinity: 0.35, trust: 0.2, kind: 'romance' });
  await adjustRelationship(ch.tx, b.a, a.a, { affinity: 0.35, trust: 0.2, kind: 'romance' });
  a.a.mood = 'hopeful';
  touch(ch.tx, a.a);
  count(ch, 'romances');
  return await tell(ch, { category: 'social', eventType: 'romance', actorId: a.a._id, participantIds: [b.a._id], summary: beat ?? a.a.name + ' and ' + b.a.name + ' fell for each other, and stopped pretending otherwise.', salience: 0.58, storylineId });
}

export async function wed(ch: Chapter, a: Person, b: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (isChild(a) || isChild(b) || partnerOf(a) || partnerOf(b) || (await isFamily(ch, a, b))) return null;
  await marry(ch.tx, a.a, a.mind, b.a, b.mind, { quiet: true });
  count(ch, 'married');
  return await tell(ch, { category: 'social', eventType: 'marriage', actorId: a.a._id, participantIds: [b.a._id], summary: beat ?? a.a.name + ' and ' + b.a.name + ' were married under the plaza lamps.', salience: 0.76, storylineId });
}

export async function separate(ch: Chapter, a: Person, b: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (partnerOf(a) !== b.a._id) return null;
  const tx = ch.tx;
  societyOf(tx, a.a, a.mind).partnerId = undefined;
  societyOf(tx, b.a, b.mind).partnerId = undefined;
  touchMind(tx, a.mind);
  touchMind(tx, b.mind);
  ch.meta.couples = ch.meta.couples.filter(([x, y]) => !((x === a.a._id && y === b.a._id) || (x === b.a._id && y === a.a._id)));
  ch.meta.wantChild = ch.meta.wantChild.filter((x) => x !== a.a._id && x !== b.a._id);
  await adjustRelationship(tx, a.a, b.a, { affinity: -0.45, trust: -0.3, kind: 'acquaintance' });
  await adjustRelationship(tx, b.a, a.a, { affinity: -0.5, trust: -0.35, kind: 'acquaintance' });
  if (a.a.householdId && a.a.householdId === b.a.householdId) await moveOut(ch, a);
  a.a.mood = 'sombre';
  b.a.mood = 'betrayed';
  touch(tx, a.a);
  touch(tx, b.a);
  count(ch, 'separated');
  return await tell(ch, { category: 'social', eventType: 'separation', actorId: a.a._id, participantIds: [b.a._id], summary: beat ?? a.a.name + ' left ' + b.a.name + ', and moved their things out of the quarters they had shared.', salience: 0.7, storylineId });
}

/** Someone leaves a shared household for quarters of their own in the other ring. */
async function moveOut(ch: Chapter, p: Person): Promise<void> {
  const tx = ch.tx;
  const old = await loadHousehold(tx, p.a.householdId);
  const home = p.a.homeLocationId === 'habitat_a' ? 'habitat_b' : 'habitat_a';
  const householdId = await tx.ctx.db.insert('households', { worldId: tx.world._id, name: p.a.name + "'s quarters", homeLocationId: home, memberIds: [p.a._id], pantry: { food: 2, water: 3 }, rationDue: { food: 1, water: 2 }, rationDay: dayOf(tx.tick) });
  if (old) {
    old.memberIds = old.memberIds.filter((id) => id !== p.a._id);
    old.rationDue = { food: Math.max(0, old.rationDue.food - 1), water: Math.max(0, old.rationDue.water - 2) };
    touchHousehold(tx, old);
  }
  p.a.householdId = householdId;
  p.a.homeLocationId = home;
  touch(tx, p.a);
}

export async function affair(ch: Chapter, a: Person, b: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const partner = living(ch, partnerOf(a));
  if (!partner || partner.a._id === b.a._id || isChild(b) || (await isFamily(ch, a, b))) return null;
  const tx = ch.tx;
  await adjustRelationship(tx, a.a, b.a, { affinity: 0.3, trust: 0.15, kind: 'romance' });
  await adjustRelationship(tx, b.a, a.a, { affinity: 0.3, trust: 0.15, kind: 'romance' });
  const persona = a.mind.persona;
  if (persona && (!persona.secret || persona.secret.exposedAtTick !== undefined)) {
    persona.secret = { kind: 'affair', text: a.a.name + ' has been seeing ' + b.a.name + ' behind ' + partner.a.name + "'s back." };
    touchMind(tx, a.mind);
  }
  await learnBelief(tx, b.a, { kind: 'affair', text: a.a.name + ' is with me, whatever ' + first(partner.a.name) + ' thinks.', valence: 0.3, confidence: 1, sourceType: 'observed', subjectAgentId: a.a._id, subjectName: a.a.name, private: true });
  count(ch, 'affairs');
  return await tell(ch, { category: 'social', eventType: 'affair', actorId: a.a._id, participantIds: [b.a._id], summary: beat ?? 'Behind ' + partner.a.name + "'s back, " + a.a.name + ' began meeting ' + b.a.name + ' in the hours nobody watches.', salience: 0.55, visibility: 'private', storylineId });
}

export async function feud(ch: Chapter, a: Person, b: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const tx = ch.tx;
  await adjustRelationship(tx, a.a, b.a, { affinity: -0.35, trust: -0.3, fear: 0.05 });
  await adjustRelationship(tx, b.a, a.a, { affinity: -0.35, trust: -0.3 });
  count(ch, 'feuds');
  return await tell(ch, { category: 'social', eventType: 'feud', actorId: a.a._id, participantIds: [b.a._id], summary: beat ?? 'What had been coldness between ' + a.a.name + ' and ' + b.a.name + ' became open enmity; they no longer eat in the same room.', salience: 0.6, storylineId });
}

export async function reconcile(ch: Chapter, a: Person, b: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const tx = ch.tx;
  const there = await tieTo(tx, a.a._id, b.a._id);
  const kind = there?.kind === 'family' ? 'family' : (there?.affinity ?? 0) + 0.45 >= 0.5 ? 'friend' : 'acquaintance';
  await adjustRelationship(tx, a.a, b.a, { affinity: 0.45, trust: 0.3, fear: -0.2, kind });
  await adjustRelationship(tx, b.a, a.a, { affinity: 0.45, trust: 0.3, fear: -0.2, kind });
  const id = await tell(ch, { category: 'social', eventType: 'reconciliation', actorId: a.a._id, participantIds: [b.a._id], summary: beat ?? a.a.name + ' and ' + b.a.name + ' made their peace, years of grudge set down over one long night in the canteen.', salience: 0.62, storylineId });
  await experience(tx, b.a, b.mind, 'helped', id);
  count(ch, 'reconciled');
  return id;
}

export type DeathKind = 'illness' | 'accident' | 'violence' | 'age';

const CAUSE_WORDS: Record<DeathKind, string[]> = {
  illness: ['a fever that would not break', 'regolith lung', 'a long illness', 'a wasting sickness the medics could not name'],
  accident: ['a suit breach out on the surface', 'a fall in the maintenance shafts', 'a rock fall at the quarry', 'a pressure blowout at the pad'],
  violence: ['a knife in a dark tube', 'a fight that went too far'],
  age: ['old age, in their sleep', 'a tired heart', 'old age, surrounded by family'],
};

/** A death through killAgent, with inheritance, grief and (for violence) the killer's reckoning. */
export async function die(ch: Chapter, p: Person, kind: DeathKind, o: { by?: Person; beat?: string; storylineId?: Id<'storylines'>; cause?: EventId; words?: string; force?: boolean } = {}): Promise<EventId | null> {
  if (!o.force && ch.deaths >= ch.deathCap + (o.storylineId ? 1 : 0)) return null;
  if (kind === 'violence' && !o.by) kind = 'accident';
  const tx = ch.tx;
  const words = o.words ?? CAUSE_WORDS[kind][Math.floor(roll(ch, p.a.seq, 'cause') * CAUSE_WORDS[kind].length)];
  const cause = kind === 'violence' ? 'killed by ' + o.by!.a.name : words;
  const summary =
    o.beat ??
    (kind === 'violence'
      ? p.a.name + ' was killed by ' + o.by!.a.name + ': ' + words + '.'
      : kind === 'age'
        ? p.a.name + ' died of ' + words + '.'
        : kind === 'accident'
          ? p.a.name + ' was lost to ' + words + '.'
          : p.a.name + ' died of ' + words + '.');
  tickOn(ch);
  const eventId = await killAgent(tx, p.a, { cause, summary, causationEventId: o.cause, category: kind === 'violence' ? 'social' : kind === 'accident' ? 'environment' : 'health', salience: ch.keyIds.has(p.a._id) ? 0.95 : 0.85 });
  if (!eventId) return null;
  if (o.storylineId) await tx.ctx.db.patch(eventId, { storylineId: o.storylineId });
  ch.people.delete(p.a._id);
  ch.deaths += 1;
  count(ch, 'died');
  await inheritance(tx, p.a, eventId);
  const bereaved = [living(ch, p.mind.society?.partnerId), ...(p.mind.society?.childIds ?? []).map((id) => living(ch, id))].filter((x): x is Person => !!x && !isChild(x)).slice(0, 2);
  for (const m of bereaved) await experience(tx, m.a, m.mind, 'bereaved', eventId);
  if (kind === 'violence' && o.by) {
    addDeedOf(o.by, 'killer');
    if (roll(ch, o.by.a.seq, 'reckon') < 0.55) await leave(ch, o.by, 'exile', o.by.a.name + ' was exiled for the killing of ' + p.a.name + ', walked to the pad under guard, and did not look back.', o.storylineId, eventId);
    else {
      for (const m of bereaved) {
        await adjustRelationship(tx, m.a, o.by.a, { affinity: -0.6, trust: -0.6, kind: 'rival' });
        if (!m.mind.society?.obsession && m.a.traits.stubbornness > 0.55) await startObsession(tx, m.a, m.mind, { kind: 'revenge', target: o.by.a._id, text: 'making ' + o.by.a.name + ' pay for ' + first(p.a.name) }, eventId);
      }
    }
  }
  return eventId;
}

function addDeedOf(p: Person, kind: string): void {
  const ledger = p.mind.ledger;
  if (ledger) ledger.deeds[kind] = (ledger.deeds[kind] ?? 0) + 1;
}

/** Someone leaves Shackleton for good: on an outbound shuttle, or exiled. */
export async function leave(ch: Chapter, p: Person, how: 'depart' | 'exile', beat?: string, storylineId?: Id<'storylines'>, cause?: EventId): Promise<EventId | null> {
  const tx = ch.tx;
  const summary = beat ?? (how === 'exile' ? 'The council exiled ' + p.a.name + '. They were put aboard the next shuttle with one bag.' : p.a.name + ' took a seat on an outbound shuttle and left Shackleton for good.');
  const partner = living(ch, p.mind.society?.partnerId);
  tickOn(ch);
  const eventId = await killAgent(tx, p.a, { cause: how === 'exile' ? 'exiled from the colony' : 'left the colony on an outbound shuttle', summary, causationEventId: cause, category: how === 'exile' ? 'politics' : 'social', salience: ch.keyIds.has(p.a._id) ? 0.85 : 0.7 });
  if (!eventId) return null;
  await tx.ctx.db.patch(eventId, { eventType: how === 'exile' ? 'exile' : 'departure', ...(storylineId ? { storylineId } : {}) });
  ch.people.delete(p.a._id);
  if (partner?.mind.society) {
    partner.mind.society.partnerId = undefined;
    touchMind(tx, partner.mind);
    ch.meta.couples = ch.meta.couples.filter(([x, y]) => x !== p.a._id && y !== p.a._id);
  }
  count(ch, how === 'exile' ? 'exiled' : 'departed');
  return eventId;
}

async function haveChild(ch: Chapter, a: Person, b: Person, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (partnerOf(a) !== b.a._id || a.mind.ageBand === 'elder' || isChild(a) || ch.tx.world.population.alive >= MAX_POPULATION) return null;
  tickOn(ch);
  const before = ch.tx.eventIds.length;
  const child = await birth(ch.tx, a.a, b.a);
  if (!child) return null;
  const mind = ch.tx.minds.get(child.mindId!);
  if (mind) ch.people.set(child._id, { a: ch.tx.agents.get(child._id) ?? child, mind });
  count(ch, 'born');
  const id = ch.tx.eventIds.slice(before).find(() => true) ?? null;
  if (id && storylineId) await ch.tx.ctx.db.patch(id, { storylineId });
  return id;
}

export async function expose(ch: Chapter, p: Person, by: Person | undefined, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const secret = p.mind.persona?.secret;
  if (!secret || secret.exposedAtTick !== undefined) return null;
  const tx = ch.tx;
  const cause = await tell(ch, {
    category: 'social',
    eventType: by ? 'investigation' : 'conscience',
    actorId: by?.a._id ?? p.a._id,
    participantIds: by ? [p.a._id] : [],
    summary: by ? by.a.name + ' had been quietly digging into ' + p.a.name + "'s past." : p.a.name + ' could not carry it any longer.',
    salience: 0.4,
    visibility: 'private',
  });
  tickOn(ch);
  const id = await exposeSecret(tx, p.a, by ? 'accused' : 'confessed', cause, by?.a);
  if (!id) return null;
  const told = beat ?? (by ? by.a.name + ' dragged ' + first(p.a.name) + "'s secret into the light. " : p.a.name + ' could not carry it any longer, and confessed. ') + secret.text.charAt(0).toUpperCase() + secret.text.slice(1);
  await tx.ctx.db.patch(id, { summary: told, ...(storylineId ? { storylineId } : {}) });
  shiftStatus(tx, p.mind, by ? -10 : -5);
  count(ch, 'exposed');
  if (secret.kind === 'affair') {
    const partner = living(ch, partnerOf(p));
    if (partner) {
      await experience(tx, partner.a, partner.mind, 'betrayed', id);
      if (roll(ch, partner.a.seq, 'forgive') > partner.a.traits.empathy * 0.6) await separate(ch, partner, p, undefined, storylineId);
    }
  }
  return id;
}

export async function settleDebt(ch: Chapter, debtor: Person, lender: Person, how: 'repaid' | 'forgiven' | 'defaulted', beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const tx = ch.tx;
  const ledger = debtor.mind.ledger;
  const owed = (ledger?.owes ?? []).filter((d) => d.to === lender.a._id);
  const what = owed.length ? owed.map((d) => Math.round(d.qty) + ' ' + d.res).join(' and ') : 'what was owed';
  if (ledger) {
    ledger.owes = ledger.owes.filter((d) => d.to !== lender.a._id);
    touchMind(tx, debtor.mind);
  }
  if (how === 'repaid') {
    const value = Math.min(debtor.a.inv.credits, owed.reduce((s, d) => s + d.qty * (d.res === 'credits' ? 1 : (tx.world.prices as Record<string, number>)[d.res] ?? 3), 0));
    debtor.a.inv.credits = round2(debtor.a.inv.credits - value);
    lender.a.inv.credits = round2(lender.a.inv.credits + value);
    touch(tx, lender.a);
    await adjustRelationship(tx, lender.a, debtor.a, { trust: 0.25, affinity: 0.1 });
  } else if (how === 'forgiven') {
    await adjustRelationship(tx, debtor.a, lender.a, { affinity: 0.3, trust: 0.2, obligation: 0.2 });
  } else {
    await adjustRelationship(tx, lender.a, debtor.a, { affinity: -0.35, trust: -0.45 });
    await learnBelief(tx, lender.a, { kind: 'untrustworthy', text: debtor.a.name + ' never paid back ' + what + '.', valence: -1, confidence: 0.9, sourceType: 'observed', subjectAgentId: debtor.a._id, subjectName: debtor.a.name });
  }
  touch(tx, debtor.a);
  const text =
    how === 'repaid'
      ? debtor.a.name + ' paid ' + lender.a.name + ' back, ' + what + ', and the debt that had hung between them was gone.'
      : how === 'forgiven'
        ? lender.a.name + ' told ' + debtor.a.name + ' to forget the debt. ' + first(debtor.a.name) + ' never did.'
        : debtor.a.name + ' never paid ' + lender.a.name + ' back. ' + first(lender.a.name) + ' stopped asking and started telling people.';
  return await tell(ch, { category: 'economy', eventType: 'debt_' + how, actorId: debtor.a._id, participantIds: [lender.a._id], summary: beat ?? text, salience: how === 'defaulted' ? 0.6 : 0.5, storylineId });
}

// ---------- organizations ----------

/** Founds an organization through the live helper and gives it its first handful of members. */
export async function found(ch: Chapter, a: Person, kind: string, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (isChild(a)) return null;
  ch.meta.lastFoundTick = -1e9;
  tickOn(ch);
  const before = ch.tx.eventIds.length;
  if ((await foundOrg(ch.tx, a.a, a.mind, kind, undefined)) <= 0) return null;
  const id = ch.tx.eventIds[before];
  const org = (await activeOrgs(ch.tx)).find((o) => o.founderId === a.a._id && o.foundedTick === ch.tx.tick);
  if (org) await recruitInto(ch, org, 2 + Math.floor(roll(ch, a.a.seq, 'firsts') * 4));
  if (id && (beat || storylineId)) await ch.tx.ctx.db.patch(id, { ...(beat ? { summary: beat } : {}), ...(storylineId ? { storylineId } : {}) });
  count(ch, 'orgsFounded');
  return id ?? null;
}

/** The people most drawn to an organization's kind join it, quietly. */
export async function recruitInto(ch: Chapter, org: OrgDoc, n: number): Promise<Person[]> {
  const joined: Person[] = [];
  if (n <= 0 || org.memberIds.length >= 24) return joined;
  const pool = [...ch.people.values()]
    .filter((p) => !isChild(p) && !org.memberIds.includes(p.a._id) && (p.mind.society?.orgIds.length ?? 0) < 3)
    .map((p) => ({ p, s: kindAffinity(org.kind, p.a, p.mind) + roll(ch, p.a.seq, 'rec' + org._id) * 0.25 }))
    .filter((x) => x.s >= 0.45)
    .sort((x, y) => y.s - x.s)
    .slice(0, n);
  for (const { p } of pool) {
    await addMember(ch.tx, org, p.a, p.mind);
    joined.push(p);
  }
  return joined;
}

async function join(ch: Chapter, a: Person, org: OrgDoc, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (org.memberIds.includes(a.a._id) || isChild(a)) return null;
  await addMember(ch.tx, org, a.a, a.mind);
  return await tell(ch, { category: 'social', eventType: 'org_join', actorId: a.a._id, participantIds: org.leaderId ? [org.leaderId] : [], summary: beat ?? a.a.name + ' joined ' + org.name + '.', salience: 0.45, storylineId });
}

async function quit(ch: Chapter, a: Person, org: OrgDoc, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (!org.memberIds.includes(a.a._id)) return null;
  const id = await tell(ch, { category: 'social', eventType: 'org_leave', actorId: a.a._id, summary: beat ?? a.a.name + ' walked out of ' + org.name + ' and did not come back.', salience: 0.5, storylineId });
  await removeMember(ch.tx, org, a.a, a.mind, id);
  return id;
}

async function takeOver(ch: Chapter, a: Person, org: OrgDoc, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (!org.memberIds.includes(a.a._id) || org.leaderId === a.a._id) return null;
  const old = living(ch, org.leaderId);
  org.leaderId = a.a._id;
  org.officerIds = [...org.officerIds.filter((x) => x !== a.a._id), ...(old ? [old.a._id] : [])].slice(0, 6);
  await saveOrg(ch.tx, org);
  shiftStatus(ch.tx, a.mind, 6);
  if (old) {
    shiftStatus(ch.tx, old.mind, -5);
    await adjustRelationship(ch.tx, old.a, a.a, { affinity: -0.3, trust: -0.25 });
  }
  return await tell(ch, { category: 'social', eventType: 'org_leader', actorId: a.a._id, participantIds: old ? [old.a._id] : [], summary: beat ?? (old ? a.a.name + ' took ' + org.name + ' from ' + old.a.name + ', and the members let it happen.' : a.a.name + ' now leads ' + org.name + '.'), salience: 0.66, storylineId });
}

async function split(ch: Chapter, a: Person, org: OrgDoc, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (!org.memberIds.includes(a.a._id) || org.leaderId === a.a._id || org.memberIds.length < 4) return null;
  const tx = ch.tx;
  const leader = living(ch, org.leaderId);
  const followers: Person[] = [];
  for (const id of org.memberIds) {
    const p = living(ch, id);
    if (!p || p === a || p === leader) continue;
    const toA = (await tieTo(tx, id, a.a._id))?.affinity ?? 0;
    const toLeader = leader ? ((await tieTo(tx, id, leader.a._id))?.affinity ?? 0) : -1;
    if (toA + roll(ch, p.a.seq, 'side') * 0.3 > toLeader) followers.push(p);
  }
  if (followers.length === 0) return null;
  const name = (org.kind === 'cult' ? 'The True ' : org.kind === 'party' ? 'The New ' : 'The Free ') + org.name.replace(/^The /, '');
  const id = await tell(ch, { category: 'social', eventType: 'org_schism', actorId: a.a._id, participantIds: [...(leader ? [leader.a._id] : []), ...followers.slice(0, 5).map((p) => p.a._id)], summary: beat ?? a.a.name + ' broke with ' + (leader ? leader.a.name : 'the old guard') + ' and led ' + (followers.length + 1) + ' members out of ' + org.name + ' to found ' + name + '.', salience: 0.74, storylineId });
  const splinter = await insertOrg(tx, { worldId: tx.world._id, key: org.kind + '-' + tx.tick + '-split', name, kind: org.kind, creed: org.creed, founderId: a.a._id, leaderId: a.a._id, officerIds: [], memberIds: [], treasury: round2(org.treasury * 0.3), reputation: org.reputation, status: 'active', foundedTick: tx.tick, territory: org.territory, rules: org.rules, rivalIds: [org._id], state: { foundEventId: id } });
  org.treasury = round2(org.treasury * 0.7);
  org.rivalIds = [...new Set([...org.rivalIds, splinter._id])];
  for (const p of [a, ...followers]) {
    await removeMember(tx, org, p.a, p.mind, id);
    await addMember(tx, splinter, p.a, p.mind);
  }
  if (leader) await adjustRelationship(tx, leader.a, a.a, { affinity: -0.4, trust: -0.4 });
  count(ch, 'orgsSplit');
  return id;
}

async function merge(ch: Chapter, x: OrgDoc, y: OrgDoc, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const [big, small] = x.memberIds.length >= y.memberIds.length ? [x, y] : [y, x];
  const id = await tell(ch, { category: 'social', eventType: 'org_merger', actorId: big.leaderId, participantIds: small.leaderId ? [small.leaderId] : [], summary: beat ?? small.name + ' folded itself into ' + big.name + '; old rivals now sit at the same table.', salience: 0.62, storylineId });
  for (const mid of [...small.memberIds]) {
    const p = living(ch, mid);
    if (p) await addMember(ch.tx, big, p.a, p.mind);
  }
  big.treasury = round2(big.treasury + small.treasury);
  small.treasury = 0;
  if (small.leaderId && !big.officerIds.includes(small.leaderId)) big.officerIds.push(small.leaderId);
  big.rivalIds = big.rivalIds.filter((r) => r !== small._id);
  await saveOrg(ch.tx, big);
  await disband(ch.tx, small, 'it merged into ' + big.name, id);
  count(ch, 'orgsMerged');
  return id;
}

async function war(ch: Chapter, x: OrgDoc, y: OrgDoc, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const tx = ch.tx;
  const strength = (o: OrgDoc) => o.memberIds.length + o.treasury / 40 + (o.kind === 'militia' || o.kind === 'gang' ? 3 : 0);
  const [win, lose] = strength(x) * (0.7 + roll(ch, 1, 'warx') * 0.6) >= strength(y) * (0.7 + roll(ch, 2, 'wary') * 0.6) ? [x, y] : [y, x];
  x.rivalIds = [...new Set([...x.rivalIds, y._id])];
  y.rivalIds = [...new Set([...y.rivalIds, x._id])];
  const loot = round2(lose.treasury * 0.4);
  lose.treasury = round2(lose.treasury - loot);
  win.treasury = round2(win.treasury + loot);
  lose.reputation = round2(clamp(lose.reputation - 0.1, -1, 1));
  const lw = living(ch, win.leaderId);
  const ll = living(ch, lose.leaderId);
  if (lw && ll) {
    await adjustRelationship(tx, ll.a, lw.a, { affinity: -0.4, trust: -0.4, fear: 0.2 });
    await adjustRelationship(tx, lw.a, ll.a, { affinity: -0.3, trust: -0.3 });
  }
  await saveOrg(tx, win);
  await saveOrg(tx, lose);
  const id = await tell(ch, { category: 'politics', eventType: 'org_war', actorId: win.leaderId, participantIds: lose.leaderId ? [lose.leaderId] : [], summary: beat ?? 'The quarrel between ' + win.name + ' and ' + lose.name + ' turned to raids and smashed stores; ' + win.name + ' came out of it stronger.', salience: 0.74, storylineId });
  const violent = [win.kind, lose.kind].some((k) => k === 'gang' || k === 'militia' || k === 'breakaway');
  if (violent && roll(ch, 3, 'warblood') < 0.3) {
    const victim = lose.memberIds.map((m) => living(ch, m)).find((p) => p && p.a._id !== lose.leaderId);
    if (victim && lw) await die(ch, victim, 'violence', { by: lw, cause: id, storylineId });
  }
  if (lose.memberIds.length <= 2 && lose.treasury < 10) await collapse(ch, lose, undefined, storylineId, id);
  count(ch, 'orgWars');
  return id;
}

async function collapse(ch: Chapter, org: OrgDoc, beat?: string, storylineId?: Id<'storylines'>, cause?: EventId): Promise<EventId | null> {
  if (org.status !== 'active') return null;
  tickOn(ch);
  const before = ch.tx.eventIds.length;
  await disband(ch.tx, org, 'the will to keep it going ran out', cause);
  const id = ch.tx.eventIds[before];
  if (id && (beat || storylineId)) await ch.tx.ctx.db.patch(id, { ...(beat ? { summary: beat } : {}), ...(storylineId ? { storylineId } : {}) });
  count(ch, 'orgsCollapsed');
  return id ?? null;
}

/** A defector government: a breakaway that claims ground and declares its own rules. */
export async function secede(ch: Chapter, a: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if ((await activeOrgs(ch.tx)).some((o) => o.kind === 'breakaway')) return null;
  const founded = await found(ch, a, 'breakaway', undefined, storylineId);
  if (!founded) return null;
  const org = (await activeOrgs(ch.tx)).find((o) => o.kind === 'breakaway' && o.leaderId === a.a._id);
  if (!org) return founded;
  const t = a.a.traits;
  const prefs = BREAKAWAY_RULE_KEYS.map((k) => ({ k, s: (k === 'share_all' ? t.empathy : k === 'keep_the_ice' ? t.ambition : k === 'no_security' ? t.stubbornness : k === 'tithe' ? a.mind.values.wealth : k === 'open_door' ? t.empathy * 0.8 : a.mind.values.freedom) + roll(ch, a.a.seq, 'rule' + k) * 0.3 }));
  org.rules = prefs.sort((x, y) => y.s - x.s).slice(0, 2).map((r) => r.k);
  await recruitInto(ch, org, 3);
  await saveOrg(ch.tx, org);
  const where = LOCATIONS[(org.territory?.[0] ?? 'quarry') as keyof typeof LOCATIONS]?.name ?? 'the quarry';
  count(ch, 'seceded');
  return await tell(ch, { category: 'politics', eventType: 'breakaway_rules', actorId: a.a._id, participantIds: org.memberIds.filter((x) => x !== a.a._id).slice(0, 5), summary: beat ?? a.a.name + ' declared ' + where + ' free of the council: ' + org.name + ' would govern itself. Its first rules: ' + org.rules.map((r) => BREAKAWAY_RULES[r].replace(/\.$/, '').toLowerCase()).join('; ') + '.', salience: 0.82, storylineId });
}

// ---------- standing, minds and work ----------

async function renown(ch: Chapter, a: Person, up: boolean, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const s = societyOf(ch.tx, a.a, a.mind);
  s.fame = round2(clamp(s.fame + (up ? 0.3 : -0.25), 0, 1));
  shiftStatus(ch.tx, a.mind, up ? 12 : -12);
  touchMind(ch.tx, a.mind);
  const artist = (a.mind.skills.art ?? 0) >= 30;
  return await tell(ch, {
    category: 'social',
    eventType: up ? 'fame' : 'disgrace',
    actorId: a.a._id,
    summary: beat ?? (up ? (artist ? a.a.name + "'s work stopped being a curiosity and became the colony's: everyone knows the name now." : a.a.name + ' became someone the whole colony knows by name.') : a.a.name + ' fell from grace; people who once nodded to them in the tubes now look away.'),
    salience: up ? 0.66 : 0.62,
    storylineId,
  });
}

function obsessionKind(text: string): ObsessionKind {
  if (/reveng|aveng|pay for|make .* pay/i.test(text)) return 'revenge';
  if (/masterpiece|song|mural|play|poem|sculpt|holo/i.test(text)) return 'masterpiece';
  if (/discover|invent|research|secret of|formula|cure/i.test(text)) return 'discovery';
  if (/rich|credits|fortune|wealth/i.test(text)) return 'wealth';
  if (/build|statue|dome|monument|tower/i.test(text)) return 'structure';
  if (/long dark|signal|crater|eleven|ghost/i.test(text)) return 'long_dark';
  return 'org';
}

async function obsess(ch: Chapter, a: Person, text: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const before = ch.tx.eventIds.length;
  tickOn(ch);
  if (!(await startObsession(ch.tx, a.a, a.mind, { kind: obsessionKind(text), text: text.replace(/\.$/, '') }))) return null;
  const id = ch.tx.eventIds[before];
  if (id && storylineId) await ch.tx.ctx.db.patch(id, { storylineId });
  count(ch, 'obsessions');
  return id ?? null;
}

async function unobsess(ch: Chapter, a: Person, fulfilled: boolean, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  if (!a.mind.society?.obsession) return null;
  const before = ch.tx.eventIds.length;
  tickOn(ch);
  await endObsession(ch.tx, a.a, a.mind, fulfilled);
  const id = ch.tx.eventIds[before];
  if (id && storylineId) await ch.tx.ctx.db.patch(id, { storylineId });
  return id ?? null;
}

async function convince(ch: Chapter, a: Person, text: string, about: Person | undefined, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const tx = ch.tx;
  const negative = /never|not to be trusted|liar|traitor|enemy|hate|fraud|coward|blame/i.test(text);
  const id = await tell(ch, { category: 'social', eventType: 'conviction', actorId: a.a._id, participantIds: about ? [about.a._id] : [], summary: a.a.name + ' came to believe it: "' + text.replace(/^"|"$/g, '') + '"', salience: 0.45, visibility: 'local', storylineId });
  await learnBelief(tx, a.a, {
    kind: about ? (negative ? 'untrustworthy' : 'admirable') : 'conviction',
    worldKey: about ? undefined : 'conviction:' + ch.tx.tick,
    text,
    valence: about ? (negative ? -1 : 1) : 0,
    confidence: 0.85,
    sourceType: 'observed',
    subjectAgentId: about?.a._id,
    subjectName: about?.a.name,
    originEventId: id,
  });
  return id;
}

export async function takeJob(ch: Chapter, a: Person, occupation: string, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const def = OCCUPATIONS.find((o) => o.id === occupation);
  if (!def || isChild(a) || a.a.occupation === occupation || occupation === 'resident') return null;
  const tx = ch.tx;
  const skill = PRIMARY_SKILL[occupation] ?? 'craft';
  const old = a.a.occupation;
  a.mind.skills[skill] = Math.max(a.mind.skills[skill] ?? 0, 30);
  societyOf(tx, a.a, a.mind).jobHistory.push({ occupation, fromTick: tx.tick });
  touchMind(tx, a.mind);
  if (a.a.role && !['chair'].includes(a.a.role)) {
    delete tx.world.roles[a.a.role];
    a.a.role = undefined;
  }
  a.a.occupation = occupation;
  a.a.workLocationId = def.workLocationId;
  a.a.skill = a.mind.skills[skill];
  a.a.spriteId = (def.archetype as SpriteArchetype) + '_' + (a.a.seq % SPRITE_VARIANTS);
  touch(tx, a.a);
  count(ch, 'jobs');
  const label = def.label.toLowerCase();
  return await tell(ch, { category: 'economy', eventType: 'job_change', actorId: a.a._id, summary: beat ?? (old === 'resident' ? a.a.name + ' found steady work at last, as a ' + label + '.' : a.a.name + ' gave up life as a ' + (OCCUPATIONS.find((o) => o.id === old)?.label.toLowerCase() ?? old) + ' and became a ' + label + '.'), salience: 0.5, storylineId });
}

export async function takeChair(ch: Chapter, a: Person, beat?: string, storylineId?: Id<'storylines'>): Promise<EventId | null> {
  const tx = ch.tx;
  if (isChild(a) || tx.world.roles.chair === a.a._id) return null;
  const old = living(ch, tx.world.roles.chair);
  if (old) {
    old.a.role = undefined;
    touch(tx, old.a);
    shiftStatus(tx, old.mind, -6);
    await adjustRelationship(tx, old.a, a.a, { affinity: -0.25, trust: -0.2 });
  }
  if (a.a.role && a.a.role !== 'chair') delete tx.world.roles[a.a.role];
  tx.world.roles.chair = a.a._id;
  tx.world.vacancies = tx.world.vacancies.filter((v) => v.role !== 'chair');
  a.a.role = 'chair';
  if (a.a.occupation !== 'councilor') {
    a.a.occupation = 'councilor';
    a.a.workLocationId = 'plaza';
  }
  if (tx.world.sim && !tx.world.sim.council.includes(a.a._id)) tx.world.sim.council = [...tx.world.sim.council.slice(-4), a.a._id];
  touch(tx, a.a);
  shiftStatus(tx, a.mind, 10);
  count(ch, 'chairs');
  return await tell(ch, { category: 'politics', eventType: 'council_chair', actorId: a.a._id, participantIds: old ? [old.a._id] : [], summary: beat ?? (old ? a.a.name + ' unseated ' + old.a.name + ' and took the chair of the council.' : a.a.name + ' was voted into the empty chair of the council.'), salience: 0.8, storylineId });
}

/** Members, in words: "Rosa, Kenji and 4 others". */
export function crowd(ch: Chapter, ids: AgentId[]): string {
  const names = ids.map((id) => living(ch, id)?.a.name).filter((n): n is string => !!n).map(first);
  return names.length <= 3 ? listNames(names) : names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' others';
}

export type { Doc };
