/**
 * The chronicle of a finished skip. Everything is gathered from the end state and the beats the
 * chapters collected, then told twice: by rules (always, so a skip never ends without a story) and
 * by the LLM when it is configured, whose prose replaces the rule-told parts it got right.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { OCCUPATIONS } from '../../shared/colony';
import type { SpriteId } from '../../shared/colony';
import type { TimeskipBeat, TimeskipPerson, TimeskipSpan, TimeskipSummary } from '../../shared/types';
import { activeOrgs, listNames } from '../society/store';
import { clip, isLive, liveStorylines } from '../storyteller/storylines';
import type { StoryKind } from '../storyteller/storylines';
import { adults, first } from './model';
import type { Beat, Chapter } from './model';
import { SPANS, TICKS_PER_YEAR } from './spans';
import type { StorySeed } from './stories';

// ---------- the snapshot taken when the skip begins ----------

export type SnapPerson = {
  id: string;
  name: string;
  occupation: string;
  role?: string;
  status: number;
  fame: number;
  partnerId?: string;
  orgIds: string[];
  key: boolean;
  followed: boolean;
};
export type Snap = { pop: number; nextSeq: number; chairId?: string; people: SnapPerson[]; orgs: { id: string; name: string; leaderId?: string }[] };

/** Who mattered when the skip began, for the then-and-now contrast of the chronicle. */
export async function snapshot(ch: Chapter): Promise<Snap> {
  const orgs = await activeOrgs(ch.tx);
  const leaders = new Set(orgs.map((o) => o.leaderId));
  const story = new Set(ch.stories.flatMap((s) => s.participantIds.slice(0, 2)));
  const rank = (p: (typeof ch.people extends Map<string, infer P> ? P : never)) =>
    (p.a._id === ch.skip.focusAgentId ? 1000 : 0) + (p.mind.persona?.key ? 200 : 0) + (leaders.has(p.a._id) ? 40 : 0) + (story.has(p.a._id) ? 30 : 0) + (p.a.role ? 20 : 0) + (p.mind.society?.status ?? 30);
  const people = adults(ch)
    .sort((x, y) => rank(y) - rank(x))
    .slice(0, 24)
    .map((p) => ({
      id: p.a._id,
      name: p.a.name,
      occupation: p.a.occupation,
      role: p.a.role,
      status: Math.round(p.mind.society?.status ?? 30),
      fame: p.mind.society?.fame ?? 0,
      partnerId: p.mind.society?.partnerId,
      orgIds: p.mind.society?.orgIds ?? [],
      key: !!p.mind.persona?.key,
      followed: p.a._id === ch.skip.focusAgentId,
    }));
  return { pop: ch.people.size, nextSeq: ch.tx.world.nextSeq, chairId: ch.tx.world.roles.chair, people, orgs: orgs.map((o) => ({ id: o._id, name: o.name, leaderId: o.leaderId })) };
}

// ---------- facts at the end ----------

export type PersonFacts = {
  ref: string;
  id: Id<'agents'>;
  name: string;
  spriteId: SpriteId;
  alive: boolean;
  role: string;
  then?: SnapPerson;
  occupation: string;
  chair: boolean;
  status: number;
  fame: number;
  partner?: string;
  partnerThen?: { name: string; alive: boolean };
  children: string[];
  leads: string[];
  orgs: string[];
  obsession?: string;
  age?: number;
  epithet?: string;
  death?: { cause: string; tick: number };
  beats: Beat[];
  parents: string[];
};

export type Facts = {
  span: TimeskipSpan;
  skip: Doc<'timeskips'>;
  world: Doc<'worlds'>;
  snap: Snap;
  pop: number;
  chairThen?: string;
  chairNow?: string;
  people: PersonFacts[];
  newPeople: PersonFacts[];
  beats: Beat[];
  orgsNow: { name: string; kind: string; leader?: string; members: number; rules?: string[] }[];
  orgsGone: string[];
  tensions: { text: string; seed?: StorySeed }[];
  stories: Doc<'storylines'>[];
};

const occLabel = (id: string) => OCCUPATIONS.find((o) => o.id === id)?.label.toLowerCase() ?? id.replace(/_/g, ' ');
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;

export async function gatherFacts(db: QueryCtx['db'], skip: Doc<'timeskips'>, world: Doc<'worlds'>): Promise<Facts> {
  const snap = (skip.start ?? { pop: 0, nextSeq: world.nextSeq, people: [], orgs: [] }) as Snap;
  const agents = await db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', world._id)).collect();
  const byId = new Map(agents.map((a) => [a._id as string, a]));
  const nameOf = (id: string | undefined) => (id ? byId.get(id)?.name : undefined);
  const snapIds = new Set(snap.people.map((p) => p.id));
  const minds = new Map<string, Doc<'minds'>>();
  for (const a of agents) {
    if (!a.mindId || (!a.alive && !snapIds.has(a._id) && a.seq < snap.nextSeq)) continue;
    const m = await db.get(a.mindId);
    if (m) minds.set(a._id, m);
  }
  const orgs = await db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', world._id).eq('status', 'active')).collect();
  const orgName = new Map(orgs.map((o) => [o._id as string, o.name]));
  for (const o of snap.orgs) if (!orgName.has(o.id)) orgName.set(o.id, o.name);
  const beats = [...skip.beats].sort((x, y) => x.tick - y.tick);
  const beatsOf = (id: string) => beats.filter((b) => b.agentIds[0] === id || (b.agentIds.includes(id as Id<'agents'>) && b.weight >= 0.6)).sort((x, y) => y.weight - x.weight).slice(0, 3);

  let n = 0;
  const facts = (a: Doc<'agents'>, role: string, then?: SnapPerson): PersonFacts => {
    const m = minds.get(a._id);
    const s = m?.society;
    const born = s?.bornTick;
    const partnerThen = then?.partnerId ? byId.get(then.partnerId) : undefined;
    return {
      ref: 'P' + ++n,
      id: a._id,
      name: a.name,
      spriteId: a.spriteId as SpriteId,
      alive: a.alive,
      role,
      then,
      occupation: a.occupation,
      chair: world.roles.chair === a._id,
      status: Math.round(s?.status ?? 30),
      fame: s?.fame ?? 0,
      partner: nameOf(s?.partnerId),
      partnerThen: partnerThen ? { name: partnerThen.name, alive: partnerThen.alive } : undefined,
      children: (s?.childIds ?? []).map((id) => byId.get(id)).filter((c): c is Doc<'agents'> => !!c && c.seq >= snap.nextSeq).map((c) => c.name),
      leads: orgs.filter((o) => o.leaderId === a._id).map((o) => o.name),
      orgs: (s?.orgIds ?? []).map((id) => orgName.get(id)).filter((x): x is string => !!x),
      obsession: s?.obsession?.text,
      age: m?.ageBand === 'child' ? (born === undefined ? undefined : -1) : born !== undefined ? Math.round((world.tick - born) / TICKS_PER_YEAR) : undefined,
      epithet: m?.persona?.epithet,
      death: m?.death,
      beats: beatsOf(a._id),
      parents: (s?.parentIds ?? []).map((id) => nameOf(id)).filter((x): x is string => !!x),
    };
  };

  const people: PersonFacts[] = [];
  for (const sp of snap.people) {
    const a = byId.get(sp.id);
    if (!a) continue;
    const m = minds.get(a._id);
    const status = m?.society?.status ?? sp.status;
    const role = sp.followed ? 'followed' : !a.alive ? 'gone' : status - sp.status >= 12 || (m?.society?.fame ?? 0) - sp.fame >= 0.25 ? 'risen' : sp.status - status >= 12 ? 'fallen' : sp.key ? 'key' : 'key';
    const f = facts(a, role, sp);
    const notable = sp.followed || sp.key || !a.alive || role === 'risen' || role === 'fallen' || f.beats.some((b) => b.weight >= 0.7) || f.chair;
    if (notable) people.push(f);
  }
  for (const a of agents) {
    if (!a.alive || snapIds.has(a._id) || a.seq >= snap.nextSeq) continue;
    const m = minds.get(a._id);
    if ((m?.society?.status ?? 0) >= 62 || (m?.society?.fame ?? 0) >= 0.4 || world.roles.chair === a._id) people.push(facts(a, 'risen'));
  }
  const newPeople = agents
    .filter((a) => a.seq >= snap.nextSeq)
    .map((a) => ({ a, w: (a.alive ? 1 : 0) + beatsOf(a._id).reduce((s, b) => s + b.weight, 0) + (minds.get(a._id)?.ageBand === 'child' ? 0 : 0.5) }))
    .sort((x, y) => y.w - x.w)
    .slice(0, 6)
    .map(({ a }) => facts(a, minds.get(a._id)?.society?.parentIds.length ? 'born' : 'newcomer'));

  const orgsNow = orgs.map((o) => ({ name: o.name, kind: o.kind, leader: nameOf(o.leaderId), members: o.memberIds.length, rules: o.rules }));
  const orgsGone = snap.orgs.filter((o) => !orgs.some((x) => x._id === o.id)).map((o) => o.name);
  const stories = (await liveStorylines(db, world._id)).filter(isLive);

  const tensions: Facts['tensions'] = [];
  for (const s of stories.slice(0, 2)) tensions.push({ text: s.title + ': ' + clip(s.premise, 160) });
  const alive = (id: string) => byId.get(id)?.alive;
  const feuds = beats.filter((b) => b.kind === 'feud' && b.agentIds.length >= 2 && b.agentIds.slice(0, 2).every(alive));
  const feud = feuds[feuds.length - 1];
  if (feud) {
    const [x, y] = feud.agentIds.map((id) => nameOf(id)!);
    tensions.push({ text: x + ' and ' + y + ' are still enemies, and the colony is too small for them to avoid each other forever.', seed: { kind: 'grudge', title: 'Bad Blood', premise: 'Years of enmity between ' + x + ' and ' + y + ' have not cooled; sooner or later one of them will act on it.', participantIds: feud.agentIds.slice(0, 2), beat: { text: feud.text, eventId: feud.eventId, tick: feud.tick } } });
  }
  for (const [id, m] of minds) {
    const a = byId.get(id);
    const sec = m.persona?.secret;
    if (!a?.alive || !sec || sec.exposedAtTick !== undefined || sec.kind !== 'affair') continue;
    tensions.push({ text: a.name + ' is still hiding an affair, and every year it gets harder to hide.', seed: { kind: 'secret', title: 'What ' + first(a.name) + ' Hides', premise: a.name + ' has a secret: ' + clip(sec.text, 120) + ' Someone is bound to find out.', participantIds: [a._id] } });
    break;
  }
  const breakaway = orgs.find((o) => o.kind === 'breakaway');
  if (breakaway) tensions.push({ text: breakaway.name + ' still governs itself, and the council has not forgiven it.', seed: { kind: 'org', title: 'The ' + breakaway.name.replace(/^The /, '') + ' Question', premise: breakaway.name + ', led by ' + (nameOf(breakaway.leaderId) ?? 'its founders') + ', answers to no council. Shackleton cannot stay divided forever.', participantIds: [breakaway.leaderId, breakaway.memberIds.find((x) => x !== breakaway.leaderId)].filter((x): x is Id<'agents'> => !!x) } });
  const obsessed = [...minds.entries()].find(([id, m]) => alive(id) && m.society?.obsession && m.ageBand !== 'child');
  if (obsessed) {
    const [id, m] = obsessed;
    tensions.push({ text: nameOf(id) + ' is still consumed by ' + m.society!.obsession!.text + '.', seed: { kind: 'obsession', title: first(nameOf(id)!) + "'s Obsession", premise: nameOf(id) + ' has given everything to ' + m.society!.obsession!.text + ', and it is not finished with them yet.', participantIds: [id as Id<'agents'>] } });
  }
  if (world.econ.rationLevel > 0) tensions.push({ text: 'The ration is still cut, and patience in the queues is wearing thin.' });

  return { span: skip.span as TimeskipSpan, skip, world, snap, pop: world.population.alive, chairThen: nameOf(snap.chairId), chairNow: nameOf(world.roles.chair), people: people.slice(0, 14), newPeople, beats, orgsNow, orgsGone, tensions: tensions.slice(0, 5), stories };
}

// ---------- the rule-told chronicle ----------

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const num = (n: number) => (n < WORDS.length ? WORDS[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** "Year 2" becomes "the second year"; "Sol 12" stays a date. */
function when(period: string): string {
  const m = period.match(/^(Year|Month|Week) (\d+)$/);
  if (!m) return 'on ' + period;
  const i = Number(m[2]) - 1;
  return 'in the ' + (ORDINALS[i] ?? m[2] + 'th') + ' ' + m[1].toLowerCase();
}

/** Lets a sentence follow a lead-in: "A fever..." becomes "a fever...", names stay capitalized. */
function lower(text: string): string {
  return /^(A|An|The|For|What|Behind|Rust|It|There)\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** The headline beats: the strongest few of each period, oldest first. */
export function headlineBeats(beats: Beat[], perPeriod: number, max: number): Beat[] {
  const periods = new Map<string, Beat[]>();
  for (const b of beats) periods.set(b.period, [...(periods.get(b.period) ?? []), b]);
  const out: Beat[] = [];
  for (const list of periods.values()) {
    const kinds = new Set<string>();
    const picked: Beat[] = [];
    for (const b of [...list].sort((x, y) => y.weight - x.weight)) {
      if (picked.length >= perPeriod) break;
      if (kinds.has(b.kind) && list.some((o) => !picked.includes(o) && !kinds.has(o.kind) && o.weight >= 0.55)) continue;
      kinds.add(b.kind);
      picked.push(b);
    }
    out.push(...picked);
  }
  return out.sort((x, y) => x.tick - y.tick).slice(0, max);
}

function personText(p: PersonFacts): string {
  const name = first(p.name);
  if (!p.alive) {
    const end = p.beats.find((b) => b.agentIds[0] === p.id && ['death', 'departure', 'exile'].includes(b.kind));
    if (end) return end.text + (p.then && p.then.status >= 55 ? ' The colony felt the gap.' : '');
    return p.name + ' is gone' + (p.death ? ': ' + p.death.cause + '.' : '.');
  }
  const bits: string[] = [];
  const then = p.then;
  if (p.chair && then?.role !== 'chair') bits.push(then ? 'Once ' + article(occLabel(then.occupation)) + ', ' + name + ' now chairs the colony council.' : name + ' now chairs the colony council.');
  else if (then && then.occupation !== p.occupation) bits.push('Once ' + article(occLabel(then.occupation)) + ', ' + name + ' is ' + article(occLabel(p.occupation)) + ' now.');
  if (p.partner && (!then || then.partnerId === undefined)) bits.push((bits.length ? 'They married ' : name + ' married ') + p.partner + (p.children.length ? ', and ' + (p.children.length === 1 ? 'a child, ' + first(p.children[0]) + ', followed.' : num(p.children.length) + ' children followed.') : '.'));
  else if (!p.partner && p.partnerThen) bits.push(p.partnerThen.alive ? name + ' and ' + first(p.partnerThen.name) + ' are no longer together.' : name + ' outlived ' + first(p.partnerThen.name) + '.');
  else if (p.children.length) bits.push(p.children.length === 1 ? name + ' has a child born in these years, ' + first(p.children[0]) + '.' : name + ' has ' + num(p.children.length) + ' children born in these years: ' + listNames(p.children.map(first)) + '.');
  if (p.leads.length) bits.push(name + ' leads ' + listNames(p.leads) + '.');
  if (then && p.status - then.status >= 12 && bits.length < 3) bits.push(name + ' stands far higher than before; people stop to listen now.');
  if (then && then.status - p.status >= 12 && bits.length < 3) bits.push('The years were not kind to ' + name + "'s name.");
  if (p.obsession && bits.length < 3) bits.push('Still obsessed with ' + p.obsession + '.');
  const beat = p.beats.find((b) => b.agentIds[0] === p.id);
  if (beat && bits.length < 2) bits.unshift(beat.text);
  if (!bits.length) bits.push(p.epithet ? name + ' is still ' + p.epithet.replace(/^(the|a|an) /i, (m) => m.toLowerCase()) + ', and little changed for them.' : name + ' kept their head down and came through it unchanged.');
  return bits.slice(0, 3).join(' ');
}

function newPersonText(p: PersonFacts): string {
  const beat = p.beats.find((b) => b.agentIds[0] === p.id && b.kind !== 'birth' && b.kind !== 'arrival');
  if (p.role === 'born') {
    const parents = p.parents.length ? 'child of ' + listNames(p.parents.map(first)) : 'born in the colony';
    const grown = p.age !== undefined && p.age >= 0;
    return p.name + ', ' + parents + (grown ? ', grown now, works as ' + article(occLabel(p.occupation)) + '.' : ', is still a child of the domes.') + (beat ? ' ' + beat.text : '') + (p.alive ? '' : ' Gone too soon.');
  }
  return p.name + (p.epithet ? ', ' + p.epithet + ',' : '') + ' came up on a shuttle and stayed' + (p.alive ? ' to work as ' + article(occLabel(p.occupation)) + '.' : ', but not for long.') + (beat ? ' ' + beat.text : '');
}

export function rulesSummary(f: Facts): TimeskipSummary {
  const def = SPANS[f.span];
  const st = f.skip.stats;
  const s = (k: string) => st[k] ?? 0;
  const narrative: string[] = [];
  const open = [cap(def.label) + ' passed over Shackleton.'];
  const born = s('born');
  const died = s('died');
  if (born || died) open.push((born ? cap(num(born)) + (born === 1 ? ' child was' : ' children were') + ' born under the domes' : 'No child was born') + (died ? ', and ' + num(died) + (died === 1 ? ' colonist was' : ' colonists were') + ' laid to rest beyond the airlock.' : ', and nobody was buried.'));
  const arrived = s('arrived');
  const left = s('departed') + s('exiled');
  if (arrived || left) open.push((arrived ? 'Shuttles brought ' + num(arrived) + (arrived === 1 ? ' stranger' : ' strangers') + (left ? '; ' + num(left) + ' others left for good.' : '.') : cap(num(left)) + (left === 1 ? ' colonist' : ' colonists') + ' left and did not come back.'));
  if (f.snap.pop && f.snap.pop !== f.pop) open.push('The colony that had numbered ' + f.snap.pop + ' now numbers ' + f.pop + '.');
  if (f.chairNow && f.chairNow !== f.chairThen) open.push(f.chairThen ? 'The council chair passed from ' + f.chairThen + ' to ' + f.chairNow + '.' : f.chairNow + ' sits in the council chair.');
  narrative.push(open.join(' '));

  const head = headlineBeats(f.beats, 2, 24);
  const byPeriod = new Map<string, Beat[]>();
  for (const b of head) byPeriod.set(b.period, [...(byPeriod.get(b.period) ?? []), b]);
  const periods = [...byPeriod.entries()];
  const chunk = Math.max(1, Math.ceil(periods.length / 3));
  for (let i = 0; i < periods.length; i += chunk) {
    const sentences: string[] = [];
    for (const [period, list] of periods.slice(i, i + chunk)) {
      list.forEach((b, j) => sentences.push(j === 0 && periods.length > 1 ? cap(when(period)) + ', ' + lower(b.text) : b.text));
    }
    if (sentences.length) narrative.push(sentences.join(' '));
  }
  const followed = f.people.find((p) => p.role === 'followed');
  if (followed) narrative.push('And ' + first(followed.name) + ', whose life you had been following? ' + personText(followed));
  const close = f.tensions.slice(0, 2).map((t) => t.text);
  narrative.push(['Now the clock runs again.', ...close].join(' '));

  const breakaway = f.orgsNow.find((o) => o.kind === 'breakaway');
  const title = breakaway ? 'The ' + breakaway.name.replace(/^The /, '') + ' Years' : f.chairNow && f.chairNow !== f.chairThen ? cap(def.label) + ' under ' + f.chairNow : died > born ? cap(def.label) + ' of Burials' : born >= 3 ? cap(def.label) + ' of Cradles' : cap(def.label) + ' in Shackleton';

  return {
    title,
    narrative,
    beats: headlineBeats(f.beats, f.span === 'decade' || f.span === 'five_years' ? 3 : 4, 30).map(toPublicBeat),
    followed: followed ? toPerson(followed, personText(followed)) : undefined,
    people: f.people.filter((p) => p !== followed).map((p) => toPerson(p, personText(p))),
    newPeople: f.newPeople.map((p) => toPerson(p, newPersonText(p))),
    tensions: f.tensions.map((t) => t.text),
    storylineIds: [],
    source: 'rules',
  };
}

const toPublicBeat = (b: Beat): TimeskipBeat => ({ tick: b.tick, period: b.period, text: b.text, agentIds: b.agentIds, kind: b.kind, eventId: b.eventId });
const toPerson = (p: PersonFacts, text: string): TimeskipPerson => ({ agentId: p.id, name: p.name, spriteId: p.spriteId, alive: p.alive, text, role: p.role });

// ---------- the LLM-told chronicle ----------

export function summaryPrompt(f: Facts): { system: string; user: string; maxTokens: number } {
  const def = SPANS[f.span];
  const st = f.skip.stats;
  const personLine = (p: PersonFacts) => {
    const then = p.then;
    const bits = [
      p.ref + ' ' + p.name + (p.epithet ? ' (' + p.epithet + ')' : '') + ' [' + p.role + ']',
      p.alive ? 'alive' + (p.age !== undefined ? (p.age < 0 ? ', a child' : ', ' + p.age) : '') : 'GONE: ' + (p.death?.cause ?? 'left'),
      then ? 'then: ' + occLabel(then.occupation) + (then.role ? ' (' + then.role + ')' : '') + ', standing ' + then.status + (p.partnerThen ? ', with ' + p.partnerThen.name : '') : undefined,
      'now: ' + occLabel(p.occupation) + (p.chair ? ' (council chair)' : '') + ', standing ' + p.status + (p.partner ? ', with ' + p.partner : '') + (p.leads.length ? ', leads ' + p.leads.join(' and ') : ''),
      p.children.length ? 'children born: ' + p.children.join(', ') : undefined,
      p.parents.length && !then ? 'parents: ' + p.parents.join(' and ') : undefined,
      p.obsession ? 'obsessed with ' + p.obsession : undefined,
      p.beats.length ? 'moments: ' + p.beats.map((b) => b.period + ' ' + b.text).join(' / ') : undefined,
    ];
    return bits.filter(Boolean).join('; ');
  };
  const system = [
    'You write the epilogue chapter of a novel about Shackleton, a small lunar colony. The reader skipped ahead ' + def.label + ' and now learns what happened, the way a novel tells the years between two parts: through people, their choices and what it cost them. Never a report, never statistics or lists of numbers.',
    'Write in the past tense, warm and specific, with the dry restraint of a good literary novel. Use full names on first mention and first names after. Only tell what the facts below support; you may add small human detail but no new major events.',
    'Return JSON with: title (3 to 7 words, evocative), narrative (3 to 6 paragraphs, 50 to 140 words each, in time order, the last one about what is unfinished as the clock starts again), people (for each person ref listed under People: 1 or 2 sentences on where they are now or how they ended), newPeople (same, for refs under New faces), tensions (2 to 4 one-sentence threads the world resumes with), storylines (1 to 3 new storylines the resumed world should follow: kind one of grudge, romance, secret, power, org, family, obsession, crime; a short title; a one-sentence premise; cast as 1 to 3 person refs).',
  ].join('\n');
  const user = [
    'Skip: ' + def.label + '. Population then ' + f.snap.pop + ', now ' + f.pop + '. Born ' + (st.born ?? 0) + ', died ' + (st.died ?? 0) + ', arrived ' + (st.arrived ?? 0) + ', left ' + ((st.departed ?? 0) + (st.exiled ?? 0)) + '.',
    'Council chair then: ' + (f.chairThen ?? 'nobody') + '; now: ' + (f.chairNow ?? 'nobody') + '.',
    'Organizations now: ' + (f.orgsNow.map((o) => o.name + ' (' + o.kind + ', ' + o.members + ', led by ' + (o.leader ?? 'nobody') + ')').join('; ') || 'none') + (f.orgsGone.length ? '. Gone: ' + f.orgsGone.join(', ') : '') + '.',
    '',
    'What happened, in order:',
    ...headlineBeats(f.beats, 5, 70).map((b) => b.period + ': ' + b.text),
    '',
    'People:',
    ...f.people.map(personLine),
    '',
    'New faces:',
    ...(f.newPeople.length ? f.newPeople.map(personLine) : ['none']),
    '',
    'Unfinished:',
    ...(f.tensions.length ? f.tensions.map((t) => t.text) : ['nothing pressing']),
  ].join('\n');
  return { system, user, maxTokens: 2600 };
}

const SEED_KINDS: StoryKind[] = ['grudge', 'romance', 'secret', 'power', 'org', 'family', 'obsession', 'crime'];
const text = (x: unknown, max: number): string | undefined => (typeof x === 'string' && x.trim().length >= 2 ? clip(x.replace(/\s+/g, ' ').trim(), max) : undefined);

/** Lays the LLM's prose over the rule-told chronicle. Anything missing or malformed keeps the rules' version. */
export function mergeLlm(rules: TimeskipSummary, f: Facts, raw: string): { summary: TimeskipSummary; seeds: StorySeed[] } | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const narrative = Array.isArray(j.narrative) ? j.narrative.map((p) => text(p, 1400)).filter((p): p is string => !!p).slice(0, 6) : [];
  if (narrative.length < 2) return null;
  const byRef = new Map([...f.people, ...f.newPeople].map((p) => [p.ref, p]));
  const texts = new Map<string, string>();
  for (const list of [j.people, j.newPeople]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const r = item as Record<string, unknown>;
      const p = typeof r.ref === 'string' ? byRef.get(r.ref.trim().toUpperCase()) : undefined;
      const t = text(r.text, 400);
      if (p && t) texts.set(p.id, t);
    }
  }
  const retell = (p: TimeskipPerson): TimeskipPerson => ({ ...p, text: texts.get(p.agentId) ?? p.text });
  const tensions = Array.isArray(j.tensions) ? j.tensions.map((t) => text(t, 240)).filter((t): t is string => !!t).slice(0, 5) : [];
  const seeds: StorySeed[] = [];
  if (Array.isArray(j.storylines)) {
    for (const item of j.storylines.slice(0, 3)) {
      const r = item as Record<string, unknown>;
      const kind = SEED_KINDS.find((k) => k === r.kind);
      const title = text(r.title, 60);
      const premise = text(r.premise, 240);
      const cast = (Array.isArray(r.cast) ? r.cast : []).map((x) => (typeof x === 'string' ? byRef.get(x.trim().toUpperCase()) : undefined)).filter((p): p is PersonFacts => !!p && p.alive).map((p) => p.id);
      if (kind && title && premise && cast.length) seeds.push({ kind, title, premise, participantIds: [...new Set(cast)].slice(0, 3) });
    }
  }
  return {
    summary: {
      ...rules,
      title: text(j.title, 60) ?? rules.title,
      narrative,
      followed: rules.followed ? retell(rules.followed) : undefined,
      people: rules.people.map(retell),
      newPeople: rules.newPeople.map(retell),
      tensions: tensions.length >= 1 ? tensions : rules.tensions,
      source: 'llm',
    },
    seeds,
  };
}

export const SUMMARY_SCHEMA = {
  name: 'timeskip_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'narrative', 'people', 'newPeople', 'tensions', 'storylines'],
    properties: {
      title: { type: 'string' },
      narrative: { type: 'array', items: { type: 'string' } },
      people: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'text'], properties: { ref: { type: 'string' }, text: { type: 'string' } } } },
      newPeople: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'text'], properties: { ref: { type: 'string' }, text: { type: 'string' } } } },
      tensions: { type: 'array', items: { type: 'string' } },
      storylines: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['kind', 'title', 'premise', 'cast'], properties: { kind: { type: 'string', enum: SEED_KINDS }, title: { type: 'string' }, premise: { type: 'string' }, cast: { type: 'array', items: { type: 'string' } } } },
      },
    },
  },
};

