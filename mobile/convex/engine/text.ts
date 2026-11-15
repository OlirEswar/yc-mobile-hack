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

/**
 * Plan intents by situation, written in the third person and grounded in names, places and causes.
 * Placeholders: {me} the planner's first name, {who} another person, {res}, {n}, {place}, {dep} a
 * dependant at home, {why} a short reason.
 */
const INTENTS: Record<string, string[]> = {
  'need.canteen': ['{me} heads to the Airlock Canteen for {res} and whatever gossip comes with it', '{me} spends a few hard-earned credits on {res} at the canteen', '{me} queues at the canteen counter for {res}, credits in hand'],
  'need.buy': ['{me} walks to the Exchange to buy {res} with wages from the last shift', '{me} counts out credits for {n} {res} at the Exchange{why}', '{me} pays the Exchange price for {res}{why}; that is what the wages are for'],
  'need.ration': ["{me} collects the household ration at the Supply Depot before it runs short", "{me} joins the ration queue at the depot for the family's share", "{me} picks up today's ration so {dep} has something at home"],
  'need.grow': ['{me} goes home to coax a little {res} out of the grow rack under the bunk', '{me} trusts the rack more than the depot: home to tend the beans', '{me} spends a precious water on the home rack; seedlings do not lie'],
  'need.barter': ['{me} takes {n} spare {res2} to the Exchange to swap for {res}, no credits needed', '{me} hopes {res2} is still worth something: off to trade it for {res}'],
  'need.sell': ['{me} sells {n} {res2} at the Exchange to pay for {res}', '{me} turns spare {res2} into credits, then credits into {res}'],
  'need.charm': ['{me} goes to find {who}, all smiles, hoping a friend will share some {res}', '{me} drops in on {who}; a little warmth usually ends with a shared ration', '{me} knows {who} has a soft spot for company, and {res} to spare'],
  'need.borrow': ['{me} swallows some pride and asks {who} for a loan of {res}', '{me} goes to {who} for a loan: {n} {res}, paid back by the end of the week', '{me} borrows from {who} again; the list of people owed is getting longer'],
  'need.beg': ['{me} has nothing left and goes to {place} to ask strangers for {res}', '{me} goes cap in hand to {place}; somebody there will spare some {res}', 'Too broke for the canteen and too proud for the depot line, {me} begs at {place}'],
  'need.scavenge': ['{me} suits up for {place} to scavenge parts worth trading for {res}', '{me} would rather pick through scrap at {place} than ask anyone for help', '{me} heads out to {place}: anything salvaged turns into {res} at the Exchange'],
  'need.smuggle': ['{me} slips down to the Landing Pad, where the crews sell {res} cheaper and ask no questions', '{me} buys {res} off a shuttle crew at the pad; the depot will never know', '{me} knows a crew chief at the pad who deals in {res} under the manifest'],
  'need.steal.depot': ['{me} tells {self} it is only borrowing and takes {res} from the depot{for}', '{me} waits for the quartermaster to look away, then pockets {res} from the depot shelves{for}', '{me} slips into the Supply Depot for {res}{for}; nobody counts that closely'],
  'need.steal.pantry': ["{me} lets {self} into {who}'s quarters while they are out and takes {res}{for}", "{me} raids {who}'s pantry{for}; they always had more than enough", '{me} lifts {res} from {who} and tries not to think about it'],
  'need.steal.person': ['{me} means to lift {res} from {who} at {place} while nobody watches', "{me} has been watching {who}'s pockets at {place}"],
  'need.steal.credits': ["{me} plans to lift a few credits from {who} at {place} and buy {res} before anyone notices", "{me} eyes {who}'s credit chit at {place}; {res} costs money {me} does not have"],
  'need.blackmail': ['{me} goes to remind {who} of a certain secret, and what silence costs', '{me} has something on {who} and is hungry enough to use it', 'Why beg when {who} has every reason to pay? {me} goes to collect'],
  'need.bribe': ['{me} slips {who} a few credits for a quiet extra ration', '{me} knows the quartermaster has a price: {who} can be persuaded'],
  'money.work': ['{me} takes an extra shift at {place}; the credits are running low', '{me} works late at {place} to put something aside{why}', 'Another double at {place}: {me} has never trusted luck over sweat'],
  'money.sell': ['{me} carries spare {res} to the Exchange to sell', '{me} sells {n} {res} at the Exchange while the price is decent'],
  'money.scavenge': ['{me} goes scavenging at {place}; scrap sells', "{me} heads out to {place} to pick over the wreckage for anything the Exchange will buy"],
  'money.smuggle': ['{me} has {n} {res} for the shuttle crews at the Landing Pad, off the books', '{me} takes {res} to the pad, where the crews pay better than the Exchange', '{me} runs {res} to the pad; every credit is a step closer{why}'],
  'money.steal': ["{me} goes after {who}'s credits at {place}", '{me} needs credits more than {who} does, and {who} never watches their pockets'],
  'money.blackmail': ['{me} has kept quiet about {who} long enough; now quiet has a price', '{me} goes to {who} with what {me} knows, and a number'],
  'money.borrow': ['{me} asks {who} for a loan of {n} credits', '{me} goes to {who} for credits, promising to pay it back soon'],
  'money.beg': ['{me} goes to {place} to ask for a few credits', '{me} has run out of options and asks around {place} for credits'],
  'money.grow': ['{me} tends the home rack; extra food sells at the Exchange', '{me} grows food at home to sell when the price is right'],
  'debt.repay': ['{me} goes to find {who} and pay back what is owed', '{me} hates owing {who} anything: off to settle up', '{me} pays {who} back before the debt sours things between them'],
  'debt.collect': ['{me} is tired of waiting for {who} to pay up', '{me} goes to collect the {res} {who} has owed since {when}', "{who} borrowed from {me} and has been avoiding the subject. Not today."],
  'debt.slander': ['{me} makes sure everyone at the canteen knows {who} does not pay debts', '{me} warns people about lending to {who}'],
  'debt.forgive': ['{me} decides {who} has suffered enough and lets the debt go'],
  'desire.court': ['{me} goes looking for {who} at {place}, rehearsing what to say', "{me} finds an excuse to be wherever {who} is; today it is {place}", '{me} cannot stop thinking about {who}, and goes to {place} to see them', '{me} hopes {who} will be at {place} again tonight'],
  'desire.partner': ['{me} goes to spend an hour with {who} at {place}', '{me} slips away to see {who}'],
  'desire.affair': ['{me} slips away to meet {who}, again, and hopes nobody notices', '{me} tells everyone it is an errand; it is {who}'],
  'desire.lie': ["{me} goes to {place} to make sure people hear the worst about {who}", "{me} has a story about {who}; true or not, it will spread", '{me} wants {who} brought low, and words cost nothing'],
  'desire.eavesdrop': ['{me} tails {who} to {place}, listening for anything useful', '{me} wants something on {who} and goes to {place} to listen', '{me} keeps an ear on {who}; everyone slips eventually'],
  'desire.threaten': ['{me} goes to {place} to put the fear into {who}', '{me} has had enough of {who} and goes to say so, loudly'],
  'desire.sabotage': ['{me} goes to {place} with a spanner and a grudge against {who}', "{me} means to make {who}'s work at {place} fail, quietly"],
  'desire.reconcile': ['{me} goes to {place} to make peace with {who}', '{me} is tired of the feud with {who} and goes to apologise', 'Life is short up here: {me} goes to find {who} and bury it'],
  'desire.uncover': ['{me} goes to {place} to listen to {who}; the Long Dark left too many questions', '{me} wants the truth about {who} and goes looking for it', '{me} keeps digging: {who} knows more than they let on'],
  'desire.comfort': ['{me} goes to sit with {who}, who has not been doing well', '{me} heard {who} is struggling and goes to {place}', '{me} brings some company to {who}'],
  'desire.confide': ['{me} goes to find {who}; it is time to tell someone the truth', '{me} needs to talk, and {who} is the only one {me} trusts', '{me} goes to unburden {self} to {who}'],
  'desire.confess': ['{me} goes to the Commons Plaza to tell everyone the truth before someone else does', '{me} cannot carry the secret another day: to the plaza, to confess', '{me} will not be blackmailed any longer. The plaza will hear it from {me}'],
  'desire.rally': ['{me} goes to the Commons Plaza to rally people for {why}', '{me} will not stay quiet: off to the plaza to rally the crews for {why}', '{me} climbs onto a crate in the plaza to call for {why}'],
  'desire.blackmail': ['{me} goes to {place} to let {who} know what {me} knows', '{me} has leverage on {who} and intends to use it', '{me} sees an opportunity in what {who} is hiding'],
  'desire.expose': ['{me} goes to {place} to tell everyone what {who} is hiding', '{me} will not keep {who}\'s secret any longer'],
  'secret.bribe': ['{me} goes to buy {who}\'s silence before the secret spreads', '{me} has credits and a secret to protect, and {who} has a price'],
  'secret.threaten': ['{me} goes to make sure {who} keeps quiet', '{me} warns {who} off, before {who} says a word'],
  'secret.discredit': ['{me} spreads a story about {who} so nobody believes what {who} might say', '{me} gets in first: whatever {who} says, people will have heard worse about {who}'],
  'case.bribe': ['{me} goes to {who} with credits, before the theft case comes to {me}', '{me} buys {who} off before the investigation gets any closer'],
  'hide': ['{me} hides the extra {res} at home, out of sight of neighbours', '{me} squirrels {n} {res} away at home, for when things get worse'],
  'strike': ['{me} stays off the job: the crews are on strike', '{me} joins the picket instead of the shift'],
};

/** A plan intent for a situation, filled with names and specifics. */
export function intentLine(key: string, r: number, vars: { me: string; who?: string; res?: string; res2?: string; n?: number; place?: string; dep?: string; why?: string; when?: string }): string {
  const forWhom = vars.dep ? ' for ' + firstName(vars.dep) : '';
  const fills: Record<string, string> = {
    me: firstName(vars.me),
    self: 'themselves',
    who: vars.who ? firstName(vars.who) : 'someone',
    res: vars.res ?? 'supplies',
    res2: vars.res2 ?? 'goods',
    n: vars.n !== undefined ? String(vars.n) : 'some',
    place: vars.place ? locName(vars.place) : 'the plaza',
    dep: vars.dep ? firstName(vars.dep) : 'the family',
    for: forWhom,
    why: vars.why ?? '',
    when: vars.when ?? 'last week',
  };
  let out = pick(INTENTS[key] ?? ['{me} has a plan'], r);
  for (const [k, v] of Object.entries(fills)) out = out.split('{' + k + '}').join(v);
  return out.charAt(0).toUpperCase() + out.slice(1);
}
