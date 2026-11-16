/**
 * Storylines through a timeskip. The live director does not run during a skip, so each chapter
 * threads its own events into the live storylines (by explicit storyline id, or by kind and cast),
 * moves their tension and status, and lets the ones nothing happened to fade. When the skip ends,
 * a few new storylines are seeded from what the years left unfinished.
 */
import type { Doc, Id } from '../_generated/dataModel';
import { clamp, round2 } from '../lib/rng';
import { CLIMAX_AT, MAX_LIVE, RISING_AT } from '../storyteller/director';
import { MAX_BEATS, clip, involvedIn, isClosing, isEasing, isHostile, isLive, kindOfEvent, stateOf } from '../storyteller/storylines';
import type { StoryKind } from '../storyteller/storylines';
import type { Chapter } from './model';
import { TICKS_PER_YEAR } from './spans';

const ENDS_A_LIFE = new Set(['death', 'departure', 'exile']);

/** Threads one event into a live storyline. Returns the storyline it joined, if any. */
export function weave(ch: Chapter, e: Doc<'events'>): Id<'storylines'> | undefined {
  const cast = involvedIn(e);
  let s = e.storylineId ? ch.stories.find((x) => x._id === e.storylineId) : undefined;
  if (!s && ENDS_A_LIFE.has(e.eventType) && e.actorId) s = ch.stories.find((x) => isLive(x) && x.participantIds.includes(e.actorId!));
  if (!s && e.salience >= 0.45) {
    const kind = kindOfEvent(e);
    if (kind) s = ch.stories.find((x) => isLive(x) && stateOf(x).kind === kind && cast.some((id) => x.participantIds.includes(id)));
  }
  if (!s || !isLive(s)) return undefined;
  s.beats = [...s.beats, { tick: e.tick, text: clip(e.summary, 180), eventId: e._id }].slice(-MAX_BEATS);
  s.lastBeatTick = e.tick;
  const delta = isEasing(e) ? -0.12 : isHostile(e) ? 0.18 : 0.06 + e.salience * 0.1;
  s.tension = round2(clamp(s.tension + delta, 0, 1));
  const lostLead = ENDS_A_LIFE.has(e.eventType) && !!e.actorId && s.participantIds.slice(0, 2).includes(e.actorId);
  if ((s.status === 'climax' && isClosing(e)) || lostLead) end(ch, s, 'resolved', e.tick);
  else if (s.status === 'brewing' && s.tension >= RISING_AT) s.status = 'rising';
  else if (s.status === 'rising' && s.tension >= CLIMAX_AT) s.status = 'climax';
  ch.dirtyStories.add(s._id);
  return s._id;
}

function end(ch: Chapter, s: Doc<'storylines'>, status: 'resolved' | 'fizzled', tick: number): void {
  s.status = status;
  s.resolvedTick = tick;
  ch.dirtyStories.add(s._id);
}

/** At a chapter's close: storylines nothing happened to cool, and long-silent ones end. */
export function settleStories(ch: Chapter): void {
  for (const s of ch.stories) {
    if (!isLive(s) || s.lastBeatTick >= ch.start) continue;
    s.tension = round2(Math.max(0, s.tension - 0.3 * ch.dtY));
    ch.dirtyStories.add(s._id);
    const silent = ch.end - s.lastBeatTick;
    if (s.tension < 0.12 || silent >= TICKS_PER_YEAR * 0.6) end(ch, s, s.status === 'climax' ? 'resolved' : 'fizzled', ch.end);
  }
}

export type StorySeed = { kind: StoryKind; title: string; premise: string; participantIds: Id<'agents'>[]; beat?: { text: string; eventId?: Id<'events'>; tick: number } };

/**
 * Writes the storylines the world resumes with: still-live ones are kept current so the director
 * does not fizzle them for the skipped silence, and up to three new ones are inserted, making room
 * by fizzling the weakest emergent storyline when the live cap is reached.
 */
export async function seedStorylines(db: Chapter['tx']['ctx']['db'], worldId: Id<'worlds'>, skipId: Id<'timeskips'>, endTick: number, live: Doc<'storylines'>[], seeds: StorySeed[]): Promise<Id<'storylines'>[]> {
  for (const s of live) if (isLive(s)) await db.patch(s._id, { lastBeatTick: endTick });
  const ids: Id<'storylines'>[] = [];
  let alive = live.filter(isLive);
  for (const [i, seed] of seeds.slice(0, 3).entries()) {
    if (alive.length >= MAX_LIVE) {
      const weakest = alive.filter((s) => s.origin !== 'seed').sort((x, y) => x.tension - y.tension)[0];
      if (!weakest) break;
      await db.patch(weakest._id, { status: 'fizzled', resolvedTick: endTick });
      alive = alive.filter((s) => s !== weakest);
    }
    const tension = 0.45;
    const id = await db.insert('storylines', {
      worldId,
      key: 'timeskip:' + skipId + ':' + i,
      title: clip(seed.title, 60),
      premise: clip(seed.premise, 240),
      status: 'rising',
      tension,
      participantIds: seed.participantIds.slice(0, 6),
      beats: seed.beat ? [{ tick: seed.beat.tick, text: clip(seed.beat.text, 180), eventId: seed.beat.eventId }] : [],
      origin: 'emergent',
      createdTick: endTick,
      lastBeatTick: endTick,
      state: { kind: seed.kind, timeskip: skipId },
    });
    ids.push(id);
  }
  return ids;
}
