/**
 * Story dump: runs a fresh colony for N sim days, optionally with an intervention, and prints the
 * chronicle. Skipped unless DUMP_DAYS is set:
 *
 *   DUMP_DAYS=3 npx vitest run convex/sim.dump.test.ts
 *   DUMP_DAYS=3 DUMP_POWER=drought npx vitest run convex/sim.dump.test.ts
 *
 * DUMP_POWER is one of drought, storm, kill, rumor, whisper. DUMP_MIN sets the salience floor (0.5).
 * Minds without a persona get a test persona (engine/devtools.ts testPersonas) unless DUMP_RAW is set.
 * The society layer is seeded (organizations, couples, artists, pets) unless DUMP_SOCIETY=0, and the
 * dump ends with the colony's almanac. DUMP_SOCIETY=only prints just the society story.
 * DUMP_FOCUS='Ines Achterberg' follows that colonist, one tick per transaction, and reports how often
 * something happens to them while awake and how much of the dull time the world fast-forwards.
 */
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { agentBySeq, chronicleText, plantRumor, runTicks, smite, startEffect, testPersonas, whisper } from './engine/devtools';
import { modules } from './test.setup';
import type { SocietyOverview } from '../shared/types';
import { seedSociety } from './society/seed';
import { SOCIETY_STORY_TYPES } from './society/store';

const env = (key: string): string | undefined => (typeof process !== 'undefined' ? process.env[key] : undefined);

test.skipIf(!env('DUMP_DAYS'))('chronicle dump', async () => {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId: 'device-dump' });
  const id = worldId as Id<'worlds'>;
  // Only this test advances the world: the loop bootstrap started would tick it in the background.
  await t.run(async (ctx) => ctx.db.patch(id, { speed: 0, loop: { ...(await ctx.db.get(id))!.loop, running: false } }));
  const days = Number(env('DUMP_DAYS'));
  const power = env('DUMP_POWER');
  const named = async (name: string) => (await t.run((ctx) => ctx.db.query('agents').collect())).find((a) => a.name === name)!;
  if (!env('DUMP_RAW')) await t.run((ctx) => testPersonas(ctx, id));
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
  const focus = env('DUMP_FOCUS') ? await named(env('DUMP_FOCUS')!) : null;
  const samples: { tick: number; awake: boolean; warp: boolean }[] = [];
  if (focus) {
    await t.run((ctx) => ctx.db.patch(id, { focusAgentId: focus._id }));
    for (let i = 0; i < days * 144; i++) {
      samples.push(
        await t.run(async (ctx) => {
          await runTicks(ctx, id, 1);
          const [w, a] = [(await ctx.db.get(id))!, (await ctx.db.get(focus._id))!];
          return { tick: w.tick, awake: a.alive && a.activity !== 'sleeping', warp: !!w.focusWarp };
        }),
      );
    }
  } else for (let i = 0; i < days * 12; i++) await t.run((ctx) => runTicks(ctx, id, 12));
  const world = (await t.run((ctx) => ctx.db.get(id)))!;
  console.log(
    'After ' + days + ' days' + (power ? ' with ' + power : '') + ': ' + world.population.alive + ' alive, ration level ' + world.econ.rationLevel +
      ', water ' + world.prices.water + ' cr, depot ' + Math.round(world.stockpiles.depot.water) + ' water / ' + Math.round(world.stockpiles.depot.food) + ' food\n',
  );
  const events = await t.run((ctx) => ctx.db.query('events').collect());
  const kinds = new Map<string, number>();
  for (const e of events) kinds.set(e.eventType, (kinds.get(e.eventType) ?? 0) + 1);
  console.log('\nEvents by type:', [...kinds].sort((x, y) => y[1] - x[1]).map(([k, n]) => k + ' ' + n).join(', '));
  const minds = await t.run((ctx) => ctx.db.query('minds').collect());
  const tried = new Map<string, string>();
  for (const m of minds) for (const s of m.ledger?.tried ?? []) tried.set(s.s, (tried.get(s.s) ?? '') + (s.ok ? '+' : '-'));
  console.log('Strategies tried (+ worked, - failed):', [...tried].map(([s, r]) => s + ' ' + r.length + ' (' + [...r].filter((x) => x === '+').length + ' ok)').join(', '));
  const discoveries = events.filter((e) => e.eventType === 'discovery').length;
  const daily = new Map<string, number>();
  for (const e of events) if (e.salience >= 0.5) daily.set(Math.floor(e.tick / 144) + '|' + e.summary, (daily.get(Math.floor(e.tick / 144) + '|' + e.summary) ?? 0) + 1);
  const repeats = [...daily].filter(([, n]) => n > 1);
  console.log('Discoveries: ' + discoveries + '. Sentences repeated within a day (salience >= 0.5): ' + repeats.length + (repeats.length ? '\n  ' + repeats.slice(0, 12).map(([k, n]) => n + 'x ' + k.split('|')[1].slice(0, 140)).join('\n  ') : ''));
  const storylines = await t.run((ctx) => ctx.db.query('storylines').collect());
  console.log('\nStorylines:');
  for (const s of storylines.sort((x, y) => x.createdTick - y.createdTick)) {
    console.log('  [' + s.origin + '] ' + s.title + ': ' + s.status + ', tension ' + s.tension + ', ' + s.beats.length + ' beats, cast ' + s.participantIds.length + (s.resolvedTick !== undefined ? ', ended tick ' + s.resolvedTick : ''));
    if (s.origin === 'seed') for (const b of s.beats) console.log('      ' + b.tick + ': ' + b.text.slice(0, 130));
  }
  if (focus) {
    const talks = await t.run((ctx) => ctx.db.query('dialogues').collect());
    console.log('\nConversations (' + talks.length + '):');
    for (const d of talks.slice(0, 12)) console.log('  [' + d.kind + ' -> ' + d.outcome + ', tick ' + d.startTick + ']\n' + d.lines.map((l) => '    ' + (l.speakerId === d.aId ? d.aName : d.bName).split(' ')[0] + ': ' + l.text).join('\n'));
    const MEANINGFUL = /conversation|rumor|talk|confide|comfort|court|romance|threat|blackmail|bribe|accus|theft|fight|loan|borrow|repay|beg|barter|eavesdrop|secret|rally|strike|petition|marri|propos|reconcil|storyline|perform|recruit|preach|gift|aid|confess|lie|smear|investigat|arrest/;
    const mine = events.filter((e) => (e.actorId === focus._id || e.participantIds.includes(focus._id)) && (MEANINGFUL.test(e.eventType) || e.salience >= 0.5));
    const moments = [...new Set(mine.map((e) => e.tick))].sort((x, y) => x - y);
    const awakeTicks = samples.filter((s) => s.awake);
    let gap = 0;
    const gaps: number[] = [];
    for (const s of samples) {
      if (moments.includes(s.tick)) {
        if (gap > 0) gaps.push(gap);
        gap = 0;
      } else if (s.awake) gap += 1;
    }
    gaps.sort((x, y) => x - y);
    const dull = samples.filter((s) => !moments.some((m) => Math.abs(m - s.tick) <= 6));
    console.log('\nFollowing ' + focus.name + ': ' + moments.length + ' meaningful moments in ' + awakeTicks.length + ' awake ticks (one per ' + (awakeTicks.length / Math.max(1, moments.length) / 6).toFixed(1) + ' awake hours); awake gaps median ' + ((gaps[Math.floor(gaps.length / 2)] ?? 0) / 6).toFixed(1) + ' h, longest ' + ((gaps.at(-1) ?? 0) / 6).toFixed(1) + ' h; warp on ' + Math.round((100 * samples.filter((s) => s.warp).length) / samples.length) + '% of ticks, ' + Math.round((100 * dull.filter((s) => s.warp).length) / Math.max(1, dull.length)) + '% of dull ticks, ' + Math.round((100 * samples.filter((s) => !s.awake && s.warp).length) / Math.max(1, samples.filter((s) => !s.awake).length)) + '% of sleep');
    for (const e of mine.sort((x, y) => x.tick - y.tick)) console.log('  ' + e.tick + ' [' + e.eventType + '] ' + e.summary.slice(0, 150));
  }
  const text = await t.run((ctx) => chronicleText(ctx, id, { minSalience: Number(env('DUMP_MIN') ?? 0.5) }));
  console.log(society === 'only' ? text.split('\n').filter((line) => SOCIETY_STORY_TYPES.some((k) => line.includes('[' + k + ' '))).join('\n') : text);
  if (society === '0') return;
  const almanac: SocietyOverview = await t.query(makeFunctionReference<'query'>('society/api:overview'), { worldId: id });
  console.log('\nThe almanac');
  for (const o of almanac.organizations) console.log('  ' + o.name + ' (' + o.kind + ', ' + o.status + ', ' + o.memberIds.length + ' members): "' + o.creed + '"' + (o.rules?.length ? ' rules: ' + o.rules.join(', ') : ''));
  for (const d of almanac.discoveries) console.log('  Discovered ' + d.name + ': ' + d.effect);
  for (const s of almanac.structures) console.log('  ' + (s.builtTick === undefined ? 'Building ' : 'Built ') + s.name + ' at ' + s.locationId + (s.builtTick === undefined ? ' (' + Math.round(s.progress * 100) + '%)' : ''));
  for (const w of almanac.works) console.log('  "' + w.title + '", a ' + w.kind + ' by ' + w.creatorName + ', fame ' + w.fame);
  for (const n of almanac.notables) console.log('  ' + n.name + ', ' + n.for);
}, 3_600_000);
