/**
 * Words for storylines the director creates and announces. Every line is grounded in the event that
 * caused it (its summary, names and place) and varies by a hash of that event, so two feuds or two
 * thefts never read alike.
 */
import type { Doc } from '../_generated/dataModel';
import { LOCATIONS } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { hash32 } from '../lib/rng';
import { clip, factName, firstName } from './storylines';
import type { StoryKind, StorylineDoc } from './storylines';

export type Cast = { a?: string; b?: string; sameFaction?: boolean };

const pickOf = <T>(items: readonly T[], seed: string): T => items[hash32(seed) % items.length];
const placeOf = (e: Doc<'events'>): string => LOCATIONS[e.locationId as LocationId]?.name ?? 'the colony';

const OMEN_TITLES: [RegExp, string][] = [
  [/quake/, 'After the Quake'],
  [/signal/, 'The Signal from the Crater'],
  [/outbreak|disease|epidemic/, 'Fever in the Domes'],
  [/reactor/, 'The Reactor Scare'],
  [/festival/, 'Festival Night'],
  [/ice_strike|lucky/, 'The Lucky Strike'],
  [/escaped/, 'Loose in the Tubes'],
];

const CRISIS_TITLES: Record<string, (c: Cast) => string> = {
  drought: () => 'The Wells Run Dry',
  storm: () => 'After the Storm',
  whisper: (c) => 'A Voice in ' + (c.a ?? 'Someone') + "'s Head",
  rumor_started: (c) => 'The Rumor About ' + (c.a ?? 'a Neighbour'),
  grant: (c) => (c.a ? c.a + "'s Windfall" : 'A Gift from Nowhere'),
  arrival: (c) => (c.a ? 'The Stranger Called ' + c.a : 'A Stranger at the Pad'),
  death: (c) => 'The Death of ' + (c.a ?? 'a Colonist'),
  create_character: (c) => (c.a ? 'The Stranger Called ' + c.a : 'A Stranger at the Pad'),
};

/** Title and premise of a new emergent storyline. */
export function storyProse(kind: StoryKind, e: Doc<'events'>, cast: Cast): { title: string; premise: string } {
  const A = cast.a ?? 'Someone';
  const B = cast.b ?? 'the others';
  const place = placeOf(e);
  const name = factName(e);
  const seed = e._id;
  const lead = clip(e.summary, 160);
  const t = (titles: string[], tails: string[]) => ({ title: pickOf(titles, seed + 't'), premise: lead + ' ' + pickOf(tails, seed + 'p') });
  switch (kind) {
    case 'grudge':
      return t(
        ['Bad Blood: ' + A + ' and ' + B, A + ' Against ' + B, 'The Feud at ' + place],
        ['Neither ' + A + ' nor ' + B + ' is the kind to let it go.', 'The cold looks between ' + A + ' and ' + B + ' are now open hostility.', 'Sooner or later one of them will push too far.'],
      );
    case 'debt':
      return t(
        ['What Is Owed', A + "'s Marker", 'Interest Due', 'The Debt Between ' + A + ' and ' + B],
        ['A debt between ' + A + ' and ' + B + ' has stopped being polite.', 'In a colony this small, an unpaid debt is everybody\'s business.', 'Somebody will pay, one way or another.'],
      );
    case 'romance':
      return t(
        [A + ' and ' + B, cast.sameFaction ? 'A Spark at ' + place : 'Across the Divide', 'What ' + A + ' Wants'],
        [cast.sameFaction ? 'Everyone will have an opinion, and some will have a stake.' : A + ' and ' + B + ' stand on opposite sides of the colony\'s quarrels, and a romance like this costs somebody something.', 'It could be the best thing that has happened to either of them, or the worst.'],
      );
    case 'secret':
      return t(
        [/confess/.test(e.eventType) ? A + "'s Confession" : /blackmail/.test(e.eventType) ? A + "'s Leverage" : /eavesdrop/.test(e.eventType) ? 'Overheard at ' + place : 'What ' + A + ' Knows', 'The Secret Gets Out'],
        ['A secret is loose in Shackleton, and secrets here are currency.', 'What was hidden is starting to surface, and not everyone will survive it with their name intact.'],
      );
    case 'crime':
      return t(
        ['Who Robbed ' + place + '?', 'Missing from ' + place, 'The ' + place + ' Job'],
        ['Somebody did this, and the colony wants a name.', 'Security has a case and too many suspects.', 'Every neighbour is a suspect now.'],
      );
    case 'power':
      return t(
        ['The Fight for the Council', 'Who Speaks for Shackleton', 'Pressure on the Chair', A + "'s Gambit"],
        ["The old balance of Compact, Union and League is shifting, and somebody means to come out on top.", 'The council has never looked so fragile.'],
      );
    case 'crisis':
      return {
        title: (CRISIS_TITLES[e.eventType] ?? (() => clip(e.summary, 40)))(cast),
        premise: lead + ' ' + pickOf(['What the colony does next is up to them.', 'Nobody in Shackleton will come out of this unchanged.', 'People are already choosing sides.'], seed + 'p'),
      };
    case 'org':
      return t(
        /schism|split|breakaway/.test(e.eventType)
          ? ['The ' + (name ?? 'Great') + ' Schism', 'The Breakaway']
          : /raid/.test(e.eventType)
            ? ['Raid on ' + (name ?? place), 'The ' + place + ' Raid']
            : [(name ?? A + "'s Circle") + "'s Rise", 'The Rise of ' + (name ?? A + "'s Circle"), A + "'s Followers"],
        ['A new power is taking shape in the tubes, and not everyone is pleased.', 'Loyalties are being tested, and every member will have to choose.', 'What starts as a gathering rarely stays one.'],
      );
    case 'family':
      return t(
        /pet/.test(e.eventType)
          ? [A + "'s Companion", name ? 'The Tale of ' + name : 'Something Small to Love']
          : /propos|marri|wedding/.test(e.eventType)
            ? [A + ' and ' + B, 'A Promise at ' + place]
            : ['A Child of ' + place, A + "'s Child", 'Growing Up in Shackleton'],
        ['A family is a promise, and promises are expensive here.', 'Everything changes when someone has more to lose.', 'The colony has a stake in how this turns out.'],
      );
    case 'invention':
      return t(
        ['Race to the ' + (name ?? 'Breakthrough'), A + "'s Breakthrough", 'What ' + A + ' Found'],
        ['Knowledge is power in a colony that runs on scarcity, and others will want it.', 'It could change how Shackleton lives, if it is not stolen or wrecked first.'],
      );
    case 'art':
      return t(
        [name ? 'The ' + name.replace(/^the /i, '') : A + "'s Masterpiece", 'A Song for ' + place, A + "'s Audience"],
        ['Art travels faster than rumor here, and it changes what people believe.', 'Fame is a dangerous thing in a small place.'],
      );
    case 'obsession':
      return t(
        [A + "'s Obsession", 'What Drives ' + A, A + ' Will Not Let Go'],
        [A + ' has stopped living a normal life, and the people around them are starting to notice.', 'An obsession burns until it is fulfilled or it burns out, and it takes others with it.'],
      );
    case 'omen':
      return {
        title: OMEN_TITLES.find(([re]) => re.test(e.eventType))?.[1] ?? clip(e.summary, 40),
        premise: lead + ' ' + pickOf(['Nobody planned this, and nobody knows what it means yet.', 'The colony will remember this one.'], seed + 'p'),
      };
  }
}

/** The summary of a banner announcing that a storyline moved to a new status. */
export function announcement(s: StorylineDoc, status: string, beat: string | undefined): string {
  const names = s.participantIds.length;
  const seed = s._id + status + s.beats.length;
  const lead = beat ? ' ' + beat : '';
  if (status === 'rising') {
    return pickOf([s.title + ' is gathering pace.' + lead, 'People have started to notice: ' + s.title.toLowerCase() + '.' + lead, s.title + ' is no longer a private matter.' + lead], seed);
  }
  if (status === 'climax') {
    return pickOf(['It comes to a head: ' + s.title + '.' + lead, s.title + ' reaches breaking point.' + lead, 'Nobody can look away from ' + s.title + ' now.' + lead], seed);
  }
  return pickOf(
    beat ? [s.title + ' is over, for now.' + lead, 'The dust settles on ' + s.title + '.' + lead] : [s.title + ' has burned itself out' + (names > 1 ? ', and the people in it have to live with what is left.' : '.')],
    seed,
  );
}

export const who = (name?: string): string | undefined => (name ? firstName(name) : undefined);
