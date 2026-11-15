/**
 * The story director (docs/STORY_SPEC.md 4 and 5). Runs once per tick after the agents step, inside
 * the tick's Tx, and stays cheap: a few index reads for the live storylines, one read per event of
 * the tick, and relationship reads only for dramatic events.
 *
 * It attaches the tick's events to storylines (by shared cast, cause chain and kind) and sets their
 * storylineId, moves tension, records beats, advances each storyline brewing -> rising -> climax ->
 * resolved (or fizzled) and the persona arcs of its cast, spots new storylines in patterns of events
 * (a grudge that escalates, a debt turning to threats, a romance across camps, a secret coming out,
 * a crime, a power struggle, a crisis rooted in a god power, and the society layer's organizations,
 * families, inventions, art, obsessions and sudden events), keeps at most MAX_LIVE alive, announces
 * turning points as banners, and hands the followed colonist to the spotlight (spotlight.ts).
 * It never writes outcomes: it emits story events and changes conditions through engine primitives.
 */
import type { Doc } from '../_generated/dataModel';
import { emitEvent, encodeStep, enqueueCognition, heldBeliefs, interrupt, loadAgent, loadMind, touchMind } from '../engine/core';
import { getBelief } from '../engine/social';
import type { AgentDoc, AgentId, EventId, Tx } from '../engine/core';
import { clamp, round2 } from '../lib/rng';
import { announcement, storyProse, who } from './prose';
import { spotlightTick, visitStep } from './spotlight';
import { MAX_BEATS, clip, involvedIn, isClosing, isEasing, isHostile, isLive, kindOfEvent, liveStorylines, stateOf } from './storylines';
import type { StoryKind, StorylineDoc } from './storylines';

/** Most storylines alive at once, so the player can follow them. */
export const MAX_LIVE = 8;
const MAX_CAST = 8;
/** Events below this salience are background and never touch a storyline. */
const MIN_SALIENCE = 0.3;
/** Least salience for an attached event to become a beat, unless it is dramatic in kind. */
const BEAT_SALIENCE = 0.4;
export const RISING_AT = 0.35;
export const CLIMAX_AT = 0.75;
/** A climax with no new beat for this long has played out (6 hours; 12 for a seeded storyline). */
const CLIMAX_BURNOUT = 36;
const SEED_CLIMAX_BURNOUT = 72;
/** A seeded climax lasts at least this long before an event can close it (2 hours). */
const CLIMAX_MIN = 12;
/** Earliest age for a climax: seeded storylines build over the first sols, emergent ones over a few hours. */
const SEED_CLIMAX_AGE = 300;
const EMERGENT_CLIMAX_AGE = 36;
/** Seeded storylines gain tension more slowly, so they build over sols instead of hours. */
const SEED_PACE = 0.6;
/** A storyline with no beat for two days and little tension fizzles; a seeded one not before its fourth sol. */
const FIZZLE_AFTER = 288;
const SEED_FIZZLE_AGE = 576;
/** A live storyline silent this long gets an encounter between two of its leads (3 hours; 6 for emergent ones). */
const STIR_AFTER = 18;
const EMERGENT_STIR_AFTER = 36;
/** Least time between two encounters the director arranges for one storyline (4 hours). */
const STIR_GAP = 24;
/** Hours of silence before tension starts to ebb. */
const EBB_AFTER = 18;
const EBB_PER_HOUR = 0.015;

const ARC_STAGES = ['setup', 'rising', 'crisis', 'climax', 'resolution'];

type Working = {
  doc: StorylineDoc;
  dirty: boolean;
  /** The best candidate beat this tick. */
  beat?: { text: string; eventId: EventId; salience: number };
  /** An event that closes the storyline if it is at its climax. */
  closing?: boolean;
};

export async function directorTick(tx: Tx, firstEvent: number): Promise<void> {
  const ids = tx.eventIds.slice(firstEvent);
  const live: Working[] = (await liveStorylines(tx.ctx.db, tx.world._id)).map((doc) => ({ doc, dirty: false }));
  const events: Doc<'events'>[] = [];
  for (const id of ids) {
    const e = await tx.ctx.db.get(id);
    if (e) events.push(e);
  }
  for (const e of events) {
    if (e.salience >= MIN_SALIENCE && !e.eventType.startsWith('storyline_')) await place(tx, live, e);
  }
  for (const w of live) await advance(tx, w);
  if (tx.tick % 6 === 3) await stir(tx, live);
  for (const w of live) {
    if (!w.dirty) continue;
    const { _id, _creationTime, ...fields } = w.doc;
    await tx.ctx.db.replace(_id, fields);
  }
  const announced: Doc<'events'>[] = [];
  for (const id of tx.eventIds.slice(firstEvent + ids.length)) {
    const e = await tx.ctx.db.get(id);
    if (e) announced.push(e);
  }
  await spotlightTick(
    tx,
    live.filter((w) => isLive(w.doc)).map((w) => w.doc),
    [...events, ...announced],
  );
}

/** The event types and belief kinds a storyline follows: the director's own and the seed's watch list. */
function watchOf(s: StorylineDoc): { types: string[]; beliefKinds: string[] } {
  const state = stateOf(s);
  const watch = (state.watch && typeof state.watch === 'object' ? state.watch : {}) as { eventTypes?: string[]; beliefKinds?: string[] };
  return { types: [...(state.eventTypes ?? []), ...(watch.eventTypes ?? [])], beliefKinds: watch.beliefKinds ?? [] };
}

/** The leads: the first two of the cast and anyone keeping its secret. Only what happens to them can end it. */
function leadsOf(s: StorylineDoc): string[] {
  const holders = stateOf(s).secretHolderIds;
  return [...new Set<string>([...s.participantIds.slice(0, 2), ...(Array.isArray(holders) ? (holders as string[]) : [])])];
}

/** Whether an event is about what the storyline is about: its kind, a watched event type, or a watched secret. */
function onTopic(s: StorylineDoc, e: Doc<'events'>, kind: StoryKind | null): boolean {
  const { types, beliefKinds } = watchOf(s);
  if (types.includes(e.eventType) || (kind && stateOf(s).kind === kind)) return true;
  const facts = e.facts && typeof e.facts === 'object' ? (e.facts as Record<string, unknown>) : {};
  const beliefKey = typeof facts.beliefKey === 'string' ? facts.beliefKey : '';
  return facts.storylineId === s._id || beliefKinds.some((k) => beliefKey.startsWith(k + ':'));
}

/**
 * Attaches an event to the storyline it belongs to, or starts a new one when it fits a pattern. An
 * event belongs to a storyline only through a real link: it follows from one of its beats, someone in
 * its cast does something on its topic, or two of its cast clash. Sharing a face is not enough.
 */
async function place(tx: Tx, live: Working[], e: Doc<'events'>): Promise<void> {
  const kind = kindOfEvent(e);
  const cause = e.causationEventId ? await tx.ctx.db.get(e.causationEventId) : null;
  let best: Working | undefined;
  let bestScore = 0;
  for (const w of live) {
    if (!isLive(w.doc)) continue;
    const s = w.doc;
    const inCast = involvedIn(e).filter((id) => s.participantIds.includes(id)).length;
    const topic = onTopic(s, e, kind);
    const chained = cause?.storylineId === s._id && (inCast > 0 || topic || e.salience >= 0.5);
    if (!chained && !(inCast > 0 && topic) && !(inCast >= 2 && kind && e.salience >= 0.45)) continue;
    const score = (chained ? 3 : 0) + inCast + (topic ? 1 : 0) + (e.actorId && s.participantIds.includes(e.actorId) ? 1 : 0);
    if (score > bestScore) {
      best = w;
      bestScore = score;
    }
  }
  if (best) return await attach(tx, best, e, kind, cause?.storylineId === best.doc._id);
  if (kind) await emerge(tx, live, e, kind, cause);
}

async function attach(tx: Tx, w: Working, e: Doc<'events'>, kind: StoryKind | null, chained = false): Promise<void> {
  const s = w.doc;
  await tx.ctx.db.patch(e._id, { storylineId: s._id });
  const leads = leadsOf(s);
  const lead = involvedIn(e).some((id) => leads.includes(id));
  const weight = (isEasing(e) ? -0.6 : isHostile(e) || e.category === 'intervention' ? 1.4 : kind ? 1 : 0.35) * (lead ? 1 : 0.5) * (s.origin === 'seed' ? SEED_PACE : 1);
  s.tension = round2(clamp(s.tension + e.salience * 0.22 * weight, 0, 1));
  // Someone joins the cast by acting on one of its members, or by acting on a crisis they did not cause, not by being in the same room.
  const joins = e.participantIds.some((id) => s.participantIds.includes(id)) || (chained && stateOf(s).kind === 'crisis');
  if (e.actorId && !s.participantIds.includes(e.actorId) && joins && s.participantIds.length < MAX_CAST) s.participantIds.push(e.actorId);
  if ((e.salience >= BEAT_SALIENCE || kind) && (!w.beat || e.salience > w.beat.salience)) w.beat = { text: clip(e.summary, 180), eventId: e._id, salience: e.salience };
  if (isClosing(e) && (e.eventType === 'death' ? !!e.actorId && leads.includes(e.actorId) : lead)) w.closing = true;
  if (e.eventType === 'death' && e.actorId && s.participantIds.includes(e.actorId)) s.tension = round2(clamp(s.tension + 0.3, 0, 1));
  w.dirty = true;
}

/** Decides whether an unattached event starts a storyline, and of what kind. */
async function patternOf(tx: Tx, e: Doc<'events'>, kind: StoryKind, cause: Doc<'events'> | null): Promise<StoryKind | null> {
  if (kind === 'crisis') return e.salience >= 0.55 ? 'crisis' : null;
  if (cause?.category === 'intervention' && e.salience >= 0.5) return 'crisis';
  const [actorId, otherId] = [e.actorId, e.participantIds.find((id) => id !== e.actorId)];
  if (actorId && otherId) {
    const tie = (from: AgentId, to: AgentId) =>
      tx.ctx.db
        .query('relationships')
        .withIndex('by_from_to', (q) => q.eq('fromAgentId', from).eq('toAgentId', to))
        .first();
    const [there, back] = [await tie(actorId, otherId), await tie(otherId, actorId)];
    if ((isHostile(e) || kind === 'debt') && (await owes(tx, actorId, otherId))) return 'debt';
    if (isHostile(e) && (Math.min(there?.affinity ?? 0, back?.affinity ?? 0) <= -0.35 || e.salience >= 0.65)) {
      return kind === 'crime' || kind === 'secret' || kind === 'org' ? kind : 'grudge';
    }
    if (kind === 'romance') {
      const [a, b] = [await loadAgent(tx, actorId), await loadAgent(tx, otherId)];
      const across = !!a?.factionId && !!b?.factionId && a.factionId !== b.factionId;
      if (across || there?.kind === 'rival' || e.salience >= 0.5) return 'romance';
    }
  }
  if (kind === 'secret' || kind === 'crime') return e.salience >= 0.5 ? kind : null;
  if (kind === 'power') return e.salience >= 0.6 ? kind : null;
  if (kind === 'grudge' || kind === 'debt' || kind === 'romance') return null;
  return e.salience >= 0.55 ? kind : null;
}

/**
 * Whether either of the two has a real debt to the other: the lender's debt belief, which a loan
 * writes and the seed authors. Obligation alone is not a debt, since family and friends carry it too.
 */
async function owes(tx: Tx, a: AgentId, b: AgentId): Promise<boolean> {
  return !!(await getBelief(tx, a, 'debt:' + b)) || !!(await getBelief(tx, b, 'debt:' + a));
}

function keyOf(kind: StoryKind, e: Doc<'events'>): string {
  const pair = involvedIn(e).slice(0, 2).sort().join(':');
  const facts = e.facts && typeof e.facts === 'object' ? (e.facts as Record<string, unknown>) : {};
  switch (kind) {
    case 'crisis':
      return 'crisis:' + e._id;
    case 'crime':
      return 'crime:' + (e.locationId ?? 'colony');
    case 'power':
      return 'power';
    case 'omen':
      return 'omen:' + e.eventType;
    case 'org':
      return 'org:' + String(facts.orgId ?? e.actorId ?? e._id);
    case 'invention':
      return 'invention:' + String(facts.discoveryKey ?? facts.structureKey ?? e.actorId ?? e._id);
    case 'family':
    case 'art':
    case 'obsession':
      return kind + ':' + (e.actorId ?? e._id);
    default:
      return kind + ':' + pair;
  }
}

async function emerge(tx: Tx, live: Working[], e: Doc<'events'>, kind: StoryKind, cause: Doc<'events'> | null): Promise<void> {
  const pattern = await patternOf(tx, e, kind, cause);
  if (!pattern) return;
  const key = keyOf(pattern, e);
  const same = live.find((w) => isLive(w.doc) && w.doc.key === key);
  if (same) return await attach(tx, same, e, pattern);
  const alive = live.filter((w) => isLive(w.doc));
  if (alive.length >= MAX_LIVE) {
    const weakest = alive.filter((w) => w.doc.origin !== 'seed' && w.doc.status === 'brewing').sort((x, y) => x.doc.tension - y.doc.tension)[0];
    if (!weakest || weakest.doc.tension >= e.salience) return;
    weakest.doc.status = 'fizzled';
    weakest.doc.resolvedTick = tx.tick;
    weakest.dirty = true;
  }
  const cast = (pattern === 'crisis' ? involvedIn(e) : involvedIn(e).slice(0, 2)).slice(0, 6);
  const [a, b] = [cast[0] ? await loadAgent(tx, cast[0]) : null, cast[1] ? await loadAgent(tx, cast[1]) : null];
  const prose = storyProse(pattern, e, { a: who(a?.name), b: who(b?.name), sameFaction: !!a?.factionId && a.factionId === b?.factionId });
  const tension = round2(0.2 + e.salience * 0.25);
  const fields = {
    worldId: tx.world._id,
    key,
    title: prose.title,
    premise: prose.premise,
    status: tension >= RISING_AT ? 'rising' : 'brewing',
    tension,
    participantIds: cast,
    beats: [{ tick: tx.tick, text: clip(e.summary, 180), eventId: e._id }],
    origin: pattern === 'crisis' || e.category === 'intervention' || cause?.category === 'intervention' ? 'player' : 'emergent',
    createdTick: tx.tick,
    lastBeatTick: tx.tick,
    state: { kind: pattern },
  };
  const id = await tx.ctx.db.insert('storylines', fields);
  await tx.ctx.db.patch(e._id, { storylineId: id });
  live.push({ doc: { ...fields, _id: id, _creationTime: Date.now() }, dirty: false });
  // The one on the receiving end thinks about it, within the normal budget and cooldown.
  if (b?.alive && e.salience >= 0.6 && b._id !== tx.world.focusAgentId) {
    await enqueueCognition(tx, b, { kind: 'plan', trigger: clip(e.summary, 120), priority: 0.6, lane: 'normal', eventId: e._id });
  }
}

/** Records the tick's beat, lets tension ebb in silence, and moves the storyline's status. */
async function advance(tx: Tx, w: Working): Promise<void> {
  const s = w.doc;
  if (!isLive(s)) return;
  if (w.beat) {
    s.beats = [...s.beats, { tick: tx.tick, text: w.beat.text, eventId: w.beat.eventId }].slice(-MAX_BEATS);
    s.lastBeatTick = tx.tick;
  }
  const silent = tx.tick - s.lastBeatTick;
  if (tx.tick % 6 === 0 && silent >= EBB_AFTER && s.tension > 0) {
    s.tension = round2(Math.max(0, s.tension - EBB_PER_HOUR));
    w.dirty = true;
  }
  const seed = s.origin === 'seed';
  const age = tx.tick - s.createdTick;
  const climaxTick = Number(stateOf(s).climaxTick ?? tx.tick);
  let next = s.status;
  if (s.status === 'climax' && ((w.closing && (!seed || tx.tick - climaxTick >= CLIMAX_MIN)) || silent >= (seed ? SEED_CLIMAX_BURNOUT : CLIMAX_BURNOUT))) next = 'resolved';
  else if (s.status === 'brewing' && s.tension >= RISING_AT) next = 'rising';
  else if (s.status === 'rising' && s.tension >= CLIMAX_AT && age >= (seed ? SEED_CLIMAX_AGE : EMERGENT_CLIMAX_AGE)) next = 'climax';
  else if (s.status !== 'climax' && silent >= FIZZLE_AFTER && s.tension < 0.3 && (!seed || age >= SEED_FIZZLE_AGE)) next = 'fizzled';
  if (next === s.status) return;
  s.status = next;
  if (next === 'climax') s.state = { ...stateOf(s), climaxTick: tx.tick };
  w.dirty = true;
  if (next === 'resolved' || next === 'fizzled') {
    s.resolvedTick = tx.tick;
    s.tension = round2(s.tension * 0.5);
  }
  if (next !== 'fizzled') await announce(tx, w, next);
  await advanceArcs(tx, s, next);
  if (next === 'climax') await thinkAtClimax(tx, s);
}

/** A banner for a turning point: social or politics, salient enough for the wide view at a climax. */
async function announce(tx: Tx, w: Working, status: string): Promise<void> {
  const s = w.doc;
  const last = s.beats[s.beats.length - 1];
  const fresh = w.beat ? last?.text : undefined;
  const [actorId, ...rest] = s.participantIds;
  const { eventId } = await emitEvent(tx, {
    category: stateOf(s).kind === 'power' || stateOf(s).kind === 'org' ? 'politics' : 'social',
    eventType: 'storyline_' + status,
    actorId,
    participantIds: rest.slice(0, 6),
    summary: announcement(s, status, fresh),
    salience: status === 'climax' ? 0.85 : status === 'resolved' ? 0.72 : 0.66,
    causationEventId: last?.eventId,
    visibility: 'public',
    facts: { storylineId: s._id, title: s.title, status },
  });
  await tx.ctx.db.patch(eventId, { storylineId: s._id });
}

/** Moves the persona arcs of the storyline's leads forward, never back. */
async function advanceArcs(tx: Tx, s: StorylineDoc, status: string): Promise<void> {
  const target = status === 'rising' ? (s.tension >= 0.6 ? 'crisis' : 'rising') : status === 'climax' ? 'climax' : status === 'resolved' ? 'resolution' : null;
  if (!target) return;
  const last = s.beats[s.beats.length - 1];
  for (const id of s.participantIds.slice(0, 3)) {
    const agent = await loadAgent(tx, id);
    const mind = agent?.alive ? await loadMind(tx, agent) : null;
    const persona = mind?.persona;
    if (!mind || !persona || ARC_STAGES.indexOf(target) <= ARC_STAGES.indexOf(persona.arc.stage)) continue;
    persona.arc = { stage: target, note: clip(s.title + (last ? ': ' + last.text : ''), 140) };
    touchMind(tx, mind);
  }
}

/** At a climax the leads think it through with the LLM, ahead of everyone else but the followed. */
async function thinkAtClimax(tx: Tx, s: StorylineDoc): Promise<void> {
  const last = s.beats[s.beats.length - 1];
  for (const id of s.participantIds.slice(0, 2)) {
    if (id === tx.world.focusAgentId) continue;
    const agent = await loadAgent(tx, id);
    if (!agent?.alive) continue;
    await enqueueCognition(tx, agent, { kind: 'plan', trigger: s.title + ' comes to a head', detail: last?.text, priority: 0.75, lane: 'crisis', eventId: last?.eventId });
  }
}

/**
 * Brings a quiet storyline back to life (docs/STORY_SPEC.md 4: put an encounter in someone's path):
 * one of its leads goes to find another and does what their secrets and feelings suggest. At most one
 * storyline an hour, hottest first. What happens when they meet is up to the simulation.
 */
async function stir(tx: Tx, live: Working[]): Promise<void> {
  for (const w of live) {
    const s = w.doc;
    if (!isLive(s) || s.participantIds.length < 2) continue;
    const seed = s.origin === 'seed';
    const lastStir = Number(stateOf(s).stirTick ?? -Infinity);
    if (tx.tick - s.lastBeatTick < (seed ? STIR_AFTER : EMERGENT_STIR_AFTER) || tx.tick - lastStir < STIR_GAP || (!seed && s.tension < 0.3)) continue;
    const people: AgentDoc[] = [];
    for (const id of leadsOf(s).concat(s.participantIds)) {
      if (people.some((p) => p._id === id)) continue;
      const p = await loadAgent(tx, id as AgentId);
      if (p?.alive && p.activity !== 'sleeping' && !p.move) people.push(p);
      if (people.length >= 3) break;
    }
    const visitor = people.find((p) => p._id !== tx.world.focusAgentId) ?? people[0];
    const target = people.find((p) => p._id !== visitor?._id);
    if (!visitor || !target) continue;
    const verb = await encounterStep(tx, visitor, target, s);
    interrupt(tx, visitor, visitor.locationId === target.locationId ? [verb] : [encodeStep('go', target.locationId), verb]);
    s.state = { ...stateOf(s), stirTick: tx.tick };
    w.dirty = true;
    return;
  }
}

/** What a lead does on finding another: silence whoever knows their secret, use what they know, or fall back on how they feel. */
async function encounterStep(tx: Tx, visitor: AgentDoc, target: AgentDoc, s: StorylineDoc): Promise<string> {
  const secret = (await loadMind(tx, visitor))?.persona?.secret;
  if (secret && (await getBelief(tx, target._id, secret.kind + ':' + visitor._id))) {
    return visitor.inv.credits >= 25 && visitor.traits.caution > 0.5 ? encodeStep('bribe', target._id, 20, 'silence') : encodeStep('threaten', target._id);
  }
  const held = (await heldBeliefs(tx, visitor._id)).find((b) => b.subjectAgentId === target._id && b.valence < 0 && b.confidence >= 0.5);
  if (held) return visitor.traits.empathy < 0.5 ? encodeStep('blackmail', target._id, held.key) : visitor.traits.stubbornness > 0.55 ? encodeStep('accuse', target._id, held.key) : encodeStep('confide', target._id);
  return await visitStep(tx, visitor, target, s);
}
