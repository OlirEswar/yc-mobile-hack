/**
 * Prompts and output schemas for cognition jobs. The model proposes; the simulation decides. Every
 * prompt lists exactly the legal steps and the refs the model may use, and the output is checked
 * again by validate.ts, so nothing the model writes reaches the world unchecked.
 */
import { LOCATIONS, LOCATION_IDS, RESOURCES, TRADED_RESOURCES } from '../../shared/colony';
import type { GoalKind } from '../../shared/types';
import { STEP_SPECS } from '../engine/core';
import { SOCIETY_ARG_KINDS } from '../society/validate';
import type { AskContext, PersonaContext, PlanContext, SpeechContext, ThoughtContext } from './context';
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

export const RALLY_TOPICS: Record<string, string> = {
  strike: 'a work stoppage',
  rations_open: 'opening the depot reserve to everyone',
  recall_chair: 'removing the council chair',
  trade: 'free trade without council price rules',
};
export const BRIBE_FAVORS = ['silence', 'vote', 'ration', 'look_away'] as const;
export const LIE_KINDS = ['thief', 'hoarding', 'saboteur', 'corrupt', 'affair', 'coward'] as const;
export const BEG_RESOURCES = ['food', 'water', 'credits'] as const;

export const MAX_STEPS = 8;
export const MAX_SPEECH_CHARS = 90;
export const MAX_THOUGHT_CHARS = 600;
export const MAX_ANSWER_CHARS = 700;

const ARG_HELP: Record<string, string> = {
  locationId: 'a location id',
  ticks: 'whole number of 10-minute ticks',
  resource: 'a resource',
  quantity: 'whole number',
  agentId: 'a person ref like p3',
  'topicKey?': 'optional belief ref like b2, to share that belief',
  target: 'a person ref, "depot", or "pantry:p3" for that person\'s household pantry',
  beliefKey: 'ref of a held belief (about that person for accuse and blackmail); s1 is their own secret (confess)',
  'beliefKey?': 'optional ref of a belief or s1, the secret to share',
  topic: 'a petition topic for petition, a rally topic for rally',
  giveResource: 'resource offered',
  giveQuantity: 'whole number offered',
  wantResource: 'resource asked for',
  wantQuantity: 'whole number asked for',
  favor: BRIBE_FAVORS.join(' | '),
  subjectId: 'person ref the lie is about',
  kind: 'for lie: ' + LIE_KINDS.join(' | ') + '; for society steps see their description',
};

const RULES_PLAN = `You are the private mind of one colonist in Shackleton Colony, a cramped Moon base of about 100 people on the rim of Shackleton crater. Water is scarce, the founding consortium went bankrupt seven years ago, and everyone still blames someone for the Long Dark. You decide what this person tries to do over the next few hours. You never decide outcomes: the simulation plays each step and it may fail or backfire.

Rules:
- Act from who they are, not from a timetable: their want, their fear, their flaw, their secret, their debts, grudges and loves. A schedule is a consequence of those. People still need to eat, drink and sleep, and most keep their job unless something matters more.
- Meet needs the way this person would: their strategies are listed in order of preference (a grower grows, a worker earns and buys, a charmer begs or borrows, a schemer skims or bribes, an opportunist scavenges or smuggles). A desperate person reaches further down their list.
- If something in the last hours touched their want, fear, debt or secret (see recent memories and stories), the plan answers it now with a real move from the full list: seek the person out, hide the evidence, bribe, repay, borrow, confide, lie, threaten, court, reconcile, confess. Carrying on as usual is a choice only when it is the clever one, and then the intent says why.
- Their flaw should sometimes win. Their fear should make them protect their secret: hide, lie, bribe or threaten rather than be exposed, unless they are ready to confess.
- Use relationships: repay or dodge debts, court who they love, comfort who is hurting, confront who wronged them, reconcile when it costs them less than the feud, blackmail when they hold leverage and lack scruples.
- Beliefs are what this person thinks, not facts. They can be false. A cautious or fair person checks before acting; a hot-headed or resentful one may not.
- They know only what is listed. Never invent people, places, goods or facts. Use only the given refs (p1, b1, s1) and ids.
- Steps run in order. Steps with a person (talk, give, help, steal, beg, borrow, repay, barter, bribe, blackmail, lie, confide, court, comfort, threaten, reconcile, eavesdrop) need that person in the same place: people marked HERE are present now; to meet anyone else, first go where they usually are.
- Buying costs the listed price per unit; check they can afford it. The depot ration (ration step at the Supply Depot) is free. smuggle happens at the Landing Pad.
- 2 to 6 steps, concrete and plausible. Do not repeat what they are already doing for no reason, and do not fall back on the same plan twice in a row.
- intent: one sentence, third person, present tense, with their first name and the real motive, e.g. "Ines slips into the depot after the shift, because Tomas's fever is worse and the ration will not cover his water."
- label per step: a short imperative phrase with real names and places, e.g. "Ask Joao for a loan", "Walk to the Supply Depot".
- goal: only when this moment gives them a new or sharper purpose, otherwise null. targetAgentId is a person ref or null.
- speech: one short line they say aloud right now, in their voice (under 90 characters, natural, no quotes), or null.
- thought: when asked for, 2 to 4 flowing sentences of inner monologue in the first person and present tense, in their voice, dramatic and emotional, with what is at stake for them, continuing their recent thoughts without restating them; never notes or fragments; otherwise null. Speak of people, places and feelings, never numbers or stats.
Reply with JSON only: {"intent": string, "goal": {"kind", "description", "priority" 0..1, "targetAgentId"} or null, "steps": [{"type", "args": [string], "label"}], "speech": string or null, "thought": string or null}.`;

const SYSTEM_SPEECH = `You write one line of dialogue for a colonist of Shackleton Colony, a cramped Moon base where water is scarce. The line must fit their voice, personality, mood and what they think of the person they are talking to, and must sound like real speech: plain, specific, under 90 characters, no quotes, no stage directions, no emojis. Never invent facts beyond what is given. Reply with JSON {"line": "..."}.`;

const SYSTEM_THOUGHT = `You write the inner voice of a colonist of Shackleton Colony, a cramped Moon base where water is scarce and everyone knows everyone. The player is following this person and reads their thoughts as one unfolding stream, like the narration of a novel told from inside their head.
- Write 2 to 4 flowing sentences (35 to 80 words), first person, present tense, in this person's own way of speaking (see their voice). It should sound like a character talking to themselves, with rhythm and feeling: never notes, never a list, never clipped fragments, never stage directions.
- Dramatic and emotional, with stakes: what they stand to lose or gain right now, what they want and what they dread. Let a memory surface when it fits (the Long Dark, the founding, the company leaving, something this person did or suffered). Let the secret show only as worry, guilt or calculation, never as an explanation for the reader.
- Continue the train of thought in their earlier lines: pick up where the last one left off and carry it further, a doubt hardening into a decision, a suspicion finding its proof, a temptation winning. Never restate or paraphrase what they already thought.
- React to what just happened or what they are about to do. Concrete: name the people and places involved. Human terms only: never numbers, percentages, stats or game words.
- No cliches, no quotes, no emojis, no third person.
Reply with JSON {"thought": string, "mood": one or two words}.`;

const SYSTEM_ASK = `You are a colonist of Shackleton Colony, a cramped Moon base of about 100 people on the rim of Shackleton crater. A voice with no body speaks inside your head and asks you something. You do not know what it is; you answer it as yourself.
- First person, in your own voice, 1 to 4 sentences, under 90 words. Speak from your wants, fears, memories and relationships, naming real people and places.
- Human terms only: never numbers, stats, percentages or game words. Never mention AI, games, players or simulations.
- Your secret: how much you reveal depends on how you treat the voice (listed). Guarded people deflect or lie outright, wary people hint and change the subject, open or desperate people may let a piece slip. Say it plainly only if it is already exposed.
- You know only what is listed. Do not invent events. You may be wrong about others, since beliefs can be false.
- You make no promises: talking to the voice changes nothing about what you will do.
Reply with JSON {"answer": string}.`;

const nullable = (type: string) => ({ type: [type, 'null'] });

/** Strict JSON schema for a plan: every field required, optional ones nullable. */
export const PLAN_SCHEMA = {
  name: 'colonist_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'goal', 'steps', 'speech', 'thought'],
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
              targetAgentId: nullable('string'),
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
      speech: nullable('string'),
      thought: nullable('string'),
    },
  },
};

export const SPEECH_SCHEMA = {
  name: 'colonist_line',
  schema: { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } },
};

export const THOUGHT_SCHEMA = {
  name: 'colonist_thought',
  schema: { type: 'object', additionalProperties: false, required: ['thought', 'mood'], properties: { thought: { type: 'string' }, mood: { type: 'string' } } },
};

export const ASK_SCHEMA = {
  name: 'colonist_answer',
  schema: { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } },
};

/** Step descriptions where the prompt says it better than STEP_SPECS for the model's refs. */
const ABOUT: Partial<Record<keyof typeof STEP_SPECS, string>> = {
  steal: 'Steal from a person, from the depot, or from a household pantry. May be witnessed.',
  confess: 'Publicly admit something: s1 (their own secret) or a held belief about what they did.',
};

const conf = (x: number): string => x.toFixed(1);

function legalSteps(): string {
  const steps = Object.entries(STEP_SPECS).map(([type, spec]) => {
    const kinds = SOCIETY_ARG_KINDS[type as keyof typeof SOCIETY_ARG_KINDS];
    const about = ABOUT[type as keyof typeof STEP_SPECS] ?? spec.about;
    return '- ' + type + '(' + spec.args.join(', ') + '): ' + about + (kinds ? ' Args: ' + Object.entries(kinds).map(([k, h]) => k + ' = ' + h).join('; ') + '.' : '');
  });
  const args = Object.entries(ARG_HELP).map(([name, help]) => name + ' = ' + help).join('; ');
  const places = LOCATION_IDS.map((id) => id + ' (' + LOCATIONS[id].name + (LOCATIONS[id].exposed ? ', surface' : '') + ')').join(', ');
  const topics = (t: Record<string, string>) => Object.entries(t).map(([key, about]) => key + ' (' + about + ')').join(', ');
  return [
    'Legal steps, args in order, all args as strings:',
    ...steps,
    'Args: ' + args + '.',
    'Locations: ' + places + '. scavenge only at surface sites.',
    'Resources: ' + RESOURCES.join(', ') + ' (buy, sell and smuggle only ' + TRADED_RESOURCES.join(', ') + '; beg only ' + BEG_RESOURCES.join(', ') + '; quantities 1 to 10, credits up to 100).',
    'Petition topics: ' + topics(PETITION_TOPICS) + '.',
    'Rally topics: ' + topics(RALLY_TOPICS) + '.',
  ].join('\n');
}

/** Static, so providers can cache it as a prompt prefix: the rules and the legal steps. */
const SYSTEM_PLAN = RULES_PLAN + '\n\n' + legalSteps();

/** The character sheet in words, shared by every prompt that speaks for someone. */
function personaLines(first: string, persona: PersonaContext | undefined, secret: { text: string; exposed: boolean } | undefined): string[] {
  if (!persona) return [];
  return [
    first + ' is ' + persona.epithet + '.',
    'Wants: ' + persona.want + '. Truly needs: ' + persona.need + '.',
    'Fears: ' + persona.fear + '. Flaw: ' + persona.flaw + '.',
    'Voice: ' + persona.voice + '.',
    ...(persona.strategies.length > 0 ? ['Ways they get by, most preferred first: ' + persona.strategies.join(', ') + '.'] : []),
    'Where their story stands: ' + persona.arc + '.',
    ...(secret ? [(secret.exposed ? 'Their secret, now known to others: ' : 'Their secret (s1), which they guard: ') + secret.text] : []),
  ];
}

/** What the plan and the ask prompts share. */
type Situation = Omit<PlanContext, 'kind'>;

function peopleLines(c: Situation): string[] {
  return c.people.map(
    (p) => '- ' + p.ref + ' ' + p.name + ', ' + p.occupation + (p.alive ? (p.present ? ' - HERE' : ' - usually at ' + p.usualPlace) : ' - DEAD') + (p.tie ? '; ' + p.tie : ''),
  );
}

function beliefLines(c: Situation): string[] {
  const refOf = (id?: string) => c.people.find((p) => p.id === id)?.ref;
  return c.beliefs.length > 0
    ? c.beliefs.map(
        (b) => '- ' + b.ref + ' (' + b.sourceType + (b.sourceName ? ' from ' + b.sourceName : '') + ', confidence ' + conf(b.confidence) + ') ' + b.text + (refOf(b.subjectId) ? ' [about ' + refOf(b.subjectId) + ']' : ''),
      )
    : ['- nothing in particular'];
}

/** Who they are and what they know, shared by the plan and the ask prompts. */
function situationLines(c: Situation): string[] {
  const first = c.name.split(' ')[0];
  const refOf = (id?: string) => c.people.find((p) => p.id === id)?.ref;
  return [
    c.name + ', ' + c.identity + '.',
    'Background: ' + c.background,
    ...personaLines(first, c.persona, c.secret),
    ...(c.society.length > 0 ? ['Their place in colony life:', ...c.society.map((l) => '- ' + l)] : []),
    'Personality: ' + c.personality + '. Values: ' + c.values + '.',
    'Mood: ' + c.mood + '. ' + c.condition + '.',
    'Carrying: ' + c.inventory + '.' + (c.household ? ' Household: ' + c.household + '.' : ''),
    'Home: ' + c.homeLocationId + '. Workplace: ' + (c.workLocationId ?? 'none') + '.',
    'Now: ' + c.clock + ', at ' + c.locationId + '. Currently: ' + c.doing + '.',
    '',
    'Colony:',
    ...c.world.map((w) => '- ' + w),
    '',
    ...(c.storylines.length > 0 ? ['Stories ' + first + ' is caught up in:', ...c.storylines.map((l) => '- ' + l), ''] : []),
    ...(c.societyRefs.orgs.length > 0 ? ['Organizations (orgId: name, kind):', ...c.societyRefs.orgs.map((o) => '- ' + o.id + ': ' + o.name + ', ' + o.kind + (o.leader ? ' (they lead it)' : o.member ? ' (member)' : '')), ''] : []),
    'Goals:',
    ...(c.goals.length > 0
      ? c.goals.map((g) => '- [' + g.kind + ', priority ' + conf(g.priority) + '] ' + g.description + (refOf(g.targetId) ? ' (about ' + refOf(g.targetId) + ')' : ''))
      : ['- none']),
    '',
    'What ' + first + ' believes (may be false):',
    ...beliefLines(c),
    '',
    'People ' + first + ' knows:',
    ...peopleLines(c),
    '',
    'Recent memories:',
    ...(c.memories.length > 0 ? c.memories.map((m) => '- ' + m) : ['- an ordinary stretch of days']),
  ];
}

/** The full request for a plan job. */
export function planRequest(c: PlanContext): ChatRequest {
  const first = c.name.split(' ')[0];
  const lines: string[] = [
    'You are deciding for ' + c.name + '.',
    ...situationLines(c),
    ...(c.thoughts.length > 0 ? ['', first + "'s recent thoughts, newest first:", ...c.thoughts.map((t) => '- ' + t)] : []),
    '',
    'Why you are deciding now: ' + c.trigger + (c.detail ? '. ' + c.detail : '') + '.',
    c.followed
      ? 'The player is following ' + first + ' closely: make the choice worth watching, true to their want, fear and secret. Fill thought with a fresh line that does not echo the recent ones.'
      : 'thought: null.',
  ];
  return { system: SYSTEM_PLAN, user: lines.join('\n'), maxTokens: 700, schema: PLAN_SCHEMA };
}

/** The full request for a speech job. */
export function speechRequest(c: SpeechContext): ChatRequest {
  const lines = [
    c.name + ', ' + c.identity + '. Personality: ' + c.personality + '. Mood: ' + c.mood + '.' + (c.voice ? ' Voice: ' + c.voice + '.' : ''),
    'At ' + c.place + ', ' + c.doing.charAt(0).toLowerCase() + c.doing.slice(1) + ', talking with ' + c.partner.name + ' (' + c.partner.occupation + (c.partner.tie ? '; ' + c.partner.tie : '') + ').',
    ...(c.aboutPartner.length > 0 ? ['What ' + c.name.split(' ')[0] + ' believes about them (may be false): ' + c.aboutPartner.join(' ')] : []),
    c.prices + '.',
    'Situation: ' + c.trigger + (c.detail ? '. ' + c.detail : '') + '.',
    'Write what ' + c.name.split(' ')[0] + ' says to ' + c.partner.name.split(' ')[0] + ' now.',
  ];
  return { system: SYSTEM_SPEECH, user: lines.join('\n'), maxTokens: 80, schema: SPEECH_SCHEMA, temperature: 0.9 };
}

/** The full request for one line of inner monologue. */
export function thoughtRequest(c: ThoughtContext): ChatRequest {
  const first = c.name.split(' ')[0];
  const lines = [
    c.name + ', ' + c.identity + '. Personality: ' + c.personality + '.',
    ...personaLines(first, c.persona, c.secret),
    ...(c.society.length > 0 ? ['Their place in colony life: ' + c.society.join('; ') + '.'] : []),
    'Mood: ' + c.mood + '. ' + c.feeling + '.',
    'At ' + c.place + ', ' + c.doing.charAt(0).toLowerCase() + c.doing.slice(1) + '.' + (c.intent ? ' What they mean to do: ' + c.intent : ''),
    ...(c.storylines.length > 0 ? ['Stories they are caught up in: ' + c.storylines.join(' | ')] : []),
    ...(c.memories.length > 0 ? ['Lately: ' + c.memories.join(' | ')] : []),
    ...(c.recent.length > 0 ? ['', first + "'s inner voice so far, oldest first. Continue this train of thought, never restate it:", ...c.recent.slice(0, 5).reverse().map((t) => '- ' + t)] : []),
    'What just happened: ' + c.trigger + (c.detail ? '. ' + c.detail : '') + '.',
    'Write what ' + first + ' thinks next, as 2 to 4 flowing sentences in their voice.',
  ];
  return { system: SYSTEM_THOUGHT, user: lines.join('\n'), maxTokens: 320, schema: THOUGHT_SCHEMA, temperature: 1 };
}

/** The full request for an answer to the player's question. */
export function askRequest(c: AskContext): ChatRequest {
  const first = c.name.split(' ')[0];
  const lines = [
    'You are ' + c.name + '.',
    ...situationLines(c),
    '',
    'How you treat the voice: ' + c.openness + '.',
    ...(c.history.length > 0 ? ['Earlier, the voice asked:', ...c.history.map((h) => '- Q: ' + h.question + ' / You said: ' + h.answer)] : []),
    '',
    'The voice asks ' + first + ': ' + c.question,
  ];
  return { system: SYSTEM_ASK, user: lines.join('\n'), maxTokens: 260, schema: ASK_SCHEMA, temperature: 0.9 };
}
