/**
 * The working state of one timeskip chapter: the world's Tx, every living colonist with their mind,
 * the society bookkeeping, and a recorder for the beats the chronicle will tell. A chapter loads
 * the world once, plays out a stretch of weeks or months in memory and commits once.
 *
 * Every event written inside a chapter goes through a db that marks it as part of the skip
 * (facts.timeskip, never a banner), so the Chronicle can tell era events from live ones and the app
 * is not flooded with banners when the world resumes.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { GROW_UP_TICKS, loadMeta, saveMeta } from '../society/store';
import type { Meta } from '../society/store';
import { beginTx, commitTx, dayOf, emitEvent, loadMind, replan, touch, wake } from '../engine/core';
import type { AgentDoc, AgentId, EventId, EventInput, MindDoc, Tx } from '../engine/core';
import { clamp, rand } from '../lib/rng';
import { liveStorylines } from '../storyteller/storylines';
import type { TimeskipSpan } from '../../shared/types';
import { TICKS_PER_YEAR, periodOf } from './spans';
import { settleStories, weave } from './stories';

export type Person = { a: AgentDoc; mind: MindDoc };
export type SkipDoc = Doc<'timeskips'>;
export type Beat = SkipDoc['beats'][number];

export type Chapter = {
  tx: Tx;
  skip: SkipDoc;
  span: TimeskipSpan;
  index: number;
  start: number;
  end: number;
  /** Length of the chapter in years. */
  dtY: number;
  /** Every living colonist. Kept current through deaths, births and arrivals. */
  people: Map<string, Person>;
  meta: Meta;
  beats: Beat[];
  stats: Record<string, number>;
  /** Agents an effect already moved this chapter, so the rules do not pile more on them. */
  moved: Set<string>;
  deaths: number;
  deathCap: number;
  /** Key characters and the followed colonist: their beats weigh more. */
  keyIds: Set<string>;
  /** How many of tx.eventIds have been turned into beats. */
  harvested: number;
  /** Live storylines as working copies, written back when the chapter closes. */
  stories: Doc<'storylines'>[];
  dirtyStories: Set<string>;
  /** The world was already in trouble when the chapter began: more deaths are plausible. */
  crisis: boolean;
  llmEnabled: boolean;
};

/** A db that stamps every event inserted during a skip chapter. */
function timeskipCtx(ctx: MutationCtx, skipId: Id<'timeskips'>): MutationCtx {
  const db = new Proxy(ctx.db, {
    get(target, prop) {
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (prop === 'insert') {
        return async (table: string, doc: Record<string, unknown>) => {
          if (table !== 'events') return await (target.insert as (t: string, d: unknown) => Promise<unknown>)(table, doc);
          const facts = doc.facts && typeof doc.facts === 'object' ? { ...(doc.facts as Record<string, unknown>) } : {};
          const storylineId = facts.storylineId as Id<'storylines'> | undefined;
          delete facts.storylineId;
          return await target.insert('events', { ...(doc as Doc<'events'>), banner: false, facts: { ...facts, timeskip: skipId }, ...(storylineId ? { storylineId } : {}) });
        };
      }
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { ...ctx, db } as MutationCtx;
}

/** Opens a chapter: the world as a Tx (LLM queueing off), every living colonist, the society meta. */
export async function openChapter(ctx: MutationCtx, skip: SkipDoc, world: Doc<'worlds'>): Promise<Chapter> {
  const tx = beginTx(timeskipCtx(ctx, skip._id), world);
  const llmEnabled = tx.world.llm.enabled;
  tx.world.llm.enabled = false;
  const rows = await tx.ctx.db
    .query('agents')
    .withIndex('by_world_seq', (q) => q.eq('worldId', world._id))
    .collect();
  const people = new Map<string, Person>();
  for (const row of rows) {
    if (!row.alive) continue;
    const a = JSON.parse(JSON.stringify(row)) as AgentDoc;
    tx.agents.set(a._id, a);
    const mind = await loadMind(tx, a);
    if (mind) people.set(a._id, { a, mind });
  }
  const meta = await loadMeta(tx);
  const start = world.tick;
  const last = skip.chapter >= skip.chapters - 1;
  const end = last ? skip.endTick : Math.min(skip.endTick, start + skip.chapterTicks);
  const dtY = Math.max(1, end - start) / TICKS_PER_YEAR;
  const stories = JSON.parse(JSON.stringify(await liveStorylines(tx.ctx.db, world._id))) as Doc<'storylines'>[];
  const crisis = tx.world.econ.rationLevel >= 2 || tx.world.activeEffects.some((e) => e.type === 'drought' && e.severity >= 0.5);
  return {
    tx,
    skip,
    span: skip.span as TimeskipSpan,
    index: skip.chapter,
    start,
    end,
    dtY,
    people,
    meta,
    beats: [],
    stats: {},
    moved: new Set(),
    deaths: 0,
    deathCap: Math.max(1, Math.round(people.size * 0.05 * dtY * (crisis ? 2.5 : 1) + 0.6)),
    keyIds: new Set([...people.values()].filter((p) => p.mind.persona?.key || p.a._id === skip.focusAgentId).map((p) => p.a._id)),
    harvested: 0,
    stories,
    dirtyStories: new Set(),
    crisis,
    llmEnabled,
  };
}

/**
 * Commits the chapter: the clock moves to its end, children's ages are carried forward, everyone
 * starts the next stretch at home and rested (so the live engine does not bill years of hunger),
 * and the world is written once.
 */
export async function closeChapter(ch: Chapter): Promise<void> {
  const { tx } = ch;
  const ages = new Map<string, number>();
  for (const p of ch.people.values()) {
    if (p.mind.ageBand !== 'child') continue;
    const born = p.mind.society?.bornTick ?? ch.start;
    ages.set(p.a._id, born > ch.start ? (ch.end - born) / TICKS_PER_YEAR : ageOf(ch, p) + ch.dtY);
  }
  tx.tick = ch.end;
  tx.world.tick = ch.end;
  for (const [id, years] of ages) {
    const p = ch.people.get(id);
    if (p && p.mind.ageBand === 'child') setChildAge(ch, p, years);
  }
  for (const p of ch.people.values()) {
    const a = p.a;
    wake(tx, a);
    replan(tx, a);
    a.locationId = a.homeLocationId;
    a.activity = 'idle';
    a.activityLabel = 'Getting their bearings';
    a.needs = { hunger: 30, thirst: 30, fatigue: 30, safety: Math.max(50, a.needs.safety), social: 40 };
    a.needsTick = ch.end;
    a.busyUntilTick = ch.end;
    a.lastLevyDay = dayOf(ch.end);
    a.health = Math.max(a.health, 35);
    touch(tx, a);
  }
  tx.world.llm.enabled = ch.llmEnabled;
  await harvest(ch);
  settleStories(ch);
  for (const s of ch.stories) {
    if (!ch.dirtyStories.has(s._id)) continue;
    const { _id, _creationTime, ...fields } = s;
    await tx.ctx.db.replace(_id, fields);
  }
  await saveMeta(tx);
  await commitTx(tx);
}

// ---------- time inside a chapter ----------

/** Moves the chapter clock on a little, so beats get distinct, ordered era timestamps. */
export function tickOn(ch: Chapter, weight = 1): number {
  const step = Math.max(1, Math.floor((ch.end - ch.start) / 80)) * weight;
  ch.tx.tick = Math.min(ch.end - 1, Math.max(ch.tx.tick, ch.start) + step);
  return ch.tx.tick;
}

// ---------- randomness ----------

/** Uniform in [0, 1), stable for a world, chapter, entity and salt. */
export const roll = (ch: Chapter, entity: number | string, salt: string): number => rand(ch.tx.world.seed, ch.start, entity, 'ts:' + salt);

/** Chance that something with a yearly probability happens within this chapter. */
export const within = (ch: Chapter, perYear: number): number => 1 - Math.pow(1 - clamp(perYear, 0, 0.999), ch.dtY);

export const happens = (ch: Chapter, perYear: number, entity: number | string, salt: string): boolean => roll(ch, entity, salt) < within(ch, perYear);

export function pickOne<T>(items: T[], r: number): T | undefined {
  return items.length ? items[Math.min(items.length - 1, Math.floor(r * items.length))] : undefined;
}

export function weighted<T>(items: T[], weight: (t: T) => number, r: number): T | undefined {
  const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0);
  if (total <= 0) return undefined;
  let x = r * total;
  for (const t of items) {
    x -= Math.max(0, weight(t));
    if (x <= 0) return t;
  }
  return items[items.length - 1];
}

// ---------- ages ----------

/**
 * Age in years. Adults carry a real-time birth tick (minds.society.bornTick, negative for those born
 * before Sol 1). Children keep the live sim's accelerated childhood scale (GROW_UP_TICKS from birth
 * to coming of age), so the live engine grows them up at the right moment after the skip.
 */
export function ageOf(ch: Chapter, p: Person): number {
  const born = p.mind.society?.bornTick;
  if (p.mind.ageBand === 'child') return born === undefined ? 10 : clamp((18 * (ch.start - born)) / GROW_UP_TICKS, 0, 17.99);
  if (born === undefined) return bandAge(p.mind.ageBand);
  return Math.max(16, (ch.tx.tick - born) / TICKS_PER_YEAR);
}

const bandAge = (band: string): number => (band === 'young' ? 24 : band === 'elder' ? 66 : 42);

/** Sets a child's age as of the chapter's end, on the live childhood scale. */
export function setChildAge(ch: Chapter, p: Person, years: number): void {
  if (!p.mind.society) return;
  p.mind.society.bornTick = Math.round(ch.end - (clamp(years, 0, 17.99) / 18) * GROW_UP_TICKS);
  ch.tx.dirtyMinds.add(p.mind._id);
}

export function setAdultAge(ch: Chapter, p: Person, years: number): void {
  if (!p.mind.society) return;
  p.mind.society.bornTick = Math.round(ch.tx.tick - years * TICKS_PER_YEAR);
  ch.tx.dirtyMinds.add(p.mind._id);
}

// ---------- beats ----------

/** Event types worth a line in the closing chronicle, with their beat kind. */
const BEAT_KINDS: Record<string, string> = {
  death: 'death',
  birth: 'birth',
  came_of_age: 'coming_of_age',
  marriage: 'marriage',
  separation: 'separation',
  romance: 'romance',
  affair: 'affair',
  feud: 'feud',
  reconciliation: 'reconciliation',
  violence: 'violence',
  exile: 'exile',
  departure: 'departure',
  arrival: 'arrival',
  secret_exposed: 'secret',
  blackmail: 'secret',
  debt_defaulted: 'debt',
  debt_repaid: 'debt',
  debt_forgiven: 'debt',
  leadership_change: 'leader',
  council_chair: 'leader',
  org_leader: 'org',
  org_founded: 'org',
  org_collapsed: 'org',
  org_schism: 'org',
  org_merger: 'org',
  org_war: 'org',
  breakaway_rules: 'org',
  discovery: 'discovery',
  structure_built: 'structure',
  art_created: 'art',
  fame: 'fame',
  disgrace: 'fame',
  obsession: 'obsession',
  obsession_fulfilled: 'obsession',
  obsession_broken: 'obsession',
  job_change: 'work',
  epidemic: 'disaster',
  accident: 'disaster',
  moonquake: 'disaster',
  shortage: 'economy',
  boom: 'economy',
  ration_change: 'economy',
  storyline_turn: 'storyline',
  conviction: 'belief',
};

/** Turns the chapter's new events into beats: the notable ones, weighted, at most a dozen per chapter. */
export async function harvest(ch: Chapter): Promise<void> {
  const ids = ch.tx.eventIds.slice(ch.harvested);
  ch.harvested = ch.tx.eventIds.length;
  const found: Beat[] = [];
  for (const id of ids) {
    const e = await ch.tx.ctx.db.get(id);
    if (!e) continue;
    const storylineId = weave(ch, e);
    const kind = BEAT_KINDS[e.eventType] ?? (e.salience >= 0.75 ? 'event' : undefined);
    if (!kind) continue;
    const agentIds = [...(e.actorId ? [e.actorId] : []), ...e.participantIds];
    const key = agentIds.some((x) => ch.keyIds.has(x));
    const weight = clamp(e.salience + (key ? 0.15 : 0) + (kind === 'storyline' ? 0.1 : 0), 0, 1);
    if (weight < 0.5 && !key) continue;
    found.push({
      tick: e.tick,
      chapter: ch.index,
      period: periodOf(ch.span, ch.skip.startTick, e.tick),
      kind,
      text: e.summary,
      weight,
      agentIds: [...new Set(agentIds)].slice(0, 6),
      eventId: e._id,
      storylineId,
    });
  }
  const keep = new Set(found.sort((x, y) => y.weight - x.weight).slice(0, 12));
  ch.beats.push(...found.filter((b) => keep.has(b)).sort((x, y) => x.tick - y.tick));
}

/** Emits a chronicle event at the next era moment. */
export async function tell(ch: Chapter, e: EventInput & { storylineId?: Id<'storylines'> }): Promise<EventId> {
  tickOn(ch);
  const { storylineId, ...input } = e;
  const facts = { ...((input.facts as Record<string, unknown>) ?? {}), ...(storylineId ? { storylineId } : {}) };
  const { eventId } = await emitEvent(ch.tx, { ...input, facts, visibility: input.visibility ?? 'public' });
  return eventId;
}

export const count = (ch: Chapter, key: string, n = 1): void => void (ch.stats[key] = (ch.stats[key] ?? 0) + n);

export const living = (ch: Chapter, id: string | undefined): Person | undefined => (id ? ch.people.get(id) : undefined);
export const adults = (ch: Chapter): Person[] => [...ch.people.values()].filter((p) => p.mind.ageBand !== 'child');
export const first = (name: string): string => name.split(' ')[0];
