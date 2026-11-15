/**
 * WorldSource over the live Convex deployment. Function references are built from the paths in
 * shared/api.ts and typed by ApiContract, so this file depends only on the contract.
 */
import { ConvexReactClient } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import type { ApiContract, ApiPath } from '../../shared/api';
import type { Id } from '../../shared/types';
import type { Unsubscribe, WorldSource } from './WorldSource';

const query = <P extends ApiPath>(path: P) => makeFunctionReference<'query', ApiContract[P]['args'], ApiContract[P]['returns']>(path);
const mutation = <P extends ApiPath>(path: P) => makeFunctionReference<'mutation', ApiContract[P]['args'], ApiContract[P]['returns']>(path);

const fn = {
  bootstrap: mutation('session:bootstrap'),
  heartbeat: mutation('session:heartbeat'),
  setFocus: mutation('session:setFocus'),
  worldGet: query('world:get'),
  setSpeed: mutation('world:setSpeed'),
  skipToNotable: mutation('world:skipToNotable'),
  reset: mutation('world:reset'),
  agentsList: query('agents:list'),
  agentsGet: query('agents:get'),
  syncUpdates: query('sync:updates'),
  feed: query('chronicle:feed'),
  chain: query('chronicle:chain'),
  apply: mutation('interventions:apply'),
  billingStatus: query('billing:status'),
  createCheckout: makeFunctionReference<'action', ApiContract['billing:createCheckout']['args'], ApiContract['billing:createCheckout']['returns']>('billing:createCheckout'),
};

export function createConvexSource(url: string): WorldSource {
  const client = new ConvexReactClient(url, { unsavedChangesWarning: false });
  let sessionToken = '';
  let worldId: Id = '';
  /** Re-subscribes world:get when the world id changes (after a reset). */
  const worldSubscribers = new Set<() => void>();

  function watch<T>(start: () => { onUpdate: (cb: () => void) => () => void; localQueryResult: () => T | undefined }, onValue: (value: T) => void, onError?: (error: Error) => void): Unsubscribe {
    const w = start();
    const read = () => {
      try {
        const value = w.localQueryResult();
        if (value !== undefined) onValue(value);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const stop = w.onUpdate(read);
    read();
    return stop;
  }

  return {
    kind: 'convex',
    async bootstrap(deviceId) {
      const session = await client.mutation(fn.bootstrap, { deviceId });
      sessionToken = session.sessionToken;
      worldId = session.worldId;
      return session;
    },
    async heartbeat() {
      await client.mutation(fn.heartbeat, { sessionToken });
    },
    async setFocus(agentId) {
      await client.mutation(fn.setFocus, { sessionToken, agentId });
    },
    subscribeWorld(onWorld, onError) {
      let stop: Unsubscribe = () => {};
      const start = () => {
        stop();
        stop = watch(() => client.watchQuery(fn.worldGet, { worldId }), onWorld, onError);
      };
      worldSubscribers.add(start);
      start();
      return () => {
        worldSubscribers.delete(start);
        stop();
      };
    },
    async setSpeed(speed) {
      await client.mutation(fn.setSpeed, { sessionToken, worldId, speed });
    },
    skipToNotable(agentId) {
      return client.mutation(fn.skipToNotable, agentId ? { sessionToken, worldId, agentId } : { sessionToken, worldId });
    },
    async reset() {
      const next = await client.mutation(fn.reset, { sessionToken });
      worldId = next.worldId;
      worldSubscribers.forEach((start) => start());
      return next;
    },
    listAgents() {
      return client.query(fn.agentsList, { worldId });
    },
    subscribeAgent(agentId, onAgent) {
      return watch(() => client.watchQuery(fn.agentsGet, { worldId, agentId }), onAgent, () => onAgent(null));
    },
    updates(sinceVersion) {
      return client.query(fn.syncUpdates, { worldId, sinceVersion });
    },
    feed(args) {
      return client.query(fn.feed, { worldId, ...args });
    },
    chain(eventId) {
      return client.query(fn.chain, { worldId, eventId });
    },
    subscribePlan(onPlan) {
      return watch(() => client.watchQuery(fn.billingStatus, { sessionToken }), (status) => onPlan(status.plan));
    },
    async createCheckout() {
      const { purchaseUrl } = await client.action(fn.createCheckout, { sessionToken });
      return purchaseUrl;
    },
    apply(intervention, commandId) {
      return client.mutation(fn.apply, { ...intervention, commandId, worldId, sessionToken });
    },
    dispose() {
      void client.close();
    },
  };
}
