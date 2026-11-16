import { convexTest } from 'convex-test';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import schema from './schema';
import { beginTx, commitTx, loadAgent, loadMind, touchMind } from './engine/core';
import { runTicks } from './engine/devtools';
import { birth } from './society/family';
import { GROW_UP_TICKS } from './society/store';
import { modules } from './test.setup';
import { playChapter } from './timeskip';
import type { TimeskipSpan } from '../shared/types';

type Cost = { reads: number; writes: number };

/** Counts document reads and writes the way society.test.ts does. */
function counting(ctx: MutationCtx) {
  const stats: Cost = { reads: 0, writes: 0 };
  const wrapQuery = (q: any): any =>
    new Proxy(q, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        if (prop === 'collect' || prop === 'take')
          return async (...args: unknown[]) => {
            const rows = await value.apply(target, args);
            stats.reads += rows.length;
            return rows;
          };
        if (prop === 'first' || prop === 'unique')
          return async (...args: unknown[]) => {
            const row = await value.apply(target, args);
            stats.reads += row ? 1 : 0;
            return row;
          };
        return (...args: unknown[]) => wrapQuery(value.apply(target, args));
      },
    });
  const db = new Proxy(ctx.db, {
    get(target: any, prop) {
      const value = target[prop];
      if (prop === 'get')
        return async (...args: unknown[]) => {
          stats.reads += 1;
          return value.apply(target, args);
        };
      if (prop === 'query') return (...args: unknown[]) => wrapQuery(value.apply(target, args));
      if (prop === 'insert' || prop === 'patch' || prop === 'replace' || prop === 'delete')
        return async (...args: unknown[]) => {
          stats.writes += 1;
          return value.apply(target, args);
        };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db } as MutationCtx, stats };
}

/** Runs a whole skip without the scheduler: every chapter measured, then the chronicle. */
async function skipAhead(deviceId: string, span: TimeskipSpan) {
  const t = convexTest(schema, modules);
  const { sessionToken, worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  const wid = worldId as Id<'worlds'>;
  // A twelve-year-old, on the live childhood scale, so a long skip sees a child come of age.
  const childId = await t.run(async (ctx) => {
    const tx = beginTx(ctx, (await ctx.db.get(wid))!);
    const parents = (await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', wid)).take(12)).filter((a) => a.alive);
    const child = (await birth(tx, (await loadAgent(tx, parents[2]._id))!, (await loadAgent(tx, parents[4]._id))!))!;
    const mind = (await loadMind(tx, child))!;
    mind.society!.bornTick = tx.tick - Math.round((12 / 18) * GROW_UP_TICKS);
    touchMind(tx, mind);
    await commitTx(tx);
    return child._id;
  });
  const before = await t.run(async (ctx) => {
    const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', wid)).collect();
    return { world: (await ctx.db.get(wid))!, agents };
  });
  const started = await t.mutation(api.world.timeskip, { sessionToken, worldId, span });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error(started.message);
  const skipId = started.timeskipId as Id<'timeskips'>;
  expect(await t.mutation(api.world.timeskip, { sessionToken, worldId, span })).toEqual(started);
  let cost: Cost = { reads: 0, writes: 0 };
  for (let i = 0; i < 60; i++) {
    const { next, stats } = await t.run(async (raw) => {
      const { ctx, stats } = counting(raw);
      return { next: await playChapter(ctx, skipId, undefined, '[]'), stats };
    });
    cost = { reads: Math.max(cost.reads, stats.reads), writes: Math.max(cost.writes, stats.writes) };
    if (next !== 'chapter') break;
  }
  await t.action(internal.timeskip.summarize, { skipId });
  const after = await t.run(async (ctx) => {
    const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', wid)).collect();
    const minds: Record<string, Doc<'minds'>> = {};
    for (const a of agents) if (a.mindId) minds[a._id] = (await ctx.db.get(a.mindId))!;
    const orgs = await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', wid)).collect();
    const storylines = await ctx.db.query('storylines').withIndex('by_world_status', (q) => q.eq('worldId', wid)).collect();
    return { world: (await ctx.db.get(wid))!, agents, minds, orgs, storylines };
  });
  const pub = await t.query(api.timeskip.get, { worldId });
  return { t, wid, sessionToken, before, after: { ...after, minds: new Map(Object.entries(after.minds)) }, pub, cost, skipId, childId };
}

describe('timeskip', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  test('a year passes inside the limits and ends in a chronicle', async () => {
    const r = await skipAhead('device-timeskip-year', 'year');
    console.log('worst year chapter:', r.cost);
    expect(r.cost.reads).toBeLessThan(8000);
    expect(r.cost.writes).toBeLessThan(4000);
    expect(r.after.world.tick - r.before.world.tick).toBe(365 * 144);
    expect(r.after.world.timeskip).toBeUndefined();
    expect(r.after.world.speed).toBeGreaterThan(0);
    expect(r.pub?.status).toBe('done');
    expect(r.pub?.summary?.narrative.length).toBeGreaterThanOrEqual(2);
    expect(r.pub?.summary?.beats.length).toBeGreaterThan(3);
    // The clock resumes: live ticks run on the new date without starving anyone.
    const alive = r.after.agents.filter((a) => a.alive).length;
    await r.t.run((ctx) => runTicks(ctx, r.wid, 48));
    const later = await r.t.run(async (ctx) => (await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', r.wid)).collect()).filter((a) => a.alive));
    expect(later.length).toBeGreaterThanOrEqual(alive - 2);
    expect(Math.min(...later.map((a) => a.health))).toBeGreaterThan(10);
  }, 600_000);

  test('five years ends in a chronicle the world resumes from', async () => {
    const r = await skipAhead('device-timeskip-five', 'five_years');
    const s = r.pub!.summary!;
    console.log('worst five-year chapter:', r.cost);
    console.log('\n# ' + s.title + '\n\n' + s.narrative.join('\n\n') + '\n\n' + [s.followed, ...s.people, ...s.newPeople].filter(Boolean).map((p) => '- ' + p!.name + ': ' + p!.text).join('\n') + '\n\nTensions: ' + s.tensions.join(' | '));
    expect(r.cost.writes).toBeLessThan(4000);
    expect(s.narrative.length).toBeGreaterThanOrEqual(3);
    expect(r.after.world.timeskip).toBeUndefined();
  }, 600_000);

  test('ten years: births, deaths, grown children, changed orgs and storylines, no extinction', async () => {
    const r = await skipAhead('device-timeskip-decade', 'decade');
    const s = r.pub!.summary!;
    console.log('worst decade chapter:', r.cost);
    console.log('decade stats:', JSON.stringify((await r.t.run((ctx) => ctx.db.get(r.skipId)))!.stats));
    console.log('\n# ' + s.title + '\n\n' + s.narrative.join('\n\n') + '\n\n' + [s.followed, ...s.people, ...s.newPeople].filter(Boolean).map((p) => '- ' + p!.name + ': ' + p!.text).join('\n') + '\n\nTensions: ' + s.tensions.join(' | '));
    expect(r.cost.reads).toBeLessThan(8000);
    expect(r.cost.writes).toBeLessThan(4000);
    const alive = r.after.agents.filter((a) => a.alive);
    expect(alive.length).toBeGreaterThan(20);
    const startSeq = r.before.world.nextSeq;
    expect(r.after.agents.some((a) => a.seq >= startSeq && (r.after.minds.get(a._id)?.society?.parentIds.length ?? 0) > 0)).toBe(true);
    expect(r.after.agents.filter((a) => !a.alive).length).toBeGreaterThan(r.before.agents.filter((a) => !a.alive).length);
    const grown = r.after.agents.find((a) => a._id === r.childId)!;
    if (grown.alive) {
      expect(r.after.minds.get(grown._id)?.ageBand).not.toBe('child');
      expect(grown.occupation).not.toBe('resident');
    }
    const kids = alive.filter((a) => a.seq > startSeq && r.after.minds.get(a._id)?.ageBand === 'child');
    expect(kids.some((a) => (r.after.minds.get(a._id)?.society?.education?.progress ?? 0) > 0.2)).toBe(true);
    expect(r.after.orgs.some((o) => o.foundedTick > r.before.world.tick || o.status !== 'active')).toBe(true);
    expect(s.storylineIds.length).toBeGreaterThan(0);
    expect(s.narrative.join(' ').length).toBeGreaterThan(400);
  }, 900_000);
});
