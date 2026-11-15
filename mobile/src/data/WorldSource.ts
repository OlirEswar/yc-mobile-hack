/**
 * The seam between the UI and the backend. The store talks only to this interface; a mock and a
 * Convex implementation sit behind it, switched by EXPO_PUBLIC_DATA_SOURCE.
 * Every method mirrors one entry of shared/api.ts.
 */
import type { Speed } from '../../shared/colony';
import type { OfferId, PlanId } from '../../shared/plans';
import type {
  AgentDetail,
  AgentLite,
  Id,
  Intervention,
  InterventionResult,
  SyncUpdates,
  Tick,
  WorldEventPublic,
  WorldPublic,
} from '../../shared/types';

export type Unsubscribe = () => void;

export type FeedArgs = { beforeTick?: Tick; limit?: number; minSalience?: number; agentId?: Id };

export interface WorldSource {
  readonly kind: 'mock' | 'convex';
  /** session:bootstrap. Must be called first; the source remembers the token and the world id. */
  bootstrap(deviceId: string): Promise<{ sessionToken: string; worldId: Id }>;
  /** session:heartbeat */
  heartbeat(): Promise<void>;
  /** session:setFocus */
  setFocus(agentId: Id | null): Promise<void>;
  /** world:get, reactive. */
  subscribeWorld(onWorld: (world: WorldPublic | null) => void, onError?: (error: Error) => void): Unsubscribe;
  /** world:setSpeed */
  setSpeed(speed: Speed): Promise<void>;
  /** world:skipToNotable */
  skipToNotable(agentId?: Id): Promise<{ advancedTicks: number; eventId?: Id }>;
  /** world:reset. Returns the new world id; the source switches to it. */
  reset(): Promise<{ worldId: Id }>;
  /** agents:list */
  listAgents(): Promise<AgentLite[]>;
  /** agents:get, reactive. */
  subscribeAgent(agentId: Id, onAgent: (agent: AgentDetail | null) => void): Unsubscribe;
  /** sync:updates */
  updates(sinceVersion: number): Promise<SyncUpdates>;
  /** chronicle:feed */
  feed(args: FeedArgs): Promise<WorldEventPublic[]>;
  /** chronicle:chain */
  chain(eventId: Id): Promise<WorldEventPublic[]>;
  /** billing:status, reactive. */
  subscribePlan(onPlan: (plan: PlanId) => void): Unsubscribe;
  /** billing:createCheckout. Returns the Whop checkout URL for the offer. */
  createCheckout(offer: OfferId): Promise<string>;
  /** interventions:apply. The caller supplies the commandId so a retry is idempotent. */
  apply(intervention: Intervention, commandId: string): Promise<InterventionResult>;
  dispose(): void;
}
