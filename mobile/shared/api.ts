/**
 * The Convex function contract. The backend implements each entry as a public function at the
 * given path (`world:get` is `export const get` in convex/world.ts). The client calls them through
 * `api.<module>.<name>`. Changing a path, argument or return shape here needs both sides to agree.
 */
import type { Speed } from './colony';
import type {
  AgentDetail,
  AgentLite,
  AskResult,
  PlantResult,
  AskTurn,
  FocusState,
  SocietyOverview,
  StoryIntro,
  StorylinePublic,
  Id,
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

  // ----- story -----
  /** query. The introduction for this world: setting, history, key characters, starter and tutorial. */
  'story:intro': { args: { worldId: Id }; returns: StoryIntro | null };
  /** query. Reactive. Live and recent storylines, highest tension first. With agentId, only theirs. */
  'story:storylines': { args: { worldId: Id; agentId?: Id }; returns: StorylinePublic[] };

  // ----- society -----
  /** query. Reactive. Organizations, discoveries, structures, famous works and notable people. */
  'society/api:overview': { args: { worldId: Id }; returns: SocietyOverview };

  // ----- follow mode -----
  /** query. Reactive. Inner monologue, story hooks and storylines of the followed colonist. */
  'focus:state': { args: { worldId: Id; agentId: Id }; returns: FocusState | null };
  /** query. Reactive. The player's questions to this colonist and their answers, oldest first. */
  'focus:conversation': { args: { sessionToken: string; agentId: Id }; returns: AskTurn[] };
  /** action. Ask the colonist a question. They answer in character; it never changes the world. */
  'focus:ask': { args: { sessionToken: string; worldId: Id; agentId: Id; question: string }; returns: AskResult };
  /**
   * action. Plant a thought (3 to 200 characters of free text) in a colonist's head. It is read into
   * a whisper (a belief about someone, a goal), surfaces at once as a 'planted' monologue line, and
   * the colonist reacts to it within a tick or two. Counts as a god power for rate limits.
   */
  'focus:plant': { args: { sessionToken: string; worldId: Id; agentId: Id; text: string }; returns: PlantResult };

  // ----- billing -----
  /** query. Reactive. True once the Whop payment.succeeded webhook has marked this session premium. */
  'billing:status': { args: { sessionToken: string }; returns: { premium: boolean } };
  /** action. Creates a Whop checkout tagged with this session and returns the hosted checkout URL. */
  'billing:createCheckout': { args: { sessionToken: string }; returns: { purchaseUrl: string } };

  // ----- god powers -----
  /** mutation. Validated and idempotent on commandId. */
  'interventions:apply': { args: InterventionCommand; returns: InterventionResult };
};

export type ApiPath = keyof ApiContract;
