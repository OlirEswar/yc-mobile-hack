/**
 * Story dump: runs a fresh colony for N sim days, optionally with an intervention, and prints the
 * chronicle. Skipped unless DUMP_DAYS is set:
 *
 *   DUMP_DAYS=3 npx vitest run convex/sim.dump.test.ts
 *   DUMP_DAYS=3 DUMP_POWER=drought npx vitest run convex/sim.dump.test.ts
 *
 * DUMP_POWER is one of drought, storm, kill, rumor, whisper. DUMP_MIN sets the salience floor (0.5).
 * The society layer is seeded (organizations, couples, artists, pets) unless DUMP_SOCIETY=0, and the
 * dump ends with the colony's almanac. DUMP_SOCIETY=only prints just the society story.
 */
import { convexTest } from 'convex-test';
import { test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { agentBySeq, chronicleText, plantRumor, runTicks, smite, startEffect, whisper } from './engine/devtools';
import { modules } from './test.setup';
import { seedSociety } from './society/seed';
import { SOCIETY_STORY_TYPES } from './society/store';

const env = (key: string): string | undefined => (typeof process !== 'undefined' ? process.env[key] : undefined);

test.skipIf(!env('DUMP_DAYS'))('chronicle dump', async () => {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId: 'device-dump' });
  const id = worldId as Id<'worlds'>;
  const days = Number(env('DUMP_DAYS'));
  const power = env('DUMP_POWER');
  const named = async (name: string) => (await t.run((ctx) => ctx.db.query('agents').collect())).find((a) => a.name === name)!;
  const society = env('DUMP_SOCIETY') ?? '1';
  if (society !== '0')
    await t.run(async (ctx) => seedSociety(ctx, id, (await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', id)).collect()).map((a) => a._id)));
  await t.run((ctx) => runTicks(ctx, id, 12));
  if (power === 'drought') await t.run((ctx) => startEffect(ctx, id, { type: 'drought', severity: 0.6, ticks: 3 * 144 }));
  if (power === 'storm') await t.run((ctx) => startEffect(ctx, id, { type: 'storm', severity: 0.8, ticks: 24, locationIds: ['solar_farm', 'ice_wells'] }));
  if (power === 'kill') await t.run(async (ctx) => smite(ctx, id, (await named('Imani Reyes'))._id, 'stabbed in the tubes'));
  if (power === 'rumor') {
    const subject = await named('Mira Castellanos');
    const hearers = await Promise.all([3, 30, 60].map((s) => t.run((ctx) => agentBySeq(ctx, id, s))));
    await t.run((ctx) => plantRumor(ctx, id, { subject: subject._id, hearers: hearers.map((h) => h._id), kind: 'hoarding', text: subject.name + ' is secretly hoarding food and water.' }));
  }
  if (power === 'whisper') {
    const [who, about] = [await named('Hana Yilmaz'), await named('Imani Reyes')];
    await t.run((ctx) =>
      whisper(ctx, id, { agent: who._id, about: about._id, drive: 'suspect_hoarding', kind: 'investigate', description: 'You suspect Imani Reyes is hiding supplies.', belief: { kind: 'hoarding', text: 'Imani Reyes is hiding supplies.' } }),
    );
  }
  for (let i = 0; i < days * 12; i++) await t.run((ctx) => runTicks(ctx, id, 12));
  const world = (await t.run((ctx) => ctx.db.get(id)))!;
  console.log(
    'After ' + days + ' days' + (power ? ' with ' + power : '') + ': ' + world.population.alive + ' alive, ration level ' + world.econ.rationLevel +
      ', water ' + world.prices.water + ' cr, depot ' + Math.round(world.stockpiles.depot.water) + ' water / ' + Math.round(world.stockpiles.depot.food) + ' food\n',
  );
  const text = await t.run((ctx) => chronicleText(ctx, id, { minSalience: Number(env('DUMP_MIN') ?? 0.5) }));
  console.log(society === 'only' ? text.split('\n').filter((line) => SOCIETY_STORY_TYPES.some((k) => line.includes('[' + k + ' '))).join('\n') : text);
  if (society === '0') return;
  const almanac = await t.query(api['society/api'].overview, { worldId: id });
  console.log('\nThe almanac');
  for (const o of almanac.organizations) console.log('  ' + o.name + ' (' + o.kind + ', ' + o.status + ', ' + o.memberIds.length + ' members): "' + o.creed + '"' + (o.rules?.length ? ' rules: ' + o.rules.join(', ') : ''));
  for (const d of almanac.discoveries) console.log('  Discovered ' + d.name + ': ' + d.effect);
  for (const s of almanac.structures) console.log('  ' + (s.builtTick === undefined ? 'Building ' : 'Built ') + s.name + ' at ' + s.locationId + (s.builtTick === undefined ? ' (' + Math.round(s.progress * 100) + '%)' : ''));
  for (const w of almanac.works) console.log('  "' + w.title + '", a ' + w.kind + ' by ' + w.creatorName + ', fame ' + w.fame);
  for (const n of almanac.notables) console.log('  ' + n.name + ', ' + n.for);
}, 3_600_000);
