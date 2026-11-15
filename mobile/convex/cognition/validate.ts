/**
 * Hard validation of model output. A step survives only if its type is in STEP_SPECS and every
 * argument resolves to something real: a known location, a resource, a living person the colonist
 * was shown, a belief they hold. Bad steps are dropped one by one; numbers are clamped. The result
 * holds encoded steps with real ids, ready for setPlan.
 */
import type { Id } from '../_generated/dataModel';
import { LOCATIONS, LOCATION_IDS, RESOURCES, TRADED_RESOURCES } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { STEP_SPECS, encodeStep } from '../engine/core';
import type { StepType } from '../engine/core';
import { validateSocietyArgs } from '../society/validate';
import type { PersonRef, PlanContext } from './context';
import { BEG_RESOURCES, BRIBE_FAVORS, GOAL_KINDS, LIE_KINDS, MAX_ANSWER_CHARS, MAX_SPEECH_CHARS, MAX_STEPS, MAX_THOUGHT_CHARS, PETITION_TOPICS, RALLY_TOPICS } from './prompt';

export type ValidGoal = { kind: string; description: string; priority: number; targetAgentId?: Id<'agents'> };

export type ValidPlan = {
  intent: string;
  /** Encoded "type|arg|arg" steps with real ids. */
  steps: string[];
  labels: string[];
  goal?: ValidGoal;
  speech?: string;
  /** A monologue line, asked of the followed colonist only. */
  thought?: string;
};

export type PlanValidation = { ok: true; plan: ValidPlan; dropped: string[] } | { ok: false; reason: string; dropped: string[] };

/** Bounds per step type for tick arguments. */
const TICK_BOUNDS: Partial<Record<StepType, [number, number]>> = { work: [1, 48], sleep: [6, 60], rest: [1, 18], wait: [1, 18], grow: [1, 24], strike: [1, 36] };
const MAX_GOODS = 10;
const MAX_CREDITS = 100;
const NEEDS_TARGET = new Set(['protect_person', 'improve_relationship', 'avoid_person', 'investigate']);

/** Parses a JSON object out of a completion, tolerating a code fence around it. */
export function parseJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Trimmed single-line text without the step separator, or undefined when empty. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function clampInt(value: string, lo: number, hi: number): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(hi, Math.max(lo, n)) : null;
}

const isLocation = (value: string): value is LocationId => (LOCATION_IDS as readonly string[]).includes(value);

/** Checks a plan against what the colonist knows. */
export function validatePlan(raw: unknown, c: PlanContext): PlanValidation {
  const dropped: string[] = [];
  const out = asRecord(raw);
  if (!out) return { ok: false, reason: 'not a JSON object', dropped };

  const person = (value: string): PersonRef | undefined => {
    const v = value.trim().toLowerCase();
    return c.people.find((p) => p.ref === v || p.id === value.trim() || p.name.toLowerCase() === v);
  };
  const living = (value: string): PersonRef | undefined => {
    const p = person(value);
    return p?.alive ? p : undefined;
  };
  const belief = (value: string): Held | undefined => {
    const ref = value.trim().toLowerCase();
    if (c.secret && ref === c.secret.ref) return { key: c.secret.key, subjectId: c.agentId, own: true };
    const b = c.beliefs.find((x) => x.ref === ref);
    return b ? { key: b.key, subjectId: b.subjectId, own: false } : undefined;
  };

  let here: LocationId = c.locationId;
  const steps: string[] = [];
  const labels: string[] = [];
  const rawSteps = Array.isArray(out.steps) ? out.steps : [];
  for (const [i, item] of rawSteps.entries()) {
    const step = asRecord(item);
    const type = typeof step?.type === 'string' ? step.type : '';
    const args = Array.isArray(step?.args) ? step.args.map((a) => String(a)) : [];
    const fail = (why: string) => void dropped.push('step ' + (i + 1) + ' ' + (type || '?') + ': ' + why);
    if (steps.length >= MAX_STEPS) {
      fail('too many steps');
      continue;
    }
    if (!(type in STEP_SPECS)) {
      fail('unknown step type');
      continue;
    }
    const spec = STEP_SPECS[type as StepType];
    const required = spec.args.filter((a) => !a.endsWith('?')).length;
    if (args.length < required) {
      fail('expected ' + required + ' args');
      continue;
    }
    const encoded = encodeArgs(type as StepType, args.slice(0, spec.args.length), { here, householdId: c.householdId, living, person, belief, society: c.societyRefs });
    if (typeof encoded === 'string') {
      fail(encoded);
      continue;
    }
    if (type === 'go' || type === 'flee') here = encoded.args[0] as LocationId;
    steps.push(encodeStep(type as StepType, ...encoded.args));
    labels.push(cleanText(step?.label, 60) ?? encoded.label);
  }
  if (steps.length === 0) return { ok: false, reason: rawSteps.length === 0 ? 'no steps' : 'no valid steps', dropped };

  const first = c.name.split(' ')[0];
  const intent = cleanText(out.intent, 220) ?? first + ' acts on ' + c.trigger.toLowerCase() + '.';
  const plan: ValidPlan = { intent, steps, labels, speech: cleanText(out.speech, MAX_SPEECH_CHARS) };
  if (c.followed) plan.thought = cleanText(out.thought, MAX_THOUGHT_CHARS);

  const goal = asRecord(out.goal);
  if (goal) {
    const kind = typeof goal.kind === 'string' && (GOAL_KINDS as readonly string[]).includes(goal.kind) ? goal.kind : undefined;
    const description = cleanText(goal.description, 100);
    const target = typeof goal.targetAgentId === 'string' ? living(goal.targetAgentId) : undefined;
    const priority = typeof goal.priority === 'number' && Number.isFinite(goal.priority) ? Math.min(1, Math.max(0, goal.priority)) : 0.6;
    if (!kind || !description) dropped.push('goal: bad kind or description');
    else if (NEEDS_TARGET.has(kind) && !target) dropped.push('goal: ' + kind + ' needs a living target');
    else plan.goal = { kind, description, priority: Math.round(priority * 100) / 100, targetAgentId: target?.id };
  }
  return { ok: true, plan, dropped };
}

/** A belief the planner may point at: a held belief, or their own secret (own). */
type Held = { key: string; subjectId?: string; own: boolean };

type Lookup = {
  here: LocationId;
  householdId?: string;
  living: (value: string) => PersonRef | undefined;
  person: (value: string) => PersonRef | undefined;
  belief: (value: string) => Held | undefined;
  society: PlanContext['societyRefs'];
};

const RESOURCE_LIST = RESOURCES as readonly string[];

/** Resolves the args of one step to stored values and a fallback label, or says why it is invalid. */
function encodeArgs(type: StepType, args: string[], l: Lookup): { args: string[]; label: string } | string {
  const place = (id: string) => LOCATIONS[id as LocationId].name;
  const ticks = (value: string): number | null => {
    const [lo, hi] = TICK_BOUNDS[type]!;
    return clampInt(value, lo, hi);
  };
  const amount = (resource: string, value: string): number | null => clampInt(value, 1, resource === 'credits' ? MAX_CREDITS : MAX_GOODS);
  const withPerson = (label: string): { args: string[]; label: string } | string => {
    const who = l.living(args[0]);
    return who ? { args: [who.id], label: label + ' ' + who.name } : 'unknown or dead person';
  };
  switch (type) {
    case 'go':
    case 'flee':
    case 'repair': {
      const loc = args[0].trim();
      if (!isLocation(loc)) return 'unknown location ' + loc.slice(0, 30);
      if (type !== 'repair' && loc === l.here) return 'already there';
      return { args: [loc], label: (type === 'go' ? 'Walk to ' : type === 'flee' ? 'Flee to ' : 'Repair ') + place(loc) };
    }
    case 'work':
    case 'sleep':
    case 'rest':
    case 'wait':
    case 'grow':
    case 'strike': {
      const n = ticks(args[0]);
      if (n === null) return 'bad tick count';
      return { args: [String(n)], label: { work: 'Work a shift', sleep: 'Sleep', rest: 'Rest', wait: 'Wait', grow: 'Tend the grow rack', strike: 'Down tools in protest' }[type] };
    }
    case 'eat':
    case 'drink':
    case 'ration':
      return { args: [], label: { eat: 'Eat', drink: 'Drink', ration: 'Collect the household ration' }[type] };
    case 'buy':
    case 'sell': {
      const resource = args[0].trim();
      if (!(TRADED_RESOURCES as readonly string[]).includes(resource)) return 'not a traded resource';
      const n = amount(resource, args[1]);
      if (n === null) return 'bad quantity';
      return { args: [resource, String(n)], label: (type === 'buy' ? 'Buy ' : 'Sell ') + n + ' ' + resource };
    }
    case 'talk': {
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      const topic = args[1] ? l.belief(args[1]) : undefined;
      return { args: topic ? [who.id, topic.key] : [who.id], label: 'Talk with ' + who.name };
    }
    case 'give': {
      const who = l.living(args[0]);
      const resource = args[1].trim();
      if (!who) return 'unknown or dead person';
      if (!(RESOURCES as readonly string[]).includes(resource)) return 'unknown resource';
      const n = amount(resource, args[2]);
      if (n === null) return 'bad quantity';
      return { args: [who.id, resource, String(n)], label: 'Give ' + who.name + ' ' + n + ' ' + resource };
    }
    case 'steal': {
      const resource = args[1].trim();
      if (!(RESOURCES as readonly string[]).includes(resource)) return 'unknown resource';
      const n = amount(resource, args[2]);
      if (n === null) return 'bad quantity';
      const target = args[0].trim();
      if (target === 'depot') return { args: ['depot', resource, String(n)], label: 'Steal ' + resource + ' from the depot' };
      if (target.startsWith('pantry:')) {
        const owner = l.person(target.slice(7));
        if (!owner?.householdId || owner.householdId === l.householdId) return 'unknown pantry';
        return { args: ['pantry:' + owner.householdId, resource, String(n)], label: 'Steal ' + resource + ' from the ' + owner.name.split(' ').slice(1).join(' ') + ' pantry' };
      }
      const who = l.living(target);
      if (!who) return 'unknown target';
      return { args: [who.id, resource, String(n)], label: 'Steal ' + resource + ' from ' + who.name };
    }
    case 'help':
    case 'investigate': {
      const who = type === 'help' ? l.living(args[0]) : l.person(args[0]);
      if (!who) return 'unknown person';
      return { args: [who.id], label: (type === 'help' ? 'Help ' : 'Look into ') + who.name };
    }
    case 'accuse': {
      const who = l.living(args[0]);
      const held = l.belief(args[1]);
      if (!who) return 'unknown or dead person';
      if (!held || held.subjectId !== who.id) return 'no held belief about them';
      return { args: [who.id, held.key], label: 'Accuse ' + who.name };
    }
    case 'petition': {
      const topic = args[0].trim();
      if (!(topic in PETITION_TOPICS)) return 'unknown petition topic';
      return { args: [topic], label: 'Petition the council' };
    }
    case 'mourn': {
      const who = l.person(args[0]);
      if (!who || who.alive) return 'can only mourn the dead';
      return { args: [who.id], label: 'Mourn ' + who.name };
    }
    case 'scavenge':
    case 'sabotage': {
      const loc = args[0].trim();
      if (!isLocation(loc)) return 'unknown location ' + loc.slice(0, 30);
      if (type === 'scavenge' && !LOCATIONS[loc].exposed) return 'scavenge needs a surface site';
      return { args: [loc], label: (type === 'scavenge' ? 'Scavenge at ' : 'Sabotage ') + place(loc) };
    }
    case 'beg': {
      const who = l.living(args[0]);
      const resource = args[1].trim();
      if (!who) return 'unknown or dead person';
      if (!(BEG_RESOURCES as readonly string[]).includes(resource)) return 'can only beg for food, water or credits';
      return { args: [who.id, resource], label: 'Ask ' + who.name + ' for ' + resource };
    }
    case 'borrow':
    case 'hide': {
      const who = type === 'borrow' ? l.living(args[0]) : undefined;
      if (type === 'borrow' && !who) return 'unknown or dead person';
      const [resource, quantity] = type === 'borrow' ? [args[1].trim(), args[2]] : [args[0].trim(), args[1]];
      if (!RESOURCE_LIST.includes(resource)) return 'unknown resource';
      const n = amount(resource, quantity);
      if (n === null) return 'bad quantity';
      return who
        ? { args: [who.id, resource, String(n)], label: 'Borrow ' + n + ' ' + resource + ' from ' + who.name }
        : { args: [resource, String(n)], label: 'Hide ' + n + ' ' + resource };
    }
    case 'barter': {
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      const [give, want] = [args[1].trim(), args[3].trim()];
      if (!RESOURCE_LIST.includes(give) || !RESOURCE_LIST.includes(want)) return 'unknown resource';
      if (give === want) return 'a swap needs two different goods';
      const [gn, wn] = [amount(give, args[2]), amount(want, args[4])];
      if (gn === null || wn === null) return 'bad quantity';
      return { args: [who.id, give, String(gn), want, String(wn)], label: 'Offer ' + who.name + ' ' + gn + ' ' + give + ' for ' + wn + ' ' + want };
    }
    case 'bribe': {
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      const n = amount('credits', args[1]);
      const favor = args[2].trim();
      if (n === null) return 'bad quantity';
      if (!(BRIBE_FAVORS as readonly string[]).includes(favor)) return 'unknown favor';
      return { args: [who.id, String(n), favor], label: 'Slip ' + who.name + ' ' + n + ' credits' };
    }
    case 'blackmail': {
      const who = l.living(args[0]);
      const held = l.belief(args[1]);
      if (!who) return 'unknown or dead person';
      if (!held || held.own || held.subjectId !== who.id) return 'no held belief about them';
      return { args: [who.id, held.key], label: 'Lean on ' + who.name };
    }
    case 'lie': {
      const who = l.living(args[0]);
      const subject = l.person(args[1]);
      const kind = args[2].trim();
      if (!who) return 'unknown or dead person';
      if (!subject || subject.id === who.id) return 'unknown subject';
      if (!(LIE_KINDS as readonly string[]).includes(kind)) return 'unknown lie';
      return { args: [who.id, subject.id, kind], label: 'Tell ' + who.name + ' a story about ' + subject.name };
    }
    case 'confide': {
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      if (!args[1]) return { args: [who.id], label: 'Confide in ' + who.name };
      const held = l.belief(args[1]);
      if (!held) return 'no such belief or secret';
      return { args: [who.id, held.key], label: 'Confide in ' + who.name };
    }
    case 'confess': {
      const held = l.belief(args[0]);
      if (!held) return 'nothing held to confess';
      return { args: [held.key], label: held.own ? 'Come clean' : 'Confess' };
    }
    case 'repay':
      return withPerson('Pay back');
    case 'court':
      return withPerson('Court');
    case 'comfort':
      return withPerson('Comfort');
    case 'threaten':
      return withPerson('Threaten');
    case 'reconcile':
      return withPerson('Make peace with');
    case 'eavesdrop':
      return withPerson('Listen in on');
    case 'smuggle': {
      const resource = args[0].trim();
      if (!(TRADED_RESOURCES as readonly string[]).includes(resource)) return 'not a traded resource';
      const n = amount(resource, args[1]);
      if (n === null) return 'bad quantity';
      return { args: [resource, String(n)], label: 'Run ' + n + ' ' + resource + ' past the pad crews' };
    }
    case 'rally': {
      const topic = args[0].trim();
      if (!(topic in RALLY_TOPICS)) return 'unknown rally topic';
      return { args: [topic], label: 'Rally the plaza' };
    }
    default:
      return validateSocietyArgs(type, args, { living: l.living, ...l.society });
  }
}

/** Checks a thought job's output. */
export function validateThought(raw: unknown): { ok: true; text: string; mood?: string } | { ok: false; reason: string } {
  const out = asRecord(raw);
  const text = cleanText(out?.thought, MAX_THOUGHT_CHARS);
  return text ? { ok: true, text, mood: cleanText(out?.mood, 24)?.toLowerCase() } : { ok: false, reason: 'no thought' };
}

/** Checks the answer to a player's question. */
export function validateAnswer(raw: unknown): string | undefined {
  return cleanText(asRecord(raw)?.answer, MAX_ANSWER_CHARS);
}

/** Checks a speech job's output. */
export function validateSpeech(raw: unknown): { ok: true; line: string } | { ok: false; reason: string } {
  const line = cleanText(asRecord(raw)?.line, MAX_SPEECH_CHARS);
  return line ? { ok: true, line } : { ok: false, reason: 'no line' };
}
