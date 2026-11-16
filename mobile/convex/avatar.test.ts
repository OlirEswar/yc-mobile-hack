import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { modules } from './test.setup';
import { planDirective } from './avatar/directive';
import { normalizeProfile, rulesProfile, scrub } from './avatar/profile';
import { planRequest } from './cognition/prompt';
import type { AvatarProfile } from '../shared/types';

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ABOUT_ME =
  'I am a startup founder in San Francisco, went through Y Combinator, and I spend weekends climbing and hiking with friends. ' +
  'I love hosting dinners, I am curious about space and astronomy, and I am pretty stubborn about shipping things fast. Email me at neel@example.com or call +1 (415) 555-0199, see https://example.com/me.';
const AI_MEMORY =
  'From our chats: the user is ambitious and sociable, a founder who is fundraising for their startup, reads a lot about rockets and Mars, cooks for their team, and values freedom and building their own thing.';

async function player(t: T, deviceId: string) {
  const { sessionToken, worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  await t.run(async (ctx) => {
    const id = ctx.db.normalizeId('worlds', worldId)!;
    const w = (await ctx.db.get(id))!;
    await ctx.db.patch(id, { llm: { ...w.llm, enabled: true }, loop: { ...w.loop, running: false } });
  });
  return { sessionToken, worldId };
}

async function builtAvatar(t: T, deviceId: string, name: string) {
  const p = await player(t, deviceId);
  expect(await t.mutation(api.avatar.addSource, { sessionToken: p.sessionToken, source: { kind: 'about_me', label: 'About me', text: ABOUT_ME } })).toEqual({ ok: true });
  const built = await t.action(api.avatar.synthesize, { sessionToken: p.sessionToken, name });
  expect(built.ok).toBe(true);
  return p;
}

const agentOf = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.get(id as Id<'agents'>))!);
const mindOf = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.get((await ctx.db.get(id as Id<'agents'>))!.mindId!))!);
const jobsOf = (t: T, id: string) => t.run((ctx) => ctx.db.query('cognitionJobs').withIndex('by_agent_status', (q) => q.eq('agentId', id as Id<'agents'>)).collect());

test('sources are scrubbed of contact details, bounded, and removable', async () => {
  const t = newTest();
  const { sessionToken } = await player(t, 'device-sources');
  expect(await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'about_me', label: 'About me', text: ABOUT_ME } })).toEqual({ ok: true });
  expect(await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'tiktok', label: 'x', text: ABOUT_ME } })).toMatchObject({ ok: false });
  expect(await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'ai_memory', label: 'ChatGPT', text: 'too short' } })).toMatchObject({ ok: false });
  const mine = (await t.query(api.avatar.mine, { sessionToken }))!;
  expect(mine.sources).toHaveLength(1);
  const stored = await t.run((ctx) => ctx.db.query('personaSources').collect());
  expect(stored[0].text).not.toMatch(/neel@example\.com|555-0199|https:/);
  expect(stored[0].text).toContain('[email]');
  expect(stored[0].text).toContain('[phone]');
  expect(stored[0].text).toContain('[link]');
  for (let i = 0; i < 5; i++) await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'ai_memory', label: 'Memory ' + i, text: AI_MEMORY } });
  expect(await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'ai_memory', label: 'One more', text: AI_MEMORY } })).toMatchObject({ ok: false });
  expect(await t.mutation(api.avatar.removeSource, { sessionToken, sourceId: mine.sources[0].id })).toEqual({ ok: true });
  expect((await t.query(api.avatar.mine, { sessionToken }))!.sources).toHaveLength(5);
  expect(await t.query(api.avatar.mine, { sessionToken: 'not-a-real-token-at-all' })).toBeNull();
});

test('without a model the rules build a profile that fits the material', async () => {
  const t = newTest();
  const { sessionToken } = await player(t, 'device-rules');
  expect(await t.action(api.avatar.synthesize, { sessionToken })).toMatchObject({ ok: false });
  await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'about_me', label: 'About me', text: ABOUT_ME } });
  await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'ai_memory', label: 'ChatGPT memory', text: AI_MEMORY } });
  const built = await t.action(api.avatar.synthesize, { sessionToken, name: 'Neel' });
  if (!built.ok) throw new Error(built.message);
  expect(built.profileSource).toBe('rules');
  const profile = built.profile!;
  expect(profile.name).toBe('Neel');
  expect(profile.occupation).toBe('trader');
  expect(profile.interests).toContain('startups');
  expect(profile.traits.ambition).toBeGreaterThan(0.6);
  expect(profile.traits.stubbornness).toBeGreaterThan(0.5);
  expect(profile.spriteId).toMatch(/^merchant_\d$/);
  expect(typeof normalizeProfile(profile)).toBe('object');
  expect((await t.query(api.avatar.mine, { sessionToken }))!.profileSource).toBe('rules');
});

test('a model profile is used where valid and patched from the rules where not', async () => {
  vi.stubEnv('LLM_API_KEY', 'sk-test-key');
  const answer = {
    name: 'Neel',
    ageBand: 'adult',
    occupation: 'researcher',
    homeLocationId: 'habitat_z',
    traits: { ambition: 0.9, empathy: 0.6, caution: 0.3, curiosity: 0.95, sociability: 0.8, stubbornness: 0.7 },
    values: { wealth: 0.5, family: 0.4, status: 0.5, harmony: 0.5, freedom: 0.9 },
    backstory: 'Left a startup in California to chase the stars. Reach him at neel@example.com.',
    summary: 'Neel is a restless builder who wants to see what is past the next ridge.',
    interests: ['rockets', 'founding things', 'climbing'],
    speechStyle: 'Fast, upbeat, thinks out loud',
    habits: ['Pitches ideas at the Exchange'],
    goals: [{ kind: 'gain_influence', description: 'Get a seat on the council' }, { kind: 'teleport', description: 'nope' }],
  };
  const calls: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }));
  const t = newTest();
  const { sessionToken } = await player(t, 'device-llm');
  await t.mutation(api.avatar.addSource, { sessionToken, source: { kind: 'about_me', label: 'About me', text: ABOUT_ME } });
  const built = await t.action(api.avatar.synthesize, { sessionToken });
  if (!built.ok) throw new Error(built.message);
  expect(calls).toHaveLength(1);
  expect(calls[0].messages[1].content).toContain('[email]');
  expect(calls[0].messages[1].content).not.toContain('neel@example.com');
  expect(built.profileSource).toBe('llm');
  expect(built.profile).toMatchObject({ name: 'Neel', occupation: 'researcher', speechStyle: 'Fast, upbeat, thinks out loud' });
  expect(built.profile!.spriteId).toMatch(/^scientist_\d$/);
  expect(['habitat_a', 'habitat_b']).toContain(built.profile!.homeLocationId);
  expect(built.profile!.backstory).toContain('[email]');
  // One bad goal makes the model's goals unusable, so the rules' goals stand.
  expect(built.profile!.goals.every((g) => g.kind !== ('teleport' as never))).toBe(true);
});

test('a player edit is checked strictly', async () => {
  const t = newTest();
  const { sessionToken } = await builtAvatar(t, 'device-edit', 'Neel');
  const profile = (await t.query(api.avatar.mine, { sessionToken }))!.profile!;
  expect(await t.mutation(api.avatar.saveProfile, { sessionToken, profile: { ...profile, occupation: 'astronaut' } })).toEqual({ ok: false, message: 'Unknown occupation.' });
  expect(await t.mutation(api.avatar.saveProfile, { sessionToken, profile: { ...profile, traits: { ...profile.traits, empathy: 3 } } })).toMatchObject({ ok: false });
  const saved = await t.mutation(api.avatar.saveProfile, { sessionToken, profile: { ...profile, occupation: 'medic', speechStyle: 'Gentle and dry' } });
  expect(saved).toMatchObject({ ok: true, profileSource: 'player', profile: { occupation: 'medic', speechStyle: 'Gentle and dry' } });
});

test('spawning puts a persona-driven avatar in the world and asks for its first plan in the focus lane', async () => {
  const t = newTest();
  const { sessionToken, worldId } = await builtAvatar(t, 'device-spawn', 'Neel Sharma');
  const spawned = await t.mutation(api.avatar.spawn, { sessionToken });
  if (!spawned.ok) throw new Error(spawned.message);
  const agentId = spawned.agentId!;
  const agent = await agentOf(t, agentId);
  expect(agent).toMatchObject({ name: 'Neel Sharma', ownerName: 'Neel', locationId: 'landing_pad', alive: true });
  const mind = await mindOf(t, agentId);
  expect(mind.avatarPersona!.interests).toContain('startups');
  const jobs = await jobsOf(t, agentId);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ lane: 'focus', status: 'queued' });
  expect(jobs[0].trigger).toContain("avatar of Neel");
  expect(await t.mutation(api.avatar.spawn, { sessionToken })).toMatchObject({ ok: false });
  expect((await t.query(api.avatar.mine, { sessionToken }))!.agentId).toBe(agentId);
  const lite = (await t.query(api.agents.list, { worldId })).find((a) => a.id === agentId)!;
  expect(lite.ownerName).toBe('Neel');
  const detail = (await t.query(api.agents.get, { worldId, agentId }))!;
  expect(detail.avatarPersona!.speechStyle.length).toBeGreaterThan(0);

  // The planner prompt speaks for the player.
  const context = await t.query(internal.cognition.context, { jobId: jobs[0]._id });
  if (!context.ok) throw new Error(context.reason);
  const prompt = planRequest(context.context as never).user;
  expect(prompt).toContain('in-world avatar of a real person, Neel');
  expect(prompt).toContain('Interests: startups');
});

test('a directive becomes the top goal, an immediate plan and a focus-lane LLM request', async () => {
  const t = newTest();
  const { sessionToken } = await builtAvatar(t, 'device-direct', 'Neel');
  expect(await t.mutation(api.avatar.direct, { sessionToken, text: 'Go buy some water' })).toMatchObject({ ok: false });
  const { agentId } = (await t.mutation(api.avatar.spawn, { sessionToken })) as { agentId: string };
  await t.run(async (ctx) => {
    for (const job of await ctx.db.query('cognitionJobs').collect()) await ctx.db.patch(job._id, { status: 'done' });
  });
  expect(await t.mutation(api.avatar.direct, { sessionToken, text: 'hi' })).toMatchObject({ ok: false });
  expect(await t.mutation(api.avatar.direct, { sessionToken, text: 'Go buy some water at the market!' })).toMatchObject({ ok: true, agentId });
  const agent = await agentOf(t, agentId);
  expect(agent.q).toEqual(['go|market', 'buy|water|3']);
  const mind = await mindOf(t, agentId);
  expect(mind.goals[0]).toMatchObject({ source: 'owner', description: 'Go buy some water at the market', priority: 0.9 });
  expect(mind.directive!.text).toBe('Go buy some water at the market');
  expect(mind.plan).toMatchObject({ source: 'local_planner', labels: ['Walk to Exchange Concourse', 'Buy water at the Exchange'] });
  const queued = (await jobsOf(t, agentId)).filter((j) => j.status === 'queued');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ lane: 'focus', priority: 1 });
  const event = await t.run(async (ctx) => (await ctx.db.query('events').collect()).find((e) => e.eventType === 'directive')!);
  expect(event).toMatchObject({ visibility: 'private', category: 'intervention', summary: 'Neel asked Neel to go buy some water at the market.' });

  await t.mutation(api.avatar.direct, { sessionToken, text: 'Make some friends' });
  const after = await mindOf(t, agentId);
  expect(after.goals.filter((g) => g.source === 'owner')).toHaveLength(1);
  expect((await t.query(api.avatar.mine, { sessionToken }))!.directives.map((d) => d.text)).toEqual(['Make some friends', 'Go buy some water at the market']);
  const context = await t.query(internal.cognition.context, { jobId: queued[0]._id });
  if (!context.ok) throw new Error(context.reason);
  expect(planRequest(context.context as never).user).toContain('Their player asked them: "Make some friends"');
});

test('forgetting deletes the material and frees the avatar', async () => {
  const t = newTest();
  const { sessionToken } = await builtAvatar(t, 'device-forget', 'Neel');
  const { agentId } = (await t.mutation(api.avatar.spawn, { sessionToken })) as { agentId: string };
  expect(await t.mutation(api.avatar.forget, { sessionToken })).toEqual({ ok: true });
  expect(await t.query(api.avatar.mine, { sessionToken })).toEqual({ sources: [], directives: [] });
  const agent = await agentOf(t, agentId);
  expect(agent.ownerSessionId).toBeUndefined();
  expect(agent.alive).toBe(true);
  expect((await mindOf(t, agentId)).avatarPersona).toBeUndefined();
});

test('friends join with a code, their avatars meet as friends, and each guards their own', async () => {
  const t = newTest();
  const host = await builtAvatar(t, 'device-host', 'Neel');
  await t.mutation(api.multiplayer.setName, { sessionToken: host.sessionToken, name: 'Neel' });
  const hostAvatar = ((await t.mutation(api.avatar.spawn, { sessionToken: host.sessionToken })) as { agentId: string }).agentId;
  const guest = await builtAvatar(t, 'device-guest', 'Oli');
  await t.mutation(api.multiplayer.setName, { sessionToken: guest.sessionToken, name: 'Oli' });

  expect(await t.mutation(api.multiplayer.invite, { sessionToken: guest.sessionToken })).toMatchObject({ ok: true });
  const invite = await t.mutation(api.multiplayer.invite, { sessionToken: host.sessionToken });
  if (!invite.ok) throw new Error(invite.message);
  expect(invite.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
  expect(await t.mutation(api.multiplayer.invite, { sessionToken: host.sessionToken })).toMatchObject({ inviteCode: invite.inviteCode });

  expect(await t.mutation(api.multiplayer.join, { sessionToken: guest.sessionToken, code: 'ZZZZZZ' })).toMatchObject({ ok: false });
  const joined = await t.mutation(api.multiplayer.join, { sessionToken: guest.sessionToken, code: invite.inviteCode!.toLowerCase() });
  expect(joined).toEqual({ ok: true, worldId: host.worldId });
  expect((await t.mutation(api.session.bootstrap, { deviceId: 'device-guest' })).worldId).toBe(host.worldId);
  expect(await t.mutation(api.multiplayer.invite, { sessionToken: guest.sessionToken })).toMatchObject({ ok: false });

  const guestAvatar = ((await t.mutation(api.avatar.spawn, { sessionToken: guest.sessionToken })) as { agentId: string }).agentId;
  expect((await agentOf(t, guestAvatar)).worldId).toBe(host.worldId);
  const tie = await t.run((ctx) => ctx.db.query('relationships').withIndex('by_from_to', (q) => q.eq('fromAgentId', guestAvatar as Id<'agents'>).eq('toAgentId', hostAvatar as Id<'agents'>)).first());
  expect(tie).toMatchObject({ kind: 'friend' });
  const reunion = await t.run(async (ctx) => (await ctx.db.query('events').collect()).find((e) => e.eventType === 'reunion')!);
  expect(reunion.summary).toContain('friends from back home');

  const state = (await t.query(api.multiplayer.state, { sessionToken: guest.sessionToken }))!;
  expect(state).toMatchObject({ worldId: host.worldId, inviteCode: invite.inviteCode, isHost: false, maxPlayers: 8 });
  expect(state.players.map((p) => [p.name, p.isHost, p.isYou, p.avatarAgentId])).toEqual([
    ['Neel', true, false, hostAvatar],
    ['Oli', false, true, guestAvatar],
  ]);

  // Each player guides only their own avatar.
  const apply = (type: string, params: unknown) => t.mutation(api.interventions.apply, { commandId: 'cmd-' + type + '-' + Math.random(), worldId: host.worldId, sessionToken: guest.sessionToken, type, params });
  expect(await apply('kill', { agentId: hostAvatar, cause: 'spite' })).toMatchObject({ ok: false, code: 'unauthorized' });
  expect(await apply('whisper', { agentId: hostAvatar, presetKey: 'get_rich', text: '', strength: 0.5 })).toMatchObject({ ok: false, code: 'unauthorized' });
  expect(await apply('grant', { agentId: hostAvatar, resource: 'food', amount: 5 })).toMatchObject({ ok: true });

  const left = await t.mutation(api.multiplayer.leave, { sessionToken: guest.sessionToken });
  expect(left).toEqual({ ok: true, worldId: guest.worldId });
  expect(await t.mutation(api.multiplayer.leave, { sessionToken: guest.sessionToken })).toMatchObject({ ok: false });
  expect((await t.query(api.multiplayer.state, { sessionToken: host.sessionToken }))!.players).toHaveLength(1);
  // The guest's avatar stays in the host's world, still theirs.
  expect((await agentOf(t, guestAvatar)).ownerName).toBe('Oli');
});

test('keyword directives map to legal plans', () => {
  const a = { name: 'Neel Sharma', locationId: 'plaza', homeLocationId: 'habitat_b', workLocationId: 'market' };
  expect(planDirective('Get some sleep', a).steps).toEqual(['go|habitat_b', 'sleep|36']);
  expect(planDirective('Work a double shift', a).steps).toEqual(['go|market', 'work|24']);
  expect(planDirective('sell parts', a).steps).toEqual(['go|market', 'sell|parts|2']);
  expect(planDirective('Fix the solar panels', a).steps).toEqual(['go|solar_farm', 'repair|solar_farm']);
  expect(planDirective('Campaign for open rations at the council', a).steps).toEqual(['petition|rations_open']);
  expect(planDirective('Make friends with people', a).steps).toEqual(['go|canteen', 'rest|6']);
  expect(planDirective('Visit the Observatory Lab', a).steps).toEqual(['go|observatory', 'rest|6']);
  expect(planDirective('hmm', a).steps).toEqual(['rest|6']);
});

test('the keyword profile is deterministic and valid', () => {
  const a = rulesProfile([ABOUT_ME], 'Neel');
  expect(rulesProfile([ABOUT_ME], 'Neel')).toEqual(a);
  expect(normalizeProfile(a)).toEqual(a as AvatarProfile);
  expect(rulesProfile(['nothing in particular here at all'], undefined).occupation).toBe('resident');
  expect(scrub('mail me: a.b+c@d.co.uk or 020 7946 0958')).toBe('mail me: [email] or [phone]');
});
