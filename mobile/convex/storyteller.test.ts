import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { adjustRelationship, beginTx, commitTx, emitEvent, encodeStep, loadAgent, setPlan, touch } from './engine/core';
import type { Tx } from './engine/core';
import { MAX_LIVE, directorTick } from './storyteller/director';
import { modules } from './test.setup';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;

/** A seeded colony with the tick loop stopped, at a given tick, with or without an LLM key. */
async function colony(t: T, opts: { tick?: number; llm?: boolean } = {}) {
  if (opts.llm) vi.stubEnv('LLM_API_KEY', 'sk-test-key');
  const { worldId: raw, sessionToken } = await t.mutation(api.session.bootstrap, { deviceId: 'device-storyteller-' + Math.random().toString(36).slice(2, 8) });
  return await t.run(async (ctx) => {
    const worldId = ctx.db.normalizeId('worlds', raw)!;
    const world = (await ctx.db.get(worldId))!;
    await ctx.db.patch(worldId, { tick: opts.tick ?? 300, speed: 0, loop: { ...world.loop, running: false }, llm: { ...world.llm, enabled: !!opts.llm } });
    for (const s of await ctx.db.query('storylines').collect()) await ctx.db.delete(s._id);
    const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId)).collect();
    return { worldId, sessionToken, agents };
  });
}

/** Runs fn inside one Tx on the world and commits it, the way a tick does. */
function inTx<R>(t: T, worldId: Id<'worlds'>, fn: (tx: Tx) => Promise<R>): Promise<R> {
  return t.run(async (ctx) => {
    const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
    const result = await fn(tx);
    await commitTx(tx);
    return result;
  });
}

/** Emits events and then runs the director on them, as the end of a tick would. */
function tick(t: T, worldId: Id<'worlds'>, emit: (tx: Tx) => Promise<unknown> = async () => {}, advanceBy = 1) {
  return inTx(t, worldId, async (tx) => {
    tx.tick += advanceBy;
    tx.world.tick = tx.tick;
    const first = tx.eventIds.length;
    await emit(tx);
    await directorTick(tx, first);
    return tx.eventIds.slice(first);
  });
}

const persona = (stage = 'setup'): NonNullable<Doc<'minds'>['persona']> => ({
  epithet: 'the quartermaster who keeps two ledgers',
  want: 'Keep her brother alive',
  need: 'To stop carrying it alone',
  fear: 'Being found out',
  flaw: 'Lies before she thinks',
  voice: 'Clipped, dry, numbers when nervous',
  secret: { kind: 'embezzler', text: 'She skims water from the depot reserve for her sick brother.' },
  strategies: ['work', 'scheme', 'borrow'],
  arc: { stage, note: '' },
  key: true,
});

async function setPersona(t: T, agentId: Id<'agents'>, stage = 'setup') {
  await t.run(async (ctx) => {
    const a = (await ctx.db.get(agentId))!;
    await ctx.db.patch(a.mindId!, { persona: persona(stage) });
  });
}

async function addStoryline(t: T, worldId: Id<'worlds'>, fields: Partial<Doc<'storylines'>> & { participantIds: Id<'agents'>[] }) {
  return await t.run((ctx) =>
    ctx.db.insert('storylines', {
      worldId,
      key: 'seed:' + Math.random(),
      title: 'Two Ledgers',
      premise: 'The quartermaster keeps a second ledger.',
      status: 'brewing',
      tension: 0.3,
      beats: [],
      origin: 'seed',
      createdTick: 0,
      lastBeatTick: 290,
      state: { kind: 'secret' },
      ...fields,
    }),
  );
}

const get = <K extends 'storylines' | 'events' | 'worlds' | 'agents' | 'minds'>(t: T, id: Id<K>) => t.run((ctx) => ctx.db.get(id)) as Promise<Doc<K>>;

/** A hostile act between two colonists. */
const threat = (actor: Id<'agents'>, target: Id<'agents'>, salience: number, eventType = 'threaten') => (tx: Tx) =>
  emitEvent(tx, { category: 'social', eventType, actorId: actor, participantIds: [target], locationId: 'depot', summary: 'Someone leaned on someone at the depot.', salience });

test('the director attaches events by cast, raises tension, records beats, escalates with banners and moves arcs', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t);
  const [a, b] = agents;
  await setPersona(t, a._id);
  const storyId = await addStoryline(t, worldId, { participantIds: [a._id, b._id] });

  const [first] = await tick(t, worldId, threat(a._id, b._id, 0.7));
  let story = await get(t, storyId);
  expect((await get(t, first)).storylineId).toBe(storyId);
  expect(story.tension).toBeGreaterThan(0.5);
  expect(story.status).toBe('rising');
  expect(story.beats.at(-1)).toMatchObject({ eventId: first });
  const rising = await t.run((ctx) => ctx.db.query('events').filter((q) => q.eq(q.field('eventType'), 'storyline_rising')).first());
  expect(rising).toMatchObject({ storylineId: storyId, category: 'social' });
  expect((await t.run(async (ctx) => (await ctx.db.get(a.mindId!))!.persona!.arc.stage))).toBe('rising');

  await tick(t, worldId, threat(b._id, a._id, 0.9, 'blackmail'));
  story = await get(t, storyId);
  expect(story.status).toBe('climax');
  const climax = await t.run((ctx) => ctx.db.query('events').filter((q) => q.eq(q.field('eventType'), 'storyline_climax')).first());
  expect(climax).toMatchObject({ banner: true, storylineId: storyId });
  expect(climax!.salience).toBeGreaterThanOrEqual(0.85);
  expect((await t.run(async (ctx) => (await ctx.db.get(a.mindId!))!.persona!.arc.stage))).toBe('climax');
  // At the climax the leads think it over with the LLM, if one is on; here it is off, so nothing queues.
  await tick(t, worldId, (tx) => emitEvent(tx, { category: 'social', eventType: 'reconcile', actorId: a._id, participantIds: [b._id], summary: 'They made peace.', salience: 0.6 }));
  story = await get(t, storyId);
  expect(story.status).toBe('resolved');
  expect(story.resolvedTick).toBeDefined();
  expect((await t.run(async (ctx) => (await ctx.db.get(a.mindId!))!.persona!.arc.stage))).toBe('resolution');
});

test('the director spots emergent storylines: a grudge between rivals and a crisis rooted in a god power', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t);
  // Two colonists from different households, so no seeded family warmth softens the feud.
  const [, , c] = agents;
  const d = agents.find((x) => x.householdId !== c.householdId)!;
  const e = agents.find((x) => x._id !== c._id && x._id !== d._id)!;
  await inTx(t, worldId, async (tx) => {
    const [x, y] = [(await loadAgent(tx, c._id))!, (await loadAgent(tx, d._id))!];
    await adjustRelationship(tx, x, y, { affinity: -0.8 });
    await adjustRelationship(tx, y, x, { affinity: -0.6 });
  });
  const [accusation] = await tick(t, worldId, threat(c._id, d._id, 0.6, 'accusation'));
  const grudge = (await t.run((ctx) => ctx.db.query('storylines').collect())).find((s) => s.key.startsWith('grudge:'))!;
  expect(grudge).toMatchObject({ origin: 'emergent', state: { kind: 'grudge' } });
  expect(grudge.participantIds).toEqual([c._id, d._id]);
  expect(grudge.title).toMatch(new RegExp(c.name.split(' ')[0] + '|' + d.name.split(' ')[0] + '|Depot'));
  expect((await get(t, accusation)).storylineId).toBe(grudge._id);

  const [drought] = await tick(t, worldId, (tx) =>
    emitEvent(tx, { category: 'intervention', eventType: 'drought', locationId: 'ice_wells', summary: 'The ice wells are running dry.', salience: 0.95, visibility: 'public' }),
  );
  const crisis = (await t.run((ctx) => ctx.db.query('storylines').collect())).find((s) => s.key === 'crisis:' + drought)!;
  expect(crisis).toMatchObject({ origin: 'player', title: 'The Wells Run Dry' });

  const [theft] = await tick(t, worldId, (tx) =>
    emitEvent(tx, { category: 'action', eventType: 'theft', actorId: e._id, locationId: 'depot', summary: 'Water went missing from the depot.', salience: 0.5, causationEventId: drought }),
  );
  expect((await get(t, theft)).storylineId).toBe(crisis._id);
  expect((await get(t, crisis._id)).participantIds).toContain(e._id);
});

test('the director keeps the number of live storylines bounded', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t);
  for (let i = 0; i < MAX_LIVE; i++) await addStoryline(t, worldId, { participantIds: [agents[10 + i]._id], origin: 'emergent', tension: 0.1 + i * 0.01, key: 'filler:' + i });
  await tick(t, worldId, (tx) => emitEvent(tx, { category: 'intervention', eventType: 'storm', summary: 'A meteor storm hits the solar farm.', salience: 0.9, visibility: 'public' }));
  const all = await t.run((ctx) => ctx.db.query('storylines').collect());
  const live = all.filter((s) => ['brewing', 'rising', 'climax'].includes(s.status));
  expect(live.length).toBe(MAX_LIVE);
  expect(all.find((s) => s.key === 'filler:0')!.status).toBe('fizzled');
  expect(live.some((s) => s.title === 'After the Storm')).toBe(true);
});

/** Puts an agent in a state for the next director tick. */
const pose = (t: T, worldId: Id<'worlds'>, agentId: Id<'agents'>, fields: Partial<Doc<'agents'>>) =>
  inTx(t, worldId, async (tx) => {
    const a = (await loadAgent(tx, agentId))!;
    Object.assign(a, fields);
    touch(tx, a);
  });

test('focusWarp is on through a quiet routine stretch and off when the story is near', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t);
  const [f, v] = agents;
  await t.run((ctx) => ctx.db.patch(worldId, { focusAgentId: f._id }));
  await pose(t, worldId, f._id, { locationId: f.homeLocationId, move: undefined, activity: 'sleeping', cur: encodeStep('sleep', 40), busyUntilTick: 340 });
  await tick(t, worldId);
  expect((await get(t, worldId)).focusWarp).toBe(true);

  await addStoryline(t, worldId, { participantIds: [f._id, v._id] });
  await pose(t, worldId, v._id, { locationId: f.homeLocationId, move: undefined, activity: 'idle', busyUntilTick: 400 });
  await tick(t, worldId);
  expect((await get(t, worldId)).focusWarp).toBe(false);

  await pose(t, worldId, v._id, { locationId: 'quarry' });
  await tick(t, worldId, (tx) => emitEvent(tx, { category: 'social', eventType: 'theft', actorId: v._id, participantIds: [f._id], summary: 'Someone stole from the sleeper.', salience: 0.6 }));
  expect((await get(t, worldId)).focusWarp).toBe(false);

  await t.run((ctx) => ctx.db.patch(worldId, { focusAgentId: undefined }));
  await tick(t, worldId);
  expect((await get(t, worldId)).focusWarp).toBe(false);
});

test('after a quiet spell the director sends someone from the story to the followed colonist', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t, { tick: 600 });
  const [f, v] = agents;
  await t.run((ctx) => ctx.db.patch(worldId, { focusAgentId: f._id }));
  await addStoryline(t, worldId, { participantIds: [f._id, v._id], status: 'rising', tension: 0.5 });
  await pose(t, worldId, f._id, { locationId: 'plaza', move: undefined, activity: 'idle', cur: encodeStep('rest', 3), busyUntilTick: 602 });
  await pose(t, worldId, v._id, { locationId: 'workshop', move: undefined, activity: 'working', cur: encodeStep('work', 12), busyUntilTick: 640, q: [] });
  await inTx(t, worldId, async (tx) => {
    const [x, y] = [(await loadAgent(tx, v._id))!, (await loadAgent(tx, f._id))!];
    await adjustRelationship(tx, x, y, { affinity: -2, obligation: -2 });
  });

  await tick(t, worldId);
  const visitor = await get(t, v._id);
  expect(visitor.q[0]).toBe(encodeStep('go', 'plaza'));
  expect(visitor.q[1]).toMatch(new RegExp('^(threaten|blackmail)\\|' + f._id));
  expect(visitor.busyUntilTick).toBe(601);
  expect((await get(t, worldId)).nudge).toMatchObject({ agentId: f._id, visitorId: v._id, tick: 601 });

  // No second visitor while the first is on the way.
  await pose(t, worldId, v._id, { q: [] });
  await tick(t, worldId);
  expect((await get(t, v._id)).q).toEqual([]);
});

/** Answers every chat completion with the given JSON and records the requests. */
function mockModel(answer: unknown) {
  const calls: { body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 500, completion_tokens: 40 } }), { status: 200 });
    }),
  );
  return calls;
}

const settle = async (t: T) => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  await t.finishInProgressScheduledFunctions();
};

const thoughtsOf = (t: T, agentId: Id<'agents'>) => t.run((ctx) => ctx.db.query('thoughts').withIndex('by_agent_tick', (q) => q.eq('agentId', agentId)).collect());

test('the followed colonist thinks with the LLM: a thought job on a quiet moment, a focus plan with a thought on a decision', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t, { llm: true });
  const [f] = agents;
  await setPersona(t, f._id, 'rising');
  await t.run((ctx) => ctx.db.patch(worldId, { focusAgentId: f._id }));
  await pose(t, worldId, f._id, { locationId: 'depot', move: undefined, activity: 'working', cur: encodeStep('work', 2), busyUntilTick: 302 });

  const calls = mockModel({ thought: 'Two ledgers, one pen. If Dmitri counts the tanks today, I am finished.', mood: 'Anxious' });
  await tick(t, worldId);
  const job = await t.run((ctx) => ctx.db.query('cognitionJobs').filter((q) => q.eq(q.field('agentId'), f._id)).first());
  expect(job).toMatchObject({ kind: 'thought', lane: 'focus' });
  await settle(t);
  expect(calls[0].body.messages[1].content).toContain('skims water');
  expect(await thoughtsOf(t, f._id)).toMatchObject([{ source: 'llm', mood: 'anxious', text: expect.stringContaining('Dmitri') }]);

  const plan = mockModel({
    intent: 'Ines slips a second tank into the cold store before the count, because her brother cannot wait.',
    goal: null,
    steps: [{ type: 'hide', args: ['water', '2'], label: 'Stash two water in the cold store' }, { type: 'work', args: ['6'], label: 'Work the counter' }],
    speech: null,
    thought: 'Hide it now. Count it later. Smile at whoever walks in.',
  });
  // A fresh rule plan for the followed colonist, made in the tick as the planner would, goes to the LLM in the focus lane.
  await tick(t, worldId, async (tx) => {
    const a = (await loadAgent(tx, f._id))!;
    await setPlan(tx, a, { intent: 'Back to the counting.', source: 'routine', steps: [encodeStep('work', 6)], labels: ['Work the depot counter'] });
  });
  const planJob = await t.run((ctx) => ctx.db.query('cognitionJobs').filter((q) => q.and(q.eq(q.field('agentId'), f._id), q.eq(q.field('kind'), 'plan'))).first());
  expect(planJob).toMatchObject({ lane: 'focus', status: 'queued' });
  await settle(t);
  expect(plan[0].body.messages[1].content).toContain('The player is following');
  const mind = await t.run(async (ctx) => (await ctx.db.get((await ctx.db.get(f._id))!.mindId!))!);
  expect(mind.plan!.source).toBe('llm');
  expect((await get(t, f._id)).q[0]).toBe(encodeStep('hide', 'water', 2));
  expect((await thoughtsOf(t, f._id)).map((x) => x.text)).toContain('Hide it now. Count it later. Smile at whoever walks in.');
});

test('without the LLM the monologue falls back to varied rule lines', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t);
  const [f, x] = agents;
  await setPersona(t, f._id);
  await t.run((ctx) => ctx.db.patch(worldId, { focusAgentId: f._id }));
  await pose(t, worldId, f._id, { locationId: 'canteen', move: undefined, activity: 'idle', cur: encodeStep('rest', 1), busyUntilTick: 301 });
  await tick(t, worldId);
  await tick(t, worldId, (tx) => emitEvent(tx, { category: 'social', eventType: 'threaten', actorId: x._id, participantIds: [f._id], locationId: 'canteen', summary: x.name + ' threatened ' + f.name + '.', salience: 0.6 }), 2);
  for (let i = 0; i < 3; i++) await tick(t, worldId, async () => {}, 4);
  const lines = await thoughtsOf(t, f._id);
  expect(lines.length).toBeGreaterThanOrEqual(4);
  expect(lines.every((l) => l.source === 'rules')).toBe(true);
  expect(lines[1].text).toMatch(new RegExp(x.name.split(' ')[0] + '|hands|fight|head|snapped|stepping'));
  for (let i = 1; i < lines.length; i++) expect(lines[i].text).not.toBe(lines[i - 1].text);
});

test('focus:state returns thoughts, hooks, storylines and warping', async () => {
  const t = newTest();
  const { worldId, agents } = await colony(t);
  const [f, v] = agents;
  const storyId = await addStoryline(t, worldId, { participantIds: [f._id, v._id], status: 'rising', tension: 0.5 });
  await t.run((ctx) => ctx.db.patch(worldId, { focusAgentId: f._id }));
  await tick(t, worldId, (tx) => emitEvent(tx, { category: 'social', eventType: 'eavesdrop', actorId: v._id, participantIds: [f._id], summary: v.name + ' overheard ' + f.name + ' at the depot.', salience: 0.55 }));
  const state = await t.query(api.focus.state, { worldId, agentId: f._id });
  expect(state!.storylines.map((s) => s.id)).toEqual([storyId]);
  expect(state!.hooks[0]).toMatchObject({ agentId: v._id, storylineId: storyId, reason: expect.stringContaining('overheard') });
  expect(state!.thoughts.length).toBeGreaterThan(0);
  expect(state!.warping).toBe(false);
  expect(await t.query(api.focus.state, { worldId, agentId: 'nope' })).toBeNull();
});

test('focus:ask answers in character, stores the turn, rate limits and never touches the world', async () => {
  const t = newTest();
  const { worldId, sessionToken, agents } = await colony(t, { llm: true });
  const [f, dead] = agents;
  await setPersona(t, f._id);
  const calls = mockModel({ answer: 'Dmitri counts the tanks twice and trusts nobody. I count them three times. Leave it there.' });
  const before = (await get(t, worldId)).version;

  const first = await t.action(api.focus.ask, { sessionToken, worldId, agentId: f._id, question: '  Why are you afraid of Dmitri? ' });
  expect(first).toMatchObject({ ok: true, turn: { question: 'Why are you afraid of Dmitri?', answer: expect.stringContaining('Dmitri') } });
  expect(calls[0].body.messages[0].content).toContain('voice with no body');
  expect(calls[0].body.messages[1].content).toContain('Their secret (s1)');
  expect(await t.query(api.focus.conversation, { sessionToken, agentId: f._id })).toMatchObject([{ question: 'Why are you afraid of Dmitri?' }]);
  expect((await get(t, worldId)).version).toBe(before);

  expect(await t.action(api.focus.ask, { sessionToken, worldId, agentId: f._id, question: 'And your brother?' })).toMatchObject({ ok: false, code: 'rate_limited' });
  expect(await t.action(api.focus.ask, { sessionToken, worldId, agentId: f._id, question: '   ' })).toMatchObject({ ok: false, code: 'invalid' });
  expect(await t.action(api.focus.ask, { sessionToken: 'x'.repeat(32), worldId, agentId: f._id, question: 'Hello?' })).toMatchObject({ ok: false, code: 'unauthorized' });
  await t.run((ctx) => ctx.db.patch(dead._id, { alive: false }));
  await t.run(async (ctx) => {
    const s = (await ctx.db.query('sessions').withIndex('by_token', (q) => q.eq('token', sessionToken)).first())!;
    await ctx.db.patch(s._id, { ask: { ...s.ask!, lastAt: 0 } });
  });
  expect(await t.action(api.focus.ask, { sessionToken, worldId, agentId: dead._id, question: 'Hello?' })).toMatchObject({ ok: false, code: 'dead' });

  vi.unstubAllEnvs();
  expect(await t.action(api.focus.ask, { sessionToken, worldId, agentId: f._id, question: 'Hello?' })).toMatchObject({ ok: false, code: 'unavailable' });
});

test('the daily allowance of questions runs out', async () => {
  const t = newTest();
  const { worldId, sessionToken, agents } = await colony(t, { llm: true });
  mockModel({ answer: 'Fine, I suppose.' });
  await t.run(async (ctx) => {
    const s = (await ctx.db.query('sessions').withIndex('by_token', (q) => q.eq('token', sessionToken)).first())!;
    await ctx.db.patch(s._id, { ask: { lastAt: 0, day: 2, count: 60 } });
  });
  expect(await t.action(api.focus.ask, { sessionToken, worldId, agentId: agents[0]._id, question: 'How are you?' })).toMatchObject({ ok: false, code: 'rate_limited' });
});
