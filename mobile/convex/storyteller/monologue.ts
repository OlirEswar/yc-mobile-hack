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
export async function writeThought(tx: Tx, agentId: AgentDoc['_id'], text: string, source: 'llm' | 'rules', mood?: string): Promise<void> {
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
  | { kind: 'plan'; label: string }
  | { kind: 'idle'; storyTitle?: string };

const place = (id?: string): string => LOCATIONS[id as LocationId]?.name ?? 'the colony';
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** One short line about how their body feels, or nothing when it is fine. */
function bodyLine(a: AgentDoc): string | undefined {
  if (a.needs.thirst >= 65) return 'My throat feels like regolith.';
  if (a.needs.hunger >= 65) return "I can't remember the last real meal.";
  if (a.needs.fatigue >= 75) return 'I could sleep standing up.';
  if (a.needs.safety >= 60) return 'Something about today feels wrong.';
  if (a.needs.social >= 75) return "I haven't had a real conversation in days.";
  return undefined;
}

/** Candidate lines for a moment, in the colonist's first person. */
function candidates(a: AgentDoc, mind: MindDoc, m: Moment): string[] {
  const hiding = !!mind.persona?.secret && mind.persona.secret.exposedAtTick === undefined;
  if (m.kind === 'plan') {
    const body = bodyLine(a);
    return [
      m.label + '.' + (body ? ' ' + body : ''),
      'Fine. ' + lower(m.label) + ', and then I deal with the rest.',
      m.label + '. At least that much I can control.',
      'Next: ' + lower(m.label) + (hiding ? ". Act normal. Nobody's looking at you." : '.'),
    ];
  }
  if (m.kind === 'idle') {
    const story = m.storyTitle;
    if (a.activity === 'working' || a.activity === 'trading') {
      return [
        'Work keeps my hands busy. It does nothing for the rest of me.',
        story ? 'Same hum, same shift, and my head keeps drifting back to ' + lower(story) + '.' : 'Same hum, same shift. My head is somewhere else.',
        hiding ? 'Every time someone walks past, I wonder what they know.' : 'One more hour and I can think about something else.',
      ];
    }
    return [
      place(a.locationId) + ' is quiet. Too quiet to stop thinking.',
      story ? 'I keep turning it over: ' + lower(story) + '. Where does it end?' : 'I keep replaying the last few days.',
      hiding ? 'What if they find out? What then?' : (bodyLine(a) ?? 'Breathe. Just breathe for a moment.'),
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
        : ['Something just shifted in this colony. I can feel it.', 'Everyone in ' + place(e.locationId) + ' is pretending to be calm.'];
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
      : [x + ' has finally snapped, right here in ' + place(e.locationId) + '.', "Nobody's stepping in. Of course nobody is.", 'Keep your head down. Not your fight. Not yet.'];
  }
  if (isEasing(e)) return [x + " didn't have to do that.", "I owe " + x + ' now. I hate owing people.', 'Maybe ' + x + ' is better than I gave them credit for.'];
  return [x + '... what does that mean for me?', "That will be all over the canteen by supper.", 'Strange day in ' + place(e.locationId) + '.'];
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
