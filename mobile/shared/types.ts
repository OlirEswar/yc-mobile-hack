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
  /** Set when this colonist is a player's avatar: the player's display name. */
  ownerName?: string;
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
  /** 'owner' is a directive from the player whose avatar this is. */
  source: 'needs' | 'personality' | 'event' | 'llm' | 'divine' | 'owner';
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
  kind: 'family' | 'friend' | 'colleague' | 'rival' | 'acquaintance';
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
  visibility: 'public' | 'local' | 'private';
};

export type AgentDetail = AgentLite & {
  ageBand: 'young' | 'adult' | 'elder';
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
  /** Set when this colonist is a player's avatar: who they are modelled on, in general terms. */
  persona?: AvatarPersona;
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
};

export type SyncUpdates = {
  version: number;
  tick: Tick;
  /** Agents changed after sinceVersion. */
  agents: AgentLite[];
  /** Events created after sinceVersion, oldest first. */
  events: WorldEventPublic[];
};

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

// ---------- Avatars: a colonist modelled on the player ----------

/**
 * Where a piece of "about me" material came from. Every source is digested on the device before it
 * is sent: Gmail arrives as a summary of senders, subjects and labels (never message bodies), and
 * ai_memory is what the player's own assistant (ChatGPT, Claude, Gemini) says it knows about them.
 * The backend strips email addresses, phone numbers and links again before storing anything.
 */
export type PersonaSourceKind = 'gmail' | 'ai_memory' | 'about_me';

export type PersonaSourceInput = {
  kind: PersonaSourceKind;
  /** Short label for the list, e.g. "Gmail, last 90 days" or "ChatGPT memory". 1..60 chars. */
  label: string;
  /** The digested text. 20..8000 chars. */
  text: string;
};

export type PersonaSourcePublic = {
  id: Id;
  kind: PersonaSourceKind;
  label: string;
  /** Length of the stored, scrubbed text. */
  chars: number;
  /** First 160 characters of the stored text, so the player can see what was kept. */
  preview: string;
  addedAt: number;
};

/** How an avatar thinks and talks, used by the LLM when it plans or speaks for them. */
export type AvatarPersona = {
  /** One line, third person: who this person is. Up to 160 chars. */
  summary: string;
  /** Up to 6 short interests, e.g. "climbing", "startups". */
  interests: string[];
  /** How they talk. Up to 140 chars. */
  speechStyle: string;
  /** Up to 4 things they tend to do, e.g. "Organises the group dinner". */
  habits: string[];
};

/** The character built from the player's sources. The player can edit it before spawning. */
export type AvatarProfile = AvatarPersona & {
  name: string; // 2..40
  spriteId: SpriteId;
  ageBand: 'young' | 'adult' | 'elder';
  occupation: string; // OccupationDef.id
  homeLocationId: 'habitat_a' | 'habitat_b';
  traits: Traits;
  values: Values;
  backstory: string; // up to 280
  goals: { kind: GoalKind; description: string }[]; // up to 2
};

export type AvatarDirective = { text: string; tick: Tick; worldId: Id };

export type AvatarPublic = {
  sources: PersonaSourcePublic[];
  profile?: AvatarProfile;
  /** 'llm' when a model built the profile, 'rules' for the offline fallback, 'player' after edits. */
  profileSource?: 'llm' | 'rules' | 'player';
  /** The player's avatar in their current world, alive or dead, if they have spawned one there. */
  agentId?: Id;
  /** Newest first, up to 5. */
  directives: AvatarDirective[];
};

/** Answer of the avatar mutations and actions. */
export type AvatarResult = { ok: true; agentId?: Id; profile?: AvatarProfile; profileSource?: AvatarPublic['profileSource'] } | { ok: false; message: string };

// ---------- Multiplayer: friends join one world ----------

export type PlayerPublic = {
  /** Opaque player id (never the session token). */
  id: Id;
  name: string;
  isHost: boolean;
  isYou: boolean;
  /** Heartbeat seen in the last minute. */
  online: boolean;
  avatarAgentId?: Id;
  avatarName?: string;
};

export type MultiplayerPublic = {
  worldId: Id;
  /** The world's join code, once the host has opened it. Visible to every player in the world. */
  inviteCode?: string;
  isHost: boolean;
  /** Host first, then by join time. */
  players: PlayerPublic[];
  maxPlayers: number;
};

export type MultiplayerResult = { ok: true; worldId?: Id; inviteCode?: string } | { ok: false; message: string };
