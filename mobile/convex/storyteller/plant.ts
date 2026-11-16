/**
 * Planting a thought (focus:plant): the player types free text and it becomes a whisper, a belief
 * about someone or a goal, applied through the whisper power. This module reads the text (with the
 * LLM, or with the rules below when it is unavailable), words the thought as it surfaces in the
 * colonist's head, and decides how a rules-only colonist takes it.
 */
import type { Id } from '../_generated/dataModel';
import { WHISPER_PRESETS } from '../../shared/colony';
import type { ChatRequest } from '../cognition/provider';
import { clamp, hash32, round2 } from '../lib/rng';
import type { AgentDoc, MindDoc } from '../engine/core';
import { WHISPER_KINDS } from '../powers/ideas';

export type Person = { id: Id<'agents'>; name: string };
export type Reading = { presetKey: string; kind?: string; aboutId?: Id<'agents'>; strength: number; surfaced: string };

const PRESETS = WHISPER_PRESETS.map((p) => p.key);
const first = (name: string) => name.split(' ')[0];

/** Who the text names first: full names before first names, and among equals people they know (listed first). */
export function namedIn(text: string, people: Person[]): Person | undefined {
  const lower = text.toLowerCase();
  const at = (w: string) => lower.search(new RegExp('\\b' + w.toLowerCase().replace(/[^a-z' -]/g, '') + '\\b'));
  const earliest = (key: (p: Person) => string) => {
    let best: { p: Person; i: number } | undefined;
    for (const p of people) {
      const i = at(key(p));
      if (i >= 0 && (!best || i < best.i)) best = { p, i };
    }
    return best?.p;
  };
  return earliest((p) => p.name) ?? earliest((p) => first(p.name));
}

const KEYWORDS: [RegExp, { presetKey: string; kind?: string; surface?: string }][] = [
  [/(do ?n[o']t|never|shouldn't|should not) (report|turn (her|him|them) in|tell on|hand (her|him|them) over|expose)|leave (her|him|them) (be|alone)|forgive|mercy|let (it|her|him|them) (go|slide)|only doing|because (her|his|their) .*(dying|sick|ill|starving)|has (her|his|their) reasons/, { presetKey: 'befriend', surface: 'mercy' }],
  [/sabot|drill|cut(ting)? the|scor(e|ing)|break(s|ing)? (the )?(rig|drill|pump)|wreck/, { presetKey: 'custom', kind: 'saboteur' }],
  [/steal|stole|thief|skim|takes? what|pocket/, { presetKey: 'custom', kind: 'thief' }],
  [/hoard|hiding (the )?(supplies|water|food)|keeping (it|supplies) back|stockpil/, { presetKey: 'suspect_hoarding' }],
  [/affair|sleeping with|seeing someone|cheat/, { presetKey: 'custom', kind: 'affair' }],
  [/bribe|corrupt|on the take|paid off/, { presetKey: 'custom', kind: 'corrupt' }],
  [/smuggl|off the books|black market/, { presetKey: 'custom', kind: 'smuggler' }],
  [/lie|liar|lying|trust|two-faced|snake/, { presetKey: 'distrust' }],
  [/love|like you|friend|closer|kind|good person|admire|trust them/, { presetKey: 'befriend' }],
  [/council|seat|lead|chair|in charge|power/, { presetKey: 'seek_power' }],
  [/rich|credits|money|deserve more|more than this|fortune/, { presetKey: 'get_rich' }],
  [/share|give|generous|help (them|others)/, { presetKey: 'share' }],
];

const SURFACE: Record<string, (x: string) => string> = {
  saboteur: (x) => 'What if it was ' + x + ' breaking things all along?',
  thief: (x) => 'Has ' + x + ' been taking what is not theirs? It would explain a lot.',
  hoarding: (x) => 'What is ' + x + ' keeping back? Somebody always is.',
  affair: (x) => x + ' and someone they should not be with... I have seen the looks.',
  corrupt: (x) => x + ' takes a little off every deal. I would bet on it.',
  smuggler: (x) => 'Those trips to the pad. What is ' + x + ' really moving?',
  untrustworthy: (x) => 'I do not trust ' + x + '. I am not sure I ever did.',
  admirable: (x) => 'Maybe I have been wrong about ' + x + '. Maybe they are worth knowing.',
  mercy: (x) => x + ' has reasons I do not know. Do I really want to be the one who ruins them?',
  seek_power: () => 'Why should the council decide everything without me?',
  get_rich: () => 'I deserve more than this. Much more.',
  share: () => 'We have more than some. That ought to mean something.',
};

/** The rules reading: keywords pick the preset or the suspicion, the first name found picks the subject. */
export function readByRules(text: string, people: Person[]): Reading {
  const lower = text.toLowerCase();
  const about = namedIn(text, people);
  const hit = KEYWORDS.find(([re]) => re.test(lower))?.[1] ?? { presetKey: 'custom' };
  let { presetKey, kind } = hit;
  const surface = about ? hit.surface : undefined;
  if (!about && (kind || presetKey === 'suspect_hoarding' || presetKey === 'distrust' || presetKey === 'befriend')) {
    presetKey = 'custom';
    kind = undefined;
  }
  if (about && presetKey === 'custom' && !kind) kind = /!|always|never|sure|know/.test(lower) ? 'untrustworthy' : undefined;
  const strength = round2(clamp(0.6 + (/!/.test(text) ? 0.15 : 0) + (/(must|always|never|know|sure)/.test(lower) ? 0.1 : 0), 0, 1));
  const surfaceKey = surface ?? kind ?? (presetKey === 'suspect_hoarding' ? 'hoarding' : presetKey === 'distrust' ? 'untrustworthy' : presetKey === 'befriend' ? 'admirable' : presetKey);
  const surfaced = SURFACE[surfaceKey] && (about || !['saboteur', 'thief', 'hoarding', 'affair', 'corrupt', 'smuggler', 'untrustworthy', 'admirable', 'mercy'].includes(surfaceKey))
    ? SURFACE[surfaceKey](about ? first(about.name) : '')
    : 'A thought I cannot shake: ' + firstPerson(text);
  return { presetKey, kind, aboutId: about?.id, strength, surfaced };
}

/** "You deserve more" becomes "I deserve more": the voice's words as the colonist's own. */
function firstPerson(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const swapped = t.replace(/\byou are\b/gi, 'I am').replace(/\byou're\b/gi, "I'm").replace(/\byourself\b/gi, 'myself').replace(/\byour\b/gi, 'my').replace(/\byou\b/gi, 'I');
  return swapped.charAt(0).toLowerCase() + swapped.slice(1).replace(/[.!?]*$/, '.');
}

const SYSTEM_PLANT = 'You read a thought that an unseen force plants in the head of a colonist of Shackleton Colony, a cramped Moon base. Map it onto the game\'s whisper machinery and word it as it surfaces in their own head.\n' +
  '- preset: suspect_hoarding (they suspect someone hides supplies), distrust (someone cannot be trusted), befriend (get closer to someone), seek_power (a council seat, leadership), get_rich (wealth, deserving more), share (give to those with less), custom (anything else).\n' +
  '- kind: when the thought accuses or praises a named person of something specific, one of ' + [...WHISPER_KINDS].join(', ') + '; else null.\n' +
  '- about: the exact full name of the person it is about, from the list, or null. suspect_hoarding, distrust and befriend need one.\n' +
  '- strength: 0.3 for a vague nudge, 0.6 for a clear idea, 0.9 for an urgent conviction.\n' +
  '- surfaced: the idea as a thought of their own, first person, in their voice, 6 to 30 words, never addressed to them and never mentioning a voice. Example: "What if it was Dmitri at the drill rig all along?"\n' +
  'Reply with JSON {"preset": string, "kind": string or null, "about": string or null, "strength": number, "surfaced": string}.';

export const PLANT_SCHEMA = {
  name: 'planted_thought',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['preset', 'kind', 'about', 'strength', 'surfaced'],
    properties: {
      preset: { type: 'string', enum: PRESETS },
      kind: { type: ['string', 'null'] },
      about: { type: ['string', 'null'] },
      strength: { type: 'number' },
      surfaced: { type: 'string' },
    },
  },
};

export function plantRequest(text: string, who: { name: string; voice?: string; want?: string }, people: Person[]): ChatRequest {
  const user = [
    'Colonist: ' + who.name + (who.voice ? '. Voice: ' + who.voice : '') + (who.want ? '. Wants: ' + who.want : '') + '.',
    'People in the colony: ' + people.slice(0, 120).map((p) => p.name).join(', ') + '.',
    'The planted thought: ' + text,
  ].join('\n');
  return { system: SYSTEM_PLANT, user, maxTokens: 160, schema: PLANT_SCHEMA, temperature: 0.7 };
}

/** Checks the model's reading against the colony; null when it does not hold together. */
export function validateReading(parsed: unknown, people: Person[]): Reading | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  const presetKey = typeof r.preset === 'string' && PRESETS.includes(r.preset) ? r.preset : null;
  const surfaced = typeof r.surfaced === 'string' ? r.surfaced.replace(/\s+/g, ' ').trim().replace(/^"|"$/g, '') : '';
  if (!presetKey || surfaced.length < 3 || surfaced.length > 220) return null;
  const about = typeof r.about === 'string' ? people.find((p) => p.name.toLowerCase() === (r.about as string).toLowerCase()) : undefined;
  const needsSubject = WHISPER_PRESETS.find((p) => p.key === presetKey)?.needsSubject;
  if (needsSubject && !about) return null;
  const kind = typeof r.kind === 'string' && WHISPER_KINDS.has(r.kind) && about ? r.kind : undefined;
  const strength = typeof r.strength === 'number' && Number.isFinite(r.strength) ? round2(clamp(r.strength, 0.1, 1)) : 0.6;
  return { presetKey, kind, aboutId: about?.id, strength, surfaced };
}

/** Whether a colonist without the LLM takes the idea up: strong ideas and pliable people do. */
export function takesItUp(a: AgentDoc, reading: Reading): boolean {
  return reading.strength + (1 - a.traits.stubbornness) * 0.3 + a.traits.curiosity * 0.1 + (hash32(a.seq, reading.surfaced.length) % 100) / 500 > 0.85;
}

/** The rules reaction line, after the idea has surfaced. */
export function reactionLine(a: AgentDoc, mind: MindDoc | null, reading: Reading, aboutName: string | undefined, accepted: boolean): string {
  const x = aboutName ? first(aboutName) : undefined;
  const kind = reading.presetKey === 'befriend' || reading.kind === 'admirable' ? 'warm' : 'cold';
  const warm = accepted
    ? ['Maybe ' + x + ' deserves better from me than I have given.', 'I could look the other way. Just this once, for ' + x + '.']
    : ['Whatever ' + x + '\'s reasons, rules are rules. I am not going soft now.', 'Feeling sorry for ' + x + ' will not fix anything.'];
  const lines = x && kind === 'warm'
    ? warm
    : accepted
    ? [x ? 'The more I think about ' + x + ', the more it fits. I need to find out.' : 'Yes. Why have I not seen it before?', x ? 'I will watch ' + x + ' closely from now on.' : 'That changes what I do today.']
    : [x ? 'No. ' + x + ' has never given me a reason. Where did that come from?' : 'No. That is not me thinking. Shake it off.', mind?.persona?.fear ? 'I have enough to fear without inventing more.' : 'Strange thought. Let it go.'];
  return lines[hash32(a.seq, reading.surfaced.length, accepted ? 1 : 0) % lines.length];
}
