/**
 * The world bible of Shackleton Colony as seed data: the introduction the player reads (story:intro),
 * the tutorial around the starter, and the storylines already in motion at Sol 1. Characters are
 * referenced by key (keyCharacters.ts); the seed resolves keys to agent ids and stores the map on the
 * world (worlds.keyAgents), so story:intro can resolve them at query time.
 */
import type { TutorialStep } from '../../shared/types';

export const INTRO_TITLE = 'Shackleton Colony, Sol 1';

export const INTRO_SETTING: string[] = [
  'A ring of pressurised domes clings to the rim of Shackleton crater at the lunar south pole. Below it, in a crater floor that has not seen sunlight in two billion years, drill crews cut the ice that is the only water on this world.',
  'A hundred people live here: founding families who remember the company, crews who keep the drills and printers running, traders who keep tramp shuttles landing. No one is coming to save them. No one has for seven years.',
  'It is 06:00 on Sol 1. The reserve in the Supply Depot is smaller than anyone has been told. The Diggers\' Union votes on a strike tomorrow night. A drill head shattered on the night rig, and it was not an accident.',
  'You are the unseen force over the colony. You can follow any life, hear what they think, ask them what they will not say aloud, and tip the world with a drought, a storm, a rumor or a whisper. You cannot tell them what to do. They will decide for themselves.',
];

export const INTRO_HISTORY: { era: string; text: string }[] = [
  {
    era: 'The Landing, nineteen years ago',
    text: 'The Artemis-Meridian consortium landed forty colonists on the crater rim to mine ice and ship it to orbit. Imani Reyes was its administrator. The founding families still call themselves the Compact.',
  },
  {
    era: 'The Export Years',
    text: 'For a decade the shuttles came monthly. The colony grew to a hundred and twenty, opened a second ice shaft, built the Fabrication Works and the grow bays. Workers came up on contracts; most never went home.',
  },
  {
    era: 'The Abandonment, seven years ago',
    text: 'Artemis-Meridian went bankrupt on Earth. The last company shuttle left with the officers and the payroll. Imani Reyes refused her seat, declared a council and wrote the ration rules. The crews organised the Diggers\' Union against the council\'s quotas; the traders who coaxed tramp ships to land formed the Free Exchange League.',
  },
  {
    era: 'The Long Dark, four years ago',
    text: 'A coolant fault took the reactor offline for nineteen days. The relief shuttle Perseverance, carrying a replacement pump, crashed on approach with the pad beacon dark. Eleven people died, seven of them in Ring B. The council\'s inquiry blamed the union\'s three-day stoppage. The union has never accepted it.',
  },
  {
    era: 'The Thin Years',
    text: 'Tramp ships land when they feel like it. Rations were cut twice. Haulers skim, traders hoard, someone pins anonymous notes on the plaza board asking who scrubbed the Ring B logs. Two weeks ago the council cut workers\' water by a cup a day.',
  },
  {
    era: 'Sol 1',
    text: 'Joao Ferreira has called a strike vote for tomorrow night. The quartermaster recounts his racks before dawn. A sixteen-year-old scavenger keeps the Perseverance\'s flight recorder under her bunk.',
  },
];

export const INTRO_TENSIONS: string[] = [
  'The depot reserve is half what the council announces, and only the quartermaster\'s red ledger says so.',
  'The Diggers\' Union votes tomorrow night on stopping the wells and the quarry until rations rise.',
  'Someone is cutting the ice drills, and the chief engineer is hunting the wrong man.',
  'The Perseverance\'s flight recorder could finally say who let it crash during the Long Dark.',
  'The union\'s councilor is secretly in love with the security chief who would break the strike.',
  'Soledad Marchetti holds paper on half the colony, and she is writing to its old owners.',
];

/** Key characters shown as cards, most important first. */
export const INTRO_CARD_KEYS = ['ines', 'dmitri', 'joao', 'soledad', 'hana', 'marcus', 'imani', 'yusuf', 'kenji', 'rook', 'juno', 'priya'];

/** Tutorial cards around the starter. agentKey resolves to TutorialStep.agentId. */
export const TUTORIAL: (Omit<TutorialStep, 'agentId'> & { agentKey?: string })[] = [
  {
    id: 'welcome',
    title: 'Sol 1, 06:00',
    body: 'A hundred lives are already in motion. You will start with one of them. Watch, listen, and when you are ready, interfere.',
    advanceOn: 'tap',
  },
  {
    id: 'meet_ines',
    title: 'Meet Ines Achterberg',
    body: 'She hauls water for the depot and raises her brother Teo, whose lungs are failing. She owes Soledad Marchetti sixty credits by tonight. Follow her.',
    advanceOn: 'follow_starter',
    agentKey: 'ines',
  },
  {
    id: 'thoughts',
    title: 'Hear what she will not say',
    body: 'Open her Mind tab and read her thoughts as they come. Ines has been skimming a litre from every cart she hauls, and she has seen something in the depot she was never meant to see.',
    advanceOn: 'read_thoughts',
    agentKey: 'ines',
  },
  {
    id: 'ask',
    title: 'Ask her',
    body: 'Ask Ines anything: what she found in the depot, why she is afraid of the quartermaster, what Teo needs. She answers in her own voice. Asking never changes her mind.',
    advanceOn: 'ask_question',
    agentKey: 'ines',
  },
  {
    id: 'switch',
    title: 'The other side of the ledger',
    body: 'Dmitri Volkov just took Ines aside. He knows about the water. She knows about his red ledger. Switch to Dmitri and see what he is deciding.',
    advanceOn: 'switch_character',
    agentKey: 'dmitri',
  },
  {
    id: 'storylines',
    title: 'Stories in motion',
    body: 'Ines is caught in two storylines already: the quartermaster\'s two ledgers and the union\'s strike vote. Open the storylines to see every thread in the colony and how tense it is.',
    advanceOn: 'open_storylines',
  },
  {
    id: 'power',
    title: 'Tip the scales',
    body: 'Open Dmitri\'s Mind tab and plant a thought in his head: a doubt, so he hesitates to report her. Or use a power to start a rumor that the quartermaster keeps two ledgers and watch who repeats it. You never control them; you change what they believe.',
    advanceOn: 'use_power',
    agentKey: 'dmitri',
  },
  {
    id: 'chronicle',
    title: 'Every consequence has a cause',
    body: 'Open the chronicle and tap an event to see its cause chain, from the thought you planted to whatever Dmitri does next.',
    advanceOn: 'open_chronicle',
  },
  {
    id: 'yours',
    title: 'The colony is yours to watch',
    body: 'Go back to Ines at the canteen, where the strike vote is being argued, or follow anyone she meets. The world will not wait for you, but it will fast-forward when nothing is happening.',
    advanceOn: 'tap',
    agentKey: 'ines',
  },
];

/**
 * Shape of storylines.state for seeded storylines, read by storyteller/director.ts. Agent ids are
 * resolved at insert. Everything here is inspiration for the director, never an outcome.
 */
export type StorylineState<A = string> = {
  /** What is at risk, one line, for prompts. */
  stakes: string;
  /** Participants whose persona.secret drives this story. */
  secretHolderIds: A[];
  /** Events the director should attach to this storyline: by type, by belief kind in facts, or by place. */
  watch: { eventTypes: string[]; beliefKinds: string[]; locations: string[] };
  /** What escalation looks like, roughly in order (rising, crisis, climax). */
  escalation: string[];
  /** Ways it could end. */
  resolutions: string[];
  /** A decision the director can put in front of a participant (usually the starter) when they are followed. */
  choice?: { agentId: A; prompt: string; options: string[] };
};

export type SeedStoryline = {
  key: string;
  title: string;
  premise: string;
  status: 'brewing' | 'rising';
  tension: number;
  participants: string[];
  /** Backstory beats, all at tick 0. */
  beats: string[];
  state: StorylineState;
};

export const SEED_STORYLINES: SeedStoryline[] = [
  {
    key: 'two_ledgers',
    title: "The Quartermaster's Two Ledgers",
    premise:
      'Dmitri Volkov tells the council the reserve is full; his red ledger says it is half that. Ines Achterberg has seen it, Priya Raghunathan\'s numbers point at it, and Dmitri knows Ines has been skimming.',
    status: 'rising',
    tension: 0.45,
    participants: ['dmitri', 'ines', 'priya', 'imani', 'rook'],
    beats: [
      'Three winters ago Imani Reyes asked Dmitri Volkov to keep the reserve figures calm. He opened a second ledger that night, bound in red.',
      'Last week, hiding two litres behind the cold-store manifest, Ines Achterberg found the red ledger.',
      'Before dawn on Sol 1 Dmitri finished a recount and wrote one word against Ines\'s cart numbers: short.',
    ],
    state: {
      stakes: 'If the real reserve comes out mid-strike the colony panics; if it stays hidden, the next drought finds an empty depot.',
      secretHolderIds: ['dmitri', 'ines'],
      watch: {
        eventTypes: ['theft', 'theft_discovered', 'supplies_missing', 'investigation', 'accusation', 'blackmail', 'bribe', 'confide', 'confess', 'smuggle', 'reserve_low', 'arrest'],
        beliefKinds: ['embezzler', 'thief', 'hoarding', 'corrupt'],
        locations: ['depot'],
      },
      escalation: [
        'Dmitri confronts Ines, threatens her or buys her silence',
        'Priya or Joao gets hold of what the red ledger says',
        'The council orders a public count of the depot',
      ],
      resolutions: [
        'Dmitri confesses and the true reserve is announced',
        'Ines is arrested for theft and the ledger is buried with her',
        'The ledger is exposed and Dmitri runs for the next shuttle',
        'Dmitri and Ines strike a bargain and keep each other\'s secrets',
      ],
      choice: {
        agentId: 'ines',
        prompt: 'Dmitri knows about the water. Does Ines trade his secret for hers, tell Joao about the red ledger, or keep her head down and find the sixty credits some other way?',
        options: ['Blackmail Dmitri with the red ledger', 'Confide in Joao about the ledger', 'Keep quiet and find the credits elsewhere'],
      },
    },
  },
  {
    key: 'strike_vote',
    title: 'The Strike Vote',
    premise:
      'Joao Ferreira has called a vote for the night of Sol 2: the crews stop the wells and the quarry unless rations rise and the reserve opens. Bram Kowalczyk wants to take the depot instead, Hana Yilmaz wants the chair, and Imani Reyes has Marcus Bell ready.',
    status: 'rising',
    tension: 0.5,
    participants: ['joao', 'bram', 'hana', 'imani', 'marcus', 'elias', 'ines', 'soledad'],
    beats: [
      'Two weeks ago the council cut workers\' water by a cup a day and kept the reserve shut.',
      'Joao Ferreira stood on a crate in the canteen and called a strike vote for the evening of Sol 2.',
      'Elias Thorne passed the date of the vote to Marcus Bell the same night, for a ration chit.',
    ],
    state: {
      stakes: 'A strike could win the crews full rations, or stop the water that keeps everyone alive.',
      secretHolderIds: ['joao', 'elias'],
      watch: {
        eventTypes: ['petition', 'petition_denied', 'council_debate', 'ration_cut', 'ration_change', 'rally', 'strike', 'threaten', 'faction_split', 'leadership_change', 'arrest'],
        beliefKinds: ['policy_open', 'policy_guard', 'informer', 'fugitive'],
        locations: ['plaza', 'canteen'],
      },
      escalation: [
        'Joao finds proof that the reserve is being kept back from the crews',
        'Bram rallies the young quarry hands to march on the depot',
        'Imani orders Marcus to break the strike',
      ],
      resolutions: [
        'The council raises rations and the strike is called off',
        'The strike holds and the wells stop',
        'Joao is exposed and the union splits behind Bram',
        'The vote fails and the crews go back to work angrier',
      ],
      choice: {
        agentId: 'joao',
        prompt: 'Bram wants the crews to take the depot tonight. Does Joao hold the line, join him, or go to the council first?',
        options: ['Hold the vote as planned', 'Let Bram take the depot', 'Petition the council one last time'],
      },
    },
  },
  {
    key: 'cut_drills',
    title: 'Cut Drill Heads',
    premise:
      'Three drill heads have shattered at the Ice Wells this month. Kenji Watanabe says they were scored on purpose and blames Bram Kowalczyk; Mira Castellanos fears it was Yusuf Rahman, her oldest friend.',
    status: 'brewing',
    tension: 0.35,
    participants: ['yusuf', 'kenji', 'mira', 'bram'],
    beats: [
      'The third drill head this month shattered on the night rig, and the wells ran at two-thirds for a day.',
      'Kenji Watanabe found clean score marks under the frost on the broken head.',
      'Mira Castellanos noticed cutting-disc dust on Yusuf\'s gloves and said nothing.',
    ],
    state: {
      stakes: 'One more broken drill in a dry week and the colony goes thirsty; the wrong accusation could start a fight inside the union.',
      secretHolderIds: ['yusuf'],
      watch: {
        eventTypes: ['sabotage', 'damage', 'repaired', 'investigation', 'accusation', 'drought', 'confess'],
        beliefKinds: ['saboteur'],
        locations: ['ice_wells', 'workshop'],
      },
      escalation: ['Another drill breaks', 'Kenji accuses Bram in public', 'Mira confronts Yusuf'],
      resolutions: [
        'Yusuf confesses',
        'Bram is punished for something he did not do',
        'Mira covers for Yusuf and the sabotage stops',
        'The wells fail during a drought and everyone pays',
      ],
      choice: {
        agentId: 'mira',
        prompt: 'Mira is nearly sure it is Yusuf. Does she confront him, tell Kenji, or protect him?',
        options: ['Confront Yusuf in private', 'Tell Kenji what she saw', 'Say nothing'],
      },
    },
  },
  {
    key: 'perseverance',
    title: 'What Happened to the Perseverance',
    premise:
      'During the Long Dark the relief shuttle Perseverance came down blind in the crater. Juno Sato has found its flight recorder, Rook Abernathy knows the pad beacon was cut from inside, Marcus Bell was on duty, and Imani Reyes\'s inquiry blamed the union.',
    status: 'brewing',
    tension: 0.3,
    participants: ['juno', 'rook', 'marcus', 'imani', 'kenji', 'lucia'],
    beats: [
      'In the Long Dark the Perseverance, carrying the coolant pump that could have restarted the reactor, crashed on approach. Eleven people died before power returned.',
      'Imani Reyes\'s inquiry blamed the union\'s three-day stoppage. The Diggers\' Union has never accepted it.',
      'Last week Juno Sato pulled the Perseverance\'s flight recorder out of the crater and promised it to Rook for two hundred credits.',
      'Someone has started pinning notes on the plaza board: WHO SCRUBBED THE RING B LOGS?',
    ],
    state: {
      stakes: 'The recorder could clear the union and bring down the chair and the security chief, or leave the Moon on a smuggler\'s shuttle.',
      secretHolderIds: ['marcus', 'imani', 'kenji'],
      watch: {
        eventTypes: ['scavenge', 'smuggle', 'confess', 'confide', 'eavesdrop', 'rumor_spread', 'rumor_started', 'accusation', 'shuttle_arrival'],
        beliefKinds: ['coward', 'forger', 'agitator'],
        locations: ['landing_pad', 'plaza'],
      },
      escalation: [
        'Juno sells the recorder, or someone else learns she has it',
        'Marcus finds out the recorder exists',
        'The recorder is played in the plaza',
      ],
      resolutions: [
        'The truth comes out and the colony turns on Marcus and Imani',
        'Marcus gets the recorder and destroys it',
        'Rook sells it off-world and the truth leaves on the next shuttle',
        'Imani confesses before anyone can expose her',
      ],
      choice: {
        agentId: 'juno',
        prompt: 'Rook will pay two hundred credits for the recorder, no questions. Does Juno sell it, play it, or take it to someone who cares what it says?',
        options: ['Sell it to Rook', 'Find out what is on it', 'Take it to Lucia Navarro'],
      },
    },
  },
  {
    key: 'councilor_and_chief',
    title: 'The Councilor and the Chief',
    premise:
      'Hana Yilmaz, the union\'s voice on the council, and Marcus Bell, the Founders\' security chief, have been lovers for five months. If the strike comes, he will be ordered to break it.',
    status: 'brewing',
    tension: 0.25,
    participants: ['hana', 'marcus', 'joao', 'imani'],
    beats: [
      'Five months ago Marcus Bell walked Hana Yilmaz home after a council session ran past curfew. Neither has told anyone since.',
      'When Marcus\'s officers broke up the last union rally, Hana spoke against him in council the next morning, and went to him that night.',
    ],
    state: {
      stakes: 'Exposed, they lose their factions; kept secret, one of them will have to betray the other when the strike comes.',
      secretHolderIds: ['hana'],
      watch: {
        eventTypes: ['court', 'confide', 'eavesdrop', 'reconcile', 'rumor_spread', 'strike', 'arrest', 'falling_out'],
        beliefKinds: ['affair'],
        locations: ['habitat_a', 'habitat_b'],
      },
      escalation: ['Someone sees them together', 'Imani orders Marcus to arrest the strike leaders', 'Hana asks Marcus to stand down'],
      resolutions: [
        'They go public and both factions turn on them',
        'Hana uses Marcus to win the chair',
        'Marcus breaks the strike and loses her',
        'Marcus resigns rather than break it',
      ],
    },
  },
];
