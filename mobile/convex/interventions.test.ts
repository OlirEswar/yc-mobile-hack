import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { beginTx, commitTx, loadAgent, touch } from './engine/core';
import { modules } from './test.setup';
import { LOCATIONS, MAX_POPULATION, TICKS_PER_DAY } from '../shared/colony';
import type { Intervention, NewCharacterInput } from '../shared/types';
import { MAX_GRANT, RATE_LIMITS } from './lib/constants';

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;

async function setup(deviceId: string) {
  const t = newTest();
  const { sessionToken, worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  let n = 0;
  const apply = (iv: Intervention, commandId = 'command-' + n++) => t.mutation(api.interventions.apply, { ...iv, commandId, worldId, sessionToken });
  const agents = () => t.run((ctx) => ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId as Id<'worlds'>)).collect());
  const world = () => t.run(async (ctx) => (await ctx.db.get(worldId as Id<'worlds'>))!);
  return { t, worldId, sessionToken, apply, agents, world };
}

/** Moves colonists (by seq) to a location, awake, through a Tx so the roster stays right. */
async function placeAt(t: T, worldId: string, seqs: number[], locationId: string, patch: Partial<Doc<'agents'>> = {}): Promise<Id<'agents'>[]> {
  return await t.run(async (ctx) => {
    const world = (await ctx.db.get(worldId as Id<'worlds'>))!;
    const all = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', world._id)).collect();
    const tx = beginTx(ctx, world);
    const ids: Id<'agents'>[] = [];
    for (const seq of seqs) {
      const a = (await loadAgent(tx, all[seq]._id))!;
      Object.assign(a, { locationId, activity: 'idle', move: undefined, ...patch });
      touch(tx, a);
      ids.push(a._id);
    }
    await commitTx(tx);
    return ids;
  });
}

const beliefsOf = (t: T, agentId: string) =>
  t.run((ctx) => ctx.db.query('beliefs').withIndex('by_agent_key', (q) => q.eq('agentId', agentId as Id<'agents'>)).collect());
const mindOf = (t: T, agentId: string) => t.run(async (ctx) => (await ctx.db.get((await ctx.db.get(agentId as Id<'agents'>))!.mindId!))!);
const eventOf = (t: T, eventId: string) => t.run(async (ctx) => (await ctx.db.get(eventId as Id<'events'>))!);

function ok<R extends { ok: boolean }>(result: R): Extract<R, { ok: true }> {
  if (!result.ok) throw new Error('expected ok, got ' + JSON.stringify(result));
  return result as Extract<R, { ok: true }>;
}

test('drought starts a standing condition, tells the well crew and queues the leaders', async () => {
  const { t, apply, agents, world, worldId } = await setup('device-drought');
  await t.run(async (ctx) => {
    const w = (await ctx.db.get(worldId as Id<'worlds'>))!;
    await ctx.db.patch(w._id, { llm: { ...w.llm, enabled: true } });
  });
  const result = ok(await apply({ type: 'drought', params: { severity: 0.6, durationDays: 2 } }));
  const after = await world();
  expect(after.version).toBe(result.worldVersion);
  const effect = after.activeEffects.find((e) => e.type === 'drought')!;
  expect(effect).toMatchObject({ severity: 0.6, startTick: 0, endTick: 2 * TICKS_PER_DAY, locationIds: [] });
  expect(after.causes.drought).toBe(result.eventIds[0]);
  const event = await eventOf(t, result.eventIds[0]);
  expect(event).toMatchObject({ category: 'intervention', eventType: 'drought', banner: true, visibility: 'public' });

  const miners = (await agents()).filter((a) => a.workLocationId === 'ice_wells');
  for (const m of miners) {
    expect(result.affectedAgentIds).toContain(m._id);
    expect((await beliefsOf(t, m._id)).some((b) => b.key === 'scarcity:water')).toBe(true);
  }
  const jobs = await t.run((ctx) => ctx.db.query('cognitionJobs').collect());
  const leaders = ['quartermaster', 'chair', 'union_leader'].map((role) => after.roles[role]);
  for (const id of leaders) expect(jobs.some((j) => j.agentId === id && j.lane === 'crisis' && j.eventId === result.eventIds[0])).toBe(true);

  const again = ok(await apply({ type: 'drought', params: { severity: 0.4, durationDays: 5 } }));
  const extended = (await world()).activeEffects.filter((e) => e.type === 'drought');
  expect(extended).toHaveLength(1);
  expect(extended[0]).toMatchObject({ severity: 0.6, endTick: 5 * TICKS_PER_DAY });
  expect((await world()).causes.drought).toBe(again.eventIds[0]);

  expect(await apply({ type: 'drought', params: { severity: 0, durationDays: 2 } })).toMatchObject({ ok: false, code: 'invalid' });
  expect(await apply({ type: 'drought', params: { severity: 0.5, durationDays: 8 } })).toMatchObject({ ok: false, code: 'invalid' });
});

test('storm damages sites, injures people caught outside and sends them to shelter', async () => {
  const { t, apply, worldId, world } = await setup('device-storm');
  const caught = await placeAt(t, worldId, [3, 4, 5], 'ice_wells');
  const [frail] = await placeAt(t, worldId, [7], 'quarry', { health: 5 });
  const result = ok(await apply({ type: 'storm', params: { severity: 0.8, locationIds: ['ice_wells', 'quarry'] } }));
  const after = await world();
  expect(after.damage.ice_wells).toBeGreaterThan(0.5);
  expect(after.damage.quarry).toBeGreaterThan(0.5);
  expect(after.causes.storm).toBe(result.eventIds[0]);
  expect(after.activeEffects.find((e) => e.type === 'storm')).toMatchObject({ locationIds: ['ice_wells', 'quarry'] });

  for (const id of caught) {
    const a = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(a.health).toBeLessThan(100);
    expect(a.needs.safety).toBeGreaterThan(50);
    const flee = a.q.find((step) => step.startsWith('flee|'))!;
    expect(LOCATIONS[flee.split('|')[1] as keyof typeof LOCATIONS].exposed).toBe(false);
  }
  expect((await t.run((ctx) => ctx.db.get(frail)))!.alive).toBe(false);
  for (const id of result.eventIds.slice(1)) expect((await eventOf(t, id)).causationEventId).toBe(result.eventIds[0]);
  expect(result.affectedAgentIds).toEqual(expect.arrayContaining([...caught, frail]));

  const everywhere = ok(await apply({ type: 'storm', params: { severity: 0.3 } }));
  const exposed = Object.values(LOCATIONS).filter((l) => l.exposed).map((l) => l.id);
  expect((await world()).activeEffects.find((e) => e.type === 'storm')!.locationIds).toEqual(expect.arrayContaining(exposed));
  const damaged = await Promise.all(everywhere.eventIds.map((id) => eventOf(t, id)));
  expect(damaged.filter((e) => e.eventType === 'damage').map((e) => e.locationId)).toEqual(exposed);
  expect(await apply({ type: 'storm', params: { severity: 0.5, locationIds: ['nowhere' as never] } })).toMatchObject({ ok: false, code: 'invalid' });
});

test('grant adds goods, plants a windfall belief and validates its params', async () => {
  const { t, apply, agents } = await setup('device-grant');
  const [a, b] = await agents();
  const result = ok(await apply({ type: 'grant', params: { agentId: a._id, resource: 'water', amount: 40 } }));
  const after = (await t.run((ctx) => ctx.db.get(a._id)))!;
  expect(after.inv.water).toBe(a.inv.water + 40);
  expect((await eventOf(t, result.eventIds[0])).eventType).toBe('grant');
  expect((await beliefsOf(t, a._id)).some((x) => x.kind === 'windfall' && x.subjectAgentId === a._id)).toBe(true);

  expect(await apply({ type: 'grant', params: { agentId: a._id, resource: 'water', amount: MAX_GRANT.water + 1 } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'grant', params: { agentId: a._id, resource: 'water', amount: 2.5 } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'grant', params: { agentId: a._id, resource: 'gold' as never, amount: 2 } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'grant', params: { agentId: 'not-an-id', resource: 'water', amount: 2 } })).toMatchObject({ code: 'not_found' });
  ok(await apply({ type: 'kill', params: { agentId: b._id, cause: 'test' } }));
  expect(await apply({ type: 'grant', params: { agentId: b._id, resource: 'water', amount: 2 } })).toMatchObject({ code: 'dead_target' });
});

test('kill writes an intervention death, frightens witnesses and rejects the dead', async () => {
  const { t, apply, worldId, world } = await setup('device-kill');
  const [victim, w1, w2] = await placeAt(t, worldId, [10, 11, 12], 'canteen');
  const result = ok(await apply({ type: 'kill', params: { agentId: victim, cause: 'a hull breach.' } }));
  const event = await eventOf(t, result.eventIds[0]);
  expect(event).toMatchObject({ category: 'intervention', eventType: 'death', actorId: victim, banner: true });
  expect(event.summary).toContain('a hull breach.');
  expect((await world()).population).toEqual({ alive: 99, dead: 1 });
  for (const id of [w1, w2]) {
    expect((await beliefsOf(t, id)).some((b) => b.kind === 'death' && b.subjectAgentId === victim && b.sourceType === 'observed')).toBe(true);
    expect(result.affectedAgentIds).toContain(id);
  }
  expect(await apply({ type: 'kill', params: { agentId: victim, cause: 'again' } })).toMatchObject({ ok: false, code: 'dead_target' });
});

test('whisper plants a private divine belief and goal, and the agent replans', async () => {
  const { t, apply, agents } = await setup('device-whisper');
  const [a, b, c] = await agents();
  const mindBefore = await mindOf(t, a._id);
  const distrust = ok(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'distrust', text: '', strength: 0.8, aboutAgentId: b._id } }));
  const belief = (await beliefsOf(t, a._id)).find((x) => x.key === 'untrustworthy:' + b._id)!;
  expect(belief).toMatchObject({ sourceType: 'divine', private: true, valence: -1, originEventId: distrust.eventIds[0] });
  expect(belief.text).toBe(b.name + ' cannot be trusted.');
  expect(await eventOf(t, distrust.eventIds[0])).toMatchObject({ eventType: 'whisper', visibility: 'private', banner: false });

  ok(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'get_rich', text: '', strength: 0.5 } }));
  const mind = await mindOf(t, a._id);
  const goal = mind.goals.find((g) => g.drive === 'get_rich' && g.source === 'divine')!;
  expect(goal).toMatchObject({ kind: 'earn_wealth', predicate: 'credits_at_least', status: 'active' });
  expect(goal.targetQuantity).toBeGreaterThan(a.inv.credits);
  expect(mind.stateVersion).toBeGreaterThan(mindBefore.stateVersion);
  expect((await t.run((ctx) => ctx.db.get(a._id)))!.planEpoch).toBeGreaterThan(a.planEpoch);

  ok(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'befriend', text: '', strength: 1, aboutAgentId: c._id } }));
  expect((await mindOf(t, a._id)).goals.find((g) => g.drive === 'befriend' && g.source === 'divine')).toMatchObject({ predicate: 'affinity_at_least', targetAgentId: c._id });

  expect(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'befriend', text: '', strength: 1 } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'nope', text: 'hi there', strength: 1 } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'custom', text: '', strength: 1 } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'whisper', params: { agentId: a._id, presetKey: 'share', text: '', strength: 2 } })).toMatchObject({ code: 'invalid' });
});

test('rumor reaches two to four awake people at the seed spot, never the subject', async () => {
  const { t, apply, worldId } = await setup('device-rumor');
  const present = await placeAt(t, worldId, [20, 21, 22, 23, 24, 25], 'plaza');
  const subject = present[0];
  const result = ok(await apply({ type: 'rumor', params: { aboutAgentId: subject, presetKey: 'hoarding', text: '' } }));
  const event = await eventOf(t, result.eventIds[0]);
  expect(event).toMatchObject({ eventType: 'rumor_started', category: 'intervention', locationId: 'plaza', visibility: 'local' });
  expect(result.affectedAgentIds.length).toBeGreaterThanOrEqual(2);
  expect(result.affectedAgentIds.length).toBeLessThanOrEqual(4);
  expect(result.affectedAgentIds).not.toContain(subject);
  const subjectName = (await t.run((ctx) => ctx.db.get(subject)))!.name;
  for (const id of result.affectedAgentIds) {
    expect(present).toContain(id);
    const b = (await beliefsOf(t, id)).find((x) => x.key === 'hoarding:' + subject)!;
    expect(b).toMatchObject({ sourceType: 'rumor', valence: -1, originEventId: result.eventIds[0] });
    expect(b.text).toBe(subjectName + ' is secretly hoarding food and water.');
  }
  expect((await beliefsOf(t, subject)).some((x) => x.originEventId === result.eventIds[0])).toBe(false);

  const custom = ok(await apply({ type: 'rumor', params: { aboutAgentId: subject, presetKey: 'custom', text: '{name} talks to the drills at night.', seedLocationId: 'plaza' } }));
  const heard = (await beliefsOf(t, custom.affectedAgentIds[0])).find((x) => x.key === 'custom:' + subject)!;
  expect(heard.text).toBe(subjectName + ' talks to the drills at night.');
  expect(await apply({ type: 'rumor', params: { aboutAgentId: subject, presetKey: 'custom', text: '' } })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'rumor', params: { aboutAgentId: subject, presetKey: 'hero', text: '', seedLocationId: 'mars' as never } })).toMatchObject({ code: 'invalid' });
});

test('a rumor started while the colony sleeps still finds two to four hearers', async () => {
  const { apply, agents } = await setup('device-rumor-night');
  const [subject] = await agents();
  const result = ok(await apply({ type: 'rumor', params: { aboutAgentId: subject._id, presetKey: 'thief', text: '' } }));
  expect(result.affectedAgentIds.length).toBeGreaterThanOrEqual(2);
  expect(result.affectedAgentIds.length).toBeLessThanOrEqual(4);
  expect(result.affectedAgentIds).not.toContain(subject._id);
});

const newcomer = (overrides: Partial<NewCharacterInput> = {}): NewCharacterInput => ({
  name: 'Ida Okafor',
  spriteId: 'medic_2',
  ageBand: 'adult',
  occupation: 'medic',
  homeLocationId: 'habitat_b',
  traits: { ambition: 0.5, empathy: 0.9, caution: 0.4, curiosity: 0.6, sociability: 0.7, stubbornness: 0.3 },
  values: { wealth: 0.2, family: 0.6, status: 0.3, harmony: 0.8, freedom: 0.5 },
  backstory: 'A trauma surgeon who left Earth after a scandal she will not discuss.',
  startingResources: { credits: 120, medicine: 4 },
  goals: [{ kind: 'earn_wealth', description: 'Pay off the shuttle fare' }],
  ...overrides,
});

test('create_character inserts a working colonist that every read sees', async () => {
  const { t, apply, agents, world, worldId } = await setup('device-create');
  const [friend] = await agents();
  const before = await world();
  const result = ok(await apply({ type: 'create_character', params: newcomer({ relationships: [{ toAgentId: friend._id, kind: 'friend' }] }) }));
  const id = result.createdAgentId!;
  const created = (await t.run((ctx) => ctx.db.get(id as Id<'agents'>)))!;
  expect(created).toMatchObject({ name: 'Ida Okafor', seq: 100, locationId: 'landing_pad', alive: true, workLocationId: 'medbay' });
  expect(created.inv).toMatchObject({ credits: 120, medicine: 4, food: 0 });
  expect(created.q[0]).toBe('go|habitat_b');
  const after = await world();
  expect(after.nextSeq).toBe(101);
  expect(after.population.alive).toBe(before.population.alive + 1);
  expect(after.roster.loc.length).toBe(101);

  const list = await t.query(api.agents.list, { worldId });
  expect(list.map((a) => a.id)).toContain(id);
  const sync = await t.query(api.sync.updates, { worldId, sinceVersion: before.version });
  expect(sync.agents.map((a) => a.id)).toContain(id);
  expect(sync.events.map((e) => e.eventType)).toContain('arrival');
  const detail = (await t.query(api.agents.get, { worldId, agentId: id }))!;
  expect(detail.relationships.map((r) => r.toAgentId)).toContain(friend._id);
  expect(detail.goals.find((g) => g.source === 'divine')).toMatchObject({ kind: 'earn_wealth' });
  expect((await mindOf(t, id)).goals.find((g) => g.source === 'divine')).toMatchObject({ predicate: 'credits_at_least', targetQuantity: 270 });
  const back = await t.run((ctx) => ctx.db.query('relationships').withIndex('by_from_to', (q) => q.eq('fromAgentId', friend._id).eq('toAgentId', id as Id<'agents'>)).first());
  expect(back).toMatchObject({ kind: 'friend' });

  expect(await apply({ type: 'create_character', params: newcomer({ name: 'I' }) })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'create_character', params: newcomer({ spriteId: 'dragon_1' as never }) })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'create_character', params: newcomer({ startingResources: { credits: 5000 } }) })).toMatchObject({ code: 'invalid' });
  expect(await apply({ type: 'create_character', params: newcomer({ occupation: 'wizard' }) })).toMatchObject({ code: 'invalid' });
  await t.run(async (ctx) => {
    const w = (await ctx.db.get(worldId as Id<'worlds'>))!;
    await ctx.db.patch(w._id, { population: { alive: MAX_POPULATION, dead: 0 } });
  });
  expect(await apply({ type: 'create_character', params: newcomer() })).toMatchObject({ ok: false, code: 'cap_reached' });
});

test('the same commandId applies once and returns the first result', async () => {
  const { t, apply, agents } = await setup('device-idempotent');
  const [a] = await agents();
  const command = { type: 'grant', params: { agentId: a._id, resource: 'credits', amount: 25 } } as const;
  const first = ok(await apply(command, 'same-command-id'));
  const second = await apply(command, 'same-command-id');
  expect(second).toEqual(first);
  expect((await t.run((ctx) => ctx.db.get(a._id)))!.inv.credits).toBe(a.inv.credits + 25);
  const grants = await t.run((ctx) => ctx.db.query('events').collect());
  expect(grants.filter((e) => e.eventType === 'grant')).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query('interventions').collect())).toHaveLength(1);
});

test('powers are rate limited per session and need a valid session', async () => {
  const { t, apply, agents, worldId } = await setup('device-rate');
  const [a] = await agents();
  for (let i = 0; i < RATE_LIMITS.powersPerWindow; i++) ok(await apply({ type: 'grant', params: { agentId: a._id, resource: 'food', amount: 1 } }));
  expect(await apply({ type: 'grant', params: { agentId: a._id, resource: 'food', amount: 1 } })).toMatchObject({ ok: false, code: 'rate_limited' });
  const forged = await t.mutation(api.interventions.apply, { type: 'drought', params: { severity: 1, durationDays: 1 }, commandId: 'forged-command', worldId, sessionToken: 'f'.repeat(32) });
  expect(forged).toMatchObject({ ok: false, code: 'unauthorized' });
});
