/**
 * Storylines: the shared vocabulary of the director, the follow view and the LLM context. A
 * storyline document is seeded (convex/seed) or created by the director; `state` holds director
 * bookkeeping, of which only `kind` (a StoryKind) and `eventTypes` (extra event types that belong
 * to it) are read here. Everything tolerates a missing or foreign state.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { StorylinePublic, StorylineStatus } from '../../shared/types';

export type StorylineDoc = Doc<'storylines'>;
export type StoryKind =
  | 'grudge'
  | 'debt'
  | 'romance'
  | 'secret'
  | 'crime'
  | 'power'
  | 'crisis'
  // the society layer (docs/STORY_SPEC.md 8)
  | 'org'
  | 'family'
  | 'invention'
  | 'art'
  | 'obsession'
  | 'omen';

export const LIVE_STATUSES = ['climax', 'rising', 'brewing'] as const;
export const MAX_BEATS = 12;

/** Live storylines of a world, hottest first. Three small index reads. */
export async function liveStorylines(db: QueryCtx['db'], worldId: Id<'worlds'>): Promise<StorylineDoc[]> {
  const out: StorylineDoc[] = [];
  for (const status of LIVE_STATUSES) {
    out.push(
      ...(await db
        .query('storylines')
        .withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', status))
        .take(20)),
    );
  }
  return out.sort((a, b) => b.tension - a.tension);
}

export const isLive = (s: StorylineDoc): boolean => (LIVE_STATUSES as readonly string[]).includes(s.status);

export function stateOf(s: StorylineDoc): { kind?: StoryKind; eventTypes?: string[] } & Record<string, unknown> {
  return s.state && typeof s.state === 'object' && !Array.isArray(s.state) ? (s.state as Record<string, unknown>) : {};
}

export function toStorylinePublic(s: StorylineDoc): StorylinePublic {
  return {
    id: s._id,
    title: s.title,
    premise: s.premise,
    status: s.status as StorylineStatus,
    tension: Math.round(s.tension * 100) / 100,
    participantIds: s.participantIds,
    beats: s.beats.map((b) => ({ tick: b.tick, text: b.text, eventId: b.eventId })),
    origin: s.origin as StorylinePublic['origin'],
    createdTick: s.createdTick,
    lastBeatTick: s.lastBeatTick,
  };
}

/** One line for an LLM prompt: "Two Ledgers (rising, tension 0.6): premise Latest: beat". */
export function describeStoryline(s: StorylineDoc): string {
  const last = s.beats[s.beats.length - 1];
  return s.title + ' (' + s.status + ', tension ' + s.tension.toFixed(1) + '): ' + s.premise + (last ? ' Latest: ' + last.text : '');
}

// ---------- reading events ----------

const PATTERNS: [StoryKind, RegExp][] = [
  ['obsession', /obsess/],
  ['secret', /secret|confess|eavesdrop|blackmail|confide|expos|affair/],
  ['debt', /borrow|loan|debt|repay|default/],
  ['crime', /robber|extort|loot|vandal|theft|steal|stole|missing|investigat|arrest|smuggl|bribe|sabotag|hoard|stockpil/],
  ['omen', /quake|signal|outbreak|disease|epidemic|reactor|festival|ice_strike|lucky|escaped|random_event/],
  ['family', /birth|born|child|grow_up|grew_up|coming_of_age|propos|marri|wedding|pet_|_pet/],
  ['invention', /discover|invent|experiment|structure|built|construct|research|breakthrough/],
  ['art', /mural|song|poem|sculpt|holo|perform|masterpiece|famous_work|artwork|create_art|play_staged/],
  ['org', /org_|organization|schism|raid|recruit|preach|expel|ritual|breakaway|guild|cult|gang|militia|troupe|company_|turf/],
  ['romance', /court|romance|flirt|love|tryst|kiss/],
  ['power', /council|petition|rally|strike|leadership|faction|seat|ration_cut|ration_change|recall|vote/],
  ['grudge', /threat|accus|smear|lie|fight|duel|feud|insult|suspicion|grudge|gambl|funeral/],
];

/** What kind of story an event belongs to, from its type and category. */
export function kindOfEvent(e: Doc<'events'>): StoryKind | null {
  if (e.category === 'intervention') return 'crisis';
  for (const [kind, re] of PATTERNS) if (re.test(e.eventType)) return kind;
  return null;
}

const HOSTILE = /robber|extort|loot|vandal|duel|turf|insult|threat|accus|smear|lie|fight|feud|insult|suspicion|blackmail|sabotag|theft|steal|arrest|expos|strike|raid|schism|expel/;
const EASING = /reconcil|repay|apolog|forgiv|comfort|gift|friendship|help|treatment/;
/** Events that close a storyline when it is at its climax. */
const CLOSING = /reconcil|repay|confess|arrest|death|leadership_change|council_seat|apolog|forgiv|wedding|marri|fulfil|collaps|disband|built|discover/;

export const isHostile = (e: Doc<'events'>): boolean => HOSTILE.test(e.eventType);
export const isEasing = (e: Doc<'events'>): boolean => EASING.test(e.eventType);
export const isClosing = (e: Doc<'events'>): boolean => CLOSING.test(e.eventType);

/** Everyone an event names: actor first. */
export const involvedIn = (e: Doc<'events'>): Id<'agents'>[] => (e.actorId ? [e.actorId, ...e.participantIds] : [...e.participantIds]);

/** Shortens text at a word boundary. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,;:\s]+$/, '') + '…';
}

export const firstName = (name: string): string => name.split(' ')[0];

/** A proper name an event's facts carry (an organization, a work, a structure), if any. */
export function factName(e: Doc<'events'>): string | undefined {
  const facts = e.facts && typeof e.facts === 'object' ? (e.facts as Record<string, unknown>) : {};
  for (const key of ['orgName', 'organization', 'workTitle', 'title', 'structureName', 'discoveryName', 'petName', 'name']) {
    const value = facts[key];
    if (typeof value === 'string' && value.length > 1 && value.length <= 40) return value;
  }
  return undefined;
}
