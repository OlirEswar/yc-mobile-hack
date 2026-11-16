/**
 * The LLM's part in a chapter: a compact picture of the colony (the people who matter, their wants,
 * flaws, secrets and ties, the organizations and the live storylines) and a request for a handful of
 * effects that follow from it. Ids travel as short refs (P3, O1, S2) to keep prompts small; the
 * reply is mapped back to ids here and validated against the real state in the chapter mutation.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { OCCUPATIONS } from '../../shared/colony';
import type { TimeskipSpan } from '../../shared/types';
import { describeStoryline, liveStorylines } from '../storyteller/storylines';
import { EFFECT_GUIDE, EFFECT_TYPES } from './effects';
import { SPANS, TICKS_PER_YEAR, periodOf, spanWords } from './spans';

export type ChapterPrompt = { system: string; user: string; refs: Record<string, string>; maxTokens: number };

const PEOPLE_IN_PROMPT = 36;
const occLabel = (id: string) => OCCUPATIONS.find((o) => o.id === id)?.label.toLowerCase() ?? id;

type Row = { a: Doc<'agents'>; m: Doc<'minds'> };

/** How much a person matters to the story right now, for choosing who the prompt describes. */
function weight(r: Row, keyIds: Set<string>, leaders: Set<string>): number {
  const s = r.m.society;
  return (keyIds.has(r.a._id) ? 100 : 0) + (leaders.has(r.a._id) ? 20 : 0) + (r.a.role ? 15 : 0) + (s?.status ?? 30) / 3 + (s?.fame ?? 0) * 30 + (s?.obsession ? 8 : 0) + (r.m.persona?.secret && r.m.persona.secret.exposedAtTick === undefined ? 6 : 0) + (r.m.ageBand === 'child' ? -40 : 0);
}

export async function chapterPrompt(ctx: QueryCtx, skip: Doc<'timeskips'>, world: Doc<'worlds'>): Promise<ChapterPrompt> {
  const span = skip.span as TimeskipSpan;
  const agents = (await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', world._id)).collect()).filter((a) => a.alive);
  const rows: Row[] = [];
  for (const a of agents) {
    const m = a.mindId ? await ctx.db.get(a.mindId) : null;
    if (m) rows.push({ a, m });
  }
  const orgs = (await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', world._id).eq('status', 'active')).collect()).slice(0, 10);
  const stories = (await liveStorylines(ctx.db, world._id)).slice(0, 8);
  const keyIds = new Set<string>([...rows.filter((r) => r.m.persona?.key).map((r) => r.a._id), ...(skip.focusAgentId ? [skip.focusAgentId] : []), ...stories.flatMap((s) => s.participantIds.slice(0, 2))]);
  const leaders = new Set(orgs.map((o) => o.leaderId).filter((x): x is Id<'agents'> => !!x));
  const chosen = rows.sort((x, y) => weight(y, keyIds, leaders) - weight(x, keyIds, leaders)).slice(0, PEOPLE_IN_PROMPT);

  const refs: Record<string, string> = {};
  const refOf = new Map<string, string>();
  chosen.forEach((r, i) => {
    refs['P' + (i + 1)] = r.a._id;
    refOf.set(r.a._id, 'P' + (i + 1));
  });
  orgs.forEach((o, i) => {
    refs['O' + (i + 1)] = o._id;
    refOf.set(o._id, 'O' + (i + 1));
  });
  stories.forEach((s, i) => {
    refs['S' + (i + 1)] = s._id;
    refOf.set(s._id, 'S' + (i + 1));
  });
  const name = (id: string | undefined) => (id ? (refOf.get(id) ?? rows.find((r) => r.a._id === id)?.a.name ?? 'someone') : 'nobody');

  const lines: string[] = [];
  for (const r of chosen) {
    const { a, m } = r;
    const s = m.society;
    const p = m.persona;
    const born = s?.bornTick;
    const age = m.ageBand === 'child' ? 'child' : born !== undefined ? String(Math.round((world.tick - born) / TICKS_PER_YEAR)) : m.ageBand;
    const ties = await ctx.db
      .query('relationships')
      .withIndex('by_from_strength', (q) => q.eq('fromAgentId', a._id))
      .order('desc')
      .take(4);
    const tieText = ties
      .filter((t) => t.toAlive && (t.affinity >= 0.45 || t.affinity <= -0.3))
      .slice(0, 3)
      .map((t) => (t.affinity <= -0.3 ? 'hates ' : t.kind === 'romance' ? 'loves ' : 'close to ') + name(t.toAgentId))
      .join(', ');
    const parts = [
      refOf.get(a._id) + ' ' + a.name + ' (' + age + ', ' + occLabel(a.occupation) + (a.role ? ', ' + a.role.replace(/_/g, ' ') : '') + (keyIds.has(a._id) ? ', KEY' : '') + (a._id === skip.focusAgentId ? ', FOLLOWED BY THE PLAYER' : '') + ')',
      p?.epithet,
      p?.want ? 'wants ' + p.want : undefined,
      p?.fear ? 'fears ' + p.fear : undefined,
      p?.flaw ? 'flaw: ' + p.flaw : undefined,
      p?.secret && p.secret.exposedAtTick === undefined ? 'SECRET: ' + p.secret.text : undefined,
      s?.partnerId ? 'partner ' + name(s.partnerId) : 'single',
      s?.childIds.length ? s.childIds.length + ' children' : undefined,
      'standing ' + Math.round(s?.status ?? 30) + (s && s.fame >= 0.2 ? ', famous' : ''),
      s?.obsession ? 'obsessed with ' + s.obsession.text : undefined,
      tieText || undefined,
    ];
    lines.push(parts.filter(Boolean).join('; '));
  }
  const orgLines = orgs.map((o) => refOf.get(o._id) + ' ' + o.name + ' (' + o.kind + ', ' + o.memberIds.length + ' members, led by ' + name(o.leaderId) + (o.rivalIds.length ? ', rivals ' + o.rivalIds.map((x) => name(x)).join(' ') : '') + '): ' + o.creed);
  const storyLines = stories.map((s) => refOf.get(s._id) + ' ' + describeStoryline(s) + ' Cast: ' + s.participantIds.slice(0, 4).map((x) => name(x)).join(', '));
  const recent = skip.beats.slice(-10).map((b) => b.period + ': ' + b.text);

  const def = SPANS[span];
  const chapterYears = skip.chapterTicks / TICKS_PER_YEAR;
  const from = periodOf(span, skip.startTick, world.tick);
  const to = periodOf(span, skip.startTick, Math.min(skip.endTick, world.tick + skip.chapterTicks) - 1);
  const many = Math.max(1, Math.min(6, Math.round(1 + chapterYears * 12)));
  const econ = world.econ;

  const system = [
    'You are the hidden chronicler of Shackleton, a small lunar colony whose people have wants, flaws, fears and secrets. The player has skipped ahead ' + spanWords(span) + '; you decide what happens to the people during one stretch of that time.',
    'Choose up to ' + many + ' effects for this stretch. Every effect must follow from someone\'s character, relationships or a live storyline: ambition overreaches, secrets leak, lovers marry or stray, grudges harden or heal, organizations rise, split and fall. Pay off or escalate the live storylines first. Give the key characters and the followed colonist real turns, good and bad. Deaths are rare and earned (age, illness, danger, violence after a long feud). Do not repeat what already happened.',
    'Each beat is one past-tense sentence of chronicle prose, 12 to 35 words, naming people by full name, concrete and specific to the colony. No statistics.',
    'Effects (use refs like P3, O1, S2 for who, with, org, org2, storyline; null when not used):',
    ...EFFECT_TYPES.map((t) => '- ' + t + ': ' + EFFECT_GUIDE[t]),
    'Return JSON: {"effects":[{"type","who","with","org","org2","storyline","detail","beat"}]}.',
  ].join('\n');
  const user = [
    'Stretch: ' + (from === to ? from : from + ' to ' + to) + ' of a skip of ' + def.label + ' (chapter ' + (skip.chapter + 1) + ' of ' + skip.chapters + ').',
    'Colony: ' + world.population.alive + ' living, rations ' + (['full', 'reduced', 'emergency'][econ.rationLevel] ?? 'full') + ', treasury ' + Math.round(econ.treasury) + ' credits.',
    '',
    'People:',
    ...lines,
    '',
    'Organizations:',
    ...(orgLines.length ? orgLines : ['none']),
    '',
    'Live storylines:',
    ...(storyLines.length ? storyLines : ['none']),
    '',
    'Already happened in this skip:',
    ...(recent.length ? recent : ['nothing yet']),
  ].join('\n');
  return { system, user, refs, maxTokens: 900 };
}

const nullable = { type: ['string', 'null'] };

export const CHAPTER_SCHEMA = {
  name: 'timeskip_chapter',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['effects'],
    properties: {
      effects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'who', 'with', 'org', 'org2', 'storyline', 'detail', 'beat'],
          properties: { type: { type: 'string', enum: [...EFFECT_TYPES] }, who: nullable, with: nullable, org: nullable, org2: nullable, storyline: nullable, detail: nullable, beat: nullable },
        },
      },
    },
  },
};

/** Parses a chapter reply into raw effects with real ids. Unknown refs are dropped, the rest validated later. */
export function parseEffects(text: string, refs: Record<string, string>): Record<string, unknown>[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
      json = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? (json as { effects?: unknown }).effects : undefined;
  if (!Array.isArray(list)) return [];
  const id = (x: unknown) => (typeof x === 'string' ? (refs[x.trim().toUpperCase()] ?? undefined) : undefined);
  return list.slice(0, 8).flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const r = e as Record<string, unknown>;
    return [{ type: r.type, who: id(r.who), with: id(r.with), org: id(r.org), org2: id(r.org2), storyline: id(r.storyline), detail: r.detail ?? undefined, beat: r.beat ?? undefined }];
  });
}
