/**
 * Public data shapes exchanged between the Convex backend and any client (the Expo app today,
 * possibly Godot later). The backend may store more than this; clients only rely on these shapes.
 * Ids are Convex document ids serialised as strings.
 */
import type {
  LocationId,
  NeedKey,
  ResourceId,
  Speed,
  SpriteId,
  TradedResourceId,
  TraitKey,
  ValueKey,
} from './colony';

export type Id = string;
export type Tick = number;

export type ActivityKind =
  | 'idle'
  | 'walking'
  | 'working'
  | 'eating'
  | 'drinking'
  | 'sleeping'
  | 'resting'
  | 'talking'
  | 'trading'
  | 'giving'
  | 'helping'
  | 'stealing'
  | 'investigating'
  | 'fleeing'
  | 'mourning'
  | 'dead';

export type Needs = Record<NeedKey, number>; // 0..100 pressure, higher is worse
export type Traits = Record<TraitKey, number>; // 0..1
export type Values = Record<ValueKey, number>; // 0..1

/** Present only while the agent is travelling. The client interpolates along findPath(from, to). */
export type Move = { from: LocationId; to: LocationId; departTick: Tick; arriveTick: Tick };

/** Everything the map needs to draw and animate one colonist. Kept small: it is sent often. */
export type AgentLite = {
  id: Id;
  name: string;
  spriteId: SpriteId;
  occupation: string; // OccupationDef.id
  factionId?: string;
  alive: boolean;
  /** Where the agent is, or the destination while `move` is set. */
  locationId: LocationId;
  move?: Move;
  activity: ActivityKind;
  /** Plain-language current action derived from the committed plan, e.g. "Walking to the Exchange to buy food". */
  activityLabel: string;
  busyUntilTick: Tick;
  /** The other party in a talk, trade, gift, theft or help, for speech bubbles and links. */
  interactingWithId?: Id;
  /** Short line of dialogue for a speech bubble, when the current interaction has one. */
  speech?: string;
  mood: string;
  health: number; // 0..100
  needs: Needs;
  /** World version at which this record last changed. */
  updatedAtVersion: number;
};

export type GoalKind =
  | 'survive'
  | 'earn_wealth'
  | 'acquire_resource'
  | 'protect_person'
  | 'improve_relationship'
  | 'gain_influence'
  | 'change_job'
  | 'join_faction'
  | 'avoid_person'
  | 'investigate'
  | 'custom';

export type GoalPublic = {
  id: Id;
  kind: GoalKind;
  description: string;
  priority: number; // 0..1
  source: 'needs' | 'personality' | 'event' | 'llm' | 'divine';
  status: 'active' | 'blocked' | 'satisfied' | 'abandoned';
  targetAgentId?: Id;
  targetAgentName?: string;
  createdAtTick: Tick;
};

export type BeliefPublic = {
  id: Id;
  /** Display text. A belief can be false. */
  text: string;
  subjectAgentId?: Id;
  subjectAgentName?: string;
  confidence: number; // 0..1
  sourceType: 'observed' | 'told' | 'rumor' | 'divine' | 'inference';
  sourceAgentName?: string;
  learnedAtTick: Tick;
};

export type RelationshipPublic = {
  toAgentId: Id;
  toAgentName: string;
  toAgentAlive: boolean;
  kind: 'family' | 'friend' | 'colleague' | 'rival' | 'acquaintance' | 'romance' | 'partner';
  affinity: number; // -1..1
  trust: number; // -1..1
  fear: number; // 0..1
};

export type PlanPublic = {
  /** One sentence: what the agent is trying to do and why. */
  intent: string;
  source: 'routine' | 'template' | 'local_planner' | 'llm';
  goalId?: Id;
  steps: { label: string; status: 'pending' | 'running' | 'done' | 'failed' }[];
  cursor: number;
};

/** The last strategic decision, for the "why did they do that" panel. Not a chain of thought. */
export type ThoughtPublic = {
  tick: Tick;
  trigger: string;
  intent: string;
  source: 'llm' | 'rules';
};

export type EventCategory = 'environment' | 'economy' | 'social' | 'politics' | 'health' | 'action' | 'intervention';

export type WorldEventPublic = {
  id: Id;
  tick: Tick;
  category: EventCategory;
  eventType: string;
  actorId?: Id;
  participantIds: Id[];
  locationId?: LocationId;
  /** Fact-grounded sentence with real names. */
  summary: string;
  salience: number; // 0..1
  /** Parent event in the cause chain, when one really caused this. */
  causationEventId?: Id;
  /** True when the event deserves a banner in the wide view. */
  banner: boolean;
  /** Storyline this event is a beat of, if any. */
  storylineId?: Id;
  visibility: 'public' | 'local' | 'private';
};

export type AgentDetail = AgentLite & {
  ageBand: 'child' | 'young' | 'adult' | 'elder';
  background: string;
  homeLocationId: LocationId;
  workLocationId?: LocationId;
  householdName?: string;
  householdMemberIds: Id[];
  factionName?: string;
  traits: Traits;
  values: Values;
  skills: Record<string, number>; // 0..100
  inventory: Partial<Record<ResourceId, number>>;
  goals: GoalPublic[]; // highest priority first
  plan?: PlanPublic;
  beliefs: BeliefPublic[]; // most relevant first, capped
  relationships: RelationshipPublic[]; // strongest first, capped
  /** The agent's own diary: events they took part in or witnessed, newest first. */
  recentEvents: WorldEventPublic[];
  lastThought?: ThoughtPublic;
  /** Set when the agent is dead. */
  death?: { tick: Tick; cause: string };
  /** The character's story: who they are in a line, what they want and fear, their arc. Never their secret. */
  persona?: PersonaPublic;
  /** Live storylines this colonist is part of, by id (see story:storylines). */
  storylineIds?: Id[];
  /** Society layer (docs/STORY_SPEC.md 8). Presented as story, never as raw numbers. */
  organizations?: { id: Id; name: string; kind: OrganizationKind; role: 'founder' | 'leader' | 'officer' | 'member' }[];
  family?: { partnerId?: Id; partnerName?: string; parentIds: Id[]; childIds: Id[] };
  pets?: { name: string; species: string }[];
  /** A goal that has taken over their life, in words. */
  obsession?: string;
  /** Their notable works, newest first. */
  works?: { id: Id; title: string; kind: string; fame: number }[];
  /** How the colony sees them, in words ("a respected elder", "a nobody", "notorious"). Never the hidden number. */
  standingLabel?: string;
  /** What they are learning or have mastered, in words. */
  education?: string;
};

export type OrganizationKind = 'company' | 'guild' | 'cult' | 'gang' | 'militia' | 'party' | 'school' | 'troupe' | 'breakaway';

export type OrganizationPublic = {
  id: Id;
  name: string;
  kind: OrganizationKind;
  /** What they are for or believe, one sentence. */
  creed: string;
  leaderId?: Id;
  memberIds: Id[];
  foundedTick: Tick;
  status: 'active' | 'disbanded';
  /** For a breakaway colony: where it holds and the rules it declared. */
  territory?: LocationId[];
  rules?: string[];
  /** Organizations it is at odds with. */
  rivalIds: Id[];
};

export type DiscoveryPublic = {
  key: string;
  name: string;
  /** What it changed in the world, one sentence. */
  effect: string;
  tick: Tick;
  discovererIds: Id[];
  eventId?: Id;
};

export type StructurePublic = {
  id: Id;
  key: string;
  name: string;
  locationId: LocationId;
  builderIds: Id[];
  /** 0..1 until finished. */
  progress: number;
  builtTick?: Tick;
};

export type WorkPublic = {
  id: Id;
  title: string;
  kind: string;
  creatorId: Id;
  creatorName: string;
  /** 0..1. Famous works are what the colony talks about. */
  fame: number;
  createdTick: Tick;
  /** What it is about, one sentence. */
  about: string;
};

/** The almanac: the colony's institutions, discoveries, landmarks and culture, for the story view. */
export type SocietyOverview = {
  organizations: OrganizationPublic[];
  discoveries: DiscoveryPublic[];
  structures: StructurePublic[];
  works: WorkPublic[];
  /** The colony's famous people in words, e.g. { agentId, name, for: "the painter of the Long Dark mural" }. */
  notables: { agentId: Id; name: string; for: string }[];
};

export type ArcStage = 'setup' | 'rising' | 'crisis' | 'climax' | 'resolution';

export type PersonaPublic = {
  /** Short tag shown under the name, e.g. "the quartermaster who keeps two ledgers". */
  epithet: string;
  want: string;
  fear: string;
  flaw: string;
  /** How they talk. */
  voice: string;
  arc: { stage: ArcStage; note: string };
  /** True for the ~20 authored key characters. */
  key: boolean;
};

export type EffectType = 'drought' | 'storm';

export type ActiveEffect = {
  id: Id;
  type: EffectType;
  /** Empty means colony-wide. */
  locationIds: LocationId[];
  severity: number; // 0..1
  startTick: Tick;
  endTick: Tick;
  label: string;
};

export type FactionPublic = {
  id: string;
  name: string;
  /** Hex colour for UI chips. */
  color: string;
  leaderAgentId?: Id;
  memberCount: number;
  description: string;
};

export type WorldPublic = {
  id: Id;
  name: string;
  tick: Tick;
  speed: Speed;
  status: 'paused' | 'running';
  /** Increases on every committed batch of changes. */
  version: number;
  population: { alive: number; dead: number };
  activeEffects: ActiveEffect[];
  /** Public building stock, e.g. the Supply Depot reserve. */
  stockpiles: Partial<Record<LocationId, Partial<Record<ResourceId, number>>>>;
  /** Buildings currently damaged, 0..1 per location (absent means intact). */
  damage: Partial<Record<LocationId, number>>;
  /** Market price in credits per unit. */
  prices: Record<TradedResourceId, number>;
  factions: FactionPublic[];
  llm: { enabled: boolean; callsToday: number; budgetPerDay: number; queued: number };
  /** Depot ration policy: 0 full rations, 1 reduced, 2 emergency. */
  rationLevel?: 0 | 1 | 2;
  /** Colony treasury in credits. Wages are paid from it; sales and the daily levy return to it. */
  treasury?: number;
  /** Raw regolith waiting at the quarry and at the works. Feeds parts; not a tradeable resource. */
  regolith?: { quarry: number; workshop: number };
  /** True while the tick loop fast-forwards through the followed colonist's routine. */
  focusWarp?: boolean;
};

// ---------- Story ----------

export type StorylineStatus = 'brewing' | 'rising' | 'climax' | 'resolved' | 'fizzled';

export type StoryBeat = { tick: Tick; text: string; eventId?: Id };

export type StorylinePublic = {
  id: Id;
  title: string;
  /** One or two sentences: what is at stake. */
  premise: string;
  status: StorylineStatus;
  tension: number; // 0..1
  participantIds: Id[];
  /** Newest last, capped. */
  beats: StoryBeat[];
  origin: 'seed' | 'emergent' | 'player';
  createdTick: Tick;
  lastBeatTick: Tick;
};

export type KeyCharacterCard = {
  agentId: Id;
  name: string;
  spriteId: SpriteId;
  epithet: string;
  /** Why the player should care, one sentence. */
  hook: string;
  factionId?: string;
};

/** A tutorial card. The client advances when the named player action happens (or on tap). */
export type TutorialStep = {
  id: string;
  title: string;
  body: string;
  advanceOn: 'tap' | 'follow_starter' | 'read_thoughts' | 'ask_question' | 'switch_character' | 'use_power' | 'open_chronicle' | 'open_storylines';
  /** Agent the step is about, when it points at someone. */
  agentId?: Id;
};

export type StoryIntro = {
  title: string;
  /** Short paragraphs: the place and the moment. */
  setting: string[];
  history: { era: string; text: string }[];
  /** What is at stake right now, one sentence each. */
  tensions: string[];
  keyCharacters: KeyCharacterCard[];
  /** The colonist the player starts by following. */
  starterAgentId: Id;
  tutorial: TutorialStep[];
};

/** One line of a colonist's inner monologue. */
export type ThoughtLine = {
  id: Id;
  tick: Tick;
  text: string;
  mood?: string;
  /** planted: a thought the player put in their head (focus:plant). */
  source: 'llm' | 'rules' | 'planted';
};

/** What focus:plant returns. message explains a refusal, in the story's voice. */
export type PlantResult = { ok: boolean; message?: string };

/** A reason to switch the camera to someone else. */
export type StoryHook = { agentId: Id; name: string; reason: string; storylineId?: Id };

/** Everything the follow view needs beyond agents:get. Reactive. */
export type FocusState = {
  agentId: Id;
  thoughts: ThoughtLine[]; // newest first
  hooks: StoryHook[];
  storylines: StorylinePublic[];
  /** True while the world is fast-forwarding through the followed colonist's routine. */
  warping: boolean;
};

export type AskTurn = { id: Id; tick: Tick; question: string; answer: string };

export type AskResult = { ok: true; turn: AskTurn } | { ok: false; code: 'unauthorized' | 'not_found' | 'dead' | 'rate_limited' | 'unavailable' | 'invalid'; message: string };

export type SyncUpdates = {
  version: number;
  tick: Tick;
  /** Agents changed after sinceVersion. */
  agents: AgentLite[];
  /** Events created after sinceVersion, oldest first. */
  events: WorldEventPublic[];
};

// ---------- Timeskip ----------

/** How far the player can skip ahead (convex/timeskip). */
export type TimeskipSpan = 'week' | 'month' | 'half_year' | 'year' | 'five_years' | 'decade';

/** One headline of the skipped years, with the people in it. */
export type TimeskipBeat = {
  tick: Tick;
  /** "Year 2", "Month 5", "Week 3" or "Sol 12". */
  period: string;
  text: string;
  agentIds: Id[];
  kind: string;
  eventId?: Id;
};

/** A person as the chronicle remembers them: one or two sentences in a story voice. */
export type TimeskipPerson = {
  agentId: Id;
  name: string;
  spriteId: SpriteId;
  alive: boolean;
  text: string;
  /** followed, key, risen, fallen, newcomer, born or gone. */
  role: string;
};

/** The chronicle of a finished skip: read like an epilogue, never a report. */
export type TimeskipSummary = {
  title: string;
  /** Three to six paragraphs. */
  narrative: string[];
  /** Headline beats, oldest first, a few per period. */
  beats: TimeskipBeat[];
  /** Where the followed colonist is now. */
  followed?: TimeskipPerson;
  /** Key characters and anyone who rose or fell, alive or dead. */
  people: TimeskipPerson[];
  /** Newcomers and the colony-born to watch. */
  newPeople: TimeskipPerson[];
  /** What the world resumes with, one sentence each. */
  tensions: string[];
  /** Storylines seeded from the end state. */
  storylineIds: Id[];
  source: 'llm' | 'rules';
};

export type TimeskipPublic = {
  id: Id;
  span: TimeskipSpan;
  status: 'running' | 'summarizing' | 'done' | 'failed';
  startTick: Tick;
  endTick: Tick;
  /** World tick reached so far. */
  tick: Tick;
  chapter: number;
  chapters: number;
  /** 0..1. */
  progress: number;
  /** Story-voice progress line, e.g. "Year 2 of 5: the Union and the council…". */
  progressLabel: string;
  latestBeat?: string;
  summary?: TimeskipSummary;
  error?: string;
};

export type TimeskipStartResult =
  | { ok: true; timeskipId: Id }
  | { ok: false; code: 'unauthorized' | 'invalid' | 'rate_limited' | 'busy'; message: string };

// ---------- God powers ----------

export type PowerType = 'drought' | 'storm' | 'grant' | 'kill' | 'whisper' | 'rumor' | 'create_character';

export type NewCharacterInput = {
  name: string; // 2..40 chars
  spriteId: SpriteId;
  ageBand: 'young' | 'adult' | 'elder';
  occupation: string; // OccupationDef.id
  homeLocationId: 'habitat_a' | 'habitat_b';
  traits: Traits;
  values: Values;
  backstory: string; // up to 280 chars, descriptive only
  startingResources: Partial<Record<ResourceId, number>>; // bounded server-side
  goals: { kind: GoalKind; description: string; targetAgentId?: Id }[]; // up to 2
  relationships?: { toAgentId: Id; kind: RelationshipPublic['kind'] }[]; // up to 3
  factionId?: string;
};

export type Intervention =
  /** Ice wells run dry: water output falls, then hydroponics yield with it. */
  | { type: 'drought'; params: { severity: number; durationDays: number } }
  /** Solar or meteor storm. Empty locationIds hits every exposed location. */
  | { type: 'storm'; params: { severity: number; locationIds?: LocationId[] } }
  | { type: 'grant'; params: { agentId: Id; resource: ResourceId; amount: number } }
  | { type: 'kill'; params: { agentId: Id; cause: string } }
  /** Plant an idea in one mind. Private to the target unless they tell someone. */
  | { type: 'whisper'; params: { agentId: Id; presetKey: string; text: string; strength: number; aboutAgentId?: Id } }
  /** Start a rumor about a character. It spreads from person to person through talk. */
  | { type: 'rumor'; params: { aboutAgentId: Id; presetKey: string; text: string; seedLocationId?: LocationId } }
  | { type: 'create_character'; params: NewCharacterInput };

export type InterventionCommand = Intervention & {
  /** Client-generated uuid. Retrying with the same id returns the first result. */
  commandId: string;
  worldId: Id;
  sessionToken: string;
};

export type InterventionResult =
  | {
      ok: true;
      interventionId: Id;
      worldVersion: number;
      eventIds: Id[];
      affectedAgentIds: Id[];
      createdAgentId?: Id;
    }
  | {
      ok: false;
      code: 'invalid' | 'unauthorized' | 'not_found' | 'rate_limited' | 'cap_reached' | 'dead_target';
      message: string;
    };
