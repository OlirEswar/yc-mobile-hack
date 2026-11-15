/**
 * Hand-authored key colonists: the people the story of Shackleton Colony is about at Sol 1. Each wants
 * something, fears something and hides something (persona.secret), and their ties are written so that
 * those wants collide. These are starting conditions, not scripts: the engine and the storyteller
 * decide what happens next.
 *
 * Data contract for the other owners:
 * - persona.secret.kind is a belief kind (see SECRET_KINDS). Discovering a secret means holding a
 *   belief of that kind with the secret holder as subject. Some colonists start out knowing or
 *   suspecting someone else's secret (KEY_BELIEFS).
 * - persona.strategies orders how the character prefers to meet needs.
 * - Relationship obligation is directed: from -> to obligation 0.6+ means 'from' owes 'to' a real
 *   debt (the amount is in the matching 'debt' belief). Family and friends carry a milder 0.2..0.8.
 * - opening seeds where the character is at 06:00 on Sol 1 and what they are already doing, so the
 *   starter's first hour runs through the other key characters. '@key' arguments are agent ids.
 */
import type { LocationId } from '../../shared/colony';

export type Traits6 = [ambition: number, empathy: number, caution: number, curiosity: number, sociability: number, stubbornness: number];
export type Values5 = [wealth: number, family: number, status: number, harmony: number, freedom: number];

/** Strategies a colonist can prefer, from docs/STORY_SPEC.md 3.1. */
export const STRATEGIES = ['work', 'grow', 'trade', 'charm', 'borrow', 'beg', 'scavenge', 'smuggle', 'steal', 'scheme'] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Belief kinds a persona secret can have. Holding one about someone means knowing their secret. */
export const SECRET_KINDS = ['embezzler', 'affair', 'saboteur', 'smuggler', 'coward', 'forger', 'addict', 'fugitive', 'thief', 'informer', 'traitor', 'agitator', 'coverup'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export type KeyGoal = {
  kind: string;
  description: string;
  priority: number;
  predicate: string;
  /** Key of another key character this goal is about, or 'household:<index>'. */
  target?: string;
  targetResource?: string;
  targetQuantity?: number;
  targetOccupation?: string;
  targetFaction?: string;
  drive?: string;
};

export type KeyPersona = {
  epithet: string;
  want: string;
  need: string;
  fear: string;
  flaw: string;
  voice: string;
  secret: { kind: SecretKind; text: string };
  strategies: Strategy[];
  arc: string;
  hook: string;
};

/** What a colonist is doing when the player arrives. Steps are [type, ...args]; '@key' is that character's id. */
export type Opening = {
  at: LocationId;
  activity: 'idle' | 'working' | 'eating' | 'talking' | 'resting';
  label: string;
  intent: string;
  steps: { step: string[]; label: string }[];
};

export type HouseholdMember = {
  name: string;
  ageBand: 'young' | 'adult' | 'elder';
  occupation: string;
  /** Lets authored data (storylines, ties) point at this member. They stay key:false. */
  key?: string;
  epithet?: string;
  want?: string;
  secret?: { kind: SecretKind; text: string };
  background?: string;
  health?: number;
};

export type KeyCharacter = {
  key: string;
  name: string;
  familyName: string;
  ageBand: 'young' | 'adult' | 'elder';
  occupation: string;
  role?: string;
  faction?: string;
  home: Extract<LocationId, 'habitat_a' | 'habitat_b'>;
  householdSize: number;
  traits: Traits6;
  values: Values5;
  skill: number;
  credits: number;
  health?: number;
  background: string;
  persona: KeyPersona;
  goals: KeyGoal[];
  /** Fixed extra household members instead of generated ones. */
  household?: HouseholdMember[];
  pantryFactor?: number;
  /** Thefts already on their record, so an investigation of a 'thief' belief finds the truth. */
  thefts?: number;
  opening?: Opening;
};

/** The colonist the introduction starts the player on. */
export const STARTER_KEY = 'ines';

export const KEY_CHARACTERS: KeyCharacter[] = [
  {
    key: 'ines',
    name: 'Ines Achterberg',
    familyName: 'Achterberg',
    ageBand: 'adult',
    occupation: 'hauler',
    faction: 'union',
    home: 'habitat_b',
    householdSize: 2,
    traits: [0.6, 0.72, 0.35, 0.75, 0.6, 0.65],
    values: [0.45, 0.95, 0.3, 0.45, 0.7],
    skill: 66,
    credits: 4,
    health: 92,
    background:
      'Orphaned by the Long Dark at nineteen, she hauls water carts from the Ice Wells to the Supply Depot under Dmitri Volkov and raises her brother Teo, whose lungs never recovered from a season in the quarry.',
    persona: {
      epithet: 'a depot hauler skimming water for her brother',
      want: 'Get Teo his lung medicine and pay Soledad Marchetti the sixty credits she owes before the debt is called in',
      need: 'To stop carrying everything alone and let someone help her',
      fear: 'Teo coughing alone in Ring B while she sits in a security cell',
      flaw: 'Proud and quick with a lie; she would rather steal than ask',
      voice: "Wry and fast, deflects with jokes, calls the quartermaster 'the Count' behind his back, swears in her mother's Dutch when scared",
      secret: {
        kind: 'thief',
        text: "She skims a litre or two from every depot cart she hauls and trades it at the pad for Teo's medicine. Covering her tracks, she found the quartermaster's red ledger, so she knows his lie as well.",
      },
      strategies: ['work', 'steal', 'borrow', 'charm'],
      arc: 'Dmitri knows she skims, she knows his red ledger, Soledad wants her sixty credits by tonight and Joao wants her vote. Every choice she makes today tips one of them.',
      hook: 'She holds the most dangerous secret in the colony while hiding a small one of her own, and four people want something from her before breakfast.',
    },
    goals: [
      { kind: 'protect_person', description: 'Get Teo the medicine his lungs need', priority: 0.85, predicate: 'target_safe', target: 'household:1' },
      { kind: 'earn_wealth', description: 'Scrape together the sixty credits owed to Soledad Marchetti', priority: 0.7, predicate: 'credits_at_least', targetQuantity: 64, drive: 'get_rich' },
    ],
    household: [
      {
        name: 'Teo Achterberg',
        ageBand: 'young',
        occupation: 'resident',
        key: 'teo',
        health: 70,
        epithet: "Ines's little brother, with quarry dust in his lungs",
        want: 'Earn his own way so Ines can stop carrying him',
        secret: { kind: 'smuggler', text: 'He runs packages for Rook between the pad and the bunk blocks to pay toward his own medicine, and lies to Ines about where he goes.' },
        background: 'Fifteen. Worked one season in the quarry at thirteen and has coughed ever since. He idolises Bram Kowalczyk and does not ask where his sister finds the credits for his medicine.',
      },
    ],
    pantryFactor: 0.3,
    thefts: 3,
    opening: {
      at: 'habitat_b',
      activity: 'idle',
      label: 'Awake before the shift horn, listening to Teo cough',
      intent: 'Get to the depot before Dmitri finishes the morning count, then find a way to the sixty credits',
      steps: [
        { step: ['go', 'depot'], label: 'Hurrying to the depot before the morning count' },
        { step: ['talk', '@dmitri'], label: 'Facing Dmitri: the cart counts came up short again' },
        { step: ['go', 'canteen'], label: 'Heading to the canteen, where the crews are arguing about the strike' },
        { step: ['talk', '@joao'], label: 'Hearing Joao out: he wants her vote, and what she knows about the depot' },
        { step: ['go', 'landing_pad'], label: 'Going to see Rook at the pad about the water no one else will buy' },
        { step: ['talk', '@rook'], label: 'Haggling with Rook in the cargo cage' },
      ],
    },
  },
  {
    key: 'dmitri',
    name: 'Dmitri Volkov',
    familyName: 'Volkov',
    ageBand: 'adult',
    occupation: 'quartermaster',
    role: 'quartermaster',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.5, 0.4, 0.9, 0.35, 0.3, 0.85],
    values: [0.6, 0.85, 0.5, 0.55, 0.3],
    skill: 88,
    credits: 140,
    background:
      'Quartermaster of the Supply Depot since the Abandonment. After the Long Dark, Imani Reyes asked him to keep the reserve figures calm, and he has kept two books ever since. His wife Oksana and their two children share his quarters in Ring A.',
    persona: {
      epithet: 'the quartermaster who keeps two ledgers',
      want: 'Buy four seats home for his family before the reserve runs out and someone counts it',
      need: 'To trust the colony with the real numbers instead of protecting it from them',
      fear: 'The morning someone opens the cold store and counts the racks',
      flaw: 'Believes a lie told for good reasons stays small',
      voice: "Short, dry sentences; talks in quantities ('that is nine litres, not ten'); answers questions with questions",
      secret: {
        kind: 'embezzler',
        text: 'He keeps two ledgers. The red one shows the reserve at half what the council announces, and that he has sold sixty litres off the books through Rook at the landing pad, saving toward four seats on an outbound shuttle.',
      },
      strategies: ['work', 'scheme', 'smuggle'],
      arc: 'The strike would open the depot, and an open depot gets counted. He has to decide whether to bury Ines Achterberg, buy her silence or come clean.',
      hook: 'The reserve the colony counts on is half what he says, and the hauler Ines Achterberg has seen his red ledger.',
    },
    goals: [
      { kind: 'custom', description: 'Keep the depot reserve above the red line whatever the council says', priority: 0.7, predicate: 'reserve_healthy', drive: 'guard_reserve' },
      { kind: 'earn_wealth', description: 'Put by 400 credits toward four shuttle seats home', priority: 0.55, predicate: 'credits_at_least', targetQuantity: 400, drive: 'get_rich' },
    ],
    opening: {
      at: 'depot',
      activity: 'working',
      label: 'Recounting the water racks before anyone else is in',
      intent: 'Finish the morning count before the hauler shift arrives, and settle what to do about the short carts',
      steps: [
        { step: ['work', '3'], label: 'Recounting the water racks, again' },
        { step: ['work', '10'], label: 'Keeping two ledgers straight at the depot' },
      ],
    },
  },
  {
    key: 'joao',
    name: 'Joao Ferreira',
    familyName: 'Ferreira',
    ageBand: 'adult',
    occupation: 'quarry_hand',
    role: 'union_leader',
    faction: 'union',
    home: 'habitat_a',
    householdSize: 5,
    traits: [0.8, 0.65, 0.3, 0.35, 0.85, 0.75],
    values: [0.4, 0.75, 0.7, 0.35, 0.6],
    skill: 76,
    credits: 45,
    background:
      "Speaker of the Diggers' Union and a quarry hand for twenty years. He organised the three-day stoppage that the inquiry blamed for the Long Dark, and has spent four years proving he is not the man that report describes.",
    persona: {
      epithet: 'the union speaker counting votes for a strike',
      want: 'Win the strike vote and force full rations for the crews who dig the colony out of the rock',
      need: 'To lead without needing to be the hero of it',
      fear: 'That Earth remembers who he really is',
      flaw: 'Pride: he cannot back down in front of a crowd',
      voice: "Big and warm, a quarry man's jokes and a preacher's cadence; says 'we', never 'I'",
      secret: {
        kind: 'fugitive',
        text: 'Joao Ferreira is not his name. He is Joaquim Ferraz, who stowed away on an ore tender after a Lisbon dock riot left a foreman dead. Soledad Marchetti found him on an old shuttle manifest and has kept it to herself, so far.',
      },
      strategies: ['work', 'charm', 'borrow'],
      arc: 'The vote is tomorrow night. He needs proof the reserve is being kept from the crews, and the strike fund runs on credits borrowed from Soledad.',
      hook: 'His strike could save the crews or break the colony, and Soledad Marchetti holds both his loans and his real name.',
    },
    goals: [
      { kind: 'gain_influence', description: "Carry the strike vote until the council has to raise the workers' rations", priority: 0.75, predicate: 'rations_full_and_leader', drive: 'seek_power' },
    ],
    opening: {
      at: 'canteen',
      activity: 'eating',
      label: 'Holding court over breakfast at the long table',
      intent: 'Count votes for the strike before the quarry shift and find someone who can prove the reserve is being kept back',
      steps: [
        { step: ['eat'], label: 'Breakfast with the strike committee' },
        { step: ['wait', '8'], label: 'Counting strike votes at the long table' },
        { step: ['talk', '@hana'], label: 'Arguing with Hana about when to call the strike' },
        { step: ['go', 'quarry'], label: 'Heading out to the quarry face, late' },
      ],
    },
  },
  {
    key: 'soledad',
    name: 'Soledad Marchetti',
    familyName: 'Marchetti',
    ageBand: 'adult',
    occupation: 'trader',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.92, 0.3, 0.5, 0.5, 0.7, 0.7],
    values: [0.95, 0.2, 0.75, 0.2, 0.7],
    skill: 86,
    credits: 320,
    background:
      'Came up as an Artemis-Meridian purser and was stranded when the company fell. She built the biggest stall on the Exchange Concourse from nothing, leads the Free Exchange League, and holds paper on half the colony.',
    persona: {
      epithet: "the merchant who holds half the colony's debts",
      want: 'Corner the water trade and collect on every debt before a strike ruins business',
      need: 'To belong somewhere instead of owning it',
      fear: 'Being poor and powerless again, as she was the day the company left',
      flaw: 'Thinks everyone has a price, and is usually right',
      voice: "Silky and amused, never in a hurry; quotes amounts to the decimal; says 'darling' when she is threatening you",
      secret: {
        kind: 'traitor',
        text: "She writes to Artemis-Meridian's receivers on every shuttle. They have promised her the water concession if they come back to repossess the colony, and she has told them exactly how weak the council is.",
      },
      strategies: ['trade', 'scheme', 'charm'],
      arc: 'A strike, an exposed reserve or a collapsed council all raise the value of what she is selling to Earth. She only needs to choose which to help along.',
      hook: 'Half the colony owes her, and she is quietly selling the colony itself back to its old owners.',
    },
    goals: [
      { kind: 'earn_wealth', description: 'Corner the water trade and build a fortune of 600 credits', priority: 0.8, predicate: 'credits_at_least', targetQuantity: 600, drive: 'get_rich' },
    ],
    opening: {
      at: 'market',
      activity: 'working',
      label: 'Opening her stall and reading her debt book',
      intent: 'Collect from Ines Achterberg before the hauler shift swallows her',
      steps: [
        { step: ['wait', '4'], label: 'Opening the stall and reading her debt book' },
        { step: ['go', 'canteen'], label: 'Going to the canteen to collect a debt' },
        { step: ['talk', '@ines'], label: 'Reminding Ines Achterberg that sixty credits fall due tonight' },
        { step: ['go', 'market'], label: 'Back to the stall, smiling' },
      ],
    },
  },
  {
    key: 'hana',
    name: 'Hana Yilmaz',
    familyName: 'Yilmaz',
    ageBand: 'adult',
    occupation: 'councilor',
    faction: 'union',
    home: 'habitat_b',
    householdSize: 2,
    traits: [0.85, 0.6, 0.35, 0.55, 0.8, 0.6],
    values: [0.35, 0.45, 0.8, 0.4, 0.7],
    skill: 74,
    credits: 60,
    background:
      'The youngest councilor, elected on the votes of the well crews. In every session she argues that the reserve should be opened to the people who fill it, and that Imani Reyes has held the chair too long.',
    persona: {
      epithet: 'the union councilor in love with the enemy',
      want: 'Take the chair from Imani Reyes and open the reserve',
      need: 'To choose between the movement and the man before someone chooses for her',
      fear: "That Joao finds out and the crews call her a Founder's mistress",
      flaw: 'Treats every relationship as a vote to be won',
      voice: 'Quick, warm and persuasive, a speech in every answer; laughs when she is cornered',
      secret: {
        kind: 'affair',
        text: "For five months she has been seeing Marcus Bell, the Founders' security chief who broke up the union's last rally. Nobody in the Diggers' Union knows.",
      },
      strategies: ['charm', 'work', 'scheme'],
      arc: 'If the strike comes, Marcus will be ordered to break it. She can use him, protect him or lose him.',
      hook: "She may be the next chair, and she spends her nights with the man whose job is to break the union's strike.",
    },
    goals: [
      { kind: 'gain_influence', description: 'Replace Imani Reyes as council chair and open the reserve', priority: 0.75, predicate: 'is_chair', target: 'imani' },
    ],
    opening: {
      at: 'canteen',
      activity: 'idle',
      label: 'Drafting a motion to open the reserve over cold tea',
      intent: 'Shape the strike vote into a vote against Imani Reyes',
      steps: [
        { step: ['wait', '10'], label: 'Drafting the motion to open the reserve' },
        { step: ['go', 'plaza'], label: 'Taking the motion to the council chamber' },
      ],
    },
  },
  {
    key: 'marcus',
    name: 'Marcus Bell',
    familyName: 'Bell',
    ageBand: 'adult',
    occupation: 'security',
    role: 'security_chief',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 3,
    traits: [0.5, 0.45, 0.85, 0.55, 0.45, 0.75],
    values: [0.35, 0.65, 0.7, 0.75, 0.2],
    skill: 84,
    credits: 60,
    background:
      'Chief of colony security, a widower raising his son with his mother in Ring A. His wife died in Ring B during the Long Dark. He believes order is what keeps the air in, and he keeps a list of everyone who has ever come up short at the depot.',
    persona: {
      epithet: 'the security chief who was on the pad the night the Perseverance fell',
      want: 'Keep order through the strike without anyone dying on his watch again',
      need: 'To stop hiding behind the rules and face what he did',
      fear: "The Perseverance's flight recorder",
      flaw: "Hard on everyone else's failures so nobody looks at his",
      voice: "Clipped and procedural, 'ma'am' and 'sir'; softens only with Hana, and then he barely talks at all",
      secret: {
        kind: 'coward',
        text: 'On the night of the Long Dark he had pad duty. When the dome lights failed he panicked, cut the landing beacon to save power for the airlock heaters and ran for Ring A. The Perseverance came down blind in the crater. He told the inquiry the beacon failed on its own.',
      },
      strategies: ['work', 'scheme', 'charm'],
      arc: 'The strike will set him against the woman he loves; the recorder could set the whole colony against him.',
      hook: 'He is in love with the union councilor he may be ordered to arrest, and he is the only one who knows why the Perseverance crashed.',
    },
    goals: [
      { kind: 'custom', description: 'Make sure no theft in the colony goes unanswered', priority: 0.6, predicate: 'none', drive: 'enforce' },
      { kind: 'improve_relationship', description: 'Keep Hana Yilmaz close, whatever the strike does', priority: 0.5, predicate: 'affinity_at_least', target: 'hana', targetQuantity: 0.95, drive: 'befriend' },
    ],
  },
  {
    key: 'imani',
    name: 'Imani Reyes',
    familyName: 'Reyes',
    ageBand: 'elder',
    occupation: 'councilor',
    role: 'chair',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 3,
    traits: [0.6, 0.55, 0.85, 0.4, 0.6, 0.8],
    values: [0.3, 0.6, 0.85, 0.7, 0.3],
    skill: 82,
    credits: 90,
    background:
      "One of the forty who landed with Artemis-Meridian nineteen years ago, and the consortium's colony administrator. When the company went bankrupt she refused the last seat home and declared the council instead. She wrote the reserve rules and the inquiry into the Long Dark, and both still stand.",
    persona: {
      epithet: 'the chair who wrote the official story of the Long Dark',
      want: 'Hold the chair and the reserve rules until the colony can survive without either',
      need: 'To tell the truth about the Long Dark and let someone else carry the colony',
      fear: 'That the families of the eleven learn whose signature deferred the reactor overhaul',
      flaw: 'Mistakes control for care; every crisis convinces her she is the only adult in the room',
      voice: 'Measured and formal, speaks in council minutes; uses full names; never raises her voice, which is worse',
      secret: {
        kind: 'forger',
        text: "She rewrote the Long Dark inquiry. Kenji Watanabe's draft said the council's deferred reactor overhaul caused the fault; the report she read aloud blamed the union's three-day stoppage.",
      },
      strategies: ['scheme', 'work', 'charm'],
      arc: 'The strike vote and the flight recorder both threaten the story she has told for four years. Will she confess, or burn someone else to keep it?',
      hook: 'She has governed for seven years, the last four on a report she forged.',
    },
    goals: [
      { kind: 'gain_influence', description: 'Stay council chair and keep the depot reserve rules in force', priority: 0.7, predicate: 'is_chair' },
    ],
  },
  {
    key: 'yusuf',
    name: 'Yusuf Rahman',
    familyName: 'Rahman',
    ageBand: 'adult',
    occupation: 'ice_miner',
    role: 'shift_boss',
    faction: 'union',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.75, 0.55, 0.4, 0.45, 0.7, 0.65],
    values: [0.45, 0.75, 0.6, 0.5, 0.5],
    skill: 85,
    credits: 50,
    background:
      "Shift boss at the Ice Wells and Mira Castellanos's oldest friend; they grew up in the same Ring A corridor. He has drilled the crater since the second shaft opened and wants a council seat so the crews who drill the water drink it first.",
    persona: {
      epithet: 'the shift boss breaking his own drills',
      want: 'Make the council feel what the wells are worth, and win a seat to say so',
      need: 'To trust that the truth is enough without breaking things to prove it',
      fear: 'Mira finding the cutting disc in his locker',
      flaw: 'Righteous: once a cause is just, any means will do',
      voice: "Soft-spoken and patient, a foreman's 'easy, easy'; goes very quiet when he lies",
      secret: {
        kind: 'saboteur',
        text: "He has been scoring the night rig's drill heads with a cutting disc so they shatter under load: three this month. He wants the council to feel what it costs when the wells stop, before the strike vote.",
      },
      strategies: ['work', 'scheme', 'trade'],
      arc: 'Kenji is hunting the saboteur and suspects the wrong man. Mira suspects the right one.',
      hook: 'Someone is wrecking the only source of water on the Moon, and it is the man in charge of it.',
    },
    goals: [
      { kind: 'gain_influence', description: 'Win a council seat so the well crews get water before the farms', priority: 0.7, predicate: 'on_council', drive: 'seek_power' },
    ],
  },
  {
    key: 'kenji',
    name: 'Kenji Watanabe',
    familyName: 'Watanabe',
    ageBand: 'adult',
    occupation: 'fabricator',
    role: 'chief_engineer',
    faction: 'union',
    home: 'habitat_b',
    householdSize: 3,
    traits: [0.55, 0.5, 0.75, 0.85, 0.4, 0.6],
    values: [0.4, 0.55, 0.55, 0.6, 0.5],
    skill: 91,
    credits: 60,
    background:
      'Chief engineer at the Fabrication Works. Every drill head and grow rack in the colony has passed through his hands. He wrote the first draft of the Long Dark inquiry and has never asked what happened to it.',
    persona: {
      epithet: 'the engineer hunting whoever is cutting his drill heads',
      want: 'Catch whoever is ruining his drill heads and keep every machine in the colony alive',
      need: "To admit his own signature is in the Long Dark, not just the council's",
      fear: 'Someone pulling the old reactor test logs',
      flaw: 'Trusts machines over people and evidence over mercy',
      voice: 'Precise and technical, short pauses while he thinks; apologises to equipment, rarely to people',
      secret: {
        kind: 'forger',
        text: 'Four years ago he signed the reactor safety certificate without running the coolant test, because the council wanted the overhaul deferred. The test log he filed is invented, and the fault that started the Long Dark was in that loop.',
      },
      strategies: ['work', 'trade', 'scavenge'],
      arc: 'He is sure Bram Kowalczyk is the saboteur. If he digs deep enough to be certain, he may dig up his own old lie.',
      hook: 'He is hunting a saboteur with the zeal of a man who forged the safety certificate behind the Long Dark.',
    },
    goals: [
      { kind: 'custom', description: 'Keep every drill, panel and grow rack in the colony running', priority: 0.65, predicate: 'no_damage', drive: 'repair' },
      { kind: 'investigate', description: 'Prove Bram Kowalczyk is scoring the drill heads', priority: 0.6, predicate: 'belief_resolved', target: 'bram', drive: 'saboteur' },
    ],
  },
  {
    key: 'mira',
    name: 'Mira Castellanos',
    familyName: 'Castellanos',
    ageBand: 'adult',
    occupation: 'hydroponicist',
    role: 'lead_grower',
    faction: 'founders',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.75, 0.6, 0.55, 0.6, 0.65, 0.6],
    values: [0.35, 0.7, 0.65, 0.6, 0.4],
    skill: 90,
    credits: 55,
    background:
      'Lead grower at the Hydroponics Bays, married with two children. She grew up in the same corridor as Yusuf Rahman and still shares a table with him, though she wants the farms to have first call on every litre he drills.',
    persona: {
      epithet: 'the lead grower with a hidden rack in the crawlspace',
      want: 'Win a council seat so the farms get first call on water',
      need: 'To stop looking away from what the people she loves are doing',
      fear: 'The drills failing for good and the racks dying of thirst',
      flaw: 'Loyal past the point of honesty',
      voice: 'Practical and teasing, everything is a plant metaphor; talks faster when she is nervous',
      secret: {
        kind: 'thief',
        text: 'She runs a hidden grow rack in the Bay 4 service crawl on water bled from the farm lines, and sells the greens to Tobias Okafor off the ration books.',
      },
      strategies: ['grow', 'trade', 'work'],
      arc: 'She suspects Yusuf is breaking the drills, and she is hiding Tobias in her life. Loyalty to one may cost her the other.',
      hook: 'She grows food the colony does not know exists, for a man who is not her husband, while her oldest friend breaks the wells that water it.',
    },
    goals: [
      { kind: 'gain_influence', description: 'Win a council seat so the farms get first call on water', priority: 0.7, predicate: 'on_council', drive: 'seek_power' },
    ],
  },
  {
    key: 'rook',
    name: 'Rook Abernathy',
    familyName: 'Abernathy',
    ageBand: 'elder',
    occupation: 'dock_hand',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.6, 0.35, 0.6, 0.6, 0.45, 0.8],
    values: [0.85, 0.15, 0.3, 0.3, 0.95],
    skill: 80,
    credits: 220,
    background:
      'Flew the tramp hauler Kestrel, grounded at Shackleton during the Long Dark when the council pulled its reactor to keep the domes warm. She never got it back. She works the pad now, and anything that moves off the books moves through her cargo cage.',
    persona: {
      epithet: 'the stranded pilot who runs the black market at the pad',
      want: 'Earn enough for a berth off the Moon on the next tramp ship',
      need: 'To stop selling the truth and finally tell it',
      fear: 'Dying on the Moon like the crew she was talking down the night the Perseverance fell',
      flaw: "Cynical; sells anything to anyone, other people's secrets included",
      voice: "Gravelly pilot slang, calls everyone 'groundling', long silences, never answers the question you asked",
      secret: {
        kind: 'smuggler',
        text: "She runs the colony's black market from the pad's cargo cage, buying the quartermaster's off-book water and selling to tramp crews. She also knows the Perseverance's beacon was cut from inside the pad hut: she was on the radio with its pilot when it went dark.",
      },
      strategies: ['smuggle', 'trade', 'scheme'],
      arc: 'Juno Sato has the flight recorder and Rook has a buyer. Selling it buys her way home; playing it buys the colony the truth.',
      hook: 'She buys stolen water from the quartermaster and knows exactly who let the Perseverance crash.',
    },
    goals: [
      { kind: 'earn_wealth', description: 'Save 900 credits for a berth on the next tramp ship out', priority: 0.75, predicate: 'credits_at_least', targetQuantity: 900, drive: 'get_rich' },
    ],
    opening: {
      at: 'landing_pad',
      activity: 'working',
      label: 'Sorting crates in the cargo cage, off the manifest',
      intent: 'Move what came in off the books before the pad gets busy',
      steps: [{ step: ['work', '14'], label: 'Working the cargo cage at the pad' }],
    },
  },
  {
    key: 'juno',
    name: 'Juno Sato',
    familyName: 'Sato',
    ageBand: 'young',
    occupation: 'resident',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.7, 0.3, 0.3, 0.85, 0.25, 0.7],
    values: [0.85, 0.3, 0.2, 0.2, 0.95],
    skill: 58,
    credits: 12,
    background:
      'Orphaned by the Long Dark at twelve. She lives alone in a Ring B bunk and walks the crater in a patched suit, salvaging what the Perseverance left behind.',
    persona: {
      epithet: "a crater scavenger holding the Perseverance's flight recorder",
      want: 'Sell the recorder for enough credits never to be hungry again',
      need: 'To find out what the recorder says and decide it matters more than the money',
      fear: 'Being caught out on the crater floor when a storm comes',
      flaw: 'Trusts nobody and lies by reflex',
      voice: 'Quiet and blunt, sixteen going on forty; answers questions with prices',
      secret: {
        kind: 'thief',
        text: 'She strips the Perseverance wreck for salvage, the belongings of the dead included. Last week she found its flight recorder; it is under her bunk, promised to Rook for two hundred credits.',
      },
      strategies: ['scavenge', 'trade', 'beg'],
      arc: 'The recorder could clear the union, sink Marcus Bell and end Imani Reyes. Right now it is two hundred credits under a bunk.',
      hook: 'A hungry sixteen-year-old is holding the truth about the Long Dark, and she plans to sell it.',
    },
    goals: [
      { kind: 'earn_wealth', description: 'Get 200 credits for the recorder, or for anything else the crater gives up', priority: 0.7, predicate: 'credits_at_least', targetQuantity: 200, drive: 'get_rich' },
    ],
    pantryFactor: 0.4,
  },
  {
    key: 'bram',
    name: 'Bram Kowalczyk',
    familyName: 'Kowalczyk',
    ageBand: 'adult',
    occupation: 'quarry_hand',
    faction: 'union',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.85, 0.35, 0.15, 0.4, 0.75, 0.85],
    values: [0.4, 0.3, 0.85, 0.2, 0.9],
    skill: 70,
    credits: 22,
    background:
      "A third-generation quarry hand whose father died in a pit collapse. Ines Achterberg's ex. He thinks Joao Ferreira's strike vote is too little, too late, and says so loudly.",
    persona: {
      epithet: 'the firebrand who wants the union to take the depot',
      want: 'Push the union past talking: take the depot and open the reserve by force',
      need: 'To be part of something instead of the loudest voice in it',
      fear: 'Being ordinary, and dying in the pit like his father',
      flaw: 'Reckless and vain; picks fights he cannot finish',
      voice: "Loud and profane, talks in slogans, calls Joao 'old man' to his face",
      secret: {
        kind: 'thief',
        text: 'He broke into the Med Bay pharmacy last month and sold the painkillers at the pad. Anneliese Brandt has been covering a shortage she believes is her own doing.',
      },
      strategies: ['steal', 'scheme', 'work'],
      arc: 'Kenji has pegged him as the saboteur, wrongly. Being accused of something he did not do may push him into something worse.',
      hook: "He is suspected of the sabotage he didn't commit, while the theft he did commit goes unnoticed.",
    },
    goals: [
      { kind: 'gain_influence', description: 'Win the crews away from Joao Ferreira', priority: 0.65, predicate: 'standing_at_least', targetQuantity: 8, drive: 'seek_power' },
    ],
    thefts: 1,
  },
  {
    key: 'priya',
    name: 'Priya Raghunathan',
    familyName: 'Raghunathan',
    ageBand: 'adult',
    occupation: 'researcher',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.55, 0.5, 0.45, 0.95, 0.45, 0.7],
    values: [0.25, 0.3, 0.5, 0.45, 0.85],
    skill: 89,
    credits: 55,
    background:
      'Astronomer at the Observatory Lab who also logs melt rates at the wells. Her figures do not match the depot ledgers, and she cannot leave a discrepancy alone.',
    persona: {
      epithet: 'the astronomer whose numbers do not add up',
      want: "Prove that Dmitri Volkov's reserve figures are fiction",
      need: "To share her own bad news, not only expose other people's",
      fear: 'Being the one who tells the colony it is running out of water',
      flaw: "Righteous about other people's lies, blind to her own",
      voice: "Rapid and exact, speaks in footnotes; 'technically' is her favourite word",
      secret: {
        kind: 'coverup',
        text: 'Her melt-rate model says the ice wells will fall below what the colony drinks within two years. She has told no one, and she has smoothed the published figures so nobody else notices.',
      },
      strategies: ['work', 'scheme', 'trade'],
      arc: 'She is closing in on the red ledger, and whoever exposes the depot will be asked what the wells really hold.',
      hook: 'She is about to expose the quartermaster for hiding the truth about water, while hiding a worse truth about water herself.',
    },
    goals: [
      { kind: 'investigate', description: "Find out whether Dmitri Volkov's reported reserves are real", priority: 0.65, predicate: 'belief_resolved', target: 'dmitri', drive: 'hoarding' },
    ],
  },
  {
    key: 'anneliese',
    name: 'Anneliese Brandt',
    familyName: 'Brandt',
    ageBand: 'adult',
    occupation: 'medic',
    role: 'head_medic',
    home: 'habitat_a',
    householdSize: 2,
    traits: [0.5, 0.92, 0.7, 0.6, 0.5, 0.55],
    values: [0.2, 0.6, 0.4, 0.85, 0.35],
    skill: 92,
    credits: 65,
    background:
      'Head medic. During the Long Dark she ran the Med Bay by candlelight and decided who got the last oxygen. She has never turned a patient away since, with or without credits.',
    persona: {
      epithet: 'the medic who chose who breathed during the Long Dark',
      want: 'Stock the Med Bay with thirty doses before the next storm',
      need: 'To forgive herself for the choices of the Long Dark',
      fear: 'Another night of choosing who lives',
      flaw: 'Gives everything to patients and lies to herself about what it costs her',
      voice: 'Gentle and tired, clinical words for terrible things, gallows humour',
      secret: {
        kind: 'addict',
        text: 'Since the Long Dark she has been taking the Med Bay painkillers to sleep. The pharmacy count is short, and she has been writing it off as spoilage.',
      },
      strategies: ['work', 'beg', 'charm'],
      arc: "Teo Achterberg's lungs are getting worse and the pharmacy is short. She does not know half the shortage is Bram's theft.",
      hook: 'Everyone trusts her with their lives, and she cannot get through a night without the pills she takes from them.',
    },
    goals: [
      { kind: 'acquire_resource', description: 'Build the Med Bay stock up to 30 doses of medicine before the next storm', priority: 0.65, predicate: 'medbay_medicine_at_least', targetResource: 'medicine', targetQuantity: 30 },
    ],
  },
  {
    key: 'elias',
    name: 'Elias Thorne',
    familyName: 'Thorne',
    ageBand: 'adult',
    occupation: 'hauler',
    faction: 'union',
    home: 'habitat_a',
    householdSize: 4,
    traits: [0.35, 0.8, 0.6, 0.3, 0.45, 0.55],
    values: [0.3, 0.97, 0.25, 0.6, 0.35],
    skill: 58,
    credits: 9,
    health: 64,
    background:
      'A hauler with a bad lung from the last decompression. He is the only wage in a household of four, and the pantry is nearly bare.',
    persona: {
      epithet: 'the union hauler informing for security to feed his kids',
      want: 'Keep Wren and Pip fed until his lung heals',
      need: 'To ask for help openly instead of selling his friends',
      fear: 'Wren going hungry, and Joao learning what he has done',
      flaw: 'Shame: he would rather betray someone than beg',
      voice: 'Hoarse and apologetic, short of breath; turns every question back to his children',
      secret: {
        kind: 'informer',
        text: "Since the union's last rally he has told Marcus Bell who comes to Diggers' Union meetings, in exchange for an extra water ration. Joao Ferreira counts him as a friend.",
      },
      strategies: ['work', 'borrow', 'beg'],
      arc: 'The strike vote is exactly what Marcus will want to hear about, and exactly what Joao would never forgive him for telling.',
      hook: "He is the union's most loyal hauler and security's best informer, and both are for his children.",
    },
    goals: [
      { kind: 'protect_person', description: 'Make sure Wren Thorne never goes hungry', priority: 0.85, predicate: 'target_safe', target: 'household:2' },
    ],
    household: [
      { name: 'Agnes Thorne', ageBand: 'elder', occupation: 'resident', epithet: "Elias's mother, who remembers the colony's first harvest" },
      { name: 'Wren Thorne', ageBand: 'young', occupation: 'resident', epithet: "Elias's daughter, too thin and too watchful" },
      { name: 'Pip Thorne', ageBand: 'young', occupation: 'resident', epithet: 'the youngest Thorne, who trails Lucia around the canteen' },
    ],
    pantryFactor: 0.12,
  },
  {
    key: 'tobias',
    name: 'Tobias Okafor',
    familyName: 'Okafor',
    ageBand: 'adult',
    occupation: 'trader',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 3,
    traits: [0.7, 0.75, 0.45, 0.5, 0.85, 0.4],
    values: [0.6, 0.7, 0.5, 0.65, 0.6],
    skill: 78,
    credits: 180,
    background:
      'Set up his stall across the concourse from Soledad Marchetti three years ago and has undercut her ever since. The well crews buy from him on credit he cannot really afford to give.',
    persona: {
      epithet: 'the fair-price trader with a married lover',
      want: 'Win the concourse from Soledad with fair prices and credit for the well crews',
      need: 'To stop being kind to everyone and honest with no one',
      fear: 'Soledad buying up his debts the way she bought out his old partner',
      flaw: "Cannot say no to anyone's face",
      voice: 'Easy charm, laughs at his own jokes, haggles with compliments',
      secret: {
        kind: 'affair',
        text: 'For a year he has been meeting Mira Castellanos in the Bay 4 crawl. He sells her hidden greens on his stall, and lets Lucia Navarro believe he might love her back.',
      },
      strategies: ['trade', 'charm', 'borrow'],
      arc: 'He owes Soledad ninety credits and his heart to a married woman, and Lucia is starting to notice where he goes in the evenings.',
      hook: "The colony's kindest trader is lying to the two women who care about him most.",
    },
    goals: [
      { kind: 'earn_wealth', description: 'Win customers away from Soledad Marchetti with fairer prices', priority: 0.7, predicate: 'credits_at_least', targetQuantity: 400, target: 'soledad', drive: 'undercut' },
    ],
  },
  {
    key: 'lucia',
    name: 'Lucia Navarro',
    familyName: 'Navarro',
    ageBand: 'adult',
    occupation: 'cook',
    home: 'habitat_b',
    householdSize: 2,
    traits: [0.45, 0.8, 0.4, 0.75, 0.97, 0.35],
    values: [0.35, 0.6, 0.5, 0.8, 0.55],
    skill: 83,
    credits: 40,
    background:
      'Runs the line at the Airlock Canteen and feeds half the colony every evening. Her husband Andres died in Ring B during the Long Dark. She hears everything said over the trays.',
    persona: {
      epithet: 'the canteen cook who hears everything and forgets nothing',
      want: 'Find out who let Ring B freeze, and get Tobias Okafor to really see her',
      need: 'To grieve Andres instead of hunting for someone to blame',
      fear: 'That the eleven will be forgotten',
      flaw: 'Gossip is how she loves people, and how she hurts them',
      voice: 'Warm and nosy, Spanish endearments, feeds you while she interrogates you',
      secret: {
        kind: 'agitator',
        text: "She is the one pinning the anonymous notes on the plaza board: 'WHO SCRUBBED THE RING B LOGS?'",
      },
      strategies: ['work', 'charm', 'trade'],
      arc: 'Her notes are making the council nervous. If she learns about Tobias and Mira, her gossip will stop being gentle.',
      hook: "The colony's kitchen runs on her warmth; the plaza board runs on her anonymous fury.",
    },
    goals: [
      { kind: 'improve_relationship', description: 'Get closer to Tobias Okafor', priority: 0.55, predicate: 'affinity_at_least', target: 'tobias', targetQuantity: 0.85, drive: 'befriend' },
    ],
    opening: {
      at: 'canteen',
      activity: 'working',
      label: 'Ladling breakfast and listening to the strike talk',
      intent: 'Feed the morning shift and hear who is voting which way',
      steps: [{ step: ['work', '12'], label: 'Running the breakfast line at the canteen' }],
    },
  },
  {
    key: 'nadia',
    name: 'Nadia Haddad',
    familyName: 'Haddad',
    ageBand: 'young',
    occupation: 'dock_hand',
    faction: 'exchange',
    home: 'habitat_b',
    householdSize: 1,
    traits: [0.88, 0.45, 0.3, 0.7, 0.75, 0.5],
    values: [0.8, 0.25, 0.65, 0.3, 0.9],
    skill: 62,
    credits: 75,
    background:
      'Unloads shuttles at the Landing Pad under Rook and watches what the cargo sells for on the concourse. She is saving for a stall of her own, faster than a dock wage allows.',
    persona: {
      epithet: 'the dock hand learning to smuggle',
      want: 'Open her own stall on the Exchange before she turns twenty-five',
      need: 'To find out what she will not do for money',
      fear: 'Hauling crates on the pad for the rest of her life',
      flaw: 'Impatient; mistakes risk for courage',
      voice: 'Fast and slangy, shuttle-crew jargon, rolls her eyes at the council',
      secret: {
        kind: 'smuggler',
        text: "She carries Rook's off-book cargo through the pad airlock in her suit locker, a few litres at a time, for a cut she is saving toward a stall.",
      },
      strategies: ['trade', 'smuggle', 'charm'],
      arc: "Every run brings her closer to a stall and deeper into Rook's debts and secrets.",
      hook: 'She is one good season from her own stall, and one bad search from a cell.',
    },
    goals: [
      { kind: 'change_job', description: 'Leave the docks and open a stall on the Exchange', priority: 0.7, predicate: 'occupation_is', targetOccupation: 'trader' },
    ],
  },
];

export const FACTIONS = [
  {
    key: 'founders',
    name: "Founders' Compact",
    color: '#4F8FE8',
    stance: 'guard',
    leader: 'imani',
    officers: ['dmitri', 'marcus', 'mira'],
    description: 'The founding families and the old officials who kept the council, the ration ledgers and the reserve when the company left. They trust rules, records and a full depot.',
  },
  {
    key: 'union',
    name: "Diggers' Union",
    color: '#E8843C',
    stance: 'open',
    leader: 'joao',
    officers: ['yusuf', 'hana', 'kenji'],
    description: 'Well crews, quarry hands, haulers and fabricators, organised after the Abandonment when the council set work quotas. They want bigger rations, an open reserve and a real say.',
  },
  {
    key: 'exchange',
    name: 'Free Exchange League',
    color: '#3CCB7F',
    stance: 'trade',
    leader: 'soledad',
    officers: ['tobias', 'nadia'],
    description: 'Traders and dock hands who kept tramp shuttles landing when the company stopped sending them. They want open trade and the council out of the market.',
  },
] as const;

/**
 * Authored ties between key characters (and their keyed household members). Each is created in both
 * directions; the *Back fields give the other direction when it differs. obligation is from a to b.
 */
export type KeyTie = {
  a: string;
  b: string;
  kind: string;
  affinity: number;
  trust: number;
  fear?: number;
  obligation?: number;
  affinityBack?: number;
  trustBack?: number;
  fearBack?: number;
  obligationBack?: number;
};

export const KEY_TIES: KeyTie[] = [
  // The starter's world
  { a: 'ines', b: 'dmitri', kind: 'colleague', affinity: -0.1, trust: -0.35, fear: 0.4, affinityBack: 0.15, trustBack: -0.45 },
  { a: 'ines', b: 'soledad', kind: 'acquaintance', affinity: -0.25, trust: -0.15, fear: 0.3, obligation: 0.75, affinityBack: 0.1, trustBack: 0.05 },
  { a: 'ines', b: 'joao', kind: 'friend', affinity: 0.5, trust: 0.5, affinityBack: 0.55, trustBack: 0.45 },
  { a: 'ines', b: 'bram', kind: 'acquaintance', affinity: 0.05, trust: -0.25, affinityBack: 0.5, trustBack: 0.3 },
  { a: 'ines', b: 'rook', kind: 'acquaintance', affinity: 0.2, trust: 0.15, affinityBack: 0.25, trustBack: 0.3 },
  { a: 'ines', b: 'elias', kind: 'colleague', affinity: 0.55, trust: 0.5 },
  { a: 'ines', b: 'anneliese', kind: 'acquaintance', affinity: 0.5, trust: 0.55, obligation: 0.35, affinityBack: 0.4 },
  { a: 'teo', b: 'bram', kind: 'acquaintance', affinity: 0.6, trust: 0.55, affinityBack: 0.3 },
  // Founders
  { a: 'imani', b: 'dmitri', kind: 'colleague', affinity: 0.45, trust: 0.7, obligationBack: 0.4 },
  { a: 'imani', b: 'marcus', kind: 'colleague', affinity: 0.4, trust: 0.65 },
  { a: 'imani', b: 'kenji', kind: 'colleague', affinity: 0.15, trust: 0.45, fear: 0.15, fearBack: 0.2 },
  { a: 'imani', b: 'hana', kind: 'rival', affinity: -0.45, trust: -0.3 },
  { a: 'anneliese', b: 'imani', kind: 'acquaintance', affinity: 0.3, trust: 0.45 },
  // The secret lovers, and the one who loves without knowing
  { a: 'hana', b: 'marcus', kind: 'friend', affinity: 0.85, trust: 0.65, affinityBack: 0.9, trustBack: 0.75 },
  { a: 'tobias', b: 'mira', kind: 'friend', affinity: 0.85, trust: 0.7 },
  { a: 'lucia', b: 'tobias', kind: 'friend', affinity: 0.8, trust: 0.6, affinityBack: 0.45, trustBack: 0.5 },
  { a: 'lucia', b: 'mira', kind: 'friend', affinity: 0.5, trust: 0.5 },
  // Union
  { a: 'hana', b: 'joao', kind: 'friend', affinity: 0.55, trust: 0.6 },
  { a: 'joao', b: 'yusuf', kind: 'colleague', affinity: 0.5, trust: 0.55 },
  { a: 'elias', b: 'joao', kind: 'friend', affinity: 0.5, trust: 0.55, affinityBack: 0.6, trustBack: 0.7 },
  { a: 'bram', b: 'joao', kind: 'rival', affinity: -0.3, trust: -0.2, affinityBack: -0.1, trustBack: -0.25 },
  { a: 'kenji', b: 'yusuf', kind: 'colleague', affinity: 0.4, trust: 0.55 },
  { a: 'kenji', b: 'bram', kind: 'acquaintance', affinity: -0.25, trust: -0.4, affinityBack: -0.2, trustBack: -0.1 },
  { a: 'mira', b: 'yusuf', kind: 'friend', affinity: 0.8, trust: 0.6, trustBack: 0.75 },
  { a: 'hana', b: 'yusuf', kind: 'colleague', affinity: 0.35, trust: 0.4 },
  // Debts and old grudges
  { a: 'joao', b: 'soledad', kind: 'acquaintance', affinity: -0.2, trust: -0.3, fear: 0.25, obligation: 0.65, affinityBack: 0.05, trustBack: -0.1 },
  { a: 'tobias', b: 'soledad', kind: 'rival', affinity: -0.6, trust: -0.45, obligation: 0.5 },
  { a: 'joao', b: 'dmitri', kind: 'rival', affinity: -0.5, trust: -0.5 },
  { a: 'marcus', b: 'joao', kind: 'rival', affinity: -0.35, trust: -0.3, fear: 0.2 },
  { a: 'elias', b: 'marcus', kind: 'acquaintance', affinity: -0.1, trust: 0.25, fear: 0.45, obligation: 0.4, affinityBack: 0.1, trustBack: 0.5 },
  { a: 'priya', b: 'dmitri', kind: 'acquaintance', affinity: -0.15, trust: -0.3 },
  { a: 'priya', b: 'kenji', kind: 'friend', affinity: 0.45, trust: 0.5 },
  // The pad
  { a: 'dmitri', b: 'rook', kind: 'acquaintance', affinity: -0.05, trust: 0.3, fear: 0.3, affinityBack: 0.1, trustBack: 0.2 },
  { a: 'rook', b: 'marcus', kind: 'acquaintance', affinity: -0.45, trust: -0.5, affinityBack: -0.2, trustBack: -0.3, fearBack: 0.35 },
  { a: 'rook', b: 'nadia', kind: 'colleague', affinity: 0.45, trust: 0.45, obligationBack: 0.3 },
  { a: 'rook', b: 'juno', kind: 'acquaintance', affinity: 0.3, trust: 0.2, affinityBack: 0.2, trustBack: 0.1 },
  { a: 'juno', b: 'kenji', kind: 'acquaintance', affinity: 0.25, trust: 0.2 },
  { a: 'nadia', b: 'soledad', kind: 'acquaintance', affinity: 0.2, trust: 0.1 },
  { a: 'nadia', b: 'tobias', kind: 'friend', affinity: 0.45, trust: 0.4 },
  { a: 'anneliese', b: 'elias', kind: 'acquaintance', affinity: 0.4, trust: 0.5 },
  { a: 'anneliese', b: 'bram', kind: 'acquaintance', affinity: 0.2, trust: 0.35, affinityBack: 0.1, trustBack: 0.05 },
];

/**
 * What key characters already know or suspect at Sol 1, true and false. A secret kind about someone
 * means the holder knows (or thinks they know) that person's secret. 'debt' beliefs carry the amount.
 */
export type KeyBelief = {
  holder: string;
  kind: string;
  subject?: string;
  worldKey?: string;
  text: string;
  valence: number;
  confidence: number;
  sourceType: 'observed' | 'told' | 'rumor' | 'inference';
  private?: boolean;
};

export const KEY_BELIEFS: KeyBelief[] = [
  { holder: 'ines', kind: 'embezzler', subject: 'dmitri', text: 'Dmitri Volkov keeps a second, red ledger: the reserve is half what the council announces.', valence: -1, confidence: 0.85, sourceType: 'observed', private: true },
  { holder: 'ines', kind: 'debt', subject: 'soledad', text: "I owe Soledad Marchetti sixty credits for Teo's medicine, due tonight.", valence: -0.4, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'soledad', kind: 'debt', subject: 'ines', text: 'Ines Achterberg owes me sixty credits, due tonight.', valence: -0.2, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'dmitri', kind: 'thief', subject: 'ines', text: 'Ines Achterberg has been skimming water from the depot carts.', valence: -1, confidence: 0.7, sourceType: 'observed', private: true },
  { holder: 'joao', kind: 'debt', subject: 'soledad', text: 'The union strike fund owes Soledad Marchetti 150 credits.', valence: -0.4, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'soledad', kind: 'debt', subject: 'joao', text: "Joao Ferreira's strike fund owes me 150 credits.", valence: -0.2, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'soledad', kind: 'fugitive', subject: 'joao', text: 'Joao Ferreira is really Joaquim Ferraz, wanted on Earth over a dock riot death.', valence: -1, confidence: 0.9, sourceType: 'observed', private: true },
  { holder: 'tobias', kind: 'debt', subject: 'soledad', text: "I owe Soledad Marchetti ninety credits for last season's stock.", valence: -0.4, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'soledad', kind: 'debt', subject: 'tobias', text: 'Tobias Okafor owes me ninety credits and cannot pay.', valence: -0.2, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'marcus', kind: 'informer', subject: 'elias', text: 'Elias Thorne reports on union meetings to me for an extra ration.', valence: 0.2, confidence: 1, sourceType: 'observed', private: true },
  { holder: 'rook', kind: 'coward', subject: 'marcus', text: 'Marcus Bell cut the pad beacon the night the Perseverance came down.', valence: -1, confidence: 0.8, sourceType: 'observed', private: true },
  { holder: 'rook', kind: 'embezzler', subject: 'dmitri', text: 'Dmitri Volkov sells reserve water off the books through my cargo cage.', valence: -0.5, confidence: 0.95, sourceType: 'observed', private: true },
  { holder: 'dmitri', kind: 'smuggler', subject: 'rook', text: 'Rook Abernathy runs everything that moves off the books at the pad.', valence: -0.3, confidence: 0.95, sourceType: 'observed', private: true },
  { holder: 'nadia', kind: 'smuggler', subject: 'rook', text: 'Rook Abernathy runs the black market out of the cargo cage.', valence: 0.2, confidence: 0.95, sourceType: 'observed', private: true },
  { holder: 'rook', kind: 'custom', subject: 'juno', text: 'Juno Sato pulled something out of the Perseverance wreck that is worth a great deal.', valence: 0, confidence: 0.7, sourceType: 'told', private: true },
  { holder: 'kenji', kind: 'saboteur', subject: 'bram', text: 'Someone is scoring the drill heads, and Bram Kowalczyk was seen near the night rig.', valence: -1, confidence: 0.5, sourceType: 'inference', private: true },
  { holder: 'mira', kind: 'saboteur', subject: 'yusuf', text: 'Yusuf came off the night rig with cutting-disc dust on his gloves.', valence: -1, confidence: 0.4, sourceType: 'inference', private: true },
  { holder: 'lucia', kind: 'affair', subject: 'tobias', text: 'Tobias Okafor slips off toward the Hydroponics Bays every evening, and Mira Castellanos always leaves soon after.', valence: -0.6, confidence: 0.45, sourceType: 'inference', private: true },
  { holder: 'priya', kind: 'hoarding', subject: 'dmitri', text: "Dmitri Volkov's reserve figures do not match the water the wells sent him.", valence: -1, confidence: 0.55, sourceType: 'inference' },
  { holder: 'priya', kind: 'scarcity', worldKey: 'scarcity:water', text: 'The ice wells give less water every season.', valence: -1, confidence: 0.9, sourceType: 'observed' },
  { holder: 'imani', kind: 'untrustworthy', subject: 'joao', text: "Joao Ferreira's stoppage left the reactor without a crew when it failed.", valence: -1, confidence: 0.6, sourceType: 'inference' },
  { holder: 'lucia', kind: 'untrustworthy', subject: 'imani', text: 'Imani Reyes let Ring B freeze during the Long Dark to keep the council dome warm.', valence: -1, confidence: 0.6, sourceType: 'inference' },
  { holder: 'bram', kind: 'untrustworthy', subject: 'joao', text: 'Joao Ferreira will sell the crews out the moment the council offers him a seat.', valence: -1, confidence: 0.55, sourceType: 'inference' },
  { holder: 'hana', kind: 'admirable', subject: 'marcus', text: 'Marcus Bell is a better man than the Founders deserve.', valence: 1, confidence: 0.8, sourceType: 'observed', private: true },
  { holder: 'anneliese', kind: 'custom', worldKey: 'pharmacy_short', text: 'The pharmacy count is short, and it is my fault.', valence: -1, confidence: 0.7, sourceType: 'inference', private: true },
];
