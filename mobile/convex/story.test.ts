import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { runTicks } from './engine/devtools';
import { buildColony } from './seed/build';
import { KEY_CHARACTERS, SECRET_KINDS, STRATEGIES } from './seed/keyCharacters';
import { modules } from './test.setup';

async function colony(deviceId: string) {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  const world = (await t.run((ctx) => ctx.db.get(worldId as Id<'worlds'>)))!;
  return { t, worldId, world };
}

describe('the seeded story', () => {
  test('every colonist has a varied persona; key characters have secrets, arcs and hooks', () => {
    const c = buildColony(1234);
    expect(c.agents).toHaveLength(100);
    const personas = c.agents.map((a) => a.persona!);
    expect(personas.every((p) => p && p.epithet && p.want && p.need && p.fear && p.flaw && p.voice && p.arc)).toBe(true);
    expect(new Set(personas.map((p) => p.epithet)).size).toBe(100);
    expect(personas.every((p) => p.strategies.length >= 3 && p.strategies.every((s) => (STRATEGIES as readonly string[]).includes(s)))).toBe(true);

    const key = c.agents.filter((a) => a.persona!.key);
    expect(key.length).toBe(KEY_CHARACTERS.length);
    expect(key.length).toBeGreaterThanOrEqual(18);
    for (const a of key) {
      expect(SECRET_KINDS).toContain(a.persona!.secret!.kind);
      expect(a.persona!.hook).toBeTruthy();
    }

    const generated = personas.filter((p) => !p.key);
    const secretShare = generated.filter((p) => p.secret).length / generated.length;
    expect(secretShare).toBeGreaterThan(0.15);
    expect(secretShare).toBeLessThan(0.45);
    // The same needs get met in visibly different ways across the colony.
    const firstChoices = new Set(personas.map((p) => p.strategies[0]));
    expect(firstChoices.size).toBeGreaterThanOrEqual(8);
    for (const s of STRATEGIES) expect(personas.some((p) => p.strategies.includes(s))).toBe(true);
  });

  test('the world stores personas, storylines, the key map and an awake starter with a queued opening', async () => {
    const { t, world } = await colony('device-story-seed');
    await t.run(async (ctx) => {
      const minds = await ctx.db.query('minds').collect();
      expect(minds.filter((m) => m.worldId === world._id && m.persona).length).toBe(100);
      expect(minds.filter((m) => m.persona?.key).every((m) => m.persona!.arc.stage === 'setup' && m.persona!.secret)).toBe(true);

      const starter = (await ctx.db.get(world.starterAgentId!))!;
      expect(starter.name).toBe('Ines Achterberg');
      expect(world.keyAgents!.ines).toBe(starter._id);
      expect(starter.activity).not.toBe('sleeping');
      expect(starter.busyUntilTick).toBe(0);
      const mind = (await ctx.db.get(starter.mindId!))!;
      expect(mind.plan!.steps).toEqual(starter.q);
      expect(mind.plan!.labels).toHaveLength(starter.q.length);
      expect(starter.q).toContain('talk|' + world.keyAgents!.dmitri);

      const storylines = await ctx.db.query('storylines').withIndex('by_world_status', (q) => q.eq('worldId', world._id)).collect();
      expect(storylines.length).toBeGreaterThanOrEqual(3);
      expect(storylines.length).toBeLessThanOrEqual(5);
      for (const s of storylines) {
        expect(s.origin).toBe('seed');
        expect(['brewing', 'rising']).toContain(s.status);
        expect(s.beats.length).toBeGreaterThanOrEqual(2);
        for (const id of [...s.participantIds, ...s.state.secretHolderIds]) expect(await ctx.db.get(id)).not.toBeNull();
      }
      const withStarter = storylines.filter((s) => s.participantIds.includes(starter._id));
      expect(withStarter.length).toBeGreaterThanOrEqual(2);
      expect(storylines.find((s) => s.key === 'two_ledgers')!.state.choice.agentId).toBe(starter._id);
    });
  });

  test("the starter's first hours run through the quartermaster, the strike table and the pad", async () => {
    const { t, world } = await colony('device-story-opening');
    const ids = world.keyAgents!;
    await t.run((ctx) => runTicks(ctx, world._id, 6));
    const talks = async () =>
      (await t.run((ctx) => ctx.db.query('events').withIndex('by_world_version', (q) => q.eq('worldId', world._id)).collect())).filter(
        (e) => e.eventType === 'conversation' || e.eventType === 'rumor_spread',
      );
    const involves = (e: { actorId?: Id<'agents'>; participantIds: Id<'agents'>[] }, a: Id<'agents'>, b: Id<'agents'>) =>
      (e.actorId === a && e.participantIds.includes(b)) || (e.actorId === b && e.participantIds.includes(a));
    expect((await talks()).some((e) => involves(e, ids.ines, ids.dmitri))).toBe(true);
    await t.run((ctx) => runTicks(ctx, world._id, 10));
    const later = await talks();
    expect(later.some((e) => involves(e, ids.ines, ids.joao))).toBe(true);
    expect(later.some((e) => involves(e, ids.ines, ids.soledad))).toBe(true);
  }, 120_000);

  test('story:intro resolves the cast, the starter and the tutorial to agents of this world', async () => {
    const { t, worldId, world } = await colony('device-story-intro');
    const intro = (await t.query(api.story.intro, { worldId }))!;
    expect(intro.starterAgentId).toBe(world.starterAgentId);
    expect(intro.setting.length).toBeGreaterThanOrEqual(3);
    expect(intro.history.length).toBeGreaterThanOrEqual(4);
    expect(intro.tensions.length).toBeGreaterThanOrEqual(4);
    expect(intro.keyCharacters.length).toBeGreaterThanOrEqual(8);
    expect(intro.keyCharacters.length).toBeLessThanOrEqual(12);
    expect(intro.keyCharacters[0].agentId).toBe(world.starterAgentId);
    expect(intro.tutorial.length).toBeGreaterThanOrEqual(8);
    expect(intro.tutorial.length).toBeLessThanOrEqual(10);
    for (const kind of ['follow_starter', 'read_thoughts', 'ask_question', 'switch_character', 'open_storylines', 'use_power', 'open_chronicle']) {
      expect(intro.tutorial.some((s) => s.advanceOn === kind)).toBe(true);
    }
    await t.run(async (ctx) => {
      for (const card of intro.keyCharacters) expect((await ctx.db.get(card.agentId as Id<'agents'>))!.name).toBe(card.name);
      for (const step of intro.tutorial) if (step.agentId) expect(await ctx.db.get(step.agentId as Id<'agents'>)).not.toBeNull();
    });
    expect(intro.tutorial.find((s) => s.advanceOn === 'follow_starter')!.agentId).toBe(world.starterAgentId);
    expect(await t.query(api.story.intro, { worldId: 'not-a-world' })).toBeNull();
  });

  test('story:storylines is highest tension first, filters by agent and hides fizzled and old resolved ones', async () => {
    const { t, worldId, world } = await colony('device-story-lines');
    const ids = world.keyAgents!;
    const all = await t.query(api.story.storylines, { worldId });
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.map((s) => s.tension)).toEqual([...all.map((s) => s.tension)].sort((a, b) => b - a));

    const juno = await t.query(api.story.storylines, { worldId, agentId: ids.juno });
    expect(juno.length).toBeGreaterThan(0);
    expect(juno.every((s) => s.participantIds.includes(ids.juno))).toBe(true);
    expect(juno.length).toBeLessThan(all.length);

    await t.run(async (ctx) => {
      const docs = await ctx.db.query('storylines').withIndex('by_world_status', (q) => q.eq('worldId', world._id)).collect();
      const beats = Array.from({ length: 20 }, (_, i) => ({ tick: i, text: 'beat ' + i }));
      await ctx.db.patch(docs[0]._id, { status: 'fizzled' });
      await ctx.db.patch(docs[1]._id, { status: 'resolved', resolvedTick: 0, beats });
      await ctx.db.patch(world._id, { tick: 1000 });
    });
    const after = await t.query(api.story.storylines, { worldId });
    expect(after.length).toBe(all.length - 2);
    await t.run((ctx) => ctx.db.patch(world._id, { tick: 100 }));
    const recent = await t.query(api.story.storylines, { worldId });
    const resolved = recent.find((s) => s.status === 'resolved')!;
    expect(resolved.beats).toHaveLength(12);
    expect(resolved.beats[11].text).toBe('beat 19');
  });

  test('agents:get carries the public persona and live storylines, never the secret', async () => {
    const { t, worldId, world } = await colony('device-story-agent');
    const detail = (await t.query(api.agents.get, { worldId, agentId: world.starterAgentId! }))!;
    expect(detail.persona!.key).toBe(true);
    expect(detail.persona!.epithet).toMatch(/hauler/);
    expect(detail.persona!.arc.stage).toBe('setup');
    expect(Object.keys(detail.persona!).sort()).toEqual(['arc', 'epithet', 'fear', 'flaw', 'key', 'voice', 'want']);
    const lines = await t.query(api.story.storylines, { worldId, agentId: world.starterAgentId! });
    expect(detail.storylineIds!.sort()).toEqual(lines.map((s) => s.id).sort());
    expect(detail.storylineIds!.length).toBeGreaterThanOrEqual(2);
  });
});
