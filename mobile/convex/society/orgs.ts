/**
 * Organizations: companies, guilds, cults, gangs, militias, parties, schools, troupes and breakaway
 * colonies. Who founds what follows from persona, traits, status and grievance; recruitment from
 * persuasion, status and affinity; organizations collect dues, feed or pay their members, meet,
 * hold rituals, raid, run protection rackets, make deals, merge, split and collapse. A breakaway
 * claims territory, declares rules that change what happens there, and collides with the council.
 */
import type { Id } from '../_generated/dataModel';
import { LOCATIONS, OCCUPATIONS, TICKS_PER_HOUR } from '../../shared/colony';
import { BREAKAWAY_RULES, BREAKAWAY_RULE_KEYS, ORG_KINDS } from '../../shared/society';
import type { OrgKindDef } from '../../shared/society';
import { PRODUCTION } from '../lib/constants';
import { clamp, pick, round2 } from '../lib/rng';
import { ROSTER_WORKING, locChar } from '../seed/insert';
import { addStock, isLocation, locName, firstName, stock } from '../engine/conditions';
import { adjustRelationship, agentsAt, emitEvent, enqueueCognition, learnBelief, loadAgent, loadMind, touch, touchMind } from '../engine/core';
import type { AgentDoc, EventId, MindDoc, Tx } from '../engine/core';
import { presentWith, tie } from '../engine/social';
import { simState } from '../engine/state';
import {
  DAY,
  MAX_ACTIVE_ORGS,
  act,
  activeOrgs,
  cap,
  clout,
  insertOrg,
  listNames,
  loadMeta,
  orgById,
  roll,
  sanitize,
  saveMeta,
  saveOrg,
  shiftStatus,
  societyOf,
} from './store';
import type { OrgDoc } from './store';

export type Person = { a: AgentDoc; mind: MindDoc };
type OrgState = { home?: string; stores?: { food: number; water: number }; lastMeetingTick?: number; symbolWorkId?: string; lastClashDay?: number; foundEventId?: EventId };

export const orgState = (org: OrgDoc): OrgState => (org.state ?? {}) as OrgState;
export const orgHome = (org: OrgDoc): string => org.territory?.[0] ?? orgState(org).home ?? ORG_KINDS[org.kind]?.home ?? 'plaza';
export const kindDef = (kind: string): OrgKindDef => ORG_KINDS[kind] ?? ORG_KINDS.troupe;
const article = (kind: string): string => (/^[aeiou]/.test(kindDef(kind).label) ? 'an ' : 'a ') + kindDef(kind).label;

export function roleIn(org: OrgDoc, id: string): 'founder' | 'leader' | 'officer' | 'member' | null {
  if (org.leaderId === id) return org.founderId === id ? 'founder' : 'leader';
  if (org.officerIds.includes(id as Id<'agents'>)) return 'officer';
  if (org.memberIds.includes(id as Id<'agents'>)) return 'member';
  return null;
}

/** Status points a rank is worth. */
export function rankOf(orgs: OrgDoc[], id: string): number {
  let rank = 0;
  for (const o of orgs) {
    const r = roleIn(o, id);
    rank += r === 'founder' || r === 'leader' ? 6 + Math.min(6, o.memberIds.length) : r === 'officer' ? 4 : r ? 1 : 0;
  }
  return Math.min(16, rank);
}

/** The active organizations an agent belongs to. */
export async function orgsOf(tx: Tx, mind: MindDoc): Promise<OrgDoc[]> {
  const ids = mind.society?.orgIds ?? [];
  if (ids.length === 0) return [];
  const all = await activeOrgs(tx);
  return all.filter((o) => ids.includes(o._id));
}

export async function addMember(tx: Tx, org: OrgDoc, a: AgentDoc, mind: MindDoc): Promise<void> {
  const s = societyOf(tx, a, mind);
  if (!org.memberIds.includes(a._id)) org.memberIds.push(a._id);
  if (!s.orgIds.includes(org._id)) s.orgIds.push(org._id);
  touchMind(tx, mind);
  await saveOrg(tx, org);
}

export async function removeMember(tx: Tx, org: OrgDoc, a: AgentDoc, mind: MindDoc | null, cause?: EventId): Promise<void> {
  org.memberIds = org.memberIds.filter((id) => id !== a._id);
  org.officerIds = org.officerIds.filter((id) => id !== a._id);
  if (mind?.society) {
    mind.society.orgIds = mind.society.orgIds.filter((id) => id !== org._id);
    touchMind(tx, mind);
  }
  if (org.leaderId === a._id) {
    org.leaderId = undefined;
    await chooseLeader(tx, org, cause);
  }
  if (org.status === 'active' && org.memberIds.length === 0) await disband(tx, org, 'nobody was left in it', cause);
  else await saveOrg(tx, org);
}

/** The member with the most status takes over; an organization nobody can lead collapses. */
export async function chooseLeader(tx: Tx, org: OrgDoc, cause?: EventId): Promise<AgentDoc | null> {
  let best: { a: AgentDoc; status: number } | null = null;
  for (const id of org.memberIds.slice(0, 16)) {
    const a = await loadAgent(tx, id);
    if (!a?.alive) continue;
    const m = await loadMind(tx, a);
    const status = (m?.society?.status ?? 20) + (org.officerIds.includes(id) ? 10 : 0) + (m ? (m.skills.persuasion ?? 30) / 10 : 0);
    if (!best || status > best.status) best = { a, status };
  }
  if (!best) {
    await disband(tx, org, 'nobody was left to lead it', cause);
    return null;
  }
  org.leaderId = best.a._id;
  org.officerIds = org.officerIds.filter((id) => id !== best!.a._id);
  await saveOrg(tx, org);
  const mind = await loadMind(tx, best.a);
  if (mind) shiftStatus(tx, mind, 5);
  await emitEvent(tx, {
    category: 'social',
    eventType: 'org_leader',
    actorId: best.a._id,
    participantIds: org.memberIds.slice(0, 8),
    summary: best.a.name + ' now leads ' + org.name + '.',
    salience: 0.55,
    causationEventId: cause,
    visibility: 'public',
  });
  return best.a;
}

export async function disband(tx: Tx, org: OrgDoc, reason: string, cause?: EventId): Promise<void> {
  if (org.status !== 'active') return;
  org.status = 'disbanded';
  for (const id of org.memberIds.slice(0, 20)) {
    const a = await loadAgent(tx, id);
    const m = a ? await loadMind(tx, a) : null;
    if (m?.society) {
      m.society.orgIds = m.society.orgIds.filter((x) => x !== org._id);
      touchMind(tx, m);
    }
  }
  if (org.treasury > 0) tx.world.econ.treasury = round2(tx.world.econ.treasury + org.treasury);
  org.treasury = 0;
  await saveOrg(tx, org);
  await emitEvent(tx, {
    category: 'social',
    eventType: 'org_collapsed',
    actorId: org.leaderId ?? org.founderId,
    summary: org.name + ' has broken up: ' + reason + '.',
    salience: 0.65,
    causationEventId: cause,
    visibility: 'public',
  });
}

// ---------- who wants what kind of organization ----------

const has = (mind: MindDoc, strategy: string): boolean => mind.persona?.strategies.includes(strategy) ?? false;
const story = (mind: MindDoc): string => ((mind.persona?.want ?? '') + ' ' + (mind.persona?.epithet ?? '') + ' ' + mind.background).toLowerCase();
const unemployed = (a: AgentDoc): boolean => a.occupation === 'resident';

/** How strongly a kind of organization appeals to someone, 0..1. */
export function kindAffinity(kind: string, a: AgentDoc, mind: MindDoc): number {
  const t = a.traits;
  const v = mind.values;
  const fear = a.needs.safety / 100;
  const hungry = Math.max(a.needs.hunger, a.needs.thirst) > 60 ? 0.25 : 0;
  const status = (mind.society?.status ?? 30) / 100;
  const art = (mind.skills.art ?? 0) / 100;
  const ob = mind.society?.obsession?.kind;
  switch (kind) {
    case 'cult':
      return clamp((1 - t.caution) * 0.25 + fear * 0.4 + t.curiosity * 0.15 + (a.mood === 'grieving' || a.mood === 'sombre' ? 0.25 : 0) + hungry + (ob === 'long_dark' ? 0.4 : 0) + (/long dark|faith|eleven|ghost/.test(story(mind)) ? 0.2 : 0), 0, 1);
    case 'company':
      return clamp(v.wealth * 0.45 + t.ambition * 0.3 + (unemployed(a) ? 0.3 : 0) + (has(mind, 'work') ? 0.1 : 0), 0, 1);
    case 'guild':
      return clamp((a.occupation === 'hydroponicist' || a.occupation === 'cook' ? 0.5 : 0) + t.empathy * 0.25 + v.harmony * 0.15 + hungry + (has(mind, 'grow') ? 0.2 : 0), 0, 1);
    case 'gang':
      return clamp((1 - t.empathy) * 0.4 + (1 - v.harmony) * 0.15 + hungry + (unemployed(a) ? 0.25 : 0) + (has(mind, 'steal') || has(mind, 'smuggle') ? 0.3 : 0) - t.caution * 0.2, 0, 1);
    case 'militia':
      return clamp(t.stubbornness * 0.3 + fear * 0.3 + (['security', 'ice_miner', 'quarry_hand'].includes(a.occupation) ? 0.3 : 0) + (1 - v.harmony) * 0.1, 0, 1);
    case 'party':
      return clamp(v.status * 0.3 + t.ambition * 0.25 + (mind.skills.persuasion ?? 30) / 250 + v.freedom * 0.15, 0, 1);
    case 'school':
      return clamp(t.curiosity * 0.5 + (mind.ageBand === 'child' || mind.ageBand === 'young' ? 0.4 : 0) + (a.occupation === 'researcher' ? 0.2 : 0), 0, 1);
    case 'troupe':
      return clamp(t.sociability * 0.35 + art * 0.6 + t.curiosity * 0.1, 0, 1);
    case 'breakaway':
      return clamp(v.freedom * 0.45 + (1 - status) * 0.25 + (unemployed(a) ? 0.2 : 0) + t.stubbornness * 0.15, 0, 1);
    default:
      return 0;
  }
}

/** The organization this person would found, if any, with how much they want to. */
export function foundingDesire(a: AgentDoc, mind: MindDoc, rationLevel: number): { kind: string; score: number } | null {
  if (mind.ageBand === 'child') return null;
  const t = a.traits;
  const v = mind.values;
  const status = mind.society?.status ?? 30;
  const art = mind.skills.art ?? 0;
  const ob = mind.society?.obsession?.kind;
  const options: { kind: string; score: number }[] = [
    { kind: 'cult', score: t.sociability > 0.55 && t.stubbornness > 0.55 ? 0.3 + t.sociability * 0.2 + (ob === 'long_dark' ? 0.3 : 0) + (/long dark|faith|eleven/.test(story(mind)) ? 0.15 : 0) : ob === 'long_dark' ? 0.35 : 0 },
    { kind: 'company', score: t.ambition > 0.6 && v.wealth > 0.5 && a.skill >= 45 && a.occupation !== 'resident' ? 0.3 + t.ambition * 0.25 : 0 },
    { kind: 'militia', score: t.stubbornness > 0.6 && v.harmony < 0.45 && (a.needs.safety > 30 || ['security', 'ice_miner', 'quarry_hand'].includes(a.occupation)) ? 0.35 + (1 - v.harmony) * 0.2 : 0 },
    { kind: 'gang', score: t.empathy < 0.35 && t.ambition > 0.45 && (has(mind, 'steal') || has(mind, 'smuggle') || ['dock_hand', 'trader', 'resident', 'hauler'].includes(a.occupation)) ? 0.35 + (1 - t.empathy) * 0.2 : 0 },
    { kind: 'troupe', score: art >= 40 || (t.sociability > 0.75 && t.curiosity > 0.6) ? 0.3 + art / 250 + t.sociability * 0.1 : 0 },
    { kind: 'guild', score: (a.occupation === 'hydroponicist' || a.occupation === 'cook') && t.empathy > 0.5 && v.harmony > 0.45 ? 0.35 + t.empathy * 0.15 : 0 },
    { kind: 'party', score: t.ambition > 0.6 && v.status > 0.55 && (mind.skills.persuasion ?? 0) >= 50 ? 0.35 + v.status * 0.15 : 0 },
    { kind: 'school', score: a.skill >= 65 && t.empathy > 0.5 && t.curiosity > 0.55 ? 0.3 + t.curiosity * 0.15 : 0 },
    { kind: 'breakaway', score: v.freedom > 0.65 && t.stubbornness > 0.5 && (status < 38 || unemployed(a) || rationLevel >= 1) ? 0.35 + v.freedom * 0.2 + rationLevel * 0.08 : 0 },
  ];
  const best = options.sort((x, y) => y.score - x.score)[0];
  return best.score > 0 ? best : null;
}

/** Whether the colony has room for one more of this kind. */
export async function canFound(tx: Tx, kind: string): Promise<boolean> {
  const orgs = await activeOrgs(tx);
  if (orgs.length >= MAX_ACTIVE_ORGS) return false;
  const same = orgs.filter((o) => o.kind === kind).length;
  return same < (kind === 'breakaway' || kind === 'school' ? 1 : 2);
}

function orgName(tx: Tx, kind: string, founder: AgentDoc, taken: string[]): string {
  const def = kindDef(kind);
  const home = kind === 'breakaway' ? breakawayTerritory(founder) : founder.workLocationId ?? def.home;
  const place = isLocation(home) ? LOCATIONS[home].name.replace(/^The /, '').split(' ').slice(-1)[0] : 'Rim';
  const family = founder.name.split(' ').slice(-1)[0];
  for (let i = 0; i < def.names.length; i++) {
    const n = pick(def.names, roll(tx, founder.seq, 'orgname' + i)).replace('{place}', place).replace('{name}', family);
    if (!taken.includes(n)) return n;
  }
  return family + "'s " + cap(def.label);
}

function breakawayTerritory(a: AgentDoc): string {
  const w = a.workLocationId;
  if (w === 'quarry' || w === 'ice_wells' || w === 'solar_farm' || w === 'landing_pad') return w;
  return a.homeLocationId === 'habitat_b' ? 'habitat_b' : 'quarry';
}

function creedFor(tx: Tx, kind: string, a: AgentDoc, mind: MindDoc, taken: string[]): string {
  const ob = mind.society?.obsession;
  if (kind === 'cult' && ob?.kind === 'long_dark') return 'The truth of the Long Dark is out there in the crater, and we will find it.';
  const creeds = kindDef(kind).creeds;
  const start = Math.floor(roll(tx, a.seq, 'creed') * creeds.length);
  return creeds.map((_, i) => creeds[(start + i) % creeds.length]).find((c) => !taken.includes(c)) ?? creeds[start];
}

// ---------- steps ----------

export async function foundOrg(tx: Tx, a: AgentDoc, mind: MindDoc, kind: string, nameArg: string | undefined): Promise<number> {
  if (!ORG_KINDS[kind]) return -1;
  const meta = await loadMeta(tx);
  const orgs = await activeOrgs(tx);
  if (orgs.some((o) => o.leaderId === a._id) || !(await canFound(tx, kind))) return -1;
  if (tx.tick - meta.lastFoundTick < 12) return -1;
  const s = societyOf(tx, a, mind);
  const taken = orgs.map((o) => o.name);
  const clean = nameArg ? sanitize(nameArg, 40) : '';
  const name = clean.length >= 3 && !taken.includes(clean) && !/^\d+$/.test(clean) ? clean : orgName(tx, kind, a, taken);
  const stake = Math.min(Math.floor(a.inv.credits * 0.3), 60);
  a.inv.credits = round2(a.inv.credits - stake);
  const home = kind === 'breakaway' ? breakawayTerritory(a) : kind === 'company' || kind === 'school' ? a.workLocationId ?? kindDef(kind).home : kindDef(kind).home;
  const creed = creedFor(tx, kind, a, mind, orgs.map((o) => o.creed));
  const org = await insertOrg(tx, {
    worldId: tx.world._id,
    key: kind + '-' + tx.tick + '-' + a.seq,
    name,
    kind,
    creed,
    founderId: a._id,
    leaderId: a._id,
    officerIds: [],
    memberIds: [a._id],
    treasury: stake,
    reputation: kind === 'gang' ? -0.2 : kind === 'school' ? 0.3 : 0,
    status: 'active',
    foundedTick: tx.tick,
    territory: kind === 'breakaway' ? [home] : undefined,
    rivalIds: [],
    state: { home },
  });
  s.orgIds.push(org._id);
  shiftStatus(tx, mind, 6);
  meta.lastFoundTick = tx.tick;
  await saveMeta(tx);
  act(tx, a, 'talking', 'Founding ' + name, undefined, kind === 'breakaway' ? 'From today we answer to ourselves.' : 'This is the start of something.');
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'org_founded',
    actorId: a._id,
    locationId: a.locationId,
    summary: a.name + ' founded ' + name + ', ' + article(kind) + ': "' + creed + '"',
    salience: kind === 'breakaway' || kind === 'cult' || kind === 'gang' ? 0.78 : 0.7,
    visibility: kind === 'gang' ? 'local' : 'public',
    witnesses: 'location',
    facts: { orgId: org._id, kind },
  });
  org.state = { ...orgState(org), foundEventId: eventId };
  await saveOrg(tx, org);
  return 3;
}

export async function joinOrg(tx: Tx, a: AgentDoc, mind: MindDoc, orgId: string): Promise<number> {
  const org = await orgById(tx, orgId);
  if (!org || org.status !== 'active' || org.memberIds.includes(a._id)) return -1;
  const here = a.locationId === orgHome(org) || (await agentsAt(tx, a.locationId)).some((id) => org.memberIds.includes(id));
  if (!here) return -1;
  if (org.kind === 'company' && org.treasury < 15 * org.memberIds.length) {
    act(tx, a, 'talking', 'Turned away by ' + org.name + ': no openings');
    return 1;
  }
  await addMember(tx, org, a, mind);
  act(tx, a, 'talking', 'Joining ' + org.name);
  const leader = org.leaderId ? await loadAgent(tx, org.leaderId) : null;
  if (leader) await adjustRelationship(tx, a, leader, { affinity: 0.1, trust: 0.1 });
  await emitEvent(tx, {
    category: 'social',
    eventType: 'org_join',
    actorId: a._id,
    participantIds: leader ? [leader._id] : [],
    locationId: a.locationId,
    summary: a.name + ' joined ' + org.name + '.',
    salience: 0.45,
    causationEventId: orgState(org).foundEventId,
    witnesses: 'location',
  });
  return 2;
}

export async function leaveOrg(tx: Tx, a: AgentDoc, mind: MindDoc, orgId: string): Promise<number> {
  const org = await orgById(tx, orgId);
  if (!org || !org.memberIds.includes(a._id)) return -1;
  const leader = org.leaderId && org.leaderId !== a._id ? await loadAgent(tx, org.leaderId) : null;
  const t = leader ? await tie(tx, a._id, leader._id) : null;
  const loud = (t?.affinity ?? 0) < -0.1 || a.traits.stubbornness > 0.7;
  act(tx, a, 'talking', loud ? 'Walking out of ' + org.name : 'Quietly leaving ' + org.name, leader?._id, loud ? 'I am done with all of you.' : undefined);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'org_leave',
    actorId: a._id,
    participantIds: leader ? [leader._id] : [],
    locationId: a.locationId,
    summary: loud ? a.name + ' walked out of ' + org.name + (leader ? ', cursing ' + leader.name : '') + '.' : a.name + ' quietly left ' + org.name + '.',
    salience: loud ? 0.55 : 0.35,
    visibility: loud ? 'public' : 'local',
  });
  if (leader && loud) await adjustRelationship(tx, leader, a, { affinity: -0.2, trust: -0.2 });
  await removeMember(tx, org, a, mind, eventId);
  return 1;
}

/** Recruitment: persuasion, status, affinity and what the organization offers decide. */
export async function recruit(tx: Tx, a: AgentDoc, mind: MindDoc, targetId: string, orgId: string | undefined): Promise<number> {
  const b = await presentWith(tx, a, targetId);
  if (!b) return -1;
  const mine = await orgsOf(tx, mind);
  const org = mine.find((o) => o._id === orgId) ?? mine[0];
  if (!org || org.memberIds.includes(b._id)) return -1;
  const bm = await loadMind(tx, b);
  if (!bm || bm.ageBand === 'child') return -1;
  const bs = societyOf(tx, b, bm);
  const t = await tie(tx, b._id, a._id);
  const meta = await loadMeta(tx);
  const fearBoost = org.kind === 'cult' && tx.tick < meta.fearUntil ? 0.2 : 0;
  const shrine = org.kind === 'cult' && meta.built.some((x) => x.key === 'long_dark_shrine' && x.orgId === org._id) ? 0.1 : 0;
  const chance = clamp(
    -0.2 + kindAffinity(org.kind, b, bm) * 0.55 + clout(mind) * 0.35 + ((mind.society?.status ?? 30) - bs.status) / 250 + (t?.affinity ?? 0) * 0.35 + (t?.trust ?? 0) * 0.15 - bs.orgIds.length * 0.12 + fearBoost + shrine,
    0.03,
    0.9,
  );
  const yes = roll(tx, a.seq, 'recruit') < chance;
  const kindLine: Record<string, string> = {
    cult: 'The eleven are watching. Come and listen with us.',
    gang: 'Stick with us and you will never go hungry.',
    company: 'I can pay better than the council.',
    militia: 'Someone has to keep this place safe.',
    breakaway: 'Come and be free with us.',
    troupe: 'We need a voice like yours.',
  };
  act(tx, a, 'talking', 'Trying to bring ' + b.name + ' into ' + org.name, b._id, kindLine[org.kind] ?? 'You should join us.');
  b.interactingWithId = a._id;
  b.speech = yes ? 'All right. Count me in.' : 'Not for me.';
  touch(tx, b);
  if (!yes) {
    await adjustRelationship(tx, b, a, { affinity: -0.03 });
    await emitEvent(tx, { category: 'social', eventType: 'recruit_refused', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: b.name + ' turned down ' + a.name + "'s invitation to join " + org.name + '.', salience: 0.3, visibility: 'local' });
    return 2;
  }
  await addMember(tx, org, b, bm);
  await adjustRelationship(tx, b, a, { affinity: 0.1, trust: 0.1, obligation: 0.05 });
  shiftStatus(tx, mind, 1);
  await emitEvent(tx, {
    category: 'social',
    eventType: 'org_recruit',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' brought ' + b.name + ' into ' + org.name + (org.kind === 'gang' ? ', quietly' : '') + '.',
    salience: 0.5,
    causationEventId: orgState(org).foundEventId,
    visibility: org.kind === 'gang' ? 'local' : 'public',
    witnesses: 'location',
  });
  return 2;
}

/** Public preaching for a creed: sways the curious and the frightened, provokes the stubborn. */
export async function preach(tx: Tx, a: AgentDoc, mind: MindDoc, topic: string | undefined): Promise<number> {
  const mine = await orgsOf(tx, mind);
  const org = mine.find((o) => o._id === topic) ?? mine.find((o) => o.leaderId === a._id) ?? mine[0];
  const cause = org ? org.creed : sanitize(topic ?? '', 80) || 'that the colony must change';
  const audience = (await agentsAt(tx, a.locationId, { exclude: [a._id] })).slice(0, 8);
  act(tx, a, 'talking', 'Preaching at ' + locName(a.locationId), undefined, cause.length < 70 ? cause : cause.slice(0, 66) + '...');
  if (audience.length === 0) return 2;
  const swayed: AgentDoc[] = [];
  const joined: AgentDoc[] = [];
  const hecklers: AgentDoc[] = [];
  const meta = await loadMeta(tx);
  const power = clout(mind) * (org?.kind === 'cult' && tx.tick < meta.fearUntil ? 1.3 : 1);
  for (const id of audience) {
    const b = await loadAgent(tx, id);
    const bm = b ? await loadMind(tx, b) : null;
    if (!b || !bm || bm.ageBand === 'child') continue;
    const r = roll(tx, b.seq, 'preach');
    const open = (1 - b.traits.stubbornness) * 0.5 + b.traits.curiosity * 0.2 + (org ? kindAffinity(org.kind, b, bm) * 0.4 : 0.2);
    if (r < power * open) {
      swayed.push(b);
      if (org) {
        await learnBelief(tx, b, { kind: 'creed', worldKey: 'creed:' + org._id, text: org.name + ' may be right: ' + org.creed, valence: 0, confidence: round2(0.3 + power * 0.4), sourceType: 'told', sourceAgentId: a._id, sourceName: a.name });
        if (!org.memberIds.includes(b._id) && r < power * open * 0.35 && societyOf(tx, b, bm).orgIds.length < 2) {
          await addMember(tx, org, b, bm);
          joined.push(b);
        }
      }
      await adjustRelationship(tx, b, a, { affinity: 0.06, trust: 0.04 });
    } else if (b.traits.stubbornness > 0.65 && r > 0.6) {
      hecklers.push(b);
      await adjustRelationship(tx, b, a, { affinity: -0.08 });
    }
  }
  if (swayed.length + hecklers.length === 0) return 3;
  shiftStatus(tx, mind, joined.length * 1.5 - hecklers.length * 0.5);
  const parts = [a.name + ' preached ' + (org ? 'the creed of ' + org.name : 'a cause') + ' at ' + locName(a.locationId)];
  if (swayed.length) parts.push(swayed.length + (swayed.length === 1 ? ' listener was' : ' listeners were') + ' moved');
  if (joined.length) parts.push(listNames(joined.map((b) => b.name)) + ' joined on the spot');
  if (hecklers.length) parts.push(listNames(hecklers.map((b) => firstName(b.name))) + ' heckled');
  await emitEvent(tx, {
    category: 'social',
    eventType: 'preaching',
    actorId: a._id,
    participantIds: [...swayed, ...hecklers].map((b) => b._id),
    locationId: a.locationId,
    summary: parts.join('; ') + '.',
    salience: joined.length > 0 ? 0.55 : 0.4,
    causationEventId: org ? orgState(org).foundEventId : undefined,
    visibility: 'public',
  });
  return 3;
}

// ---------- org_action ----------

/** What an organization gives a member who asks: food and water from its stores, its purse or the depot. */
async function aid(tx: Tx, a: AgentDoc, org: OrgDoc): Promise<number> {
  const st = orgState(org);
  const stores = st.stores ?? { food: 0, water: 0 };
  const res: 'food' | 'water' = a.needs.thirst >= a.needs.hunger ? 'water' : 'food';
  let got = 0;
  let how = '';
  if (stores[res] >= 1) {
    got = Math.min(2, Math.floor(stores[res]));
    stores[res] -= got;
    how = 'from the common stores';
  } else if (org.kind === 'gang' && stock(tx.world, 'depot', res) > 30) {
    got = 2;
    addStock(tx.world, 'depot', res, -got);
    const sim = await simState(tx);
    sim.missing[res] = round2(sim.missing[res] + got);
    how = 'lifted from the depot by the crew';
  } else {
    const price = tx.world.prices[res] * 1.1;
    const n = Math.min(2, Math.floor(org.treasury / price), Math.floor(stock(tx.world, 'depot', res) - 40));
    if (n > 0) {
      org.treasury = round2(org.treasury - n * price);
      tx.world.econ.treasury = round2(tx.world.econ.treasury + n * price);
      addStock(tx.world, 'depot', res, -n);
      got = n;
      how = 'bought with the ' + kindDef(org.kind).label + "'s purse";
    }
  }
  org.state = { ...st, stores };
  await saveOrg(tx, org);
  if (got <= 0) {
    act(tx, a, 'talking', org.name + ' had nothing to give');
    return 1;
  }
  a.inv[res] += got;
  act(tx, a, 'talking', 'Getting ' + res + ' from ' + org.name);
  const leader = org.leaderId && org.leaderId !== a._id ? await loadAgent(tx, org.leaderId) : null;
  if (leader) await adjustRelationship(tx, a, leader, { affinity: 0.05, obligation: 0.1 });
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'org_aid',
    actorId: a._id,
    participantIds: leader ? [leader._id] : [],
    locationId: a.locationId,
    summary: org.name + ' gave ' + a.name + ' ' + got + ' ' + res + ', ' + how + '.',
    salience: org.kind === 'gang' ? 0.4 : 0.3,
    visibility: org.kind === 'gang' ? 'private' : 'local',
  });
  return 1;
}

/** A company shift: the company is paid by the colony for goods delivered and pays a wage. */
async function companyWorkDone(tx: Tx, a: AgentDoc, org: OrgDoc, ticks: number): Promise<void> {
  const home = orgHome(org);
  const hours = ticks / TICKS_PER_HOUR;
  const skill = 0.6 + a.skill / 120;
  const goods: Record<string, { res: 'water' | 'food' | 'parts' | 'medicine'; rate: number }> = {
    ice_wells: { res: 'water', rate: PRODUCTION.water * 0.6 },
    hydroponics: { res: 'food', rate: PRODUCTION.food * 0.6 },
    workshop: { res: 'parts', rate: 0.5 },
    quarry: { res: 'parts', rate: 0.35 },
    medbay: { res: 'medicine', rate: PRODUCTION.medicine },
  };
  const g = goods[home] ?? { res: 'parts' as const, rate: 0.25 };
  const made = round2(g.rate * hours * skill);
  addStock(tx.world, 'depot', g.res, made);
  const price = made * (tx.world.prices[g.res] ?? 3) * 0.6;
  const paid = Math.min(price, tx.world.econ.treasury * 0.01);
  tx.world.econ.treasury = round2(tx.world.econ.treasury - paid);
  org.treasury = round2(org.treasury + paid);
  const wage = Math.min(org.treasury, round2(1.4 * hours));
  org.treasury = round2(org.treasury - wage);
  a.inv.credits = round2(a.inv.credits + wage);
  a.skill = Math.min(100, a.skill + 0.02 * ticks);
  touch(tx, a);
  await saveOrg(tx, org);
}

export async function orgAction(tx: Tx, a: AgentDoc, mind: MindDoc, orgId: string | undefined, action: string): Promise<number> {
  const mine = await orgsOf(tx, mind);
  const org = mine.find((o) => o._id === orgId) ?? mine[0];
  if (!org) return -1;
  const lead = org.leaderId === a._id;
  switch (action) {
    case 'meeting':
    case 'ritual': {
      if (a.locationId !== orgHome(org)) return -1;
      act(tx, a, 'talking', action === 'ritual' ? ritualLabel(org) : 'At a meeting of ' + org.name);
      return 4;
    }
    case 'work': {
      if (org.kind !== 'company' || a.locationId !== orgHome(org)) return -1;
      act(tx, a, 'helping', 'Working a shift for ' + org.name);
      return 12;
    }
    case 'protect': {
      act(tx, a, 'investigating', org.kind === 'gang' ? 'Making the rounds for ' + org.name : 'On patrol for ' + org.name + ' at ' + locName(a.locationId));
      return 4;
    }
    case 'dues': {
      const due = Math.max(1, kindDef(org.kind).dues);
      if (a.inv.credits < due) return -1;
      a.inv.credits = round2(a.inv.credits - due);
      org.treasury = round2(org.treasury + due);
      await saveOrg(tx, org);
      act(tx, a, 'giving', 'Paying dues to ' + org.name);
      return 0;
    }
    case 'aid':
      return aid(tx, a, org);
    case 'raid':
      return (await raid(tx, a, org)) ? 2 : -1;
    case 'trade_deal':
      return (await tradeDeal(tx, a, org)) ? 2 : -1;
    case 'expel':
      return lead && (await expel(tx, a, org)) ? 1 : -1;
    case 'declare_rules':
      return lead && org.kind === 'breakaway' ? declareRules(tx, a, mind, org) : -1;
    default:
      return -1;
  }
}

function ritualLabel(org: OrgDoc): string {
  if (org.kind === 'cult') return 'Lighting the lamps with ' + org.name;
  if (org.kind === 'troupe') return 'Rehearsing with ' + org.name;
  if (org.kind === 'breakaway') return 'Holding the assembly of ' + org.name;
  return 'Keeping the customs of ' + org.name;
}

/** The end of a timed org action. */
export async function orgActionDone(tx: Tx, a: AgentDoc, orgId: string | undefined, action: string, ticks: number): Promise<void> {
  const mind = await loadMind(tx, a);
  if (!mind) return;
  const mine = await orgsOf(tx, mind);
  const org = mine.find((o) => o._id === orgId) ?? mine[0];
  if (!org) return;
  if (action === 'work') return companyWorkDone(tx, a, org, ticks);
  if (action === 'protect') {
    const meta = await loadMeta(tx);
    if (org.kind === 'gang') {
      await racket(tx, a, org);
      return;
    }
    meta.guarded[a.locationId] = tx.tick + 36;
    await saveMeta(tx);
    for (const id of (await agentsAt(tx, a.locationId)).slice(0, 10)) {
      const b = await loadAgent(tx, id);
      if (b) {
        b.needs.safety = Math.max(0, b.needs.safety - 15);
        touch(tx, b);
      }
    }
    return;
  }
  if (action !== 'meeting' && action !== 'ritual') return;
  const present: AgentDoc[] = [];
  for (const id of await agentsAt(tx, a.locationId)) {
    if (!org.memberIds.includes(id)) continue;
    const b = await loadAgent(tx, id);
    if (b) present.push(b);
  }
  const meta = await loadMeta(tx);
  const chapel = meta.built.some((x) => (x.key === 'chapel' || x.key === 'theatre_stage') && x.loc === a.locationId) ? 1.5 : 1;
  for (const b of present) {
    b.needs.social = Math.max(0, b.needs.social - 25);
    if (action === 'ritual') {
      b.needs.safety = Math.max(0, b.needs.safety - 25 * chapel);
      if (b.mood === 'afraid' || b.mood === 'grieving' || b.mood === 'anxious') b.mood = 'hopeful';
    }
    touch(tx, b);
    if (b._id !== a._id) await adjustRelationship(tx, b, a, { affinity: 0.04 * chapel, trust: 0.03 * chapel });
  }
  const st = orgState(org);
  const last = st.lastMeetingTick ?? -1000;
  org.state = { ...st, lastMeetingTick: tx.tick };
  await saveOrg(tx, org);
  if (present.length < 2 || tx.tick - last < DAY / 2) return;
  const names = present.slice(0, 4).map((b) => firstName(b.name));
  const ritual: Record<string, string> = {
    cult: org.name + ' lit eleven lamps at ' + locName(a.locationId) + ' and spoke the names of the dead of the Long Dark',
    troupe: org.name + ' rehearsed late at ' + locName(a.locationId) + ', and the canteen stayed to listen',
    breakaway: org.name + ' held its assembly at ' + locName(a.locationId) + ' and voted on everything',
  };
  await emitEvent(tx, {
    category: 'social',
    eventType: action === 'ritual' ? 'org_ritual' : 'org_meeting',
    actorId: a._id,
    participantIds: present.map((b) => b._id),
    locationId: a.locationId,
    summary: (action === 'ritual' && ritual[org.kind] ? ritual[org.kind] : org.name + ' met at ' + locName(a.locationId)) + ' (' + listNames(names) + (present.length > 4 ? ' and others' : '') + ').',
    salience: action === 'ritual' ? 0.42 : 0.33,
    visibility: org.kind === 'gang' ? 'private' : 'local',
  });
}

/** Strength in a clash: members, the leader's grit, an armory or a barricade. */
async function strength(tx: Tx, org: OrgDoc, defending: boolean): Promise<number> {
  const meta = await loadMeta(tx);
  let s = Math.min(org.memberIds.length, 12);
  for (const b of meta.built) {
    if (b.orgId !== org._id) continue;
    if (b.key === 'militia_armory') s *= 1.5;
    if (b.key === 'barricade' && defending) s *= 1.6;
  }
  if (defending && meta.guarded[orgHome(org)] > tx.tick) s *= 1.3;
  const leader = org.leaderId ? await loadAgent(tx, org.leaderId) : null;
  return s * (0.8 + (leader?.traits.stubbornness ?? 0.5) * 0.4) * (0.8 + roll(tx, org.memberIds.length, 'str' + org._id) * 0.4);
}

/** A raid on a rival organization, or the depot when there is none to hit. */
async function raid(tx: Tx, a: AgentDoc, org: OrgDoc): Promise<boolean> {
  if (!['gang', 'militia', 'breakaway'].includes(org.kind)) return false;
  const orgs = await activeOrgs(tx);
  const target = orgs.find((o) => org.rivalIds.includes(o._id) && orgHome(o) === a.locationId) ?? orgs.find((o) => o._id !== org._id && orgHome(o) === a.locationId && (org.kind === 'militia' ? o.kind === 'gang' : o.kind !== 'militia'));
  const meta = await loadMeta(tx);
  if (!target) {
    if (org.kind !== 'gang' || a.locationId !== 'depot') return false;
    const guarded = (meta.guarded.depot ?? 0) > tx.tick;
    const caught = roll(tx, a.seq, 'raidcaught') < (guarded ? 0.6 : 0.2) + a.traits.caution * -0.1;
    act(tx, a, 'stealing', 'Raiding the depot with ' + org.name);
    if (caught) {
      const mind = await loadMind(tx, a);
      if (mind) shiftStatus(tx, mind, -8);
      meta.scandals[a._id] = tx.tick;
      await saveMeta(tx);
      await emitEvent(tx, { category: 'social', eventType: 'raid_foiled', actorId: a._id, locationId: 'depot', summary: a.name + ' was caught leading ' + org.name + ' into the Supply Depot at night' + (guarded ? ', by the militia patrol' : '') + '.', salience: 0.7, visibility: 'public', witnesses: 'location' });
      org.reputation = round2(clamp(org.reputation - 0.2, -1, 1));
      await saveOrg(tx, org);
      return true;
    }
    const st = orgState(org);
    const stores = st.stores ?? { food: 0, water: 0 };
    const food = Math.min(8, Math.floor(stock(tx.world, 'depot', 'food') - 40));
    const water = Math.min(10, Math.floor(stock(tx.world, 'depot', 'water') - 60));
    if (food + water <= 0) return true;
    addStock(tx.world, 'depot', 'food', -Math.max(0, food));
    addStock(tx.world, 'depot', 'water', -Math.max(0, water));
    const sim = await simState(tx);
    sim.missing.food = round2(sim.missing.food + Math.max(0, food));
    sim.missing.water = round2(sim.missing.water + Math.max(0, water));
    org.state = { ...st, stores: { food: stores.food + Math.max(0, food), water: stores.water + Math.max(0, water) } };
    await saveOrg(tx, org);
    await emitEvent(tx, { category: 'social', eventType: 'gang_theft', actorId: a._id, locationId: 'depot', summary: org.name + ', led by ' + a.name + ', carried ' + Math.max(0, food) + ' food and ' + Math.max(0, water) + ' water out of the depot unseen.', salience: 0.45, visibility: 'private' });
    return true;
  }
  const mine = await strength(tx, org, false);
  const theirs = await strength(tx, target, true);
  const won = mine > theirs;
  act(tx, a, won ? 'stealing' : 'fleeing', 'Leading ' + org.name + ' against ' + target.name);
  if (!org.rivalIds.includes(target._id)) org.rivalIds.push(target._id);
  if (!target.rivalIds.includes(org._id)) target.rivalIds.push(org._id);
  let summary: string;
  if (won) {
    const take = round2(target.treasury * 0.4);
    target.treasury = round2(target.treasury - take);
    org.treasury = round2(org.treasury + take);
    summary = a.name + ' led ' + org.name + ' in a raid on ' + target.name + ' at ' + locName(a.locationId) + ' and carried off ' + Math.round(take) + ' credits from their purse.';
  } else {
    a.health = Math.max(5, a.health - 18);
    touch(tx, a);
    summary = a.name + ' led ' + org.name + ' against ' + target.name + ' at ' + locName(a.locationId) + ' and was beaten back, bloodied.';
  }
  await saveOrg(tx, org);
  await saveOrg(tx, target);
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'org_raid', actorId: a._id, participantIds: [target.leaderId, ...target.memberIds.slice(0, 4)].filter((x): x is Id<'agents'> => !!x), locationId: a.locationId, summary, salience: 0.76, visibility: 'public', witnesses: 'location' });
  const victim = target.leaderId ? await loadAgent(tx, target.leaderId) : null;
  if (victim?.alive) {
    await adjustRelationship(tx, victim, a, { affinity: -0.35, trust: -0.3, fear: won ? 0.2 : 0 });
    await enqueueCognition(tx, victim, { kind: 'plan', trigger: org.name + ' raided ' + target.name, priority: 0.7, lane: 'crisis', eventId });
  }
  return true;
}

async function tradeDeal(tx: Tx, a: AgentDoc, org: OrgDoc): Promise<boolean> {
  const orgs = await activeOrgs(tx);
  for (const id of await agentsAt(tx, a.locationId, { exclude: [a._id] })) {
    const other = orgs.find((o) => o._id !== org._id && o.leaderId === id && o.kind !== 'cult');
    if (!other) continue;
    const b = (await loadAgent(tx, id))!;
    const t = await tie(tx, b._id, a._id);
    if ((t?.affinity ?? 0) < -0.3) continue;
    org.treasury = round2(org.treasury + 12);
    other.treasury = round2(other.treasury + 12);
    org.rivalIds = org.rivalIds.filter((x) => x !== other._id);
    other.rivalIds = other.rivalIds.filter((x) => x !== org._id);
    await saveOrg(tx, org);
    await saveOrg(tx, other);
    await adjustRelationship(tx, a, b, { affinity: 0.12, trust: 0.15 });
    await adjustRelationship(tx, b, a, { affinity: 0.12, trust: 0.15 });
    act(tx, a, 'trading', 'Striking a deal with ' + b.name, b._id, 'Shake on it.');
    await emitEvent(tx, { category: 'economy', eventType: 'org_deal', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' of ' + org.name + ' and ' + b.name + ' of ' + other.name + ' shook on a trade deal.', salience: 0.55, visibility: 'public' });
    return true;
  }
  return false;
}

async function expel(tx: Tx, leader: AgentDoc, org: OrgDoc): Promise<boolean> {
  let worst: { a: AgentDoc; affinity: number } | null = null;
  for (const id of org.memberIds) {
    if (id === leader._id) continue;
    const t = await tie(tx, leader._id, id);
    const aff = t?.affinity ?? 0;
    if (aff < -0.15 && (!worst || aff < worst.affinity)) {
      const b = await loadAgent(tx, id);
      if (b?.alive) worst = { a: b, affinity: aff };
    }
  }
  if (!worst) return false;
  const b = worst.a;
  const bm = await loadMind(tx, b);
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'org_expel', actorId: leader._id, participantIds: [b._id], summary: leader.name + ' threw ' + b.name + ' out of ' + org.name + '.', salience: 0.6, visibility: 'public' });
  await removeMember(tx, org, b, bm, eventId);
  if (bm) shiftStatus(tx, bm, -5);
  await adjustRelationship(tx, b, leader, { affinity: -0.35, trust: -0.3 });
  act(tx, leader, 'talking', 'Expelling ' + b.name + ' from ' + org.name, b._id, 'You are not one of us any more.');
  return true;
}

async function declareRules(tx: Tx, a: AgentDoc, mind: MindDoc, org: OrgDoc): Promise<number> {
  const territory = orgHome(org);
  if (a.locationId !== territory) return -1;
  const t = a.traits;
  const v = mind.values;
  const ranked = BREAKAWAY_RULE_KEYS.map((key) => {
    const w: Record<string, number> = { share_all: t.empathy + v.harmony * 0.5, keep_the_ice: v.wealth + t.ambition * 0.5, no_security: v.freedom + t.stubbornness * 0.5, tithe: t.ambition + v.status * 0.5, open_door: t.empathy * 1.2, elect_leader: v.harmony + v.freedom * 0.3 };
    return { key, w: (w[key] ?? 0) + roll(tx, a.seq, 'rule' + key) * 0.4 };
  }).sort((x, y) => y.w - x.w);
  const rules = ranked.slice(0, 3).map((r) => r.key);
  org.rules = rules;
  org.territory = [territory];
  await saveOrg(tx, org);
  act(tx, a, 'talking', 'Declaring the rules of ' + org.name, undefined, 'Hear this: here, we make the rules.');
  shiftStatus(tx, mind, 4);
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'breakaway_rules',
    actorId: a._id,
    participantIds: org.memberIds.slice(0, 8),
    locationId: territory,
    summary: a.name + ' stood on a crate at ' + locName(territory) + ' and declared the rules of ' + org.name + ': ' + rules.map((r) => BREAKAWAY_RULES[r].replace(/\.$/, '').toLowerCase()).join('; ') + '.',
    salience: 0.82,
    causationEventId: orgState(org).foundEventId,
    visibility: 'public',
    witnesses: 'location',
    facts: { orgId: org._id, rules },
  });
  const chairId = tx.world.roles.chair;
  const chair = chairId ? await loadAgent(tx, chairId) : null;
  if (chair?.alive) {
    await learnBelief(tx, chair, { kind: 'custom', worldKey: 'breakaway:' + org._id, text: org.name + ' at ' + locName(territory) + ' no longer answers to the council.', valence: -1, confidence: 0.9, sourceType: 'told', originEventId: eventId });
    await enqueueCognition(tx, chair, { kind: 'plan', trigger: org.name + ' declared its own rules at ' + locName(territory), priority: 0.75, lane: 'crisis', eventId });
  }
  return 3;
}

/** A gang leans on a business at the place it is patrolling: pay up, or something breaks. */
async function racket(tx: Tx, a: AgentDoc, org: OrgDoc): Promise<void> {
  const orgs = await activeOrgs(tx);
  const mark = orgs.find((o) => (o.kind === 'company' || o.kind === 'guild' || o.kind === 'troupe') && orgHome(o) === a.locationId);
  if (!mark) return;
  const st = orgState(mark);
  const day = Math.floor(tx.tick / DAY);
  if (st.lastClashDay === day) return;
  mark.state = { ...st, lastClashDay: day };
  const markLeader = mark.leaderId ? await loadAgent(tx, mark.leaderId) : null;
  const pays = mark.treasury >= 15 && (markLeader?.traits.caution ?? 0.5) > 0.45;
  if (pays) {
    const fee = Math.min(25, round2(mark.treasury * 0.25));
    mark.treasury = round2(mark.treasury - fee);
    org.treasury = round2(org.treasury + fee);
    await saveOrg(tx, mark);
    await saveOrg(tx, org);
    await emitEvent(tx, { category: 'social', eventType: 'protection_racket', actorId: a._id, participantIds: markLeader ? [markLeader._id] : [], locationId: a.locationId, summary: (markLeader?.name ?? mark.name) + ' paid ' + org.name + ' ' + Math.round(fee) + ' credits for "protection" after a quiet word from ' + a.name + '.', salience: 0.55, visibility: 'local' });
    if (markLeader) await adjustRelationship(tx, markLeader, a, { fear: 0.2, affinity: -0.15 });
    return;
  }
  const loc = a.locationId;
  tx.world.damage[loc] = round2(clamp((tx.world.damage[loc] ?? 0) + 0.15, 0, 1));
  await saveOrg(tx, mark);
  if (!mark.rivalIds.includes(org._id)) mark.rivalIds.push(org._id);
  if (!org.rivalIds.includes(mark._id)) org.rivalIds.push(mark._id);
  await saveOrg(tx, mark);
  await saveOrg(tx, org);
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'racket_sabotage', actorId: a._id, participantIds: markLeader ? [markLeader._id] : [], locationId: loc, summary: mark.name + ' refused to pay ' + org.name + ', and by morning the equipment at ' + locName(loc) + ' had been smashed.', salience: 0.72, visibility: 'public' });
  if (markLeader?.alive) {
    await learnBelief(tx, markLeader, { kind: 'saboteur', text: a.name + ' smashed our equipment at ' + locName(loc) + ' for ' + org.name + '.', valence: -1, confidence: 0.7, sourceType: 'inference', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId });
    await enqueueCognition(tx, markLeader, { kind: 'plan', trigger: org.name + ' smashed our equipment', priority: 0.7, lane: 'crisis', eventId });
  }
}

// ---------- the daily round of organizations ----------

/** Dues, wages, feeding members, hiring and firing, splits, rivalries, mergers, collapse and the breakaway question. */
export async function orgsDaily(tx: Tx, people: Map<string, Person>): Promise<void> {
  const orgs = [...(await activeOrgs(tx))];
  const day = Math.floor(tx.tick / DAY);
  for (const org of orgs) {
    if (org.status !== 'active') continue;
    const members = org.memberIds.map((id) => people.get(id)).filter((p): p is Person => !!p);
    org.memberIds = members.map((p) => p.a._id);
    if (org.leaderId && !people.has(org.leaderId)) {
      org.leaderId = undefined;
      if (!(await chooseLeader(tx, org))) continue;
    }
    if (members.length === 0) {
      await disband(tx, org, 'nobody is left in it');
      continue;
    }
    if (members.length === 1 && tx.tick - org.foundedTick > 3 * DAY) {
      await disband(tx, org, 'nobody ever joined ' + members[0].a.name);
      continue;
    }
    const dues = kindDef(org.kind).dues;
    const tithe = org.rules?.includes('tithe');
    for (const p of members) {
      const owed = tithe ? round2(p.a.inv.credits * 0.1) : dues;
      if (owed > 0 && p.a.inv.credits >= owed) {
        p.a.inv.credits = round2(p.a.inv.credits - owed);
        org.treasury = round2(org.treasury + owed);
        touch(tx, p.a);
      }
    }
    await serviceMembers(tx, org, members);
    if (org.kind === 'company') await companyStaffing(tx, org, members, people);
    if (members.length >= 2 && org.officerIds.length < Math.floor(members.length / 4)) {
      const officer = members.filter((p) => p.a._id !== org.leaderId && !org.officerIds.includes(p.a._id)).sort((x, y) => (y.mind.society?.status ?? 0) - (x.mind.society?.status ?? 0))[0];
      if (officer) org.officerIds.push(officer.a._id);
    }
    if (org.rules?.includes('elect_leader')) await election(tx, org, members);
    await maybeSchism(tx, org, members, people);
    await saveOrg(tx, org);
  }
  await clashes(tx, day);
  await councilAndBreakaway(tx, people);
}

async function serviceMembers(tx: Tx, org: OrgDoc, members: Person[]): Promise<void> {
  const st = orgState(org);
  const stores = st.stores ?? { food: 0, water: 0 };
  const share = org.kind === 'guild' || org.kind === 'cult' || org.rules?.includes('share_all') || org.kind === 'gang';
  let fed = 0;
  if (share) {
    if (org.rules?.includes('share_all')) {
      for (const p of members) {
        for (const res of ['food', 'water'] as const) {
          const spare = Math.floor(p.a.inv[res] - 2);
          if (spare > 0) {
            p.a.inv[res] -= spare;
            stores[res] += spare;
            touch(tx, p.a);
          }
        }
      }
    }
    for (const p of members) {
      const res: 'food' | 'water' = p.a.needs.thirst >= p.a.needs.hunger ? 'water' : 'food';
      if (Math.max(p.a.needs.hunger, p.a.needs.thirst) < 55 || p.a.inv[res] >= 1) continue;
      if (stores[res] < 1) {
        const price = tx.world.prices[res];
        if (org.treasury >= price * 2 && stock(tx.world, 'depot', res) > 50) {
          org.treasury = round2(org.treasury - price * 2);
          tx.world.econ.treasury = round2(tx.world.econ.treasury + price * 2);
          addStock(tx.world, 'depot', res, -2);
          stores[res] += 2;
        } else continue;
      }
      const n = Math.min(2, Math.floor(stores[res]));
      stores[res] -= n;
      p.a.inv[res] += n;
      touch(tx, p.a);
      fed += 1;
    }
  }
  if (org.kind === 'company' && org.treasury > 30 + members.length * 4) {
    for (const p of members) {
      p.a.inv.credits = round2(p.a.inv.credits + 4);
      touch(tx, p.a);
    }
    org.treasury = round2(org.treasury - members.length * 4);
  }
  if (org.kind === 'troupe') {
    for (const p of members) if (p.mind.society) p.mind.society.inspiration = round2(Math.min(1, p.mind.society.inspiration + 0.1));
  }
  org.state = { ...st, stores };
  if (fed >= 2) {
    const verb: Record<string, string> = { guild: 'shared its harvest with', cult: 'fed', gang: 'kept fed', breakaway: 'shared out its stores among' };
    await emitEvent(tx, { category: 'economy', eventType: 'org_aid', actorId: org.leaderId, participantIds: members.slice(0, 8).map((p) => p.a._id), summary: org.name + ' ' + (verb[org.kind] ?? 'looked after') + ' ' + fed + ' hungry members.', salience: 0.35, visibility: org.kind === 'gang' ? 'private' : 'public' });
  }
}

async function companyStaffing(tx: Tx, org: OrgDoc, members: Person[], people: Map<string, Person>): Promise<void> {
  const leader = org.leaderId ? people.get(org.leaderId) : undefined;
  if (!leader) return;
  if (org.treasury > 40 + members.length * 12 && members.length < 10) {
    const hire = [...people.values()].filter((p) => p.a.occupation === 'resident' && p.mind.ageBand !== 'child' && p.mind.ageBand !== 'elder' && !org.memberIds.includes(p.a._id)).sort((x, y) => y.a.skill + (y.mind.society?.status ?? 0) - x.a.skill - (x.mind.society?.status ?? 0))[0];
    if (hire) {
      await addMember(tx, org, hire.a, hire.mind);
      hire.a.mood = 'hopeful';
      touch(tx, hire.a);
      await adjustRelationship(tx, hire.a, leader.a, { affinity: 0.15, obligation: 0.1 });
      await emitEvent(tx, { category: 'economy', eventType: 'hired', actorId: leader.a._id, participantIds: [hire.a._id], summary: leader.a.name + ' hired ' + hire.a.name + ' at ' + org.name + ', the first steady work ' + firstName(hire.a.name) + ' has had in a while.', salience: 0.5, visibility: 'public' });
    }
  } else if (org.treasury < 8 && members.length > 2) {
    const fired = members.filter((p) => p.a._id !== org.leaderId).sort((x, y) => x.a.skill - y.a.skill)[0];
    if (fired) {
      const { eventId } = await emitEvent(tx, { category: 'economy', eventType: 'fired', actorId: leader.a._id, participantIds: [fired.a._id], summary: leader.a.name + ' let ' + fired.a.name + ' go from ' + org.name + ': the money has run out.', salience: 0.55, visibility: 'public' });
      await removeMember(tx, org, fired.a, fired.mind, eventId);
      fired.a.mood = 'humiliated';
      touch(tx, fired.a);
      shiftStatus(tx, fired.mind, -4);
      await adjustRelationship(tx, fired.a, leader.a, { affinity: -0.25, trust: -0.2 });
    }
  }
}

async function election(tx: Tx, org: OrgDoc, members: Person[]): Promise<void> {
  const winner = [...members].sort((x, y) => (y.mind.society?.status ?? 0) + y.a.standing - (x.mind.society?.status ?? 0) - x.a.standing)[0];
  if (!winner || winner.a._id === org.leaderId) return;
  const old = org.leaderId;
  org.leaderId = winner.a._id;
  shiftStatus(tx, winner.mind, 5);
  await emitEvent(tx, { category: 'politics', eventType: 'org_election', actorId: winner.a._id, participantIds: old ? [old] : [], summary: 'The assembly of ' + org.name + ' voted ' + winner.a.name + ' its new leader.', salience: 0.6, visibility: 'public' });
}

/** A leader who has lost standing loses half the members to a rival with more of it. */
async function maybeSchism(tx: Tx, org: OrgDoc, members: Person[], people: Map<string, Person>): Promise<void> {
  if (members.length < 5 || !org.leaderId) return;
  const leader = people.get(org.leaderId);
  if (!leader) return;
  const rival = members.filter((p) => p.a._id !== org.leaderId).sort((x, y) => (y.mind.society?.status ?? 0) - (x.mind.society?.status ?? 0))[0];
  if (!rival || (rival.mind.society?.status ?? 0) < (leader.mind.society?.status ?? 0) + 12) return;
  if (roll(tx, rival.a.seq, 'schism') > 0.35) return;
  const followers: Person[] = [];
  for (const p of members) {
    if (p === leader || p === rival) continue;
    const toLeader = (await tie(tx, p.a._id, leader.a._id))?.affinity ?? 0;
    const toRival = (await tie(tx, p.a._id, rival.a._id))?.affinity ?? 0;
    if (toRival > toLeader) followers.push(p);
  }
  if (followers.length < 1) return;
  const name = (org.kind === 'cult' ? 'The True ' : 'The Reformed ') + org.name.replace(/^The /, '');
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'org_schism', actorId: rival.a._id, participantIds: [leader.a._id, ...followers.map((p) => p.a._id)], summary: rival.a.name + ' broke with ' + leader.a.name + ' and led ' + (followers.length + 1) + ' members out of ' + org.name + ' to found ' + name + '.', salience: 0.78, visibility: 'public' });
  const split = await insertOrg(tx, { worldId: tx.world._id, key: org.kind + '-' + tx.tick + '-split', name, kind: org.kind, creed: org.creed, founderId: rival.a._id, leaderId: rival.a._id, officerIds: [], memberIds: [], treasury: round2(org.treasury * 0.3), reputation: org.reputation, status: 'active', foundedTick: tx.tick, territory: undefined, rivalIds: [org._id], state: { home: orgHome(org), foundEventId: eventId } });
  org.treasury = round2(org.treasury * 0.7);
  org.rivalIds.push(split._id);
  for (const p of [rival, ...followers]) {
    await removeMember(tx, org, p.a, p.mind, eventId);
    await addMember(tx, split, p.a, p.mind);
  }
  await adjustRelationship(tx, leader.a, rival.a, { affinity: -0.4, trust: -0.4 });
  shiftStatus(tx, leader.mind, -6);
}

/** One or two clashes or deals between organizations each day: rackets, raids, poaching, deals, mergers. */
async function clashes(tx: Tx, day: number): Promise<void> {
  const orgs = (await activeOrgs(tx)).filter((o) => o.leaderId);
  const r = roll(tx, day, 'clash');
  const gangs = orgs.filter((o) => o.kind === 'gang');
  const militias = orgs.filter((o) => o.kind === 'militia');
  const businesses = orgs.filter((o) => o.kind === 'company' || o.kind === 'guild');
  if (militias.length && gangs.length && r < 0.5) {
    const m = militias[0];
    const g = gangs[0];
    const leader = await loadAgent(tx, m.leaderId!);
    if (leader?.alive) {
      if (!m.rivalIds.includes(g._id)) m.rivalIds.push(g._id);
      if (!g.rivalIds.includes(m._id)) g.rivalIds.push(m._id);
      await saveOrg(tx, m);
      await saveOrg(tx, g);
      await enqueueCognition(tx, leader, { kind: 'plan', trigger: g.name + ' is preying on the colony', priority: 0.55, lane: 'normal' });
    }
  }
  if (gangs.length && businesses.length && r >= 0.3 && r < 0.8) {
    const g = gangs[Math.floor(r * 10) % gangs.length];
    const b = businesses[Math.floor(r * 100) % businesses.length];
    const enforcer = await loadAgent(tx, g.leaderId!);
    if (enforcer?.alive) {
      const was = enforcer.locationId;
      enforcer.locationId = orgHome(b);
      await racket(tx, enforcer, g);
      enforcer.locationId = was;
      touch(tx, enforcer);
    }
  }
  const companies = orgs.filter((o) => o.kind === 'company');
  if (companies.length >= 2 && r > 0.6) {
    const [x, y] = companies[0].treasury >= companies[1].treasury ? [companies[0], companies[1]] : [companies[1], companies[0]];
    const poached = y.memberIds.find((id) => id !== y.leaderId);
    const boss = await loadAgent(tx, x.leaderId!);
    const worker = poached ? await loadAgent(tx, poached) : null;
    const wm = worker ? await loadMind(tx, worker) : null;
    if (boss && worker && wm && x.treasury > 40) {
      const { eventId } = await emitEvent(tx, { category: 'economy', eventType: 'poached', actorId: boss._id, participantIds: [worker._id, y.leaderId!], summary: boss.name + ' lured ' + worker.name + ' away from ' + y.name + ' to ' + x.name + ' with better pay.', salience: 0.55, visibility: 'public' });
      await removeMember(tx, y, worker, wm, eventId);
      await addMember(tx, x, worker, wm);
      if (!y.rivalIds.includes(x._id)) y.rivalIds.push(x._id);
      if (!x.rivalIds.includes(y._id)) x.rivalIds.push(y._id);
      await saveOrg(tx, x);
      await saveOrg(tx, y);
    }
  }
  for (const kind of ['troupe', 'guild', 'party', 'cult']) {
    const small = orgs.filter((o) => o.kind === kind && o.status === 'active' && o.memberIds.length <= 3);
    if (small.length < 2) continue;
    const [x, y] = small;
    const lx = await loadAgent(tx, x.leaderId!);
    const ly = await loadAgent(tx, y.leaderId!);
    if (!lx || !ly) continue;
    const t = await tie(tx, ly._id, lx._id);
    if ((t?.affinity ?? 0) < 0.2) continue;
    const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'org_merger', actorId: lx._id, participantIds: [ly._id], summary: y.name + ' merged into ' + x.name + ', with ' + ly.name + ' as ' + lx.name + "'s second.", salience: 0.6, visibility: 'public' });
    for (const id of [...y.memberIds]) {
      const p = await loadAgent(tx, id);
      const pm = p ? await loadMind(tx, p) : null;
      if (p && pm) await addMember(tx, x, p, pm);
    }
    x.treasury = round2(x.treasury + y.treasury);
    y.treasury = 0;
    x.officerIds.push(ly._id);
    await saveOrg(tx, x);
    await disband(tx, y, 'it merged into ' + x.name, eventId);
  }
}

/** The council and any breakaway: a crackdown when security is strong enough, a humiliation when it is not. */
async function councilAndBreakaway(tx: Tx, people: Map<string, Person>): Promise<void> {
  const breakaway = (await activeOrgs(tx)).find((o) => o.kind === 'breakaway' && o.rules && o.rules.length > 0);
  if (!breakaway) return;
  const provocative = breakaway.rules!.some((r) => r === 'no_security' || r === 'keep_the_ice');
  if (!provocative && roll(tx, 1, 'tolerate') < 0.6) return;
  const officers = [...people.values()].filter((p) => p.a.occupation === 'security');
  const chief = officers.find((p) => p.a.role === 'security_chief') ?? officers[0];
  if (!chief) return;
  const security = officers.length * (0.8 + roll(tx, 2, 'crack') * 0.6);
  const defence = await strength(tx, breakaway, true);
  const where = locName(orgHome(breakaway));
  if (security > defence) {
    const fine = round2(breakaway.treasury * 0.6);
    breakaway.treasury = round2(breakaway.treasury - fine);
    tx.world.econ.treasury = round2(tx.world.econ.treasury + fine);
    breakaway.reputation = round2(clamp(breakaway.reputation - 0.15, -1, 1));
    const { eventId } = await emitEvent(tx, { category: 'politics', eventType: 'crackdown', actorId: chief.a._id, participantIds: breakaway.memberIds.slice(0, 8), locationId: orgHome(breakaway), summary: chief.a.name + ' led security into ' + where + ' and tore down the rules of ' + breakaway.name + '; ' + Math.round(fine) + ' credits were seized for the colony.', salience: 0.8, visibility: 'public' });
    const leaver = breakaway.memberIds.map((id) => people.get(id)).find((p) => p && p.a._id !== breakaway.leaderId && p.a.traits.caution > 0.5);
    if (leaver) await removeMember(tx, breakaway, leaver.a, leaver.mind, eventId);
    const leader = breakaway.leaderId ? people.get(breakaway.leaderId) : undefined;
    if (leader) {
      shiftStatus(tx, leader.mind, -4);
      await adjustRelationship(tx, leader.a, chief.a, { affinity: -0.3, trust: -0.3 });
      await enqueueCognition(tx, leader.a, { kind: 'plan', trigger: 'security broke up ' + breakaway.name, priority: 0.75, lane: 'crisis', eventId });
    }
    breakaway.rules = breakaway.rules!.filter((r) => r !== 'no_security' && r !== 'keep_the_ice');
  } else {
    const leader = breakaway.leaderId ? people.get(breakaway.leaderId) : undefined;
    if (leader) shiftStatus(tx, leader.mind, 4);
    breakaway.reputation = round2(clamp(breakaway.reputation + 0.05, -1, 1));
    const chairId = tx.world.roles.chair;
    const chair = chairId ? people.get(chairId) : undefined;
    if (chair) shiftStatus(tx, chair.mind, -3);
    await emitEvent(tx, { category: 'politics', eventType: 'standoff', actorId: chief.a._id, participantIds: breakaway.memberIds.slice(0, 8), locationId: orgHome(breakaway), summary: chief.a.name + ' and ' + officers.length + ' officers came to the barricade at ' + where + ', faced ' + breakaway.memberIds.length + ' members of ' + breakaway.name + ', and went back without a fight.', salience: 0.75, visibility: 'public' });
  }
  await saveOrg(tx, breakaway);
}

// ---------- hourly: territories ----------

const workersAt = (tx: Tx, loc: string): number => {
  const c = locChar(loc);
  let n = 0;
  for (let seq = 0; seq < tx.rosterLoc.length; seq++) if (tx.rosterLoc[seq] === c && tx.rosterSt[seq] === ROSTER_WORKING) n += 1;
  return n;
};

/** A breakaway that keeps what is produced in its territory takes a share of it from the depot, and turns away security. */
export async function territoriesHourly(tx: Tx): Promise<void> {
  const orgs = await activeOrgs(tx);
  for (const org of orgs) {
    if (org.kind !== 'breakaway' || !org.rules?.length) continue;
    const loc = orgHome(org);
    if (org.rules.includes('keep_the_ice')) {
      const res = loc === 'ice_wells' ? 'water' : loc === 'hydroponics' ? 'food' : null;
      const rate = res === 'water' ? PRODUCTION.water : res === 'food' ? PRODUCTION.food : 0;
      const kept = res ? round2(Math.min(workersAt(tx, loc) * rate * 0.35, stock(tx.world, 'depot', res))) : 0;
      if (res && kept > 0) {
        addStock(tx.world, 'depot', res, -kept);
        const st = orgState(org);
        const stores = st.stores ?? { food: 0, water: 0 };
        stores[res] = round2(stores[res] + kept);
        org.state = { ...st, stores };
        await saveOrg(tx, org);
      }
    }
    if (org.rules.includes('no_security') && tx.tick % 36 === 0) {
      for (const id of await agentsAt(tx, loc)) {
        if (org.memberIds.includes(id)) continue;
        const b = await loadAgent(tx, id);
        if (!b || b.occupation !== 'security') continue;
        const leader = org.leaderId ? await loadAgent(tx, org.leaderId) : null;
        b.needs.safety = Math.min(100, b.needs.safety + 25);
        touch(tx, b);
        if (leader) await adjustRelationship(tx, b, leader, { affinity: -0.15, fear: 0.1 });
        await emitEvent(tx, { category: 'politics', eventType: 'turned_away', actorId: leader?._id, participantIds: [b._id], locationId: loc, summary: 'Members of ' + org.name + ' blocked ' + b.name + ' at ' + locName(loc) + ': "No council security past this line."', salience: 0.6, visibility: 'public' });
        break;
      }
    }
  }
}

export const isUnemployed = unemployed;
export const occupationDef = (id: string) => OCCUPATIONS.find((o) => o.id === id);
