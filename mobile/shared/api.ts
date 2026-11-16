/**
 * The Convex function contract. The backend implements each entry as a public function at the
 * given path (`world:get` is `export const get` in convex/world.ts). The client calls them through
 * `api.<module>.<name>`. Changing a path, argument or return shape here needs both sides to agree.
 */
import type { Speed } from './colony';
import type {
  AgentDetail,
  AgentLite,
  AvatarProfile,
  AvatarPublic,
  AvatarResult,
  Id,
  MultiplayerPublic,
  MultiplayerResult,
  PersonaSourceInput,
  InterventionCommand,
  InterventionResult,
  SyncUpdates,
  Tick,
  WorldEventPublic,
  WorldPublic,
} from './types';

export type ApiContract = {
  // ----- session and lifecycle -----
  /**
   * mutation. Finds or creates the session and its world for this install. On first call it seeds
   * the colony with 100 colonists. The token authorises every other mutation.
   */
  'session:bootstrap': { args: { deviceId: string }; returns: { sessionToken: string; worldId: Id } };
  /**
   * mutation. The client calls this about every 15 seconds while the app is open. The simulation
   * only ticks while a heartbeat is fresh (60 seconds), so a closed app pauses its world.
   */
  'session:heartbeat': { args: { sessionToken: string }; returns: { ok: boolean } };
  /**
   * mutation. Tells the backend which colonist the player is following, or null in the wide view.
   * A followed colonist gets priority in the LLM planning queue; it never changes the simulation.
   */
  'session:setFocus': { args: { sessionToken: string; agentId: Id | null }; returns: { ok: boolean } };

  // ----- world -----
  /** query. Reactive. Changes every tick, so it also serves as the clock. */
  'world:get': { args: { worldId: Id }; returns: WorldPublic | null };
  /** mutation. Speed 0 pauses. */
  'world:setSpeed': { args: { sessionToken: string; worldId: Id; speed: Speed }; returns: { ok: boolean } };
  /**
   * mutation. Runs the simulation forward until the next high-salience event, or the next one
   * involving agentId when given, up to 6 simulated hours.
   */
  'world:skipToNotable': {
    args: { sessionToken: string; worldId: Id; agentId?: Id };
    returns: { advancedTicks: number; eventId?: Id };
  };
  /** mutation. Deletes the world and seeds a fresh one. For demos and tests. */
  'world:reset': { args: { sessionToken: string }; returns: { worldId: Id } };

  // ----- agents -----
  /** query. Every colonist, alive or dead. Call once on load, then keep current with sync:updates. */
  'agents:list': { args: { worldId: Id }; returns: AgentLite[] };
  /** query. Reactive detail for the inspector and the follow HUD. */
  'agents:get': { args: { worldId: Id; agentId: Id }; returns: AgentDetail | null };

  // ----- sync -----
  /**
   * query. Agents and events that changed after sinceVersion. Reads only the changed rows, so the
   * client can call it on every world:get change (or subscribe with a moving cursor).
   */
  'sync:updates': { args: { worldId: Id; sinceVersion: number }; returns: SyncUpdates };

  // ----- chronicle -----
  /** query. Newest first, filtered by salience. `beforeTick` pages backwards. */
  'chronicle:feed': {
    args: { worldId: Id; beforeTick?: Tick; limit?: number; minSalience?: number; agentId?: Id };
    returns: WorldEventPublic[];
  };
  /** query. The cause chain through one event: its ancestors from the root, then the event, then its direct effects. */
  'chronicle:chain': { args: { worldId: Id; eventId: Id }; returns: WorldEventPublic[] };

  // ----- billing -----
  /** query. Reactive. True once the Whop payment.succeeded webhook has marked this session premium. */
  'billing:status': { args: { sessionToken: string }; returns: { premium: boolean } };
  /** action. Creates a Whop checkout tagged with this session and returns the hosted checkout URL. */
  'billing:createCheckout': { args: { sessionToken: string }; returns: { purchaseUrl: string } };

  // ----- god powers -----
  /**
   * mutation. Validated and idempotent on commandId. kill and whisper refuse another player's
   * avatar (code 'unauthorized'): only its owner guides it, through avatar:direct.
   */
  'interventions:apply': { args: InterventionCommand; returns: InterventionResult };

  // ----- avatar: your own colonist, built from what you import about yourself -----
  /** query. Reactive. The player's sources, profile, avatar in the current world and recent directives. */
  'avatar:mine': { args: { sessionToken: string }; returns: AvatarPublic | null };
  /** mutation. Stores one digested source after scrubbing emails, phone numbers and links. At most 6. */
  'avatar:addSource': { args: { sessionToken: string; source: PersonaSourceInput }; returns: AvatarResult };
  /** mutation. */
  'avatar:removeSource': { args: { sessionToken: string; sourceId: Id }; returns: AvatarResult };
  /**
   * action. Builds the profile from every source with the LLM, or with keyword rules when no model
   * is configured or the call fails. name, when given, is used as the character's name.
   */
  'avatar:synthesize': { args: { sessionToken: string; name?: string }; returns: AvatarResult };
  /** mutation. Saves a profile the player edited. Validated with the same rules as create_character. */
  'avatar:saveProfile': { args: { sessionToken: string; profile: AvatarProfile }; returns: AvatarResult };
  /**
   * mutation. Puts the avatar into the player's current world at the Landing Pad. Friends' avatars
   * already there become friends. Refused while the player's avatar in this world is alive.
   */
  'avatar:spawn': { args: { sessionToken: string }; returns: AvatarResult };
  /**
   * mutation. Tells the avatar what its player wants, e.g. "make friends with the medics". Becomes a
   * goal and an immediate plan (keyword rules now, the LLM's plan when it answers). 3..140 chars.
   */
  'avatar:direct': { args: { sessionToken: string; text: string }; returns: AvatarResult };
  /** mutation. Deletes every source and the profile. A spawned avatar stays as an ordinary colonist. */
  'avatar:forget': { args: { sessionToken: string }; returns: AvatarResult };

  // ----- multiplayer -----
  /** query. Reactive. The players sharing the session's current world. */
  'multiplayer:state': { args: { sessionToken: string }; returns: MultiplayerPublic | null };
  /** mutation. Display name shown to the other players. 2..24 chars. */
  'multiplayer:setName': { args: { sessionToken: string; name: string }; returns: MultiplayerResult };
  /** mutation. Host only. Opens the world to friends and returns its 6-character join code. */
  'multiplayer:invite': { args: { sessionToken: string }; returns: MultiplayerResult };
  /**
   * mutation. Moves this session into the world with that code. The client then restarts its
   * subscriptions with session:bootstrap, which now returns the shared world.
   */
  'multiplayer:join': { args: { sessionToken: string; code: string }; returns: MultiplayerResult };
  /** mutation. Guests only. Returns to the player's own world (seeding a new one if it is gone). */
  'multiplayer:leave': { args: { sessionToken: string }; returns: MultiplayerResult };
};

export type ApiPath = keyof ApiContract;
