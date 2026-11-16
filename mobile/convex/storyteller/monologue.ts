/**
 * The followed colonist's inner monologue (docs/STORY_SPEC.md 5). Lines come from the LLM, either as
 * the thought of a focus-lane plan answer or from a 'thought' job, and from the rules below when the
 * LLM is off or its budget is spent. Thoughts never change the world; they only explain it.
 */
import type { Doc } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LOCATIONS } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import type { AgentDoc, MindDoc, Tx } from '../engine/core';
import { hash32 } from '../lib/rng';
import { firstName, isEasing, isHostile, kindOfEvent } from './storylines';

/** Appends a line to a colonist's monologue. */
export async function writeThought(tx: Tx, agentId: AgentDoc['_id'], text: string, source: 'llm' | 'rules' | 'planted', mood?: string): Promise<void> {
  await tx.ctx.db.insert('thoughts', { worldId: tx.world._id, agentId, tick: tx.tick, text, mood, source });
}

/** The latest monologue lines of a colonist, newest first. */
export async function recentThoughts(tx: Tx, agentId: AgentDoc['_id'], max: number): Promise<Doc<'thoughts'>[]> {
  return await tx.ctx.db
    .query('thoughts')
    .withIndex('by_agent_tick', (q) => q.eq('agentId', agentId))
    .order('desc')
    .take(max);
}

/**
 * Queues a focus-lane 'thought' job, the way enqueueCognition queues plans. The caller has checked
 * that the LLM can take it and that nothing else is queued for the agent.
 */
export async function queueThought(tx: Tx, a: AgentDoc, mind: MindDoc, job: { trigger: string; detail?: string; eventId?: Doc<'events'>['_id'] }): Promise<void> {
  await tx.ctx.db.insert('cognitionJobs', {
    worldId: tx.world._id,
    agentId: a._id,
    kind: 'thought',
    trigger: job.trigger,
    detail: job.detail,
    priority: 0.9,
    status: 'queued',
    lane: 'focus',
    enqueuedTick: tx.tick,
    mindVersion: mind.stateVersion,
    attempts: 0,
    eventId: job.eventId,
  });
  tx.world.llm.queued += 1;
  await tx.ctx.scheduler.runAfter(0, internal.cognition.drain, { worldId: tx.world._id });
}

/** What the followed colonist is reacting to. */
export type Moment =
  | { kind: 'event'; event: Doc<'events'>; otherName?: string }
  | { kind: 'plan'; label: string; step?: string; place?: string; otherName?: string }
  | { kind: 'idle'; otherName?: string }
  | { kind: 'wake'; otherName?: string };

/** A place name as it reads in a sentence: "the Supply Depot", "Habitat Ring A", "The Airlock Canteen". */
function placeName(id?: string): string {
  const name = LOCATIONS[id as LocationId]?.name;
  if (!name) return 'the colony';
  return /^(The |Habitat)/.test(name) ? name : 'the ' + name;
}
const place = placeName;

/** One short line about how their body feels, or nothing when it is fine. */
function bodyLine(a: AgentDoc): string | undefined {
  if (a.needs.thirst >= 65) return 'My throat feels like regolith.';
  if (a.needs.hunger >= 65) return "I can't remember the last real meal.";
  if (a.needs.fatigue >= 75) return 'I could sleep standing up.';
  if (a.needs.safety >= 60) return 'Something about today feels wrong.';
  if (a.needs.social >= 75) return "I haven't had a real conversation in days.";
  return undefined;
}

const SNEAKY = new Set(['steal', 'smuggle', 'hide', 'sabotage', 'eavesdrop', 'bribe', 'blackmail', 'lie']);
const TENDER = new Set(['court', 'comfort', 'confide', 'reconcile', 'help', 'give', 'repay']);
const HARD = new Set(['threaten', 'accuse', 'confess', 'rally', 'strike', 'petition']);
const SUPPLY = new Set(['eat', 'drink', 'ration', 'buy', 'beg', 'borrow', 'barter', 'grow', 'scavenge']);

/** Candidate lines for a moment, in the colonist's first person. */
function candidates(a: AgentDoc, mind: MindDoc, m: Moment): string[] {
  const hiding = !!mind.persona?.secret && mind.persona.secret.exposedAtTick === undefined;
  const body = bodyLine(a);
  if (m.kind === 'plan') {
    const x = m.otherName ? firstName(m.otherName) : undefined;
    const step = m.step ?? '';
    if (SNEAKY.has(step)) return ["Quick and quiet. Nobody needs to know.", "Don't think about it. Just do it.", x ? 'If ' + x + ' finds out, I will think of something.' : 'My hands are steadier than my nerves.'];
    if (TENDER.has(step) && x) return ['I need to see ' + x + '.', x + " first. I've put this off long enough.", 'Maybe ' + x + ' is the one person I can be straight with.'];
    if (HARD.has(step)) return [x ? 'Time ' + x + ' heard it from me.' : 'Enough waiting. Today I say it out loud.', 'My voice had better not shake.', 'No turning back after this.'];
    if (step === 'talk' && x) return ['I should talk to ' + x + '.', x + ' will know what people are saying.', 'Let me see what ' + x + ' makes of all this.'];
    if (SUPPLY.has(step)) return [body ?? 'Supplies first. Everything else can wait.', 'Water and food, then I can think straight.', 'Everything here costs something. Even breathing.'];
    if (step === 'work' || step === 'study' || step === 'experiment') return ['Back to it. The work does not care how I feel.', 'Another shift. Head down, hands busy.', hiding ? 'If I keep working, nobody asks questions.' : (body ?? 'At least work makes sense.')];
    if (step === 'sleep') return ['Bed. Maybe tonight I sleep through.', 'Lights out. Tomorrow comes either way.', hiding ? 'Another day nobody found out.' : 'Enough for one day.'];
    if (step === 'go' && m.place) return ['Off to ' + place(m.place) + '.', place(m.place).replace(/^the /, 'The ') + ", then. Let's see who is there.", body ?? 'Keep moving.'];
    return [body ?? 'One thing at a time.', 'Fine. One thing at a time.', 'Keep going. Just keep going.'];
  }
  if (m.kind === 'wake') {
    const x = m.otherName ? firstName(m.otherName) : undefined;
    return [
      x ? 'Awake. First thing in my head is ' + x + '. Not a good sign.' : 'Awake before the lights. My head started without me.',
      hiding ? 'Another morning. Another day of keeping my face straight.' : (body ?? 'Up. The colony will not run itself.'),
      'The vents are louder in the morning. Or I am listening harder.',
    ];
  }
  if (m.kind === 'idle') {
    const x = m.otherName ? firstName(m.otherName) : undefined;
    if (a.activity === 'working' || a.activity === 'trading') {
      return [
        'Work keeps my hands busy. It does nothing for the rest of me.',
        x ? 'Same hum, same shift, and my head keeps going back to ' + x + '.' : 'Same hum, same shift. My head is somewhere else.',
        hiding ? 'Every time someone walks past, I wonder what they know.' : 'One more hour and I can think about something else.',
      ];
    }
    return [
      place(a.locationId).replace(/^the /, 'The ') + ' is quiet. Too quiet to stop thinking.',
      x ? 'What is ' + x + ' planning? I would give a lot to know.' : 'I keep replaying the last few days.',
      hiding ? 'What if they find out? What then?' : (body ?? 'Breathe. Just breathe for a moment.'),
    ];
  }
  const e = m.event;
  const x = m.otherName ? firstName(m.otherName) : 'someone';
  const mine = e.actorId === a._id;
  const kind = kindOfEvent(e);
  if (kind === 'crisis') {
    return e.eventType === 'drought'
      ? ['The wells. It is always the wells.', 'If the water runs short, the council will start choosing who drinks.']
      : e.eventType === 'storm'
        ? ["Anyone caught outside is in trouble. I'm counting faces.", "The domes creak and everyone pretends they don't hear it."]
        : ['Something just shifted in this colony. I can feel it.', 'Everyone at ' + place(e.locationId) + ' is pretending to be calm.'];
  }
  if (mine) {
    if (kind === 'crime') return ['No one saw. I think no one saw.', 'My heart is going like a drill bit.'];
    if (isHostile(e)) return ["I said it. I can't unsay it now.", 'Let ' + x + ' stew on that.'];
    if (isEasing(e)) return ['That felt better than I expected.', 'Maybe ' + x + ' and I can start over.'];
    return ["It's done. Now I live with it.", 'One thing off the list.'];
  }
  if (isHostile(e)) {
    return e.participantIds.includes(a._id)
      ? [x + " thinks I'll just take that. " + x + ' is wrong.', "My hands are shaking. Not from fear, I tell myself.", "I'll remember this, " + x + '.']
      : [x + ' has finally snapped, right here at ' + place(e.locationId) + '.', "Nobody's stepping in. Of course nobody is.", 'Keep your head down. Not your fight. Not yet.'];
  }
  if (isEasing(e)) return [x + " didn't have to do that.", "I owe " + x + ' now. I hate owing people.', 'Maybe ' + x + ' is better than I gave them credit for.'];
  return [x + '... what does that mean for me?', "That will be all over the canteen by supper.", 'Strange day at ' + place(e.locationId) + '.'];
}

/** A rule-based monologue line that does not repeat the recent ones. */
export function ruleThought(tx: Tx, a: AgentDoc, mind: MindDoc, moment: Moment, recent: string[]): string {
  const lines = candidates(a, mind, moment);
  const start = hash32(a.seq, tx.tick, moment.kind) % lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[(start + i) % lines.length];
    if (!recent.includes(line)) return line;
  }
  return lines[start];
}
