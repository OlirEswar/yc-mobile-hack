import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { agentsAt, beginTx, commitTx, emitEvent, killAgent, learnBelief, loadAgent } from './engine/core';
import { modules } from './test.setup';

test('seeds a colony and core primitives write one consistent version', async () => {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId: 'device-core-test' });
  await t.run(async (ctx) => {
    const world = (await ctx.db.get(ctx.db.normalizeId('worlds', worldId)!))!;
    const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', world._id)).collect();
    expect(agents.length).toBe(100);

    const tx = beginTx(ctx, world);
    const [a, b] = [(await loadAgent(tx, agents[0]._id))!, (await loadAgent(tx, agents[1]._id))!];
    const tieOf = () => ctx.db.query('relationships').withIndex('by_from_to', (q) => q.eq('fromAgentId', a._id).eq('toAgentId', b._id)).first();
    const trustBefore = (await tieOf())?.trust ?? 0;
    const learned = await learnBelief(tx, a, { kind: 'thief', text: b.name + ' steals.', valence: -1, confidence: 0.8, sourceType: 'rumor', subjectAgentId: b._id, subjectName: b.name });
    expect(learned.created).toBe(true);
    expect(a.topics).toContain(learned.key);
    const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'conversation', summary: 'A test.', salience: 0.4, actorId: a._id, participantIds: [b._id] });
    await killAgent(tx, b, { cause: 'test' });
    expect(await agentsAt(tx, b.locationId, { includeAsleep: true })).not.toContain(b._id);
    await commitTx(tx);

    const after = (await ctx.db.get(world._id))!;
    expect(after.version).toBe(world.version + 1);
    expect(after.population).toEqual({ alive: 99, dead: 1 });
    expect((await ctx.db.get(a._id))!.updatedAtVersion).toBe(after.version);
    expect((await ctx.db.get(b._id))!.alive).toBe(false);
    expect((await ctx.db.get(eventId))!.version).toBe(after.version);
    const tie = await tieOf();
    expect(tie!.trust).toBeLessThan(trustBefore);
    expect(tie!.toAlive).toBe(false);
  });
});
