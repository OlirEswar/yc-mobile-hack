/**
 * Prompts and output schemas for cognition jobs. The model proposes; the simulation decides. Every
 * prompt lists exactly the legal steps and the refs the model may use, and the output is checked
 * again by validate.ts, so nothing the model writes reaches the world unchecked.
 */
import { LOCATIONS, LOCATION_IDS, RESOURCES, TRADED_RESOURCES } from '../../shared/colony';
import type { GoalKind } from '../../shared/types';
import { STEP_SPECS } from '../engine/core';
import type { PlanContext, SpeechContext } from './context';
import type { ChatRequest } from './provider';

export const GOAL_KINDS: readonly GoalKind[] = [
  'survive',
  'earn_wealth',
  'acquire_resource',
  'protect_person',
  'improve_relationship',
  'gain_influence',
  'change_job',
  'join_faction',
  'avoid_person',
  'investigate',
  'custom',
];

export const PETITION_TOPICS: Record<string, string> = {
  rations_open: 'open the depot reserve to everyone',
  rations_guard: 'keep the depot reserve locked for hard times',
  seat: 'a council seat for themself',
  trade: 'free trade without council price rules',
};

export const MAX_STEPS = 8;
export const MAX_SPEECH_CHARS = 90;

const ARG_HELP: Record<string, string> = {
  locationId: 'a location id',
  ticks: 'whole number of 10-minute ticks',
  resource: 'a resource',
  quantity: 'whole number',
  agentId: 'a person ref like p3',
  'topicKey?': 'optional belief ref like b2, to share that belief',
  target: 'a person ref, "depot", or "pantry:p3" for that person\'s household pantry',
  beliefKey: 'ref of a belief about that person',
  topic: 'a petition topic',
};

const RULES_PLAN = `You are the private mind of one colonist in Shackleton Colony, a cramped Moon base of about 100 people where water is scarce and everyone knows everyone. You decide what this person tries to do over the next few hours. You never decide outcomes: the simulation plays each step and it may fail.

Rules:
- Stay in character. Their personality, values, mood, needs and relationships drive the choice. Ordinary people mostly keep their routines; break routine only for a reason this person would feel.
- Strong or desperate needs and danger come first unless this person would truly sacrifice for someone.
- Beliefs are what this person thinks, not facts. They can be false. Weigh confidence and source: a cautious or fair-minded person checks before acting, a hot-headed or resentful one may not.
- They know only what is listed. Never invent people, places, goods or facts. Use only the given refs (p1, b1) and ids.
- Steps run in order. talk, give, help and steal need the other person in the same place at that moment: people marked HERE are present now; to meet anyone else, first go where they usually are.
- To look after someone, get the goods and then give or help in person. Buying costs the listed price per unit, so check they can afford it; the depot ration (ration step at the Supply Depot) is free.
- During their working hours most people keep their job going unless something matters more to them.
- 2 to 6 steps, concrete and plausible. Do not repeat what they are already doing for no reason.
- intent: one sentence, third person, present tense, with their first name and the motive, e.g. "Mira heads to the depot to see the reserve for herself, because she doubts the rumor about Dmitri."
- label per step: a short imperative phrase with real names and places, e.g. "Ask Joao about the rumor", "Walk to the Supply Depot".
- goal: only when this moment gives them a new or sharper purpose, otherwise null. targetAgentId is a person ref or null.
- speech: one short line they say aloud right now (under 90 characters, natural, no quotes), or null.
Reply with JSON only: {"intent": string, "goal": {"kind", "description", "priority" 0..1, "targetAgentId"} or null, "steps": [{"type", "args": [string], "label"}], "speech": string or null}.`

const SYSTEM_SPEECH = `You write one line of dialogue for a colonist of Shackleton Colony, a cramped Moon base where water is scarce. The line must fit their personality, mood and what they think of the person they are talking to, and must sound like real speech: plain, specific, under 90 characters, no quotes, no stage directions, no emojis. Never invent facts beyond what is given. Reply with JSON {"line": "..."}.`;

/** Strict JSON schema for a plan: every field required, optional ones nullable. */
export const PLAN_SCHEMA = {
  name: 'colonist_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'goal', 'steps', 'speech'],
    properties: {
      intent: { type: 'string' },
      goal: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'description', 'priority', 'targetAgentId'],
            properties: {
              kind: { type: 'string', enum: [...GOAL_KINDS] },
              description: { type: 'string' },
              priority: { type: 'number' },
              targetAgentId: { type: ['string', 'null'] },
            },
          },
        ],
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'args', 'label'],
          properties: {
            type: { type: 'string', enum: Object.keys(STEP_SPECS) },
            args: { type: 'array', items: { type: 'string' } },
            label: { type: 'string' },
          },
        },
      },
      speech: { type: ['string', 'null'] },
    },
  },
};

export const SPEECH_SCHEMA = {
  name: 'colonist_line',
  schema: { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } },
};

/** Step descriptions where the prompt says it better than STEP_SPECS for the model's refs. */
const ABOUT: Partial<Record<keyof typeof STEP_SPECS, string>> = {
  steal: 'Steal from a person, from the depot, or from a household pantry. May be witnessed.',
};

const conf = (x: number): string => x.toFixed(1);

function legalSteps(): string {
  const steps = Object.entries(STEP_SPECS).map(([type, spec]) => '- ' + type + '(' + spec.args.join(', ') + '): ' + (ABOUT[type as keyof typeof STEP_SPECS] ?? spec.about));
  const args = Object.entries(ARG_HELP).map(([name, help]) => name + ' = ' + help).join('; ');
  const places = LOCATION_IDS.map((id) => id + ' (' + LOCATIONS[id].name + (LOCATIONS[id].exposed ? ', surface' : '') + ')').join(', ');
  const petitions = Object.entries(PETITION_TOPICS).map(([key, about]) => key + ' (' + about + ')').join(', ');
  return [
    'Legal steps, args in order, all args as strings:',
    ...steps,
    'Args: ' + args + '.',
    'Locations: ' + places + '.',
    'Resources: ' + RESOURCES.join(', ') + ' (buy and sell only ' + TRADED_RESOURCES.join(', ') + '; quantities 1 to 10, credits up to 100).',
    'Petition topics: ' + petitions + '.',
  ].join('\n');
}

/** Static, so providers can cache it as a prompt prefix: the rules and the legal steps. */
const SYSTEM_PLAN = RULES_PLAN + '\n\n' + legalSteps();

/** The full request for a plan job. */
export function planRequest(c: PlanContext): ChatRequest {
  const first = c.name.split(' ')[0];
  const refOf = (id?: string) => c.people.find((p) => p.id === id)?.ref;
  const lines: string[] = [
    'You are deciding for ' + c.name + ', ' + c.identity + '.',
    'Background: ' + c.background,
    'Personality: ' + c.personality + '. Values: ' + c.values + '.',
    'Mood: ' + c.mood + '. ' + c.condition + '.',
    'Carrying: ' + c.inventory + '.' + (c.household ? ' Household: ' + c.household + '.' : ''),
    'Home: ' + c.homeLocationId + '. Workplace: ' + (c.workLocationId ?? 'none') + '.',
    'Now: ' + c.clock + ', at ' + c.locationId + '. Currently: ' + c.doing + '.',
    '',
    'Colony:',
    ...c.world.map((w) => '- ' + w),
    '',
    'Goals:',
    ...(c.goals.length > 0
      ? c.goals.map((g) => '- [' + g.kind + ', priority ' + conf(g.priority) + '] ' + g.description + (refOf(g.targetId) ? ' (about ' + refOf(g.targetId) + ')' : ''))
      : ['- none']),
    '',
    'What ' + first + ' believes (may be false):',
    ...(c.beliefs.length > 0
      ? c.beliefs.map(
          (b) =>
            '- ' + b.ref + ' (' + b.sourceType + (b.sourceName ? ' from ' + b.sourceName : '') + ', confidence ' + conf(b.confidence) + ') ' + b.text + (refOf(b.subjectId) ? ' [about ' + refOf(b.subjectId) + ']' : ''),
        )
      : ['- nothing in particular']),
    '',
    'People ' + first + ' knows:',
    ...c.people.map(
      (p) =>
        '- ' + p.ref + ' ' + p.name + ', ' + p.occupation + (p.alive ? (p.present ? ' - HERE' : ' - usually at ' + p.usualPlace) : ' - DEAD') + (p.tie ? '; ' + p.tie : ''),
    ),
    '',
    'Recent memories:',
    ...(c.memories.length > 0 ? c.memories.map((m) => '- ' + m) : ['- an ordinary stretch of days']),
    '',
    'Why you are deciding now: ' + c.trigger + (c.detail ? '. ' + c.detail : '') + '.',
  ];
  return { system: SYSTEM_PLAN, user: lines.join('\n'), maxTokens: 600, schema: PLAN_SCHEMA };
}

/** The full request for a speech job. */
export function speechRequest(c: SpeechContext): ChatRequest {
  const lines = [
    c.name + ', ' + c.identity + '. Personality: ' + c.personality + '. Mood: ' + c.mood + '.',
    'At ' + c.place + ', ' + c.doing.charAt(0).toLowerCase() + c.doing.slice(1) + ', talking with ' + c.partner.name + ' (' + c.partner.occupation + (c.partner.tie ? '; ' + c.partner.tie : '') + ').',
    ...(c.aboutPartner.length > 0 ? ['What ' + c.name.split(' ')[0] + ' believes about them (may be false): ' + c.aboutPartner.join(' ')] : []),
    c.prices + '.',
    'Situation: ' + c.trigger + (c.detail ? '. ' + c.detail : '') + '.',
    'Write what ' + c.name.split(' ')[0] + ' says to ' + c.partner.name.split(' ')[0] + ' now.',
  ];
  return { system: SYSTEM_SPEECH, user: lines.join('\n'), maxTokens: 80, schema: SPEECH_SCHEMA, temperature: 0.9 };
}
