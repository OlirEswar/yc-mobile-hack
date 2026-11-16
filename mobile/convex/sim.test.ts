import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import schema from './schema';
import { blockedRoutes } from './engine/conditions';
import { beginTx, commitTx, encodeStep, loadAgent, setPlan } from './engine/core';
import { agentBySeq, plantRumor, runTicks, startEffect } from './engine/devtools';
import { cadence, warpCadence } from './engine/loop';
import { advance } from './engine/step';
import { WARP_MAX_TICKS, WARP_STEP_BUDGET } from './lib/constants';
import { modules } from './test.setup';

const DAY = 144;

async function colony(deviceId: string) {
  const t = convexTest(schema, modules);
  const { worldId, sessionToken } = await t.mutation(api.session.bootstrap, { deviceId });
  return { t, worldId: worldId as Id<'worlds'>, sessionToken };
}

type T = Awaited<ReturnType<typeof colony>>['t'];

/** Runs whole sim hours, 12 ticks per transaction like a busy tick loop would. */
async function runHours(t: T, worldId: Id<'worlds'>, hours: number): Promise<void> {
  for (let i = 0; i < hours / 2; i++) await t.run((ctx) => runTicks(ctx, worldId, 12));
}

const eventsOf = (t: T, worldId: Id<'worlds'>) =>
  t.run((ctx) =>
    ctx.db
      .query('events')
      .withIndex('by_world_version', (q) => q.eq('worldId', worldId))
      .collect(),
  );

/** The root of an event's cause chain. */
function rootOf(e: Doc<'events'>, byId: Map<string, Doc<'events'>>): Doc<'events'> {
  let cur = e;
  for (let i = 0; i < 20 && cur.causationEventId; i++) {
    const parent = byId.get(cur.causationEventId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/** Wraps ctx.db to count documents read and written. */
function counting(ctx: MutationCtx) {
  const stats = { reads: 0, writes: 0 };
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

describe('simulation', () => {
  test('an undisturbed colony lives several days without mass death and with small daily stories', async () => {
    const { t, worldId } = await colony('device-stable');
    await runHours(t, worldId, 4 * 24);
    const world = (await t.run((ctx) => ctx.db.get(worldId)))!;
    expect(world.tick).toBe(4 * DAY);
    expect(world.population.alive).toBeGreaterThanOrEqual(97);
    const events = await eventsOf(t, worldId);
    const kinds = new Set(events.map((e) => e.eventType));
    for (const kind of ['conversation', 'rumor_spread', 'trade', 'friendship']) expect(kinds).toContain(kind);
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    const agents = await t.run((ctx) => ctx.db.query('agents').collect());
    const alive = agents.filter((a) => a.alive);
    expect(alive.every((a) => a.dueTick > world.tick - 2)).toBe(true);
    expect(alive.filter((a) => a.activity === 'sleeping').length).toBeGreaterThan(30);
    expect(world.stockpiles.depot.water).toBeGreaterThan(150);
    expect(world.stockpiles.depot.food).toBeGreaterThan(120);
  }, 600_000);

  test('a drought cascades into prices, rationing, petitions and thefts traced back to it', async () => {
    const { t, worldId } = await colony('device-drought');
    await runHours(t, worldId, 2);
    const droughtId = await t.run((ctx) => startEffect(ctx, worldId, { type: 'drought', severity: 0.6, ticks: 2 * DAY }));
    await runHours(t, worldId, 48);
    const world = (await t.run((ctx) => ctx.db.get(worldId)))!;
    expect(world.prices.water).toBeGreaterThan(3);
    expect(world.econ.rationLevel).toBeGreaterThan(0);
    const events = await eventsOf(t, worldId);
    const byId = new Map(events.map((e) => [e._id as string, e]));
    const fromDrought = events.filter((e) => e._id !== droughtId && rootOf(e, byId)._id === droughtId);
    const kinds = new Set(fromDrought.map((e) => e.eventType));
    expect(kinds).toContain('price_change');
    expect(kinds).toContain('ration_change');
    expect([...kinds].some((k) => k === 'theft' || k === 'accusation' || k === 'petition' || k === 'ration_shortfall' || k === 'trade_dispute')).toBe(true);
    // The drought ends on its own and says so.
    expect(events.some((e) => e.eventType === 'drought_ended' && e.causationEventId === droughtId)).toBe(true);
    expect(world.activeEffects).toHaveLength(0);
    expect(world.causes.drought).toBeUndefined();
  }, 600_000);

  test('a storm blocks surface routes, empties exposed sites, and engineers repair the damage after', async () => {
    const { t, worldId } = await colony('device-storm');
    await runHours(t, worldId, 4);
    const stormId = await t.run((ctx) => startEffect(ctx, worldId, { type: 'storm', severity: 0.8, ticks: 18, locationIds: ['solar_farm', 'ice_wells'] }));
    await t.run((ctx) => runTicks(ctx, worldId, 3));
    await t.run(async (ctx) => {
      const world = (await ctx.db.get(worldId))!;
      expect(blockedRoutes(world).size).toBeGreaterThan(0);
      const out = await ctx.db
        .query('agents')
        .withIndex('by_world_seq', (q) => q.eq('worldId', worldId))
        .collect();
      expect(out.filter((a) => a.alive && !a.move && (a.locationId === 'solar_farm' || a.locationId === 'ice_wells'))).toHaveLength(0);
      // Nobody can walk into a struck site.
      const tx = beginTx(ctx, world);
      const walker = (await loadAgent(tx, out.find((a) => a.alive && a.locationId === 'habitat_a' && a.activity !== 'sleeping')?._id ?? out[0]._id))!;
      walker.locationId = 'habitat_a';
      await setPlan(tx, walker, { intent: 'Testing the storm', source: 'llm', steps: [encodeStep('go', 'ice_wells')], labels: ['Walk to the wells'], now: true });
      await advance(tx, 1);
      expect(walker.activityLabel).toMatch(/storm/);
    });
    const damaged = (await t.run((ctx) => ctx.db.get(worldId)))!.damage;
    expect(damaged.solar_farm).toBeGreaterThan(0.3);
    await runHours(t, worldId, 20);
    const after = (await t.run((ctx) => ctx.db.get(worldId)))!;
    expect(after.activeEffects).toHaveLength(0);
    expect(after.damage.solar_farm ?? 0).toBeLessThan(damaged.solar_farm);
    const events = await eventsOf(t, worldId);
    expect(events.some((e) => e.eventType === 'storm_ended' && e.causationEventId === stormId)).toBe(true);
    expect(events.some((e) => e.eventType === 'repaired')).toBe(true);
  }, 600_000);

  test('a planted rumor spreads through talk to many more people within a day', async () => {
    const { t, worldId } = await colony('device-rumor');
    await runHours(t, worldId, 2);
    const subject = await t.run((ctx) => agentBySeq(ctx, worldId, 7));
    const hearers = await Promise.all([3, 30, 60].map((seq) => t.run((ctx) => agentBySeq(ctx, worldId, seq))));
    const rumorId = await t.run((ctx) =>
      plantRumor(ctx, worldId, { subject: subject._id, hearers: hearers.map((h) => h._id), kind: 'thief', text: subject.name + ' has been stealing from the Supply Depot.' }),
    );
    await runHours(t, worldId, 24);
    const believers = await t.run((ctx) =>
      ctx.db
        .query('beliefs')
        .withIndex('by_world_key', (q) => q.eq('worldId', worldId).eq('key', 'thief:' + subject._id))
        .collect(),
    );
    expect(believers.length).toBeGreaterThanOrEqual(10);
    expect(believers.every((b) => b.originEventId === rumorId)).toBe(true);
    expect(Math.max(...believers.map((b) => b.hops))).toBeGreaterThanOrEqual(1);
    const events = await eventsOf(t, worldId);
    expect(events.filter((e) => e.eventType === 'rumor_spread' && e.causationEventId === rumorId).length).toBeGreaterThanOrEqual(1);
  }, 600_000);

  test('an LLM plan executes step by step and fails gracefully where the world says no', async () => {
    const { t, worldId } = await colony('device-llm');
    await runHours(t, worldId, 4);
    const hauler = await t.run(async (ctx) => {
      const world = (await ctx.db.get(worldId))!;
      const tx = beginTx(ctx, world);
      const agents = await ctx.db
        .query('agents')
        .withIndex('by_world_seq', (q) => q.eq('worldId', worldId))
        .collect();
      const a = (await loadAgent(tx, agents.find((x) => x.alive && x.occupation === 'hauler')!._id))!;
      a.inv.credits = 100;
      const steps = [encodeStep('go', 'market'), encodeStep('buy', 'water', 2), encodeStep('drink'), encodeStep('go', 'plaza'), encodeStep('petition', 'rations_open')];
      await setPlan(tx, a, { intent: 'Buy water and speak up for the crews', source: 'llm', steps, labels: steps.map((s) => s), trigger: 'test', now: true });
      await commitTx(tx);
      return a;
    });
    // Step until the plan's last step lands: the seeded hauler has goals of her own and replans once it is done.
    let events = await eventsOf(t, worldId);
    for (let i = 0; i < 10 && !events.some((e) => e.eventType === 'petition' && e.actorId === hauler._id); i++) {
      await t.run((ctx) => runTicks(ctx, worldId, 1));
      events = await eventsOf(t, worldId);
    }
    expect(events.some((e) => e.eventType === 'trade' && e.actorId === hauler._id)).toBe(true);
    expect(events.some((e) => e.eventType === 'petition' && e.actorId === hauler._id)).toBe(true);
    const mind = (await t.run((ctx) => ctx.db.get(hauler.mindId!)))!;
    expect(mind.lastThought?.source).toBe('llm');

    // Impossible and malformed steps never throw; each one ends the plan with a legible reason.
    const nonsense = [
      'fly|moon',
      encodeStep('accuse', hauler._id, 'thief:nobody'),
      encodeStep('give', hauler._id, 'water', 1),
      encodeStep('repair', 'plaza'),
      encodeStep('steal', 'pantry:nothing', 'water', 3),
      encodeStep('go', 'atlantis'),
      encodeStep('talk', 'not-an-id'),
    ];
    for (const step of nonsense) {
      await t.run(async (ctx) => {
        const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
        const a = (await loadAgent(tx, hauler._id))!;
        await setPlan(tx, a, { intent: 'Nonsense', source: 'llm', steps: [step, encodeStep('wait', 2)], labels: ['?', 'Wait'], now: true });
        await advance(tx, 1);
        expect(a.q).toEqual([]);
        expect(a.failStreak).toBeGreaterThan(0);
        expect(a.activityLabel).not.toBe('Deciding what to do');
        await commitTx(tx);
      });
    }
  }, 600_000);

  test('a tick invocation stays small in documents read and written', async () => {
    const { t, worldId } = await colony('device-budget');
    await runHours(t, worldId, 8);
    const samples: { reads: number; writes: number }[] = [];
    for (let i = 0; i < 8; i++) {
      samples.push(
        await t.run(async (raw) => {
          const { ctx, stats } = counting(raw);
          await runTicks(ctx, worldId, 3);
          return stats;
        }),
      );
    }
    const worst = { reads: Math.max(...samples.map((s) => s.reads)), writes: Math.max(...samples.map((s) => s.writes)) };
    console.log('three-tick invocation, worst of 8:', worst, 'average reads', Math.round(samples.reduce((s, x) => s + x.reads, 0) / samples.length));
    expect(worst.reads).toBeLessThan(4000);
    expect(worst.writes).toBeLessThan(1500);
  }, 600_000);

  test('a focus-warp invocation runs more ticks within the step budget and stays affordable', async () => {
    expect(warpCadence(1).ticks).toBeGreaterThan(cadence(1).ticks);
    expect(warpCadence(16).ticks).toBe(WARP_MAX_TICKS);
    const { t, worldId } = await colony('device-warp');
    await runHours(t, worldId, 4);
    const samples: { reads: number; writes: number; ticks: number }[] = [];
    for (let i = 0; i < 4; i++) {
      samples.push(
        await t.run(async (raw) => {
          const { ctx, stats } = counting(raw);
          const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
          const { ticks } = await advance(tx, WARP_MAX_TICKS, { stepBudget: WARP_STEP_BUDGET });
          await commitTx(tx);
          return { ...stats, ticks };
        }),
      );
    }
    console.log('focus-warp invocation:', samples);
    expect(samples.every((s) => s.ticks >= 1 && s.ticks <= WARP_MAX_TICKS)).toBe(true);
    expect(Math.max(...samples.map((s) => s.reads))).toBeLessThan(12000);
    expect(Math.max(...samples.map((s) => s.writes))).toBeLessThan(4000);
  }, 600_000);
});

describe('world controls', () => {
  test('setSpeed restarts the loop, skipToNotable advances to an event, reset seeds a fresh world', async () => {
    const { t, worldId, sessionToken } = await colony('device-controls');
    expect(await t.mutation(api.world.setSpeed, { sessionToken, worldId, speed: 4 })).toEqual({ ok: true });
    expect(await t.mutation(api.world.setSpeed, { sessionToken, worldId, speed: 3 as never })).toEqual({ ok: false });
    const world = (await t.run((ctx) => ctx.db.get(worldId)))!;
    expect(world.speed).toBe(4);
    expect(world.loop.running).toBe(true);

    const before = world.tick;
    const skipped = await t.mutation(api.world.skipToNotable, { sessionToken, worldId });
    expect(skipped.advancedTicks).toBeGreaterThan(0);
    expect(skipped.advancedTicks).toBeLessThanOrEqual(36);
    const afterSkip = (await t.run((ctx) => ctx.db.get(worldId)))!;
    expect(afterSkip.tick).toBe(before + skipped.advancedTicks);
    if (skipped.eventId) {
      const e = (await t.run((ctx) => ctx.db.get(skipped.eventId as Id<'events'>)))!;
      expect(e.salience).toBeGreaterThanOrEqual(0.7);
    }
    const subject = await t.run((ctx) => agentBySeq(ctx, worldId, 12));
    const followed = await t.mutation(api.world.skipToNotable, { sessionToken, worldId, agentId: subject._id });
    if (followed.eventId) {
      const e = (await t.run((ctx) => ctx.db.get(followed.eventId as Id<'events'>)))!;
      expect(e.actorId === subject._id || e.participantIds.includes(subject._id)).toBe(true);
    }

    const { worldId: fresh } = await t.mutation(api.world.reset, { sessionToken });
    expect(fresh).not.toBe(worldId);
    const old = await t.run((ctx) => ctx.db.get(worldId));
    expect(old === null || old.deleted === true).toBe(true);
    const seeded = (await t.run((ctx) => ctx.db.get(fresh as Id<'worlds'>)))!;
    expect(seeded.tick).toBe(0);
    expect(seeded.population.alive).toBe(100);
  }, 600_000);
});
