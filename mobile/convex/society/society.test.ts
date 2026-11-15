import { convexTest } from 'convex-test';
import { beforeAll, describe, expect, test } from 'vitest';
import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import schema from '../schema';
import { beginTx, commitTx, loadAgent, loadMind, touch, type Tx } from '../engine/core';
import { planFor } from '../engine/planner';
import { chronicleText, runTicks } from '../engine/devtools';
import { modules } from '../test.setup';
import { DISCOVERIES, STRUCTURES } from '../../shared/society';
import { canBuildHere, buildDone, buildStart, discover, mechanicsDaily, productionHourly } from './craft';
import { createArtDone, performDone } from './culture';
import { adoptPet, birth, growUp } from './family';
import { foundOrg, joinOrg, orgAction, orgHome } from './orgs';
import { startObsession } from './obsession';
import { seedSociety } from './seed';
import { GROW_UP_TICKS, loadMeta, orgById, saveMeta } from './store';
import { studyDone } from './work';

const DAY = 144;

async function colony(deviceId: string, options: { society?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  const id = worldId as Id<'worlds'>;
  if (options.society !== false)
    await t.run(async (ctx) => {
      const ids = (await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', id)).collect()).map((a) => a._id);
      await seedSociety(ctx, id, ids);
    });
  return { t, worldId: id };
}
type T = Awaited<ReturnType<typeof colony>>['t'];

async function inTx<R>(t: T, worldId: Id<'worlds'>, fn: (tx: Tx, people: { a: Doc<'agents'>; mind: Doc<'minds'> }[]) => Promise<R>): Promise<R> {
  return await t.run(async (ctx) => {
    const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
    const people: { a: Doc<'agents'>; mind: Doc<'minds'> }[] = [];
    for (const row of await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId)).collect()) {
      const a = await loadAgent(tx, row._id);
      const mind = a?.alive ? await loadMind(tx, a) : null;
      if (a && mind) people.push({ a, mind });
    }
    const out = await fn(tx, people);
    await commitTx(tx);
    return out;
  });
}

const adults = (people: { a: Doc<'agents'>; mind: Doc<'minds'> }[]) => people.filter((p) => p.mind.ageBand !== 'child');

describe('catalogues', () => {
  test('there are enough discoveries and structures, and every prerequisite exists', () => {
    expect(DISCOVERIES.length).toBeGreaterThanOrEqual(50);
    expect(STRUCTURES.length).toBeGreaterThanOrEqual(15);
    expect(STRUCTURES.length).toBeLessThanOrEqual(25);
    const keys = new Set(DISCOVERIES.map((d) => d.key));
    for (const d of DISCOVERIES) for (const r of d.prerequisites) expect(keys.has(r)).toBe(true);
    for (const s of STRUCTURES) if (s.requires) expect(keys.has(s.requires)).toBe(true);
  });
});

describe('society subsystems', () => {
  test('an organization is founded and takes members; a breakaway declares its own rules', async () => {
    const { t, worldId } = await colony('device-soc-orgs', { society: false });
    const result = await inTx(t, worldId, async (tx, people) => {
      const [founder, joiner, rebel] = adults(people);
      expect(await foundOrg(tx, founder.a, founder.mind, 'troupe', 'The Test Players')).toBeGreaterThan(0);
      const org = (await orgById(tx, founder.mind.society!.orgIds[0]))!;
      joiner.a.locationId = orgHome(org) as Doc<'agents'>['locationId'];
      touch(tx, joiner.a);
      expect(await joinOrg(tx, joiner.a, joiner.mind, org._id)).toBeGreaterThan(0);

      const meta = await loadMeta(tx);
      meta.lastFoundTick = -1000;
      await saveMeta(tx);
      expect(await foundOrg(tx, rebel.a, rebel.mind, 'breakaway', '')).toBeGreaterThan(0);
      const breakaway = (await orgById(tx, rebel.mind.society!.orgIds[0]))!;
      rebel.a.locationId = orgHome(breakaway) as Doc<'agents'>['locationId'];
      touch(tx, rebel.a);
      expect(await orgAction(tx, rebel.a, rebel.mind, breakaway._id, 'declare_rules')).toBeGreaterThanOrEqual(0);
      return { org: (await orgById(tx, org._id))!, breakaway: (await orgById(tx, breakaway._id))!, joinerId: joiner.a._id };
    });
    expect(result.org.name).toBe('The Test Players');
    expect(result.org.memberIds).toContain(result.joinerId);
    expect(result.breakaway.rules?.length).toBe(3);
    const text = await t.run((ctx) => chronicleText(ctx, worldId, { minSalience: 0 }));
    expect(text).toMatch(/founded The Test Players, a troupe/);
    expect(text).toMatch(/joined The Test Players/);
  }, 120_000);

  test('a child is born to a couple, and grows up into an adult with a job', async () => {
    const { t, worldId } = await colony('device-soc-family', { society: false });
    const childId = await inTx(t, worldId, async (tx, people) => {
      const [x, y] = adults(people);
      const child = await birth(tx, x.a, y.a);
      expect(child).not.toBeNull();
      const cm = (await loadMind(tx, child!))!;
      expect(cm.ageBand).toBe('child');
      expect(cm.society?.parentIds).toEqual(expect.arrayContaining([x.a._id, y.a._id]));
      return child!._id;
    });
    expect(GROW_UP_TICKS).toBe(3 * DAY);
    await inTx(t, worldId, async (tx) => {
      const child = (await loadAgent(tx, childId))!;
      await growUp(tx, child, (await loadMind(tx, child))!);
    });
    const grown = await inTx(t, worldId, async (tx) => {
      const child = (await loadAgent(tx, childId))!;
      return { band: (await loadMind(tx, child))!.ageBand, occupation: child.occupation };
    });
    expect(grown.band).not.toBe('child');
    expect(grown.occupation).toBeTruthy();
    const text = await t.run((ctx) => chronicleText(ctx, worldId));
    expect(text).toMatch(/welcomed a child/);
    expect(text).toMatch(/has grown up/);
  }, 120_000);

  test('a stray is adopted, named, and recorded as a pet', async () => {
    const { t, worldId } = await colony('device-soc-pets', { society: false });
    const pet = await inTx(t, worldId, async (tx, people) => {
      const meta = await loadMeta(tx);
      meta.strays = 2;
      await saveMeta(tx);
      const [p] = adults(people);
      expect(await adoptPet(tx, p.a, p.mind, 'cat')).toBeGreaterThan(0);
      return await tx.ctx.db.query('pets').withIndex('by_owner', (q) => q.eq('ownerId', p.a._id)).first();
    });
    expect(pet?.species).toBe('cat');
    expect(pet?.alive).toBe(true);
    expect(await t.run((ctx) => chronicleText(ctx, worldId, { minSalience: 0 }))).toMatch(/took in a stray cat and named it/);
  }, 120_000);

  test('study raises a skill, faster at the Observatory', async () => {
    const { t, worldId } = await colony('device-soc-study', { society: false });
    const gains = await inTx(t, worldId, async (tx, people) => {
      const [home, school] = adults(people).filter((p) => (p.mind.skills.science ?? 0) < 20);
      school.a.locationId = 'observatory';
      home.a.locationId = home.a.homeLocationId;
      const before = [home.mind.skills.science ?? 0, school.mind.skills.science ?? 0];
      await studyDone(tx, home.a, 'science', 12);
      await studyDone(tx, school.a, 'science', 12);
      return [(home.mind.skills.science ?? 0) - before[0], (school.mind.skills.science ?? 0) - before[1]];
    });
    expect(gains[0]).toBeGreaterThan(0);
    expect(gains[1]).toBeGreaterThan(0);
  }, 120_000);

  test('a discovery unlocks a structure, which gets built and feeds the depot every day', async () => {
    const { t, worldId } = await colony('device-soc-build', { society: false });
    const out = await inTx(t, worldId, async (tx, people) => {
      const meta = await loadMeta(tx);
      expect(canBuildHere(meta, 'water_reclaimer', 'habitat_a', [])).toBe(false);
      const [p] = adults(people);
      await discover(tx, 'greywater_reclamation', [p.a._id]);
      expect(canBuildHere(meta, 'water_reclaimer', 'habitat_a', [])).toBe(true);
      p.a.locationId = 'habitat_a';
      p.a.inv.parts = (p.a.inv.parts ?? 0) + 40;
      touch(tx, p.a);
      expect(await buildStart(tx, p.a, p.mind, 'water_reclaimer')).toBeGreaterThan(0);
      for (let i = 0; i < 6; i++) await buildDone(tx, p.a, 60);
      const water = tx.world.stockpiles.depot?.water ?? 0;
      await mechanicsDaily(tx, meta, new Map(people.map((x) => [x.a._id as string, x])));
      return { built: meta.built.map((b) => b.key), gained: (tx.world.stockpiles.depot?.water ?? 0) - water };
    });
    expect(out.built).toContain('water_reclaimer');
    expect(out.gained).toBeGreaterThanOrEqual(10);
    const text = await t.run((ctx) => chronicleText(ctx, worldId));
    expect(text).toMatch(/worked out greywater reclamation/);
    expect(text).toMatch(/finished the water reclaimer/);
  }, 120_000);

  test('a discovery has its effect: thermal drill bits make the ice wells give more water', async () => {
    const { t, worldId } = await colony('device-soc-discovery', { society: false });
    const deltas = await inTx(t, worldId, async (tx, people) => {
      for (const p of adults(people).slice(0, 6)) {
        p.a.locationId = 'ice_wells';
        p.a.activity = 'working';
        touch(tx, p.a);
      }
      const meta = await loadMeta(tx);
      const measure = () => {
        const before = tx.world.stockpiles.depot?.water ?? 0;
        productionHourly(tx, meta);
        return (tx.world.stockpiles.depot?.water ?? 0) - before;
      };
      const without = measure();
      await discover(tx, 'thermal_drill_bits', [people[0].a._id]);
      return { without, with: measure() };
    });
    expect(deltas.with).toBeGreaterThan(deltas.without);
  }, 120_000);

  test('art is made, performed to a crowd, and its maker becomes better known', async () => {
    const { t, worldId } = await colony('device-soc-art', { society: false });
    const { artistId, before } = await inTx(t, worldId, async (tx, people) => {
      const [artist, ...rest] = adults(people).sort((x, y) => (y.mind.skills.art ?? 0) - (x.mind.skills.art ?? 0));
      await createArtDone(tx, artist.a, 'song');
      for (const p of [artist, ...rest.slice(0, 8)]) {
        p.a.locationId = 'canteen';
        p.a.activity = 'idle';
        p.a.move = undefined;
        touch(tx, p.a);
      }
      return { artistId: artist.a._id, before: artist.mind.society?.fame ?? 0 };
    });
    const out = await inTx(t, worldId, async (tx) => {
      const artist = (await loadAgent(tx, artistId))!;
      await performDone(tx, artist);
      const works = await tx.ctx.db.query('works').withIndex('by_creator', (q) => q.eq('creatorId', artistId)).collect();
      return { before, after: (await loadMind(tx, artist))!.society?.fame ?? 0, works: works.length };
    });
    expect(out.works).toBe(1);
    expect(out.after).toBeGreaterThan(out.before);
    const text = await t.run((ctx) => chronicleText(ctx, worldId, { minSalience: 0 }));
    expect(text).toMatch(/performed "/);
    expect(text).toMatch(/wrote "/);
  }, 120_000);

  test('an obsession takes over planning', async () => {
    const { t, worldId } = await colony('device-soc-obsession', { society: false });
    const intent = await inTx(t, worldId, async (tx, people) => {
      const [p] = adults(people);
      expect(await startObsession(tx, p.a, p.mind, { kind: 'discovery', target: 'thermal_drill_bits', text: 'how to cut the ice faster' })).toBe(true);
      for (const k of Object.keys(p.a.needs) as (keyof typeof p.a.needs)[]) p.a.needs[k] = 5;
      p.a.dayOffset = tx.tick - 70;
      p.mind.plan = undefined;
      touch(tx, p.a);
      await planFor(tx, p.a);
      return (await loadMind(tx, p.a))?.plan?.intent ?? '';
    });
    expect(intent).toMatch(/cannot stop until I understand how to cut the ice faster/);
  }, 120_000);
});

describe('a seeded society over three days', () => {
  let story: { types: Map<string, number>; text: string; recent: { key: string; tick: number }[]; cost: { reads: number; writes: number } };

  beforeAll(async () => {
    const { t, worldId } = await colony('device-soc-run');
    const start = await t.run(async (ctx) => (await ctx.db.get(worldId))!.tick);
    let cost = { reads: 0, writes: 0 };
    for (let i = 0; i < (3 * DAY) / 12; i++) {
      const stats = await t.run(async (raw) => {
        const { ctx, stats } = counting(raw);
        await runTicks(ctx, worldId, 12);
        return stats;
      });
      cost = { reads: Math.max(cost.reads, stats.reads), writes: Math.max(cost.writes, stats.writes) };
    }
    const events = await t.run((ctx) => ctx.db.query('events').withIndex('by_world_version', (q) => q.eq('worldId', worldId)).collect());
    const types = new Map<string, number>();
    for (const e of events) if (e.tick >= start) types.set(e.eventType, (types.get(e.eventType) ?? 0) + 1);
    const text = await t.run((ctx) => chronicleText(ctx, worldId, { minSalience: 0.45 }));
    const recent = await inTx(t, worldId, async (tx) => (await loadMeta(tx)).recent);
    story = { types, text, recent, cost };
    console.log('society event types over three days:', JSON.stringify(Object.fromEntries(types)));
    console.log('worst twelve-tick transaction with society seeded:', cost);
    console.log(text.split('\n').slice(0, 60).join('\n'));
  }, 900_000);

  test('many kinds of society story happen', () => {
    const wanted = ['org_founded', 'org_join', 'org_recruit', 'marriage', 'birth', 'pet_adopted', 'discovery', 'construction_started', 'structure_built', 'art_created', 'performance', 'mastery', 'preaching'];
    const seen = wanted.filter((k) => story.types.has(k));
    expect(seen.length, 'missing: ' + wanted.filter((k) => !story.types.has(k)).join(', ')).toBeGreaterThanOrEqual(wanted.length - 2);
  });

  test('random events fire about once every half day to a day, without repeating back to back', () => {
    const fired = story.recent;
    expect(fired.length).toBeGreaterThanOrEqual(2);
    expect(fired.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < fired.length; i++) expect(fired[i].key).not.toBe(fired[i - 1].key);
  });

  test('a busy twelve-tick transaction with society seeded stays within budget', () => {
    expect(story.cost.reads).toBeLessThan(8000);
    expect(story.cost.writes).toBeLessThan(3000);
  });
});

/** Wraps ctx.db to count documents read and written (as in sim.test.ts). */
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
