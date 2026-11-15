/**
 * Rule-based wording: activity labels and one-line speech for speech bubbles. Lines are picked
 * deterministically from the seeded roll passed in, so a replay says the same things.
 */
import { pick } from '../lib/rng';
import { firstName, locName } from './conditions';
import type { AgentDoc } from './core';

const WORK_LABELS: Record<string, string> = {
  hydroponicist: 'Tending the grow racks at the Hydroponics Bays',
  ice_miner: 'Drilling ice at the Ice Wells',
  quarry_hand: 'Digging regolith at the Regolith Quarry',
  fabricator: 'Printing parts at the Fabrication Works',
  solar_tech: 'Cleaning panels at the Solar Farm',
  trader: 'Minding the stall on the Exchange Concourse',
  quartermaster: 'Counting crates at the Supply Depot',
  councilor: 'Sitting in council at the Commons Plaza',
  security: 'Patrolling the tubes around the Commons Plaza',
  medic: 'Treating patients at the Med Bay',
  researcher: 'Logging melt rates at the Observatory Lab',
  cook: 'Cooking for the line at the Airlock Canteen',
  dock_hand: 'Moving cargo at the Landing Pad',
  hauler: 'Hauling crates for the Supply Depot',
  resident: 'Doing chores around the Commons Plaza',
};

export const workLabel = (a: AgentDoc): string => WORK_LABELS[a.occupation] ?? 'Working at ' + locName(a.workLocationId ?? a.locationId);

/** What someone says when passing a belief on. {s} is the subject's first name. */
const BELIEF_LINES: Record<string, string[]> = {
  hoarding: ['They say {s} is sitting on a stash of food and water.', 'Ever wonder why {s} never looks thirsty?', '{s} is hoarding. I would bet my ration on it.'],
  thief: ['{s} has been helping themselves at the depot.', 'Keep your pantry locked. {s} has sticky hands.', 'I heard {s} was caught taking what is not theirs.'],
  saboteur: ['People are saying {s} wrecked the drills.', 'The drills did not break themselves. Ask {s}.'],
  corrupt: ['{s} skims credits. Everyone knows it.', 'Follow the credits and you end up at {s}.'],
  hero: ['{s} gave away their own rations, did you know?', 'If everyone were like {s}, nobody would go hungry.'],
  untrustworthy: ['I would not trust {s} with a cup of water.', 'Watch yourself around {s}.'],
  admirable: ['{s} actually stands up for people like us.', 'I would follow {s} anywhere.'],
  innocent: ['I looked into it. {s} is clean.', 'Whatever you heard about {s}, it is not true.'],
  suspect: ['Ask yourself who gained from it. {s} did.', 'I keep thinking about {s} and that death.'],
  death: ['I still cannot believe {s} is gone.'],
  scarcity: ['The wells are giving less every shift.', 'Fill every bottle you have. The water is going.'],
  policy_open: ['The reserve should feed the people who fill it.', 'Open the depot. We dug it full.'],
  policy_guard: ['Open the reserve now and we starve later.', 'Somebody has to keep the reserve for the bad days.'],
  windfall: ['{s} came into a fortune out of nowhere.'],
};

const SMALL_TALK = [
  'How was your shift?',
  'Long day. The air scrubbers were loud again.',
  'Did you see the price board at the Exchange?',
  'The canteen flatbread is better this week.',
  'Any news from the pad?',
  'My bunk neighbour snores like a drill.',
];

const REPLIES_AGREE = ['I knew it.', 'That explains a lot.', 'Really? Huh.', 'Keep your voice down, but yes.'];
const REPLIES_DOUBT = ['I am not sure about that.', 'Who told you that?', 'Sounds like gossip to me.'];
const REPLIES_DEFEND = ['{s} would never do that.', 'Take that back. I know {s}.', 'That is a lie and you know it.'];
const REPLIES_SMALL = ['Same as always.', 'Could be worse.', 'Ha. True.', 'Do not get me started.'];

const fill = (line: string, subject?: string): string => line.split('{s}').join(subject ? firstName(subject) : 'them');

/** A gossip line for a belief, falling back to its own text for custom ideas. */
export function beliefLine(kind: string, text: string, subject: string | undefined, r: number): string {
  const lines = BELIEF_LINES[kind];
  if (!lines) return text.length > 90 ? text.slice(0, 87) + '...' : text;
  return fill(pick(lines, r), subject);
}

export const smallTalk = (r: number): string => pick(SMALL_TALK, r);

export function reply(kind: 'agree' | 'doubt' | 'defend' | 'small', subject: string | undefined, r: number): string {
  const lines = kind === 'agree' ? REPLIES_AGREE : kind === 'doubt' ? REPLIES_DOUBT : kind === 'defend' ? REPLIES_DEFEND : REPLIES_SMALL;
  return fill(pick(lines, r), subject);
}

/** Accusation lines by belief kind. */
const ACCUSE_LINES: Record<string, string[]> = {
  thief: ['You took from the depot, {s}. People saw.', 'Give back what you stole, {s}.'],
  hoarding: ['Where is it, {s}? Where are you hiding the water?', 'People are thirsty and you are hoarding, {s}.'],
  saboteur: ['You wrecked those drills, {s}.'],
  corrupt: ['How much did they pay you, {s}?'],
  suspect: ['What did you do, {s}? Look at me and say it.'],
  untrustworthy: ['Nobody can trust a word you say, {s}.'],
};

export function accuseLine(kind: string, subject: string, r: number): string {
  return fill(pick(ACCUSE_LINES[kind] ?? ['I know what you did, {s}.'], r), subject);
}

export function denyLine(guilty: boolean, accuser: string, r: number): string {
  const lines = guilty ? ['I... it was only a little.', 'You cannot prove anything.', 'My family was thirsty!'] : ['That is a lie, {s}, and you know it.', 'Who is spreading this about me?', 'Say that again, {s}. I dare you.'];
  return fill(pick(lines, r), accuser);
}
