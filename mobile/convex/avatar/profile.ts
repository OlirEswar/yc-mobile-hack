/**
 * Turning what a player shares about themself into a colonist: scrubbing the raw material, the
 * keyword fallback that works with no model, the LLM request, and the one check every profile
 * passes through, whoever wrote it.
 */
import { OCCUPATIONS, SPRITE_IDS, SPRITE_VARIANTS, TRAIT_KEYS, VALUE_KEYS } from '../../shared/colony';
import type { SpriteId, TraitKey, ValueKey } from '../../shared/colony';
import type { AvatarProfile, GoalKind } from '../../shared/types';
import { GOAL_KINDS } from '../cognition/prompt';
import type { ChatRequest } from '../cognition/provider';
import { round2 } from '../lib/rng';

export const MAX_SOURCES = 6;
export const SOURCE_MIN_CHARS = 20;
export const SOURCE_MAX_CHARS = 8000;
export const SOURCE_KINDS = ['gmail', 'ai_memory', 'about_me'] as const;
const AGE_BANDS = ['young', 'adult', 'elder'] as const;
const HOMES = ['habitat_a', 'habitat_b'] as const;

/** Removes contact details and links, then tidies whitespace. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link]')
    .replace(/\bwww\.\S+/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- the check ----------

const clean = (x: unknown, max: number): string | undefined => {
  if (typeof x !== 'string') return undefined;
  const text = scrub(x).replace(/\s+/g, ' ').replace(/^["']+|["']+$/g, '').trim().slice(0, max).trim();
  return text.length > 0 ? text : undefined;
};

const cleanList = (x: unknown, count: number, max: number): string[] | undefined => {
  if (!Array.isArray(x)) return undefined;
  const items = x.map((item) => clean(item, max)).filter((item): item is string => !!item);
  return [...new Set(items)].slice(0, count);
};

const pickOf = <T extends string>(x: unknown, options: readonly T[]): T | undefined =>
  typeof x === 'string' && (options as readonly string[]).includes(x) ? (x as T) : undefined;

/** Every key as a number in 0..1. A model's slightly-out-of-range number is clamped; a player's is refused. */
function scoresOf<K extends string>(x: unknown, keys: readonly K[], clampOut: boolean): Record<K, number> | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = (x as Record<string, unknown>)[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || (!clampOut && (n < 0 || n > 1))) return undefined;
    out[key] = round2(Math.min(1, Math.max(0, n)));
  }
  return out;
}

function goalsOf(x: unknown): { kind: GoalKind; description: string }[] | undefined {
  if (!Array.isArray(x) || x.length > 2) return undefined;
  const goals: { kind: GoalKind; description: string }[] = [];
  for (const g of x) {
    const kind = pickOf((g as { kind?: unknown } | null)?.kind, GOAL_KINDS);
    const description = clean((g as { description?: unknown } | null)?.description, 140);
    if (!kind || !description || description.length < 2) return undefined;
    goals.push({ kind, description });
  }
  return goals;
}

const PROBLEMS: Record<keyof AvatarProfile, string> = {
  name: 'The name must be 2 to 40 characters.',
  spriteId: 'Unknown sprite.',
  ageBand: 'Unknown age band.',
  occupation: 'Unknown occupation.',
  homeLocationId: 'Home must be habitat_a or habitat_b.',
  traits: 'Every trait must be a number from 0 to 1.',
  values: 'Every value must be a number from 0 to 1.',
  backstory: 'The backstory must be text.',
  summary: 'The summary is missing.',
  interests: 'Interests must be a list.',
  speechStyle: 'The speech style is missing.',
  habits: 'Habits must be a list.',
  goals: 'At most 2 goals, each a known kind with a description.',
};

/**
 * Checks a profile. With a fallback (a model's answer), every missing or invalid field takes the
 * fallback's value, so a half-good answer still makes a usable character. Without one (a player's
 * edit), the first problem comes back as a message.
 */
export function normalizeProfile(raw: unknown, fallback?: AvatarProfile): AvatarProfile | string {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = clean(p.name, 40);
  const read: { [K in keyof AvatarProfile]: AvatarProfile[K] | undefined } = {
    name: name && name.length >= 2 && String(p.name).trim().length <= 40 ? name : undefined,
    spriteId: pickOf(p.spriteId, SPRITE_IDS),
    ageBand: pickOf(p.ageBand, AGE_BANDS),
    occupation: pickOf(p.occupation, OCCUPATIONS.map((o) => o.id)),
    homeLocationId: pickOf(p.homeLocationId, HOMES),
    traits: scoresOf(p.traits, TRAIT_KEYS, !!fallback),
    values: scoresOf(p.values, VALUE_KEYS, !!fallback),
    backstory: typeof p.backstory === 'string' ? (clean(p.backstory, 280) ?? '') : undefined,
    summary: clean(p.summary, 160),
    interests: cleanList(p.interests, 6, 40),
    speechStyle: clean(p.speechStyle, 140),
    habits: cleanList(p.habits, 4, 100),
    goals: goalsOf(p.goals),
  };
  const keys = Object.keys(PROBLEMS) as (keyof AvatarProfile)[];
  if (!fallback) {
    const missing = keys.find((k) => read[k] === undefined);
    return missing ? PROBLEMS[missing] : (read as AvatarProfile);
  }
  const out = { ...fallback } as Record<string, unknown>;
  for (const k of keys) if (read[k] !== undefined) out[k] = read[k];
  if (read.occupation && !read.spriteId) out.spriteId = spriteFor(read.occupation, String(out.name));
  return out as AvatarProfile;
}

// ---------- the keyword fallback ----------

type Interest = { label: string; words: RegExp; occupation: string; habit: string; traits?: Partial<Record<TraitKey, number>>; values?: Partial<Record<ValueKey, number>> };

const INTERESTS: Interest[] = [
  { label: 'startups', words: /\b(startups?|founders?|y ?combinator|yc|venture|fundrais\w*|pitch(es|ing)?|launch(ed|ing)?)\b/gi, occupation: 'trader', habit: 'Pitches a new venture to anyone at the Exchange who will listen', traits: { ambition: 0.12 }, values: { wealth: 0.08, freedom: 0.06 } },
  { label: 'coding', words: /\b(cod(e|ing)|software|programm\w+|developers?|engineer(ing)?|github|swift|python|typescript|apis?)\b/gi, occupation: 'fabricator', habit: 'Tinkers with the printers at the Fabrication Works after shift', traits: { curiosity: 0.1 } },
  { label: 'science', words: /\b(research\w*|scien\w+|physics|biology|chemistry|labs?|papers?|phd)\b/gi, occupation: 'researcher', habit: 'Spends spare hours at the Observatory Lab', traits: { curiosity: 0.12, caution: 0.04 } },
  { label: 'space', words: /\b(space|astronom\w*|nasa|rockets?|moon|mars|telescopes?|stars)\b/gi, occupation: 'researcher', habit: 'Watches the sky from the Observatory dome', traits: { curiosity: 0.08 } },
  { label: 'cooking', words: /\b(cook(ing)?|recipes?|restaurants?|baking|chef|dinners?|brunch)\b/gi, occupation: 'cook', habit: 'Feeds whoever turns up at the Airlock Canteen', traits: { sociability: 0.08, empathy: 0.06 }, values: { harmony: 0.06 } },
  { label: 'fitness', words: /\b(gym|running|marathon|climb(ing)?|fitness|workouts?|hik(e|es|ing)|yoga|cycling)\b/gi, occupation: 'ice_miner', habit: 'Volunteers for the hardest surface shifts', traits: { stubbornness: 0.06 } },
  { label: 'health', words: /\b(doctors?|medic(al|ine)?|health|hospitals?|nurs(e|ing)|therapy|wellness)\b/gi, occupation: 'medic', habit: 'Checks on anyone who looks unwell', traits: { empathy: 0.12 }, values: { harmony: 0.04 } },
  { label: 'gardening', words: /\b(garden(ing)?|plants?|farm(ing)?|grow(ing)?)\b/gi, occupation: 'hydroponicist', habit: 'Talks to the grow racks in the Hydroponics Bays', traits: { caution: 0.04 } },
  { label: 'investing', words: /\b(invest\w*|stocks?|crypto|financ\w+|banks?|trading|portfolio|savings)\b/gi, occupation: 'trader', habit: 'Watches Exchange prices for a bargain', traits: { ambition: 0.06, caution: 0.04 }, values: { wealth: 0.12 } },
  { label: 'community', words: /\b(politic\w*|polic(y|ies)|elections?|government|community|volunteer\w*|organi[sz]\w+|nonprofit)\b/gi, occupation: 'councilor', habit: 'Speaks up at the council in the Commons Plaza', traits: { sociability: 0.06, empathy: 0.04 }, values: { status: 0.06, harmony: 0.06 } },
  { label: 'music', words: /\b(music|concerts?|guitar|piano|spotify|bands?|singing|playlists?)\b/gi, occupation: 'resident', habit: 'Hums a tune that gets stuck in everyone\'s head', traits: { sociability: 0.04 } },
  { label: 'gaming', words: /\b(gam(e|es|ing)|steam|playstation|xbox|nintendo|chess|board games?)\b/gi, occupation: 'resident', habit: 'Starts a game of something at the canteen', traits: { curiosity: 0.04 } },
  { label: 'travel', words: /\b(travel\w*|flights?|trips?|hotels?|airbnb|backpack\w*|adventures?)\b/gi, occupation: 'dock_hand', habit: 'Meets every shuttle at the Landing Pad', traits: { curiosity: 0.06 }, values: { freedom: 0.12 } },
  { label: 'design', words: /\b(design\w*|figma|art|artist|photograph\w*|drawing|painting)\b/gi, occupation: 'fabricator', habit: 'Redesigns anything that looks ugly', traits: { curiosity: 0.06 } },
  { label: 'security', words: /\b(security|law|legal|police|defen[cs]e|safety)\b/gi, occupation: 'security', habit: 'Keeps an eye on the Supply Depot', traits: { caution: 0.1 } },
  { label: 'energy', words: /\b(solar|energy|climate|electric\w*|batter(y|ies)|renewables?)\b/gi, occupation: 'solar_tech', habit: 'Fusses over the panels on the crater rim', traits: { caution: 0.04 } },
  { label: 'logistics', words: /\b(shipping|logistics|deliver(y|ies)|warehouses?|supply chain|orders?)\b/gi, occupation: 'hauler', habit: 'Knows where every crate in the colony is', traits: { caution: 0.04 } },
];

const TRAIT_WORDS: Record<TraitKey, [up: RegExp, down?: RegExp]> = {
  ambition: [/\b(ambitio\w+|driven|goals?|ship(ping)?|hustl\w+|build(ing|er)?|promot\w+|ceo|lead(ing|er)?)\b/gi, /\b(laid[- ]back|content|relaxed|chill)\b/gi],
  empathy: [/\b(help(ing|ful)?|kind|car(e|ing)|support\w*|mentor\w*|empath\w+|listen\w*|friends?)\b/gi, /\b(blunt|cold|harsh)\b/gi],
  caution: [/\b(careful|cautious|plan(s|ning|ner)?|safe|risk[- ]averse|organi[sz]ed|detail)\b/gi, /\b(spontaneous|impulsive|risk[- ]taker|bold|yolo)\b/gi],
  curiosity: [/\b(curious|learn\w*|read(ing|s)?|books?|explor\w+|new|questions?|podcasts?)\b/gi, /\b(routine|predictable)\b/gi],
  sociability: [/\b(social|part(y|ies)|friends|meetups?|events?|team|people|extrovert\w*|chatty|hangouts?)\b/gi, /\b(introvert\w*|quiet|alone|solitary|shy|private)\b/gi],
  stubbornness: [/\b(stubborn|opinionated|determined|persistent|strong[- ]willed|principled)\b/gi, /\b(flexible|open[- ]minded|easygoing|adaptable)\b/gi],
};

const VALUE_WORDS: Record<ValueKey, RegExp> = {
  wealth: /\b(money|salary|invest\w*|rich|profit|revenue|wealth)\b/gi,
  family: /\b(family|kids?|children|mom|dad|parents?|wedding|sister|brother|partner|wife|husband)\b/gi,
  status: /\b(influence|award\w*|status|recogni\w+|famous|lead(er|ership)?|ceo|founder)\b/gi,
  harmony: /\b(community|peace|together|team|harmony|fair(ness)?|kindness)\b/gi,
  freedom: /\b(freedom|independen\w+|remote|travel\w*|adventure|explore|own boss)\b/gi,
};

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
const nudge = (hits: number, per: number, cap: number): number => Math.min(cap, hits * per);

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function spriteFor(occupation: string, name: string): SpriteId {
  const archetype = OCCUPATIONS.find((o) => o.id === occupation)?.archetype ?? 'civilian';
  return (archetype + '_' + (hashOf(name) % SPRITE_VARIANTS)) as SpriteId;
}

const STYLE: [test: (t: Record<TraitKey, number>) => boolean, style: string][] = [
  [(t) => t.sociability >= 0.65 && t.empathy >= 0.6, 'Warm and chatty, asks about your day and remembers the answer'],
  [(t) => t.sociability >= 0.65, 'Talkative and quick with a joke, thinks out loud'],
  [(t) => t.ambition >= 0.65, 'Direct and energetic, always pitching the next idea'],
  [(t) => t.curiosity >= 0.65, 'Thoughtful, full of questions, goes off on interesting tangents'],
  [(t) => t.caution >= 0.65, 'Measured and precise, weighs every word'],
  [(t) => t.sociability <= 0.35, 'Quiet and dry, says a lot in few words'],
];

/**
 * A profile from keywords alone: interests pick the job, word counts nudge traits and values from
 * an even 0.5. Used when no model is configured or its answer is unusable.
 */
export function rulesProfile(texts: string[], name?: string): AvatarProfile {
  const text = texts.join('\n');
  const scored = INTERESTS.map((interest) => ({ interest, hits: count(text, interest.words) }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const top = scored.slice(0, 4).map((s) => s.interest);

  const traits = Object.fromEntries(TRAIT_KEYS.map((k) => [k, 0.5])) as Record<TraitKey, number>;
  for (const key of TRAIT_KEYS) {
    const [up, down] = TRAIT_WORDS[key];
    traits[key] += nudge(count(text, up), 0.04, 0.25) - (down ? nudge(count(text, down), 0.08, 0.3) : 0);
  }
  const values = Object.fromEntries(VALUE_KEYS.map((k) => [k, 0.45])) as Record<ValueKey, number>;
  for (const key of VALUE_KEYS) values[key] += nudge(count(text, VALUE_WORDS[key]), 0.05, 0.35);
  for (const interest of top) {
    for (const [k, d] of Object.entries(interest.traits ?? {})) traits[k as TraitKey] += d;
    for (const [k, d] of Object.entries(interest.values ?? {})) values[k as ValueKey] += d;
  }
  for (const k of TRAIT_KEYS) traits[k] = round2(Math.min(0.95, Math.max(0.05, traits[k])));
  for (const k of VALUE_KEYS) values[k] = round2(Math.min(0.95, Math.max(0.05, values[k])));

  const finalName = (name ? clean(name, 40) : undefined) ?? 'New Arrival';
  const first = finalName.split(' ')[0];
  const occupation = top[0]?.occupation ?? 'resident';
  const occupationLabel = OCCUPATIONS.find((o) => o.id === occupation)!.label.toLowerCase();
  const interests = top.map((i) => i.label);
  const style = STYLE.find(([test]) => test(traits))?.[1] ?? 'Easygoing and plain-spoken';
  const topValue = VALUE_KEYS.slice().sort((a, b) => values[b] - values[a])[0];
  const goal: Record<ValueKey, { kind: GoalKind; description: string }> = {
    wealth: { kind: 'earn_wealth', description: 'Build up savings at the Exchange' },
    family: { kind: 'improve_relationship', description: 'Find people here who feel like family' },
    status: { kind: 'gain_influence', description: 'Earn a voice on the colony council' },
    harmony: { kind: 'improve_relationship', description: 'Make real friends in the colony' },
    freedom: { kind: 'custom', description: 'See every corner of the colony' },
  };
  const likes = interests.length > 0 ? interests.slice(0, 2).join(' and ') : 'people';
  const adjective = traits.ambition >= 0.65 ? 'driven' : traits.empathy >= 0.65 ? 'kind' : traits.curiosity >= 0.65 ? 'curious' : traits.sociability >= 0.65 ? 'outgoing' : 'steady';
  return {
    name: finalName,
    spriteId: spriteFor(occupation, finalName),
    ageBand: 'adult',
    occupation,
    homeLocationId: hashOf(finalName) % 2 === 0 ? 'habitat_a' : 'habitat_b',
    traits,
    values,
    backstory: (first + ' came up on the shuttle with a head full of ' + likes + ' and took work as a ' + occupationLabel + '.').slice(0, 280),
    summary: (first + ' is a ' + adjective + ' person who lights up about ' + likes + '.').slice(0, 160),
    interests,
    speechStyle: style,
    habits: top.slice(0, 3).map((i) => i.habit),
    goals: [goal[topValue]],
  };
}

// ---------- the model ----------

const SYSTEM_PROFILE = `You turn what a real person shared about themself into their avatar: a colonist in Shackleton Colony, a cramped Moon base of about 100 people where water is scarce. The avatar will live there on its own and should do what this person would do in that world.

Rules:
- Use only what the material supports. Where it says nothing, choose middling numbers (around 0.5) rather than guessing.
- The material may include an email digest (senders' domains, subject lines, labels) and what the person's AI assistant knows about them. Read it for personality, work, interests, habits and values, not for private facts.
- Never include email addresses, phone numbers, street addresses, account details, health or financial specifics, or other people's full names. Keep everything general and kind.
- Translate their real life to the colony: pick the job they would gravitate to there.
- traits and values are numbers from 0 to 1.
- summary: one sentence, third person, under 160 characters.
- backstory: how they ended up on the Moon, under 280 characters, in keeping with who they are.
- interests: up to 6, each two or three words.
- speechStyle: how they talk, under 140 characters.
- habits: up to 4 things they would do in the colony, each a short sentence naming colony places where it fits.
- goals: one or two, what they would want here.
Reply with JSON only.`;

const PROFILE_SCHEMA = {
  name: 'avatar_profile',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'ageBand', 'occupation', 'homeLocationId', 'traits', 'values', 'backstory', 'summary', 'interests', 'speechStyle', 'habits', 'goals'],
    properties: {
      name: { type: 'string' },
      ageBand: { type: 'string', enum: [...AGE_BANDS] },
      occupation: { type: 'string', enum: OCCUPATIONS.map((o) => o.id) },
      homeLocationId: { type: 'string', enum: [...HOMES] },
      traits: { type: 'object', additionalProperties: false, required: [...TRAIT_KEYS], properties: Object.fromEntries(TRAIT_KEYS.map((k) => [k, { type: 'number' }])) },
      values: { type: 'object', additionalProperties: false, required: [...VALUE_KEYS], properties: Object.fromEntries(VALUE_KEYS.map((k) => [k, { type: 'number' }])) },
      backstory: { type: 'string' },
      summary: { type: 'string' },
      interests: { type: 'array', items: { type: 'string' } },
      speechStyle: { type: 'string' },
      habits: { type: 'array', items: { type: 'string' } },
      goals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'description'],
          properties: { kind: { type: 'string', enum: [...GOAL_KINDS] }, description: { type: 'string' } },
        },
      },
    },
  },
};

/** Total characters of source material sent to the model. */
const PROMPT_SOURCE_CHARS = 12_000;

export function profileRequest(sources: { kind: string; label: string; text: string }[], name?: string): ChatRequest {
  const jobs = OCCUPATIONS.map((o) => o.id + ' (' + o.label + ')').join(', ');
  const per = Math.floor(PROMPT_SOURCE_CHARS / Math.max(1, sources.length));
  const lines = [
    'Colony jobs: ' + jobs + '.',
    'Homes: habitat_a (older family quarters near the farms), habitat_b (newer bunk blocks near the works).',
    'Traits: ' + TRAIT_KEYS.join(', ') + '. Values: ' + VALUE_KEYS.join(', ') + '.',
    'Goal kinds: ' + GOAL_KINDS.join(', ') + '.',
    name ? 'Their name in the colony: ' + name + '.' : 'Choose their first name from the material, or a fitting one if it gives none.',
    '',
    ...sources.flatMap((s) => ['## ' + s.label + ' (' + s.kind + ')', s.text.slice(0, per), '']),
  ];
  return { system: SYSTEM_PROFILE, user: lines.join('\n'), maxTokens: 900, schema: PROFILE_SCHEMA, temperature: 0.6 };
}
