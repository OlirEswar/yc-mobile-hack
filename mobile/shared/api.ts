/**
 * The Convex function contract. The backend implements each entry as a public function at the
 * given path (`world:get` is `export const get` in convex/world.ts). The client calls them through
 * `api.<module>.<name>`. Changing a path, argument or return shape here needs both sides to agree.
 */
import type { Speed } from './colony';
import type { OfferId, PlanId } from './plans';
import type {
  AgentDetail,
  AgentLite,
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

  // ----- billing -----
  /** query. Reactive. The session's plan, switched by the Whop membership.activated and membership.deactivated webhooks. */
  'billing:status': { args: { sessionToken: string }; returns: { plan: PlanId } };
  /** action. Creates a Whop checkout for one store offer, tagged with this session, and returns the hosted checkout URL. */
  'billing:createCheckout': { args: { sessionToken: string; offer: OfferId }; returns: { purchaseUrl: string } };

  // ----- god powers -----
  /** mutation. Validated and idempotent on commandId. */
  'interventions:apply': { args: InterventionCommand; returns: InterventionResult };
};

export type ApiPath = keyof ApiContract;
