import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { modules } from './test.setup';
import type { Intervention, InterventionResult } from '../shared/types';

async function setup(deviceId: string) {
  const t = convexTest(schema, modules);
  const { sessionToken, worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  let n = 0;
  const apply = async (iv: Intervention) => {
    const result: InterventionResult = await t.mutation(api.interventions.apply, { ...iv, commandId: 'command-' + n++, worldId, sessionToken });
    if (!result.ok) throw new Error(result.message);
    return result;
  };
  const agents = () => t.run((ctx) => ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId as Id<'worlds'>)).collect());
  const setTick = (tick: number) => t.run(async (ctx) => ctx.db.patch(worldId as Id<'worlds'>, { tick }));
  return { t, worldId, apply, agents, setTick };
}

test('sync:updates returns everything from zero, then only rows changed after a version', async () => {
  const { t, worldId, apply, agents } = await setup('device-sync');
  const fresh = await t.query(api.sync.updates, { worldId, sinceVersion: 0 });
  expect(fresh.agents).toHaveLength(100);
  expect(fresh.tick).toBe(0);

  const [a, b] = await agents();
  const grant = await apply({ type: 'grant', params: { agentId: a._id, resource: 'food', amount: 5 } });
  const whisper = await apply({ type: 'whisper', params: { agentId: b._id, presetKey: 'seek_power', text: '', strength: 0.5 } });
  const changed = await t.query(api.sync.updates, { worldId, sinceVersion: fresh.version });
  expect(changed.version).toBe(whisper.worldVersion);
  expect(changed.agents.map((x) => x.id).sort()).toEqual([a._id, b._id].sort());
  expect(changed.events.map((e) => e.id)).toEqual(grant.eventIds);
  expect(changed.events.every((e) => e.visibility !== 'private')).toBe(true);

  const later = await t.query(api.sync.updates, { worldId, sinceVersion: grant.worldVersion });
  expect(later.agents.map((x) => x.id)).toEqual([b._id]);
  expect(later.events).toHaveLength(0);
});

test('chronicle:chain runs from the root through the event to its direct effects', async () => {
  const { t, worldId, apply } = await setup('device-chain');
  const storm = await apply({ type: 'storm', params: { severity: 0.5, locationIds: ['ice_wells', 'quarry'] } });
  const [root, firstDamage, secondDamage] = storm.eventIds;

  const fromDamage = await t.query(api.chronicle.chain, { worldId, eventId: firstDamage });
  expect(fromDamage.map((e) => e.id)).toEqual([root, firstDamage]);
  const fromRoot = await t.query(api.chronicle.chain, { worldId, eventId: root });
  expect(fromRoot.map((e) => e.id)).toEqual([root, firstDamage, secondDamage]);
  expect(await t.query(api.chronicle.chain, { worldId, eventId: 'missing' })).toEqual([]);
});

test('chronicle:feed is newest first, filters by salience and agent, pages by tick and hides private events', async () => {
  const { t, worldId, apply, agents, setTick } = await setup('device-feed');
  const [a, b] = await agents();
  const drought = await apply({ type: 'drought', params: { severity: 0.5, durationDays: 2 } });
  await setTick(5);
  const grant = await apply({ type: 'grant', params: { agentId: a._id, resource: 'parts', amount: 3 } });
  await setTick(9);
  const whisper = await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'distrust', text: '', strength: 0.5, aboutAgentId: b._id } });
  const storm = await apply({ type: 'storm', params: { severity: 0.2, locationIds: ['solar_farm'] } });

  const all = await t.query(api.chronicle.feed, { worldId });
  const ids = all.map((e) => e.id);
  expect(ids).not.toContain(whisper.eventIds[0]);
  expect(ids.indexOf(storm.eventIds[0])).toBeLessThan(ids.indexOf(grant.eventIds[0]));
  expect(ids.indexOf(grant.eventIds[0])).toBeLessThan(ids.indexOf(drought.eventIds[0]));
  for (let i = 1; i < all.length; i++) expect(all[i - 1].tick).toBeGreaterThanOrEqual(all[i].tick);

  const notable = await t.query(api.chronicle.feed, { worldId, minSalience: 0.8 });
  expect(notable.map((e) => e.id)).toEqual([storm.eventIds[0], drought.eventIds[0]]);
  const older = await t.query(api.chronicle.feed, { worldId, beforeTick: 9 });
  expect(older.map((e) => e.id)).toEqual([grant.eventIds[0], drought.eventIds[0]]);
  expect(await t.query(api.chronicle.feed, { worldId, limit: 1 })).toHaveLength(1);

  const mine = await t.query(api.chronicle.feed, { worldId, agentId: a._id });
  expect(mine.map((e) => e.id)).toEqual([grant.eventIds[0]]);
});
