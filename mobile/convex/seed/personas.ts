/**
 * Personas for the colonists who are not hand-authored. Built from what the seed already decided
 * about them (occupation, household, faction, traits, values, their personal goal and ties) plus
 * pools of wants, fears, flaws, voices and small secrets, so that no two read the same and every
 * want matches the goal the planner pursues. Deterministic for a seed.
 */
import { OCCUPATIONS } from '../../shared/colony';
import type { SeedAgent, SeedGoal, SeedHousehold, SeedPersona, SeedRelationship } from './build';
import { FACTIONS, STRATEGIES } from './keyCharacters';
import type { SecretKind, Strategy } from './keyCharacters';

type Pick = <T>(items: readonly T[]) => T;

const first = (name: string) => name.split(' ')[0];
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How strongly each occupation leans toward each way of getting by, before personality. */
const OCCUPATION_STRATEGY: Record<string, Partial<Record<Strategy, number>>> = {
  hydroponicist: { grow: 0.9, work: 0.55 },
  ice_miner: { work: 0.8, scavenge: 0.15 },
  quarry_hand: { work: 0.75, scavenge: 0.2 },
  fabricator: { work: 0.8, trade: 0.15 },
  solar_tech: { work: 0.75, scavenge: 0.2 },
  trader: { trade: 0.95, scheme: 0.15 },
  dock_hand: { trade: 0.45, smuggle: 0.5, work: 0.45 },
  quartermaster: { work: 0.75, scheme: 0.2 },
  hauler: { work: 0.7, steal: 0.15 },
  councilor: { charm: 0.6, scheme: 0.4, work: 0.35 },
  security: { work: 0.8 },
  medic: { work: 0.8, charm: 0.1 },
  researcher: { work: 0.6, scavenge: 0.25 },
  cook: { work: 0.7, trade: 0.25 },
  resident: { beg: 0.45, borrow: 0.35, scavenge: 0.3, grow: 0.25 },
};

const LEGIT: Strategy[] = ['work', 'grow', 'trade'];

function strategiesFor(a: SeedAgent, next: () => number): Strategy[] {
  const t = a.traits;
  const v = a.values;
  const base = OCCUPATION_STRATEGY[a.occupation] ?? {};
  const lean: Record<Strategy, number> = {
    work: t.caution * 0.3 + (1 - v.freedom) * 0.15,
    grow: v.family * 0.15 + v.harmony * 0.1,
    trade: v.wealth * 0.35 + t.sociability * 0.1,
    charm: t.sociability * 0.45 + t.empathy * 0.1,
    borrow: v.family * 0.2 + t.sociability * 0.15 - t.stubbornness * 0.1,
    beg: (1 - v.status) * 0.2 - t.ambition * 0.15 + (a.ageBand === 'elder' ? 0.15 : 0),
    scavenge: t.curiosity * 0.3 + v.freedom * 0.2 - t.caution * 0.3 + (a.ageBand === 'young' ? 0.15 : 0),
    smuggle: v.freedom * 0.3 + v.wealth * 0.2 - t.caution * 0.4,
    steal: (1 - t.empathy) * 0.3 + (1 - t.caution) * 0.3 - v.harmony * 0.25,
    scheme: t.ambition * 0.35 + v.status * 0.25 - t.empathy * 0.2,
  };
  const ranked = STRATEGIES.map((s) => ({ s, score: (base[s] ?? 0) + lean[s] + next() * 0.25 })).sort((x, y) => y.score - x.score);
  const chosen = ranked.slice(0, 3).map((r) => r.s);
  if (!chosen.some((s) => LEGIT.includes(s))) chosen.push(ranked.find((r) => LEGIT.includes(r.s))!.s);
  return chosen;
}

function occupationNoun(a: SeedAgent, pick: Pick): string {
  const ring = a.home === 'habitat_a' ? 'Ring A' : 'Ring B';
  if (a.occupation === 'resident') {
    if (a.ageBand === 'young') return pick(['a ' + ring + ' teenager', 'a kid from ' + ring]);
    if (a.ageBand === 'elder') return pick(['a ' + ring + ' elder', 'an old-timer from ' + ring]);
    return 'a ' + ring + ' resident';
  }
  const label = OCCUPATIONS.find((o) => o.id === a.occupation)!.label.toLowerCase();
  const article = /^[aeiou]/.test(label) ? 'an ' : 'a ';
  if (a.ageBand === 'elder') return pick([article + label, 'a veteran ' + label]);
  if (a.ageBand === 'young') return pick(['a young ' + label, article + label]);
  return article + label;
}

const factionShort = (key?: string) => (key === 'union' ? 'the union' : key === 'founders' ? 'the Compact' : key === 'exchange' ? 'the League' : 'the council');
const factionFull = (key?: string) => FACTIONS.find((f) => f.key === key)?.name ?? 'the council';

type Motive = { want: string; tag: string };

function motivesFor(a: SeedAgent, g: SeedGoal | undefined, agents: SeedAgent[], edges: SeedRelationship[]): Motive[] {
  if (!g) return [{ want: 'Get through the thin years without owing anyone', tag: 'who owes nobody and means to keep it that way' }];
  const n = g.targetQuantity ?? 100;
  const target = g.target !== undefined ? agents[g.target] : undefined;
  const t = target ? first(target.name) : '';
  switch (g.kind) {
    case 'earn_wealth':
      return [
        { want: 'Save ' + n + ' credits for a seat on the next outbound shuttle', tag: 'saving for a ticket home' },
        { want: 'Save ' + n + ' credits to buy into a grow rack of their own', tag: 'saving for a grow rack of their own' },
        { want: 'Put ' + n + " credits by before the strike empties everyone's pockets", tag: 'hoarding credits against the strike' },
        { want: 'Save ' + n + ' credits to stake a stall on the concourse', tag: 'dreaming of a stall on the Exchange' },
        { want: 'Earn ' + n + ' credits for a proper marker for someone lost in the Long Dark', tag: 'saving for a Long Dark memorial' },
        { want: 'Save ' + n + ' credits so the family never queues at the depot again', tag: 'who swore never to queue at the depot again' },
        { want: 'Earn ' + n + ' credits for a suit that does not leak at the knee', tag: "saving for a suit that doesn't leak" },
        { want: 'Reach ' + n + ' credits, because the last time they were broke they went hungry', tag: 'who went hungry once and never will again' },
        { want: 'Win ' + n + ' credits at the canteen dice table, one way or another', tag: 'with a dice habit and a plan' },
      ];
    case 'protect_person':
      if (target?.ageBand === 'young') {
        return [
          { want: 'Keep ' + t + ' out of the quarry', tag: 'keeping ' + t + ' out of the quarry' },
          { want: 'Get ' + t + ' through the thin years in one piece', tag: 'raising ' + t + ' through the thin years' },
          { want: 'Find ' + t + ' a trade before the strike breaks everything', tag: 'looking for a future for ' + t },
          { want: 'Make sure ' + t + ' never learns how close the pantry came to empty', tag: 'hiding an empty pantry from ' + t },
        ];
      }
      if (target?.ageBand === 'elder') {
        return [
          { want: 'Keep ' + t + ' warm and fed through the thin years', tag: 'looking after ' + t },
          { want: 'Make sure ' + t + ' is never the first mouth the council decides it cannot feed', tag: 'standing between ' + t + ' and the ration cuts' },
        ];
      }
      return [
        { want: 'Keep ' + t + ' fed, whatever it takes', tag: 'who would starve before ' + t + ' did' },
        { want: 'Make sure ' + t + ' never learns how close the pantry came to empty', tag: 'hiding an empty pantry from ' + t },
        { want: 'Keep ' + t + ' safe if the strike turns ugly', tag: 'watching over ' + t },
      ];
    case 'gain_influence':
      return [
        { want: 'Earn a voice ' + factionShort(a.faction) + ' listens to', tag: 'who wants ' + factionShort(a.faction) + ' to listen' },
        { want: 'Win a council seat before they are too old to use it', tag: 'angling for a council seat' },
        { want: 'Be the one people come to when the depot says no', tag: 'collecting favours like credits' },
        { want: 'Make the plaza say their name with respect', tag: 'tired of being overlooked' },
      ];
    case 'improve_relationship': {
      const edge = edges.find((e) => e.to === g.target);
      if (edge?.kind === 'rival') return [{ want: 'Make peace with ' + t + ' before the feud costs them both', tag: 'feuding with ' + t }, { want: 'End the quarrel with ' + t + ' on their own terms', tag: 'locked in a quarrel with ' + t }];
      return [
        { want: 'Win ' + t + ' over, and maybe more', tag: 'sweet on ' + t },
        { want: "Earn back " + t + "'s trust after an old falling-out", tag: 'trying to mend things with ' + t },
        { want: 'Stay close to ' + t + ', the one who stayed after the Long Dark', tag: 'who leans on ' + t },
      ];
    }
    case 'join_faction':
      return [{ want: 'Join the ' + factionFull(g.targetFaction) + ' and stop standing alone', tag: 'drifting toward the ' + factionFull(g.targetFaction) }];
    case 'change_job': {
      const job = OCCUPATIONS.find((o) => o.id === g.targetOccupation)?.label.toLowerCase() ?? 'something else';
      if (a.occupation === 'resident') return [{ want: 'Get taken on as a ' + job, tag: 'desperate for a real job' }, { want: 'Prove they can work as a ' + job, tag: 'who wants to be a ' + job }];
      return [{ want: 'Get out of the ' + a.workLocationId.replace('_', ' ') + ' and become a ' + job, tag: 'who wants out of the ' + a.workLocationId.replace('_', ' ') }];
    }
    case 'investigate':
      return [{ want: 'Find out what ' + (target?.name ?? 'the council') + ' is really keeping back', tag: 'convinced ' + t + ' is hiding something' }];
    default:
      return [{ want: g.description, tag: 'with something to prove' }];
  }
}

const OCCUPATION_FEARS: Record<string, string[]> = {
  hydroponicist: ['A blight in the racks with no seed stock left', 'The water lines to the bays being cut first'],
  ice_miner: ['A blowout on the crater floor', 'The wells running dry under their drill'],
  quarry_hand: ['A pit collapse like the one in the export years', 'Dust lung'],
  fabricator: ['A forge fire in a sealed dome', 'Running out of parts the day something big breaks'],
  solar_tech: ['A solar storm catching them on the rim', 'The panels failing the way the reactor did'],
  trader: ['A market crash when the strike starts', 'Being cut out by Soledad Marchetti'],
  dock_hand: ['A shuttle coming down wrong, like the Perseverance', 'Being caught with cargo that is not on the manifest'],
  quartermaster: ['A count that does not match', 'Being blamed for an empty shelf'],
  hauler: ['Being searched at the depot door', 'A tube breach between the wells and home'],
  councilor: ['A recall vote', 'The plaza turning on the council'],
  security: ['A riot in the tubes', 'Having to arrest a neighbour'],
  medic: ['An outbreak with an empty pharmacy', 'Another night of triage like the Long Dark'],
  researcher: ['Being right about the wells', 'Their data being used to justify a ration cut'],
  cook: ['The canteen stores running out mid-service', 'A fight over the last tray'],
  resident: ['Being a mouth the colony decides it cannot feed', 'The council forgetting the old corridors'],
};

const GENERAL_FEARS = [
  'Another Long Dark',
  'Dying in debt',
  'The strike turning violent',
  'Being forgotten when they are gone',
  'The colony being sold back to the company',
  'Losing their bunk to a new arrival',
  'Silence in the tubes, the way it was during the Long Dark',
  'Their children growing up hungry',
  'Being the next name on the security chief\'s list',
  'Choosing the wrong side',
  'The depot running dry',
  'Going outside and not coming back',
];

const NEEDS = [
  'To ask for help before it is too late',
  'To forgive someone who wronged them in the Long Dark',
  'To stop measuring their worth in credits',
  'To speak up when it counts',
  'To trust someone outside their own household',
  'To slow down and grieve',
  'To find people who stay',
  'To admit they were wrong about the union',
  'To accept that the company is never coming back',
  'To choose a side and mean it',
  'To be honest with the people they love',
  'To believe they deserve a share',
  'To let go of an old grudge',
  'To be needed rather than tolerated',
];

const FLAWS: Record<string, string[]> = {
  reckless: ['Reckless outside the domes', 'Spends credits the day they get them', 'Gambles at the canteen dice table'],
  stubborn: ['Holds grudges for years', 'Never admits a mistake', 'Would rather be right than fed'],
  cold: ['Looks after themselves first, always', 'Petty about every ration', 'Mistakes cruelty for honesty'],
  social: ['Cannot keep a secret', 'Repeats every rumor they hear', 'Needs an audience for everything'],
  cautious: ['Too frightened to take a side', 'Hoards out of habit', 'Freezes when things go wrong'],
  ambitious: ['Jealous of anyone who gets ahead', 'Cuts corners to look good', 'Takes credit that is not theirs'],
  soft: ['Gives away what their own family needs', 'Says yes to everyone', 'Forgives the same people too many times'],
  general: ['Drinks the canteen still-brew', 'Lies to avoid a fight', 'Too proud to ask for help', 'Sulks for days when crossed', 'Trusts the wrong people', 'Coasts through long shifts'],
};

function flawFor(a: SeedAgent, pick: Pick, next: () => number): string {
  const t = a.traits;
  const leanings: [string, number][] = [
    ['reckless', 1 - t.caution],
    ['stubborn', t.stubbornness],
    ['cold', 1 - t.empathy],
    ['social', t.sociability],
    ['cautious', t.caution],
    ['ambitious', t.ambition],
    ['soft', t.empathy],
  ];
  const [kind, strength] = leanings.sort((x, y) => y[1] - x[1])[0];
  return pick(strength > 0.7 && next() < 0.75 ? FLAWS[kind] : FLAWS.general);
}

const REGISTERS = {
  loud: ['Loud and cheerful', 'Chatty', 'Warm and teasing', 'Boisterous'],
  quiet: ['Terse', 'Soft-spoken', 'Gruff', 'Dry'],
  kind: ['Gentle', 'Earnest', 'Patient'],
  sharp: ['Sardonic', 'Blunt', 'Clipped'],
};

const TICS = [
  'quotes old Earth songs nobody else remembers',
  "calls everyone 'neighbour'",
  'swears by the eleven',
  'never quite finishes a sentence',
  'talks in shift-radio jargon',
  'answers questions with questions',
  'describes Earth weather as if they remember it',
  'laughs at the wrong moments',
  "repeats their grandmother's proverbs",
  'counts on their fingers while they talk',
  'lowers their voice whenever the council comes up',
  'turns every story back to the Long Dark',
  'mutters prices under their breath',
  'gives everyone a nickname',
  'apologises before disagreeing',
  'speaks very slowly, as if every word costs water',
  'peppers everything with union slogans',
  'tells the same three jokes',
];

function voiceFor(a: SeedAgent, pick: Pick): string {
  const t = a.traits;
  const register = t.empathy > 0.7 ? pick(REGISTERS.kind) : t.empathy < 0.35 ? pick(REGISTERS.sharp) : t.sociability > 0.55 ? pick(REGISTERS.loud) : pick(REGISTERS.quiet);
  return register + ', ' + pick(TICS);
}

function secretFor(a: SeedAgent, household: SeedHousehold, agents: SeedAgent[], edges: SeedRelationship[], pick: Pick, next: () => number): { kind: SecretKind; text: string } | undefined {
  const t = a.traits;
  const chance = 0.18 + (1 - t.empathy) * 0.12 + (1 - t.caution) * 0.1 + t.ambition * 0.05;
  if (next() > chance) return undefined;
  const housemate = household.members.filter((m) => m !== a.seq).map((m) => agents[m]).find((m) => m.ageBand !== 'elder');
  const friend = edges.find((e) => e.kind === 'friend' && agents[e.to].ageBand === 'adult' && agents[e.to].household !== a.household);
  const work = a.workLocationId.replace('_', ' ');
  const options: { kind: SecretKind; text: string; weight: number }[] = [
    {
      kind: 'thief',
      text: housemate
        ? 'Took food from the household pantry and let ' + first(housemate.name) + ' take the blame.'
        : 'Pockets a ration bar from the canteen counter most days.',
      weight: 0.3 + (1 - t.empathy) * 0.4,
    },
    { kind: 'addict', text: 'Trades part of their water ration for canteen still-brew and hides the shakes on shift.', weight: 0.2 + (1 - t.caution) * 0.2 },
    { kind: 'forger', text: "Forged a medic's chit to skip a week at the " + work + '.', weight: 0.15 + (1 - t.caution) * 0.15 },
    { kind: 'informer', text: 'Tells Marcus Bell what their neighbours say about the council, for an extra cup of water.', weight: a.faction === 'founders' ? 0.05 : 0.2 },
    { kind: 'fugitive', text: 'Came up on a forged work contract; their real name is on an Earth debt register.', weight: a.ageBand === 'young' ? 0 : 0.12 },
  ];
  if (a.ageBand !== 'young') options.push({ kind: 'coward', text: 'Hid in a storage locker through the worst night of the Long Dark while others hauled the injured.', weight: 0.15 + t.caution * 0.15 });
  if (['hauler', 'cook', 'trader', 'dock_hand', 'hydroponicist'].includes(a.occupation)) options.push({ kind: 'embezzler', text: 'Shaves a little from every crate that passes through their hands at the ' + work + '.', weight: 0.35 });
  if (['dock_hand', 'trader', 'cook'].includes(a.occupation)) options.push({ kind: 'smuggler', text: 'Sells canteen still-brew to tramp crews at the pad, off the books.', weight: 0.35 });
  if (friend && a.ageBand === 'adult') options.push({ kind: 'affair', text: 'Has been seeing ' + agents[friend.to].name + ' in secret; neither household knows.', weight: 0.3 });
  if (['fabricator', 'solar_tech', 'ice_miner'].includes(a.occupation)) options.push({ kind: 'saboteur', text: 'Jammed equipment at the ' + work + ' last month to win the crew a rest day, and let the night shift take the blame.', weight: 0.08 });
  let roll = next() * options.reduce((s, o) => s + o.weight, 0);
  for (const o of options) {
    roll -= o.weight;
    if (roll <= 0) return { kind: o.kind, text: o.text };
  }
  return { kind: options[0].kind, text: options[0].text };
}

const HISTORY_LINES: Record<string, string[]> = {
  elder: [
    'Landed with the second wave of Artemis-Meridian contracts and still talks about the export years.',
    'Was on the crew that cut the second ice shaft.',
    'Voted for Imani Reyes in the first council and has had doubts ever since.',
    'Remembers the day the last company shuttle left without them.',
  ],
  adult: [
    'Spent the Long Dark hauling oxygen candles between the rings.',
    'Came up on one of the last company shuttles before the Abandonment.',
    'Lost a cousin in Ring B during the Long Dark.',
    'Signed a five-year contract eleven years ago with a company that no longer exists.',
    'Was at the union rally Marcus Bell broke up, and has the scar to prove it.',
  ],
  young: [
    'Was born the year the second shaft opened and has never seen Earth.',
    'Remembers the Long Dark as the winter the lights went out.',
    "Grew up on the ring nursery's stories about the company men.",
  ],
};

const ARC_TEMPLATES: ((p: { name: string; want: string; flaw: string; fear: string }) => string)[] = [
  (p) => p.name + ' wants to ' + lower(p.want) + '. ' + p.flaw + ', and that could cost them.',
  (p) => 'What ' + p.name + ' wants: to ' + lower(p.want) + '. What stands in the way: ' + lower(p.flaw) + '. What keeps them up at night: ' + lower(p.fear) + '.',
  (p) => p.name + ' is one bad week from desperate and wants to ' + lower(p.want) + '. Their weak spot: ' + lower(p.flaw) + '.',
];

export function generatedPersona(
  a: SeedAgent,
  input: {
    household: SeedHousehold;
    agents: SeedAgent[];
    edges: SeedRelationship[];
    usedEpithets: Set<string>;
    next: () => number;
    /** Authored details for a household member of a key character. */
    authored?: { epithet?: string; want?: string; secret?: { kind: SecretKind; text: string } };
  },
): SeedPersona {
  const { household, agents, edges, usedEpithets, next, authored } = input;
  const pick: Pick = (items) => items[Math.floor(next() * items.length)];
  const goal = a.goals.find((g) => g.kind !== 'survive');
  const motives = motivesFor(a, goal, agents, edges);
  let motive = pick(motives);
  let epithet = authored?.epithet ?? occupationNoun(a, pick) + ' ' + motive.tag;
  for (let i = 0; i < 8 && usedEpithets.has(epithet); i++) {
    motive = pick(motives);
    epithet = occupationNoun(a, pick) + ' ' + motive.tag;
  }
  if (usedEpithets.has(epithet)) epithet += a.home === 'habitat_a' ? ' in Ring A' : ' in Ring B';
  usedEpithets.add(epithet);
  const fear = next() < 0.5 ? pick(OCCUPATION_FEARS[a.occupation] ?? GENERAL_FEARS) : pick(GENERAL_FEARS);
  const flaw = flawFor(a, pick, next);
  const want = authored?.want ?? motive.want;
  if (next() < 0.45) a.background += ' ' + pick(HISTORY_LINES[a.ageBand]);
  return {
    epithet,
    want,
    need: pick(NEEDS),
    fear,
    flaw,
    voice: voiceFor(a, pick),
    secret: authored?.secret ?? secretFor(a, household, agents, edges, pick, next),
    strategies: strategiesFor(a, next),
    arc: pick(ARC_TEMPLATES)({ name: first(a.name), want, flaw, fear }),
    key: false,
  };
}

