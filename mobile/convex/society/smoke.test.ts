import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { chronicleText, runTicks } from '../engine/devtools';
import { modules } from '../test.setup';
import { seedSociety } from './seed';

test('smoke', async () => {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId: 'device-smoke' });
  const id = worldId as Id<'worlds'>;
  await t.run(async (ctx) => {
    const ids = (await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', id)).collect()).map((a) => a._id);
    await seedSociety(ctx, id, ids);
  });
  for (let i = 0; i < 12 * 2; i++) await t.run((ctx) => runTicks(ctx, id, 12));
  const text = await t.run((ctx) => chronicleText(ctx, id, { minSalience: 0.4 }));
  console.log(text);
  expect(text.length).toBeGreaterThan(0);
}, 600_000);
