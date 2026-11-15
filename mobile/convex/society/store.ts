/**
 * Storage of the society layer. Per-world bookkeeping lives in one hidden organizations row (kind
 * 'colony', status 'system') so the layer needs no field on the world document; it is read once per
 * transaction and written only when it changes. Organizations are cached per transaction and written
 * through at once. Social status (hidden, 0..100) and the words the player sees for it live here too.
 */
import type { Doc, Id } from '../_generated/dataModel';
import { DISCOVERIES } from '../../shared/society';
import { TICKS_PER_DAY } from '../../shared/colony';
import { clamp, rand, round2 } from '../lib/rng';
import type { ActivityKind } from '../../shared/types';
import { touch, touchMind } from '../engine/core';
import type { AgentDoc, MindDoc, Tx } from '../engine/core';

export type OrgDoc = Doc<'organizations'>;
export type SocietyState = NonNullable<MindDoc['society']>;
export type BuiltEntry = { id: string; key: string; loc: string; ownerId?: string; orgId?: string; subjectId?: string };
export type Pregnancy = { carrierId: string; partnerId: string; dueTick: number; eventId?: string };
export type Missing = { kind: 'pet' | 'child' | 'rover'; id: string; ownerId?: string; sinceTick: number; resolveTick: number; eventId: string };

export type Meta = {
  /** Events up to this world version have been reacted to. */
  seenVersion: number;
  nextEventTick: number;
  recent: { key: string; tick: number }[];
  discovered: string[];
  built: BuiltEntry[];
  pets: string[];
  strays: number;
  pregnancies: Pregnancy[];
  children: string[];
  couples: [string, string][];
  /** Structure id to the person a statue honours. */
  subjects: Record<string, string>;
  missing: Missing[];
  lastFoundTick: number;
  /** The latest big event, which artists make work about. */
  inspiration?: { eventId: string; summary: string; tick: number; kind: string };
  /** Until this tick the colony is frightened: cults recruit more easily. */
  fearUntil: number;
  /** Militia patrols: location to tick until which it is guarded. */
  guarded: Record<string, number>;
  /** Agent id to tick of their last public scandal. */
  scandals: Record<string, number>;
  /** Agents who agreed to raise a child together. */
  wantChild: string[];
  /** Tick of the colony's last marriage proposal: courtship takes time. */
  lastProposalTick: number;
  /** Agent id to tick of their last performance. */
  performed: Record<string, number>;
  lastDailyDay: number;
};

export const META_KEY = '_society';
export const DAY = TICKS_PER_DAY;
/** Ticks from birth to a young adult choosing a career. Accelerated so a child visibly grows up in a demo. */
export const GROW_UP_TICKS = 3 * TICKS_PER_DAY;
/** A newborn stays at home this long. */
export const INFANT_TICKS = Math.round(TICKS_PER_DAY / 2);
export const PREGNANCY_TICKS = Math.round(1.5 * TICKS_PER_DAY);
export const MAX_ACTIVE_ORGS = 16;

const BASICS = DISCOVERIES.filter((x) => x.tier === 0).map((x) => x.key);

function freshMeta(tick: number, version: number): Meta {
  return {
    seenVersion: version,
    nextEventTick: tick + 60,
    recent: [],
    discovered: [...BASICS],
    built: [],
    pets: [],
    strays: 2,
    pregnancies: [],
    children: [],
    couples: [],
    subjects: {},
    missing: [],
    lastFoundTick: -1000,
    fearUntil: 0,
    guarded: {},
    scandals: {},
    wantChild: [],
    lastProposalTick: -1000,
    performed: {},
    lastDailyDay: Math.floor(tick / TICKS_PER_DAY) - 1,
  };
}

type Cache = { metaId?: Id<'organizations'>; meta?: Meta; orgs?: OrgDoc[]; byId: Map<string, OrgDoc>; reacted?: boolean };
const caches = new WeakMap<Tx, Cache>();
export function cacheOf(tx: Tx): Cache {
  let c = caches.get(tx);
  if (!c) {
    c = { byId: new Map() };
    caches.set(tx, c);
  }
  return c;
}

/** The world's society bookkeeping, created on first use. */
export async function loadMeta(tx: Tx): Promise<Meta> {
  const c = cacheOf(tx);
  if (c.meta) return c.meta;
  const row = await tx.ctx.db
    .query('organizations')
    .withIndex('by_world_status', (q) => q.eq('worldId', tx.world._id).eq('status', 'system'))
    .first();
  if (row) {
    c.metaId = row._id;
    c.meta = { ...freshMeta(tx.tick, tx.world.version), ...(row.state as Partial<Meta>) };
    return c.meta;
  }
  c.meta = freshMeta(tx.tick, tx.world.version);
  c.metaId = await tx.ctx.db.insert('organizations', {
    worldId: tx.world._id,
    key: META_KEY,
    name: 'Society bookkeeping',
    kind: 'colony',
    creed: '',
    officerIds: [],
    memberIds: [],
    treasury: 0,
    reputation: 0,
    status: 'system',
    foundedTick: tx.tick,
    rivalIds: [],
    state: c.meta,
  });
  return c.meta;
}

export async function saveMeta(tx: Tx): Promise<void> {
  const c = cacheOf(tx);
  if (!c.meta) return;
  if (!c.metaId) await loadMeta(tx);
  await tx.ctx.db.patch(c.metaId!, { state: c.meta });
}

/** Active organizations as working copies. Save changes with saveOrg. */
export async function activeOrgs(tx: Tx): Promise<OrgDoc[]> {
  const c = cacheOf(tx);
  if (c.orgs) return c.orgs.filter((o) => o.status === 'active');
  const rows = await tx.ctx.db
    .query('organizations')
    .withIndex('by_world_status', (q) => q.eq('worldId', tx.world._id).eq('status', 'active'))
    .collect();
  c.orgs = rows.map((r) => c.byId.get(r._id) ?? (JSON.parse(JSON.stringify(r)) as OrgDoc));
  for (const o of c.orgs) c.byId.set(o._id, o);
  return c.orgs;
}

export async function orgById(tx: Tx, id: string | undefined): Promise<OrgDoc | null> {
  if (!id) return null;
  const c = cacheOf(tx);
  const cached = c.byId.get(id);
  if (cached) return cached;
  const norm = tx.ctx.db.normalizeId('organizations', id);
  if (!norm) return null;
  const row = await tx.ctx.db.get(norm);
  if (!row || row.worldId !== tx.world._id || row.status === 'system') return null;
  const copy = JSON.parse(JSON.stringify(row)) as OrgDoc;
  c.byId.set(id, copy);
  return copy;
}

export async function saveOrg(tx: Tx, org: OrgDoc): Promise<void> {
  const { _id, _creationTime, ...fields } = org;
  await tx.ctx.db.replace(_id, fields);
}

export async function insertOrg(tx: Tx, fields: Omit<OrgDoc, '_id' | '_creationTime'>): Promise<OrgDoc> {
  const id = await tx.ctx.db.insert('organizations', fields);
  const org = { ...fields, _id: id, _creationTime: Date.now() } as OrgDoc;
  const c = cacheOf(tx);
  c.byId.set(id, org);
  if (c.orgs) c.orgs.push(org);
  return org;
}

// ---------- randomness ----------

export const roll = (tx: Tx, entity: number | string, salt: string): number => rand(tx.world.seed, tx.tick, entity, 'soc:' + salt);

export function pickWeighted<T>(items: T[], weight: (t: T) => number, r: number): T | undefined {
  const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0);
  if (total <= 0) return undefined;
  let x = r * total;
  for (const t of items) {
    x -= Math.max(0, weight(t));
    if (x <= 0) return t;
  }
  return items[items.length - 1];
}

// ---------- the society record on a mind ----------

const OCCUPATION_STATUS: Record<string, number> = {
  councilor: 62,
  medic: 55,
  quartermaster: 55,
  researcher: 52,
  security: 46,
  trader: 46,
  fabricator: 40,
  solar_tech: 40,
  hydroponicist: 36,
  cook: 32,
  ice_miner: 32,
  quarry_hand: 26,
  dock_hand: 26,
  hauler: 26,
  resident: 18,
};

/** Where status settles for someone, from job, wealth, fame, reputation, rank and age. */
export function targetStatus(a: AgentDoc, mind: MindDoc, rank = 0): number {
  const s = mind.society;
  const wealth = Math.min(12, Math.log2(1 + Math.max(0, a.inv.credits)) * 1.6);
  const age = mind.ageBand === 'elder' ? 6 : mind.ageBand === 'child' ? -12 : mind.ageBand === 'young' ? -4 : 0;
  return clamp((OCCUPATION_STATUS[a.occupation] ?? 25) + (a.role ? 14 : 0) + wealth + (s?.fame ?? 0) * 25 + clamp(a.standing * 0.8, -12, 12) + rank + age, 0, 100);
}

/** The agent's society record, created from who they are the first time it is needed. */
export function societyOf(tx: Tx, a: AgentDoc, mind: MindDoc): SocietyState {
  if (!mind.society) {
    mind.society = {
      status: round2(targetStatus(a, mind)),
      fame: 0,
      orgIds: [],
      parentIds: [],
      childIds: [],
      jobHistory: [{ occupation: a.occupation, fromTick: Math.min(0, tx.tick) }],
      inspiration: 0,
    };
    touchMind(tx, mind);
  }
  return mind.society;
}

/** Moves hidden status by delta (deeds, scandals, triumphs). */
export function shiftStatus(tx: Tx, mind: MindDoc, delta: number): void {
  if (!mind.society) return;
  mind.society.status = round2(clamp(mind.society.status + delta, 0, 100));
  touchMind(tx, mind);
}

/** How the colony sees someone, in words. Never the number. */
export function standingLabel(status: number, fame: number, o: { ageBand?: string; scandal?: boolean; artist?: boolean } = {}): string {
  if (o.ageBand === 'child') return status >= 40 ? 'a child everyone in the colony knows' : 'a child of the colony';
  if (fame >= 0.6) return o.artist ? 'a famous artist, known to everyone' : 'famous across the colony';
  if (o.scandal) return status < 40 ? 'notorious' : 'respected, though people whisper';
  if (status >= 80) return 'a pillar of the colony';
  if (status >= 65) return 'widely respected';
  if (status >= 50) return 'well regarded';
  if (status >= 35) return o.artist && fame > 0.05 ? 'a striving artist, not yet known' : 'an ordinary colonist';
  if (status >= 20) return 'easily overlooked';
  return 'a nobody, as far as most are concerned';
}

/** Persuasive weight of someone's word: status and skill. 0..1. */
export function clout(mind: MindDoc | null): number {
  const status = mind?.society?.status ?? 30;
  const persuasion = mind?.skills.persuasion ?? 30;
  return clamp(status / 100 * 0.55 + persuasion / 100 * 0.45, 0, 1);
}

/** Sets what the agent is visibly doing. */
export function act(tx: Tx, a: AgentDoc, activity: ActivityKind, label: string, withId?: Id<'agents'>, speech?: string): void {
  a.activity = activity;
  a.activityLabel = label;
  a.interactingWithId = withId;
  a.speech = speech;
  touch(tx, a);
}

export const listNames = (names: string[]): string => (names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
export const sanitize = (text: string, max: number): string => text.replace(/[|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
