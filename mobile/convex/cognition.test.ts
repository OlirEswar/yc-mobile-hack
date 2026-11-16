import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { beginTx, commitTx, encodeStep, enqueueCognition, loadAgent, setPlan } from './engine/core';
import { modules } from './test.setup';

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;
type Job = Partial<Doc<'cognitionJobs'>>;

beforeEach(() => {
  vi.stubEnv('LLM_API_KEY', 'sk-test-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Answers every chat completion with the given body (or HTTP status) and records the requests. */
function mockModel(answer: unknown | ((n: number) => unknown), status = 200) {
  const calls: { url: string; body: any }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (status !== 200) return new Response('upstream sad', { status });
    const content = typeof answer === 'function' ? (answer as (n: number) => unknown)(calls.length) : answer;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function setup(t: T, llm: Partial<Doc<'worlds'>['config']['llm']> = {}) {
  const { worldId: raw } = await t.mutation(api.session.bootstrap, { deviceId: 'device-cognition-test' });
  return await t.run(async (ctx) => {
    const worldId = ctx.db.normalizeId('worlds', raw)!;
    const world = (await ctx.db.get(worldId))!;
    await ctx.db.patch(worldId, { tick: 20, loop: { ...world.loop, running: false }, llm: { ...world.llm, enabled: true }, config: { llm: { ...world.config.llm, ...llm } } });
    const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId)).collect();
    return { worldId, agents };
  });
}

/** Inserts a queued job the way enqueueCognition does, without scheduling a drain. */
async function queue(t: T, worldId: Id<'worlds'>, agentId: Id<'agents'>, job: Job = {}): Promise<Id<'cognitionJobs'>> {
  return await t.run(async (ctx) => {
    const agent = (await ctx.db.get(agentId))!;
    const mind = (await ctx.db.get(agent.mindId!))!;
    const world = (await ctx.db.get(worldId))!;
    await ctx.db.patch(worldId, { llm: { ...world.llm, queued: world.llm.queued + 1 } });
    return await ctx.db.insert('cognitionJobs', {
      worldId,
      agentId,
      kind: 'plan',
      trigger: 'Heard a rumor about the depot',
      priority: 0.5,
      status: 'queued',
      lane: 'normal',
      enqueuedTick: world.tick,
      mindVersion: mind.stateVersion,
      attempts: 0,
      ...job,
    });
  });
}

const settle = async (t: T) => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  await t.finishInProgressScheduledFunctions();
};

const GOOD_PLAN = {
  intent: 'She heads to the Exchange to stock up before prices climb.',
  goal: { kind: 'acquire_resource', description: 'Keep a water reserve at home', priority: 0.7, targetAgentId: null },
  steps: [
    { type: 'go', args: ['market'], label: 'Walk to the Exchange Concourse' },
    { type: 'buy', args: ['water', '3'], label: 'Buy three water' },
    { type: 'talk', args: ['p1'], label: 'Talk it over' },
  ],
  speech: 'Better safe than thirsty.',
};

test('a valid answer commits an llm plan, goal, cooldown and counters in one version', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t);
  const agent = agents[0];
  const jobId = await queue(t, worldId, agent._id, { lane: 'crisis' });
  const calls = mockModel(GOOD_PLAN);
  const versionBefore = (await t.run((ctx) => ctx.db.get(worldId)))!.version;

  await t.action(internal.cognition.drain, { worldId });
  await settle(t);

  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  expect(calls[0].body).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none', response_format: { type: 'json_schema' } });
  expect(calls[0].body.messages[1].content).toContain(agent.name);
  const { job, a, mind, world } = await t.run(async (ctx) => {
    const a = (await ctx.db.get(agent._id))!;
    return { job: (await ctx.db.get(jobId))!, a, mind: (await ctx.db.get(a.mindId!))!, world: (await ctx.db.get(worldId))! };
  });
  expect(job.status).toBe('done');
  expect(job.outcome).toBe('committed');
  expect(job.tokensIn).toBe(900);
  expect(job.trace.promptChars).toBeGreaterThan(1000);
  expect(mind.plan!.source).toBe('llm');
  expect(mind.plan!.intent).toBe(GOOD_PLAN.intent);
  expect(mind.plan!.labels).toEqual(['Walk to the Exchange Concourse', 'Buy three water', 'Talk it over']);
  expect(mind.lastThought).toMatchObject({ source: 'llm', trigger: 'Heard a rumor about the depot' });
  expect(a.q[0]).toBe(encodeStep('go', 'market'));
  expect(a.q[1]).toBe(encodeStep('buy', 'water', 3));
  expect(a.q[2]).toMatch(/^talk\|/);
  expect(a.speech).toBe('Better safe than thirsty.');
  expect(mind.llmCooldownUntilTick).toBe(20 + world.config.llm.cooldownTicks);
  const goal = mind.goals.find((g) => g.source === 'llm');
  expect(goal).toMatchObject({ kind: 'acquire_resource', predicate: 'none', status: 'active' });
  expect(mind.plan!.goalId).toBe(goal!.id);
  expect(world.llm).toMatchObject({ callsToday: 1, queued: 0, running: 0, totalCalls: 1, tokensIn: 900, tokensOut: 120, failStreak: 0, provider: 'openai' });
  expect(world.version).toBeGreaterThan(versionBefore);
  expect(a.updatedAtVersion).toBe(world.version);
});

test('invalid steps are dropped and the rest commits', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t);
  const jobId = await queue(t, worldId, agents[3]._id);
  mockModel({
    intent: 'Tries a few things.',
    goal: { kind: 'protect_person', description: 'Guard someone', priority: 2, targetAgentId: null },
    steps: [
      { type: 'go', args: ['mars'], label: 'Fly to Mars' },
      { type: 'teleport', args: ['plaza'], label: 'Teleport' },
      { type: 'talk', args: ['p99'], label: 'Talk to a ghost' },
      { type: 'give', args: ['p1', 'gold', '5'], label: 'Give gold' },
      { type: 'buy', args: ['food', '500'], label: '' },
    ],
    speech: null,
  });
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);
  const { job, a, mind } = await t.run(async (ctx) => {
    const job = (await ctx.db.get(jobId))!;
    const a = (await ctx.db.get(agents[3]._id))!;
    return { job, a, mind: (await ctx.db.get(a.mindId!))! };
  });
  expect(job.status).toBe('done');
  expect(job.trace.dropped.length).toBe(5);
  expect(a.q).toEqual([encodeStep('buy', 'food', 10)]);
  expect(mind.plan!.labels).toEqual(['Buy 10 food']);
  expect(mind.goals.some((g) => g.source === 'llm')).toBe(false);
});

test('an answer with no valid step is rejected and the rule plan stays', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t);
  const agentId = agents[5]._id;
  await t.run(async (ctx) => {
    const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
    const a = (await loadAgent(tx, agentId))!;
    await setPlan(tx, a, { intent: 'Routine shift.', source: 'routine', steps: [encodeStep('work', 24)], labels: ['Work the shift'] });
    await commitTx(tx);
  });
  const jobId = await queue(t, worldId, agentId);
  mockModel({ intent: 'Nonsense.', goal: null, steps: [{ type: 'dance', args: [], label: 'Dance' }], speech: null });
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);
  const { job, a, mind, world } = await t.run(async (ctx) => {
    const a = (await ctx.db.get(agentId))!;
    return { job: (await ctx.db.get(jobId))!, a, mind: (await ctx.db.get(a.mindId!))!, world: (await ctx.db.get(worldId))! };
  });
  expect(job.status).toBe('rejected');
  expect(job.outcome).toBe('no valid steps');
  expect(mind.plan!.source).toBe('routine');
  expect(a.q).toEqual([encodeStep('work', 24)]);
  expect(mind.llmCooldownUntilTick).toBe(0);
  expect(world.llm).toMatchObject({ running: 0, totalCalls: 1, failStreak: 0 });
});

test('a job whose mind moved on is never committed', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t);
  const bumpMind = (agentId: Id<'agents'>, by: number) =>
    t.run(async (ctx) => {
      const a = (await ctx.db.get(agentId))!;
      const mind = (await ctx.db.get(a.mindId!))!;
      await ctx.db.patch(mind._id, { stateVersion: mind.stateVersion + by });
    });

  // Moved before the call: dropped at claim, no model call.
  const early = await queue(t, worldId, agents[0]._id);
  await bumpMind(agents[0]._id, 2);
  const calls = mockModel(GOOD_PLAN);
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);
  expect(calls.length).toBe(0);
  expect((await t.run((ctx) => ctx.db.get(early)))!.status).toBe('stale');

  // Moved while the model was thinking: the answer is recorded but not applied.
  const late = await queue(t, worldId, agents[1]._id);
  mockModel((n: number) => {
    if (n === 1) void bumpMind(agents[1]._id, 2);
    return GOOD_PLAN;
  });
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);
  const { job, mind } = await t.run(async (ctx) => {
    const a = (await ctx.db.get(agents[1]._id))!;
    return { job: (await ctx.db.get(late))!, mind: (await ctx.db.get(a.mindId!))! };
  });
  expect(job.status).toBe('stale');
  expect(job.outcome).toBe('mind moved');
  expect(mind.plan?.source).not.toBe('llm');
});

test('claims respect concurrency, lane order, reserves, the daily budget and day rollover', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t, { budgetPerDay: 4, focusReserve: 1, orbitReserve: 0, crisisReserve: 1, maxConcurrent: 2, speechPerDay: 1 });
  const normal = [await queue(t, worldId, agents[0]._id, { priority: 0.9 }), await queue(t, worldId, agents[1]._id), await queue(t, worldId, agents[2]._id)];
  const crisis = await queue(t, worldId, agents[3]._id, { lane: 'crisis', priority: 0.2 });
  const focus = await queue(t, worldId, agents[4]._id, { lane: 'focus', priority: 0.1 });
  const statusOf = (id: Id<'cognitionJobs'>) => t.run(async (ctx) => (await ctx.db.get(id))!.status);

  // Two slots: focus and crisis go first despite their low priority.
  const first = await t.mutation(internal.cognition.claim, { worldId, configured: true });
  expect(first.jobIds).toEqual([focus, crisis]);
  let world = (await t.run((ctx) => ctx.db.get(worldId)))!;
  expect(world.llm).toMatchObject({ running: 2, queued: 3, callsToday: 2, focusUsed: 1, crisisUsed: 1 });

  // Slots full: nothing more is claimed.
  expect((await t.mutation(internal.cognition.claim, { worldId, configured: true })).jobIds).toEqual([]);

  // Free the slots. Reserves are used up, so normal jobs may spend the rest: two of the three.
  await t.run(async (ctx) => {
    for (const id of [focus, crisis]) await ctx.db.patch(id, { status: 'done' });
    const w = (await ctx.db.get(worldId))!;
    await ctx.db.patch(worldId, { llm: { ...w.llm, running: 0 } });
  });
  const second = await t.mutation(internal.cognition.claim, { worldId, configured: true });
  expect(second.jobIds).toEqual([normal[0], normal[1]]);
  await t.run(async (ctx) => {
    for (const id of second.jobIds) await ctx.db.patch(id, { status: 'done' });
    const w = (await ctx.db.get(worldId))!;
    await ctx.db.patch(worldId, { llm: { ...w.llm, running: 0 } });
  });
  // Budget spent: the last normal job is dropped rather than left to block its agent.
  expect((await t.mutation(internal.cognition.claim, { worldId, configured: true })).jobIds).toEqual([]);
  expect(await statusOf(normal[2])).toBe('dropped');

  // A normal job cannot eat into an unused reserve.
  await t.run(async (ctx) => {
    const w = (await ctx.db.get(worldId))!;
    await ctx.db.patch(worldId, { tick: 144, llm: { ...w.llm, callsToday: 2, focusUsed: 0, crisisUsed: 0, day: 1 } });
  });
  const held = await queue(t, worldId, agents[6]._id);
  expect((await t.mutation(internal.cognition.claim, { worldId, configured: true })).jobIds).toEqual([]);
  expect(await statusOf(held)).toBe('dropped');

  // A new sim day resets the counters.
  await t.run((ctx) => ctx.db.patch(worldId, { tick: 300 }));
  const fresh = await queue(t, worldId, agents[7]._id);
  expect((await t.mutation(internal.cognition.claim, { worldId, configured: true })).jobIds).toEqual([fresh]);
  world = (await t.run((ctx) => ctx.db.get(worldId)))!;
  expect(world.llm).toMatchObject({ day: 2, callsToday: 1, focusUsed: 0, crisisUsed: 0 });
});

test('jobs are dropped while the LLM is disabled or unconfigured', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t);
  const job = await queue(t, worldId, agents[0]._id);
  expect((await t.mutation(internal.cognition.claim, { worldId, configured: false })).jobIds).toEqual([]);
  const after = await t.run(async (ctx) => ({ job: (await ctx.db.get(job))!, world: (await ctx.db.get(worldId))! }));
  expect(after.job).toMatchObject({ status: 'dropped', outcome: 'no api key' });
  expect(after.world.llm.queued).toBe(0);
});

test('repeated failures back off and the world keeps running on rules', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t, { maxConcurrent: 3 });
  const jobs: Id<'cognitionJobs'>[] = [];
  for (let i = 0; i < 4; i++) jobs.push(await queue(t, worldId, agents[i]._id));
  const calls = mockModel(null, 500);
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);

  expect(calls.length).toBe(6);
  const { statuses, world } = await t.run(async (ctx) => ({
    statuses: await Promise.all(jobs.map(async (id) => (await ctx.db.get(id))!.status)),
    world: (await ctx.db.get(worldId))!,
  }));
  expect(statuses.filter((s) => s === 'failed').length).toBe(3);
  expect(statuses).toContain('dropped');
  expect(world.llm.failStreak).toBe(3);
  expect(world.llm.lastError).toContain('HTTP 500');
  expect(world.llm.lastError).not.toContain('sk-test-key');
  expect(world.llm.disabledUntil).toBeGreaterThan(Date.now());
  expect(world.llm).toMatchObject({ running: 0, queued: 0 });

  const queued = await t.run(async (ctx) => {
    const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
    const a = (await loadAgent(tx, agents[9]._id))!;
    return await enqueueCognition(tx, a, { kind: 'plan', trigger: 'test', priority: 1, lane: 'focus' });
  });
  expect(queued).toBe(false);
});

test('a speech line shows only while the interaction lasts and counts against its allowance', async () => {
  const t = newTest();
  const { worldId, agents } = await setup(t);
  const [speaker, partner, other] = agents;
  await t.run(async (ctx) => {
    await ctx.db.patch(speaker._id, { interactingWithId: partner._id, activity: 'talking', activityLabel: 'Talking with ' + partner.name });
    await ctx.db.patch(other._id, { interactingWithId: partner._id });
  });
  const kept = await queue(t, worldId, speaker._id, { kind: 'speech', lane: 'focus', trigger: 'Chatting about the water ration' });
  const calls = mockModel({ line: '"They cut the ration again. Did you hear?"' });
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);
  expect(calls[0].body.messages[1].content).toContain(partner.name);
  const a = (await t.run((ctx) => ctx.db.get(speaker._id)))!;
  expect(a.speech).toBe('They cut the ration again. Did you hear?');

  const lost = await queue(t, worldId, other._id, { kind: 'speech', lane: 'normal', trigger: 'Small talk' });
  mockModel((n: number) => {
    if (n === 1) void t.run((ctx) => ctx.db.patch(other._id, { interactingWithId: undefined }));
    return { line: 'Long shift, huh?' };
  });
  await t.action(internal.cognition.drain, { worldId });
  await settle(t);
  const after = await t.run(async (ctx) => ({ job: (await ctx.db.get(lost))!, o: (await ctx.db.get(other._id))!, world: (await ctx.db.get(worldId))! }));
  expect(after.job).toMatchObject({ status: 'stale', outcome: 'interaction over' });
  expect(after.o.speech).toBeUndefined();
  expect(after.world.llm).toMatchObject({ speechToday: 2, callsToday: 0 });
  expect((await t.run((ctx) => ctx.db.get(kept)))!.status).toBe('done');
});
