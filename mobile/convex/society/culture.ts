/**
 * Arts and culture. Artists make works whose quality comes from skill, mood and inspiration, about
 * what they have lived through (a death, a storm, a wedding, a discovery, the Long Dark); they perform
 * to whoever is there, moving moods and beliefs and growing their fame. Famous and striving artists,
 * envy between them, patrons, and works organizations adopt as their symbols.
 */
import type { Doc, Id } from '../_generated/dataModel';
import { ART_KINDS } from '../../shared/society';
import { clamp, pick, round2 } from '../lib/rng';
import { firstName, locName } from '../engine/conditions';
import { adjustRelationship, agentsAt, emitEvent, learnBelief, loadAgent, loadMind, touch, touchMind } from '../engine/core';
import type { AgentDoc, EventId, MindDoc, Tx } from '../engine/core';
import { bonusFor } from './craft';
import { fulfil } from './obsession';
import { orgState, orgsOf } from './orgs';
import { DAY, act, listNames, loadMeta, roll, saveMeta, saveOrg, shiftStatus, societyOf } from './store';

type WorkDoc = Doc<'works'>;
export const isArtist = (mind: MindDoc | null | undefined): boolean => (mind?.skills.art ?? 0) >= 30;

export async function createArtStart(tx: Tx, a: AgentDoc, kind: string): Promise<number> {
  const meta = await loadMeta(tx);
  const def = ART_KINDS.find((k) => k.key === kind && (!k.requires || meta.discovered.includes(k.requires)));
  if (!def) return -1;
  act(tx, a, 'resting', (def.key === 'mural' ? 'Painting a mural' : def.key === 'sculpture' ? 'Carving a sculpture' : 'Working on a ' + def.label) + ' at ' + locName(a.locationId));
  return def.key === 'play' || def.key === 'mural' ? 9 : 6;
}

type Theme = { title: string; about: string; eventId?: EventId };

/** What the work is about: the strongest thing the artist lived through lately, or an old theme. */
async function themeFor(tx: Tx, a: AgentDoc, mind: MindDoc, kind: string): Promise<Theme> {
  const memories = await tx.ctx.db.query('memories').withIndex('by_agent_tick', (q) => q.eq('agentId', a._id).gte('tick', tx.tick - 2 * DAY)).order('desc').take(20);
  const strongest = memories.filter((m) => m.salience >= 0.6).sort((x, y) => y.salience - x.salience).slice(0, 3);
  const meta = await loadMeta(tx);
  const candidates: Doc<'events'>[] = [];
  for (const m of strongest) {
    const e = await tx.ctx.db.get(m.eventId);
    if (e && !['obsession', 'art_created', 'performance'].includes(e.eventType)) candidates.push(e);
  }
  if (meta.inspiration && tx.tick - meta.inspiration.tick < 2 * DAY && candidates.length === 0) {
    const e = await tx.ctx.db.get(meta.inspiration.eventId as Id<'events'>);
    if (e) candidates.push(e);
  }
  const e = candidates[0];
  const r = roll(tx, a.seq, 'title');
  const k = kind;
  if (e) {
    const who = e.actorId ? await loadAgent(tx, e.actorId) : null;
    const name = who ? firstName(who.name) : 'them';
    const place = e.locationId ? locName(e.locationId) : 'the colony';
    const t: Record<string, string[]> = {
      death: ['Requiem for ' + name, 'The Last Shift of ' + name, name + ', Remembered', 'An Empty Bunk'],
      storm: ['The Storm over ' + place, 'Iron Rain', 'Run for the Airlock'],
      drought: ['Dry Wells', 'The Thirst', 'Last Water'],
      discovery: ['Ode to ' + (e.facts && typeof e.facts === 'object' && 'discovery' in e.facts ? String((e.facts as { discovery: string }).discovery).replace(/_/g, ' ') : 'the new thing'), 'Eureka at ' + place],
      marriage: ['Song for ' + name, 'Two Lamps in ' + place],
      birth: ['Lullaby for a New Colonist', 'First Breath'],
      org_raid: ['The Night They Came', 'Blood at ' + place],
      breakaway_rules: ['The Crate Speech', 'Free Ground'],
      org_founded: ['Hymn of the Founding', 'A New Banner'],
      theft: ['Empty Shelves', 'The Thief at ' + place],
      arrest: ['The Accused', 'Cuffs at Dawn'],
      moonquake: ['When the Ground Moved', 'Cracks'],
      festival_day: ['Festival Night', 'The Colony Dances'],
      strange_signal: ['The Voice under the Crater', 'Signal'],
      reactor_scare: ['Not Again', 'The Alarm'],
    };
    const titles = t[e.eventType] ?? ['What Happened at ' + place, 'The Day of ' + cap(e.eventType.replace(/_/g, ' '))];
    return { title: pick(titles, r), about: 'A ' + k + ' about this: ' + e.summary, eventId: e._id };
  }
  const partner = mind.society?.partnerId ? await loadAgent(tx, mind.society.partnerId) : null;
  const themes: Theme[] = [
    { title: 'The Long Dark', about: 'A ' + k + ' about the winter the reactor failed and eleven people died.' },
    { title: 'Eleven Lamps', about: 'A ' + k + ' for the eleven dead of the Long Dark.' },
    { title: locName(a.workLocationId ?? a.homeLocationId) + ' at Dawn', about: 'A ' + k + ' about ordinary work and the light on the rim.' },
    { title: 'Letters to Earth', about: 'A ' + k + ' about the families left behind on Earth.' },
    { title: 'Dust and Starlight', about: 'A ' + k + ' about living under a dome.' },
  ];
  if (partner) themes.push({ title: 'For ' + firstName(partner.name), about: 'A ' + k + ' of love for ' + partner.name + '.' });
  return pick(themes, r);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export async function createArtDone(tx: Tx, a: AgentDoc, kind: string): Promise<void> {
  const mind = await loadMind(tx, a);
  const def = ART_KINDS.find((k) => k.key === kind);
  if (!mind || !def) return;
  const s = societyOf(tx, a, mind);
  const meta = await loadMeta(tx);
  const art = mind.skills.art ?? 5;
  const strong = ['grieving', 'euphoric', 'angry', 'despairing', 'proud', 'restless'].includes(a.mood) ? 0.08 : a.mood === 'exhausted' ? -0.1 : 0;
  const obsessed = s.obsession?.kind === 'masterpiece' ? 0.1 : 0;
  const quality = round2(clamp(0.08 + (art / 100) * 0.55 + s.inspiration * 0.2 + strong + obsessed + bonusFor(meta, 'art') * 0.5 + (roll(tx, a.seq, 'quality') - 0.5) * 0.3, 0.05, 1));
  const theme = await themeFor(tx, a, mind, def.label);
  const earlier = await tx.ctx.db.query('works').withIndex('by_creator', (q) => q.eq('creatorId', a._id)).take(30);
  const taken = earlier.filter((w) => w.title === theme.title || w.title.startsWith(theme.title + ' (')).length;
  if (taken > 0) theme.title = theme.title + ' (' + ['second', 'third', 'fourth', 'fifth'][Math.min(3, taken - 1)] + ' version)';
  const fame = round2(quality * quality * 0.25 * (1 + bonusFor(meta, 'fame')));
  const workId = await tx.ctx.db.insert('works', { worldId: tx.world._id, creatorId: a._id, title: theme.title, kind: def.key, about: theme.about, quality, fame, locationId: def.performable ? undefined : a.locationId, createdTick: tx.tick, inspiredByEventId: theme.eventId });
  mind.skills.art = round2(Math.min(100, art + 1.5));
  s.inspiration = 0;
  s.fame = round2(Math.max(s.fame, fame * 0.8));
  touchMind(tx, mind);
  shiftStatus(tx, mind, quality * 3);
  const masterpiece = quality >= 0.85;
  const verdict = masterpiece ? ' People are calling it a masterpiece.' : quality < 0.3 ? ' It is not good, and ' + firstName(a.name) + ' knows it.' : '';
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'art_created',
    actorId: a._id,
    locationId: a.locationId,
    summary: a.name + ' ' + def.verb + ' "' + theme.title + '", a ' + def.label + (def.performable ? '' : ' at ' + locName(a.locationId)) + '.' + verdict,
    salience: round2(0.35 + quality * 0.45),
    causationEventId: theme.eventId,
    visibility: masterpiece ? 'public' : 'local',
    witnesses: 'location',
    facts: { workId, quality },
  });
  if (masterpiece) {
    shiftStatus(tx, mind, 5);
    await fulfil(tx, a, mind, 'masterpiece', undefined, eventId);
  }
  if (quality >= 0.6) await adoptAsSymbol(tx, a, mind, workId, theme.title);
}

/** An organization the artist belongs to takes a strong work as its symbol. */
async function adoptAsSymbol(tx: Tx, a: AgentDoc, mind: MindDoc, workId: Id<'works'>, title: string): Promise<void> {
  const org = (await orgsOf(tx, mind)).find((o) => !orgState(o).symbolWorkId && ['cult', 'troupe', 'breakaway', 'party', 'militia', 'guild'].includes(o.kind));
  if (!org) return;
  org.state = { ...orgState(org), symbolWorkId: workId };
  org.reputation = round2(clamp(org.reputation + 0.05, -1, 1));
  await saveOrg(tx, org);
  await emitEvent(tx, { category: 'social', eventType: 'symbol_adopted', actorId: a._id, summary: org.name + ' has taken "' + title + '" by ' + a.name + ' as its own; members know it by heart.', salience: 0.5, visibility: 'public' });
}

export function performStart(tx: Tx, a: AgentDoc, ticks: number): number {
  act(tx, a, 'talking', 'Performing at ' + locName(a.locationId), undefined, pick(['This one is for all of you.', 'Listen.', 'A new one tonight.'], roll(tx, a.seq, 'perfline')));
  return clamp(ticks, 2, 6);
}

export async function performDone(tx: Tx, a: AgentDoc): Promise<void> {
  const mind = await loadMind(tx, a);
  if (!mind) return;
  const s = societyOf(tx, a, mind);
  const meta = await loadMeta(tx);
  const works = await tx.ctx.db.query('works').withIndex('by_creator', (q) => q.eq('creatorId', a._id)).take(20);
  const performable = new Set(ART_KINDS.filter((k) => k.performable).map((k) => k.key));
  const work: WorkDoc | undefined = works.filter((w) => performable.has(w.kind)).sort((x, y) => y.quality + y.fame - x.quality - x.fame)[0];
  const quality = work?.quality ?? clamp((mind.skills.art ?? 10) / 140, 0.05, 0.6);
  const audience: AgentDoc[] = [];
  for (const id of (await agentsAt(tx, a.locationId, { exclude: [a._id] })).slice(0, 10)) {
    const b = await loadAgent(tx, id);
    if (b) audience.push(b);
  }
  if (audience.length === 0) return;
  meta.performed[a._id] = tx.tick;
  await saveMeta(tx);
  const stage = meta.built.some((b) => b.key === 'theatre_stage' && b.loc === a.locationId);
  const gain = audience.length * quality * 0.015 * (1 + bonusFor(meta, 'perform', a.locationId) + bonusFor(meta, 'fame'));
  const moved: AgentDoc[] = [];
  const envious: AgentDoc[] = [];
  let patron: AgentDoc | null = null;
  for (const b of audience) {
    b.needs.social = Math.max(0, b.needs.social - 20);
    b.needs.safety = Math.max(0, b.needs.safety - 8 * quality);
    const bm = await loadMind(tx, b);
    if (quality >= 0.5 && roll(tx, b.seq, 'moved') < quality) {
      moved.push(b);
      if (b.mood === 'calm' || b.mood === 'anxious' || b.mood === 'lonely' || b.mood === 'content') b.mood = 'hopeful';
      await adjustRelationship(tx, b, a, { affinity: 0.05 * quality, trust: 0.02 });
      if (work?.inspiredByEventId) await learnBelief(tx, b, { kind: 'custom', worldKey: 'work:' + work._id, text: a.name + "'s " + work.kind + ' "' + work.title + '" will not leave me: ' + work.about.replace(/^A \w+ about (this: )?/, ''), valence: 0, confidence: round2(0.3 + quality * 0.4), sourceType: 'observed', originEventId: work.inspiredByEventId });
    }
    if (bm && isArtist(bm) && bm.society && Math.abs(bm.society.fame - s.fame) < 0.2 && bm.society.fame < s.fame + gain) {
      envious.push(b);
      await adjustRelationship(tx, b, a, { affinity: -0.1 });
      bm.society.inspiration = round2(Math.min(1, bm.society.inspiration + 0.2));
      touchMind(tx, bm);
    } else if (!patron && bm && b.inv.credits > 150 && bm.values.status > 0.5 && quality >= 0.45) patron = b;
    touch(tx, b);
  }
  const before = s.fame;
  if (work) await tx.ctx.db.patch(work._id, { fame: round2(Math.min(1, work.fame + gain)) });
  s.fame = round2(Math.min(1, Math.max(s.fame, (work?.fame ?? 0) + gain) + gain * 0.3));
  touchMind(tx, mind);
  shiftStatus(tx, mind, audience.length * quality * 0.3);
  if (patron) {
    const gift = Math.min(30, Math.round(patron.inv.credits * 0.08));
    patron.inv.credits = round2(patron.inv.credits - gift);
    a.inv.credits = round2(a.inv.credits + gift);
    touch(tx, patron);
    touch(tx, a);
    await adjustRelationship(tx, a, patron, { affinity: 0.1, obligation: 0.15 });
  }
  if (audience.length < 3 && !patron) return;
  const title = work ? '"' + work.title + '"' : 'something new';
  const extra: string[] = [];
  if (moved.length) extra.push(listNames(moved.slice(0, 2).map((b) => firstName(b.name))) + (moved.length > 2 ? ' and others were' : moved.length === 1 ? ' was' : ' were') + ' visibly moved');
  if (envious.length) extra.push(firstName(envious[0].name) + ', a rival artist, watched with a face like thunder');
  if (patron) extra.push(patron.name + ' pressed credits into ' + firstName(a.name) + "'s hand afterwards");
  await emitEvent(tx, {
    category: 'social',
    eventType: 'performance',
    actorId: a._id,
    participantIds: [...moved, ...envious].map((b) => b._id),
    locationId: a.locationId,
    summary: a.name + ' performed ' + title + ' for ' + audience.length + ' people at ' + locName(a.locationId) + (stage ? ' on the new stage' : '') + (extra.length ? '; ' + extra.join('; ') : '') + '.',
    salience: round2(0.38 + s.fame * 0.3 + (moved.length >= 3 ? 0.08 : 0)),
    causationEventId: work?.inspiredByEventId,
    visibility: 'public',
  });
  if (before < 0.6 && s.fame >= 0.6) {
    await emitEvent(tx, { category: 'social', eventType: 'fame', actorId: a._id, summary: 'Everyone in the colony knows the name ' + a.name + ' now: ' + title + ' is sung in the tubes.', salience: 0.7, visibility: 'public' });
  }
}

/** Once a day: old works fade from memory, patrons adopt striving artists, the two most famous become rivals. */
export async function cultureDaily(tx: Tx, people: Map<string, { a: AgentDoc; mind: MindDoc }>): Promise<void> {
  const top = await tx.ctx.db.query('works').withIndex('by_world_fame', (q) => q.eq('worldId', tx.world._id)).order('desc').take(30);
  for (const w of top) if (w.fame > 0.02 && tx.tick - w.createdTick > DAY) await tx.ctx.db.patch(w._id, { fame: round2(w.fame * 0.97) });
  const artists = [...people.values()].filter((p) => isArtist(p.mind)).sort((x, y) => (y.mind.society?.fame ?? 0) - (x.mind.society?.fame ?? 0));
  for (const p of artists) if (p.mind.society) p.mind.society.fame = round2(p.mind.society.fame * 0.985);
  const [first, second] = artists;
  if (first && second && (second.mind.society?.fame ?? 0) >= 0.25 && roll(tx, first.a.seq, 'rivalry') < 0.3) {
    const t = await tx.ctx.db.query('relationships').withIndex('by_from_to', (q) => q.eq('fromAgentId', second.a._id).eq('toAgentId', first.a._id)).first();
    if (!t || t.kind !== 'rival') {
      await adjustRelationship(tx, second.a, first.a, { affinity: -0.35, kind: 'rival' });
      await adjustRelationship(tx, first.a, second.a, { affinity: -0.15 });
      second.mind.society!.inspiration = round2(Math.min(1, second.mind.society!.inspiration + 0.4));
      touchMind(tx, second.mind);
      await emitEvent(tx, { category: 'social', eventType: 'artistic_rivalry', actorId: second.a._id, participantIds: [first.a._id], summary: second.a.name + ' told the canteen that ' + first.a.name + "'s work is hollow; the colony's two best-known artists are now open rivals.", salience: 0.58, visibility: 'public' });
    }
  }
  const striving = artists.filter((p) => (p.mind.society?.fame ?? 0) < 0.25 && (p.mind.skills.art ?? 0) >= 35);
  const rich = [...people.values()].filter((p) => p.a.inv.credits > 200 && p.mind.values.status > 0.55 && !isArtist(p.mind)).sort((x, y) => y.a.inv.credits - x.a.inv.credits)[0];
  if (rich && striving.length && roll(tx, rich.a.seq, 'patron') < 0.35) {
    const artist = striving[Math.floor(roll(tx, rich.a.seq, 'patronwho') * striving.length)];
    const stipend = 25;
    rich.a.inv.credits = round2(rich.a.inv.credits - stipend);
    artist.a.inv.credits = round2(artist.a.inv.credits + stipend);
    touch(tx, rich.a);
    touch(tx, artist.a);
    artist.mind.society!.inspiration = round2(Math.min(1, artist.mind.society!.inspiration + 0.3));
    touchMind(tx, artist.mind);
    shiftStatus(tx, rich.mind, 2);
    await adjustRelationship(tx, artist.a, rich.a, { affinity: 0.2, obligation: 0.3 });
    await emitEvent(tx, { category: 'social', eventType: 'patronage', actorId: rich.a._id, participantIds: [artist.a._id], summary: rich.a.name + ' has become the patron of ' + artist.a.name + ', a striving ' + (artist.mind.skills.art! >= 50 ? 'painter' : 'singer') + ' nobody has heard of yet.', salience: 0.5, visibility: 'public' });
  }
}
