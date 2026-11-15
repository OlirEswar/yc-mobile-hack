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

/**
 * Speech for the iteration-2 actions, several lines per moment so the same act sounds different
 * each time. Placeholders: {you} the listener, {me} the speaker, {s} a third person (first names),
 * {res} a resource, {n} a quantity, {place} a location name.
 */
const LINES: Record<string, string[]> = {
  'beg.ask': [
    'Please, {you}. Just a little {res}. I will not ask again.',
    'I hate asking. Can you spare any {res}?',
    'Anything, {you}. Even half a ration of {res}.',
    'My pantry is bare. Is there any {res} you could give?',
    'I am not proud of this, {you}, but I need {res}.',
  ],
  'beg.yes': ['Here. Do not make it a habit.', 'Take it. We all have bad weeks.', 'Go on. Before I change my mind.', 'It is not much, but it is yours.', 'Keep your chin up, {you}.'],
  'beg.no': ['I have barely enough for my own.', 'Not today, {you}.', 'Ask the depot, not me.', 'Everyone wants something from me lately.', 'Sorry. Truly. I cannot.'],
  'borrow.ask': [
    'Lend me {n} {res}? You will have it back by the end of the week.',
    '{you}, I need {n} {res}. I am good for it, you know I am.',
    'Could you front me {n} {res}? I will pay you back, with thanks.',
    'Just {n} {res} until my next wage, {you}.',
  ],
  'borrow.yes': ['Fine. But I am counting, {you}.', 'Pay me back when you can. Soon.', 'Here. Do not make me chase you.', 'For you, yes. Once.'],
  'borrow.no': ['You still owe me from last time.', 'I lend to people I trust, {you}.', 'No. I need every bit of it.', 'Ask someone with more to spare.'],
  'repay.give': ['Here, every bit of it. Thank you for waiting.', 'What I owe you, {you}. We are square.', 'Took me long enough. Here.', 'I said I was good for it.'],
  'repay.partial': ['This is all I have. The rest soon, I swear.', 'Part of it now, {you}. I have not forgotten.', 'I am short. Take this much.'],
  'repay.thanks': ['Good. I was starting to wonder.', 'We are square, then.', 'Thank you. That means something.', 'About time, {you}.'],
  'barter.offer': ['{n} {res} for what you have. Fair trade?', 'I have {res} going spare. Swap?', 'Trade you, {you}. Straight swap, no credits.'],
  'barter.yes': ['Deal.', 'You drive a hard bargain. Fine.', 'Done. Pleasure, {you}.'],
  'barter.no': ['Not worth it to me.', 'Make it better and we will talk.', 'I would be robbing myself.'],
  'bribe.offer': [
    'Nobody needs to know about this, {you}. {n} credits says they will not.',
    'Consider this a gift. A quiet one.',
    '{n} credits, {you}. Just this once, look the other way.',
    'We can help each other. Here is how I help you.',
  ],
  'bribe.yes': ['I did not see anything. I never do.', 'Put it away before someone sees.', 'Fine. This never happened.', 'For that much, I am deaf and blind.'],
  'bribe.no': ['Are you trying to buy me, {you}?', 'Keep your credits. I will remember this.', 'Some of us cannot be bought.', 'Get out of my sight.'],
  'blackmail.demand': [
    'I know about it, {you}. All of it. That knowledge costs.',
    'It would be a shame if the plaza heard what I heard.',
    'You and I need to talk about what you have been hiding.',
    'Pay, and your secret stays with me.',
  ],
  'blackmail.pay': ['Take it. And never speak of it again.', 'This is the last time. The last.', 'Fine. Just keep quiet.', 'You are a snake, {you}.'],
  'blackmail.refuse': ['Do your worst. I am done being afraid.', 'Say it in the plaza, then. I dare you.', 'Nobody will believe you.'],
  'blackmail.retaliate': ['Threaten me again and see what happens.', 'Security will want to hear about this.', 'You just made an enemy, {you}.'],
  lie: [
    'I should not say this, but {s} is not who you think.',
    'Keep this between us. {s}.',
    'You did not hear it from me, {you}.',
    'Have you noticed {s} lately? I have.',
  ],
  'confide.share': [
    'I have never told anyone this, {you}.',
    'Can I trust you with something? Really trust you?',
    'It has been eating at me. I need to tell someone.',
    'Promise me this stays between us.',
  ],
  'confide.listen': ['Of course. It stays with me.', 'Thank you for telling me.', 'I had no idea. I am glad you said it.', 'Whatever you need, {you}.'],
  'court.flirt': [
    'You look like the only good thing in this dome, {you}.',
    'Walk with me after the shift?',
    'I saved you a seat. I always seem to.',
    'Tell me something nobody else knows about you.',
    'The stars from the rim are better with company, {you}.',
  ],
  'court.yes': ['Maybe I would like that.', 'You are trouble, {you}. I like trouble.', 'Ask me again tomorrow. I might say yes.', 'Stay a while.'],
  'court.no': ['I am flattered. But no.', 'Not like that, {you}.', 'Please do not.', 'You have the wrong idea.'],
  'comfort.offer': ['Hey. Sit with me a while.', 'You are not alone in this, {you}.', 'Talk to me. Whatever it is.', 'It will not always feel like this.'],
  'comfort.thanks': ['I needed that.', 'Thank you, {you}.', 'I did not know who else to talk to.', 'Stay a little longer?'],
  'threaten.debt': ['Pay what you owe, {you}, or this gets ugly.', 'I am done waiting for my {res}.', 'You have until tomorrow. Then I stop being nice.'],
  'threaten.quiet': ['Keep your mouth shut about me, {you}. I mean it.', 'Whatever you think you know, forget it.', 'Talk and you will regret it.'],
  'threaten.grudge': ['Stay out of my way, {you}.', 'One more word and you will need the Med Bay.', 'You do not want me as an enemy.'],
  'threaten.cowed': ['All right, all right.', 'I hear you.', 'Please. I do not want trouble.'],
  'threaten.defiant': ['Try it.', 'You do not scare me, {you}.', 'Go on, then.'],
  'reconcile.offer': ['I was wrong, {you}. I am sorry.', 'Can we put this behind us?', 'I miss how things were.', 'Life is too short up here for grudges.'],
  'reconcile.yes': ['I am sorry too.', 'All right. Clean slate.', 'I have been waiting for you to say that.'],
  'reconcile.no': ['Sorry does not fix it.', 'Not yet. Maybe not ever.', 'You do not get to just say that.'],
  'rally.call': [
    'Who keeps this colony breathing? We do!',
    'They count our water while they count their credits!',
    'Stand with us, or stand aside!',
    'Not one more shift until they listen!',
    'Remember the Long Dark! Never again!',
  ],
  'rally.join': ['I am with you!', 'Count me in.', 'About time someone said it.', 'For the crews!'],
  strike: ['Not a single shift until they listen.', 'Tools down. We hold the line.', 'Let the council dig its own ice.', 'We are not machines.'],
  confess: [
    'I have to say this out loud. I did it.',
    'I cannot carry it any more. It was me.',
    'You deserve the truth, all of you.',
    'Judge me if you want. Here it is.',
  ],
  smuggle: ['Off the books, like always.', 'Keep the manifest clean. Credits on delivery.', 'Nobody needs to log this one.'],
  hide: ['Just in case.', 'Nobody needs to know about this.', 'For the bad days.'],
  eavesdrop: ['...', 'Hm.', 'Interesting.'],
  sabotage: ['Nobody will notice a loose coupling.', 'Let them see how fragile it all is.'],
};

const LINE_FALLBACK = ['...'];

/** A line for an action moment with its placeholders filled. */
export function line(key: string, r: number, vars: { you?: string; me?: string; s?: string; res?: string; n?: number; place?: string } = {}): string {
  let out = pick(LINES[key] ?? LINE_FALLBACK, r);
  const fills: Record<string, string> = {
    you: vars.you ? firstName(vars.you) : 'you',
    me: vars.me ? firstName(vars.me) : 'me',
    s: vars.s ? firstName(vars.s) : 'them',
    res: vars.res ?? 'it',
    n: vars.n !== undefined ? String(vars.n) : 'some',
    place: vars.place ? locName(vars.place) : 'here',
  };
  for (const [k, v] of Object.entries(fills)) out = out.split('{' + k + '}').join(v);
  return out;
}

/** The made-up story a liar tells about someone, by kind. */
const LIES: Record<string, string[]> = {
  thief: ['{s} has been taking from the depot after dark.', '{s} lifted credits from a bunkmate in Ring B.'],
  hoarding: ['{s} has crates of water stacked under the bunk.', '{s} takes a double ration and hides half.'],
  saboteur: ['{s} was seen at the drill housing right before it failed.', '{s} cut the feed line at the wells, I swear it.'],
  corrupt: ['{s} takes credits to fix the ration lists.', '{s} sells council favours at the canteen.'],
  affair: ['{s} has been sneaking out of the wrong bunk at night.', '{s} is cheating, and half of Ring A knows it.'],
  coward: ['{s} hid in the airlock while others died in the Long Dark.', '{s} ran when the reactor alarm went off and left people behind.'],
};

export function lieText(kind: string, subject: string, r: number): string {
  return pick(LIES[kind] ?? LIES.corrupt, r).split('{s}').join(subject);
}
