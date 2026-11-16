import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { runTicks } from './engine/devtools';
import { modules } from './test.setup';

/** God powers applied through interventions:apply, then played out by the tick engine. */
test('powers applied through the public API cascade through the simulation', async () => {
  const t = convexTest(schema, modules);
  const { worldId, sessionToken } = await t.mutation(api.session.bootstrap, { deviceId: 'device-integration' });
  const id = worldId as Id<'worlds'>;
  await t.run((ctx) => runTicks(ctx, id, 12));
  const agents = await t.run((ctx) => ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', id)).collect());
  const named = (name: string) => agents.find((a) => a.name === name)!;
  let n = 0;
  const apply = (intervention: any) => t.mutation(api.interventions.apply, { ...intervention, commandId: 'integration-' + n++, worldId, sessionToken });

  const drought = await apply({ type: 'drought', params: { severity: 0.7, durationDays: 2 } });
  const rumorSubject = named('Mira Castellanos');
  const rumor = await apply({ type: 'rumor', params: { aboutAgentId: rumorSubject._id, presetKey: 'thief', text: rumorSubject.name + ' has been stealing from the Supply Depot.' } });
  const victim = named('Imani Reyes');
  const kill = await apply({ type: 'kill', params: { agentId: victim._id, cause: 'struck down by fate' } });
  const whispered = named('Hana Yilmaz');
  const whisper = await apply({ type: 'whisper', params: { agentId: whispered._id, presetKey: 'seek_power', text: 'You deserve a seat on the council.', strength: 0.9 } });
  for (const result of [drought, rumor, kill, whisper]) expect(result.ok).toBe(true);

  for (let i = 0; i < 12; i++) await t.run((ctx) => runTicks(ctx, id, 12));

  await t.run(async (ctx) => {
    const world = (await ctx.db.get(id))!;
    expect(world.population.alive).toBeGreaterThan(90);
    expect(world.prices.water).toBeGreaterThan(2);

    const events = await ctx.db.query('events').withIndex('by_world_version', (q) => q.eq('worldId', id)).collect();
    const byId = new Map(events.map((e) => [e._id as string, e]));
    const rootOf = (e: (typeof events)[number]) => {
      let cur = e;
      while (cur.causationEventId && byId.has(cur.causationEventId)) cur = byId.get(cur.causationEventId)!;
      return cur;
    };
    const droughtId = drought.ok ? drought.eventIds[0] : '';
    const droughtEffects = events.filter((e) => e._id !== droughtId && rootOf(e)._id === droughtId);
    expect(droughtEffects.length).toBeGreaterThan(2);

    const rumorKey = 'thief:' + rumorSubject._id;
    const holders = await ctx.db.query('beliefs').withIndex('by_world_key', (q) => q.eq('worldId', id).eq('key', rumorKey)).collect();
    expect(holders.length).toBeGreaterThan(4);

    expect(events.some((e) => e.eventType === 'death' && e.actorId === victim._id)).toBe(true);
    expect(events.some((e) => e.eventType === 'grief' || e.eventType === 'mourning' || (e.causationEventId && byId.get(e.causationEventId)?.eventType === 'death'))).toBe(true);

    const mind = await ctx.db.query('minds').withIndex('by_agent', (q) => q.eq('agentId', whispered._id)).first();
    expect(mind!.goals.some((g) => g.source === 'divine' && g.drive === 'seek_power')).toBe(true);
  });
}, 600_000);
