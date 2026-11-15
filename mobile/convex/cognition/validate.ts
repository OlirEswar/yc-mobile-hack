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
import type { PersonRef, PlanContext } from './context';
import { GOAL_KINDS, MAX_SPEECH_CHARS, MAX_STEPS, PETITION_TOPICS } from './prompt';

export type ValidGoal = { kind: string; description: string; priority: number; targetAgentId?: Id<'agents'> };

export type ValidPlan = {
  intent: string;
  /** Encoded "type|arg|arg" steps with real ids. */
  steps: string[];
  labels: string[];
  goal?: ValidGoal;
  speech?: string;
};

export type PlanValidation = { ok: true; plan: ValidPlan; dropped: string[] } | { ok: false; reason: string; dropped: string[] };

/** Bounds per step type for tick arguments. */
const TICK_BOUNDS: Partial<Record<StepType, [number, number]>> = { work: [1, 48], sleep: [6, 60], rest: [1, 18], wait: [1, 18] };
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
  const belief = (value: string) => c.beliefs.find((b) => b.ref === value.trim().toLowerCase());

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
    const encoded = encodeArgs(type as StepType, args.slice(0, spec.args.length), { here, householdId: c.householdId, living, person, belief });
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

type Lookup = {
  here: LocationId;
  householdId?: string;
  living: (value: string) => PersonRef | undefined;
  person: (value: string) => PersonRef | undefined;
  belief: (value: string) => PlanContext['beliefs'][number] | undefined;
};

/** Resolves the args of one step to stored values and a fallback label, or says why it is invalid. */
function encodeArgs(type: StepType, args: string[], l: Lookup): { args: string[]; label: string } | string {
  const place = (id: string) => LOCATIONS[id as LocationId].name;
  const ticks = (value: string): number | null => {
    const [lo, hi] = TICK_BOUNDS[type]!;
    return clampInt(value, lo, hi);
  };
  const amount = (resource: string, value: string): number | null => clampInt(value, 1, resource === 'credits' ? MAX_CREDITS : MAX_GOODS);
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
    case 'wait': {
      const n = ticks(args[0]);
      if (n === null) return 'bad tick count';
      return { args: [String(n)], label: { work: 'Work a shift', sleep: 'Sleep', rest: 'Rest', wait: 'Wait' }[type] };
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
  }
}

/** Checks a speech job's output. */
export function validateSpeech(raw: unknown): { ok: true; line: string } | { ok: false; reason: string } {
  const line = cleanText(asRecord(raw)?.line, MAX_SPEECH_CHARS);
  return line ? { ok: true, line } : { ok: false, reason: 'no line' };
}
