/**
 * Multiplayer: friends play in one world. The host opens their world with a join code; a friend's
 * session moves into it (remembering its own world to go back to), spawns its own avatar there,
 * and every player sees and steers the same colony.
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import type { MultiplayerPublic, MultiplayerResult } from '../shared/types';
import { scrub } from './avatar/profile';
import { beginTx, commitTx, loadAgent, touch } from './engine/core';
import { ensureLoop } from './engine/loop';
import { authorizeWorld } from './lib/auth';
import { DEFAULT_SEED, HEARTBEAT_FRESH_MS } from './lib/constants';
import { MAX_PLAYERS, avatarIn, playerName, playersIn } from './lib/players';
import { seedWorld } from './seed/insert';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const fail = (message: string): MultiplayerResult => ({ ok: false, message });
const isHost = (session: Doc<'sessions'>, world: Doc<'worlds'>): boolean => session.deviceId === world.deviceId && !session.homeWorldId;

/** The players sharing the session's current world. */
export const state = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<MultiplayerPublic | null> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) return null;
    const { session, world } = auth;
    const now = Date.now();
    const players = [];
    for (const s of await playersIn(ctx, world)) {
      const avatar = await avatarIn(ctx, s._id, world._id);
      players.push({
        id: s._id,
        name: await playerName(ctx, s),
        isHost: s.deviceId === world.deviceId,
        isYou: s._id === session._id,
        online: now - s.lastHeartbeatAt < HEARTBEAT_FRESH_MS,
        ...(avatar ? { avatarAgentId: avatar._id, avatarName: avatar.name } : {}),
      });
    }
    return { worldId: world._id, inviteCode: world.inviteCode, isHost: isHost(session, world), players, maxPlayers: MAX_PLAYERS };
  },
});

/** The display name the other players see. Also relabels this player's avatars. */
export const setName = mutation({
  args: { sessionToken: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<MultiplayerResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken);
    if (!auth) return fail('This session is not recognised.');
    const name = scrub(args.name).replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 24) return fail('Your name must be 2 to 24 characters.');
    await ctx.db.patch(auth.session._id, { playerName: name });
    const owned = await ctx.db
      .query('agents')
      .withIndex('by_owner', (q) => q.eq('ownerSessionId', auth.session._id))
      .collect();
    for (const a of owned) {
      const world = await ctx.db.get(a.worldId);
      if (!world || world.deleted) continue;
      const tx = beginTx(ctx, world);
      const agent = (await loadAgent(tx, a._id))!;
      agent.ownerName = name;
      touch(tx, agent);
      await commitTx(tx);
    }
    return { ok: true };
  },
});

/** Host only. Opens the world to friends and returns its join code. */
export const invite = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<MultiplayerResult> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) return fail('This session is not recognised.');
    const { session, world } = auth;
    if (!isHost(session, world)) return fail('Only the host can invite people to this colony.');
    if (world.inviteCode) return { ok: true, inviteCode: world.inviteCode, worldId: world._id };
    for (let attempt = 0; attempt < 8; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      const taken = await ctx.db
        .query('worlds')
        .withIndex('by_invite', (q) => q.eq('inviteCode', code))
        .first();
      if (taken) continue;
      await ctx.db.patch(world._id, { inviteCode: code });
      return { ok: true, inviteCode: code, worldId: world._id };
    }
    return fail('Could not make a join code. Try again.');
  },
});

/** Moves this session into the world with that code. */
export const join = mutation({
  args: { sessionToken: v.string(), code: v.string() },
  handler: async (ctx, args): Promise<MultiplayerResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken);
    if (!auth) return fail('This session is not recognised.');
    const { session, world: current } = auth;
    const code = args.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== CODE_LENGTH) return fail('A join code is ' + CODE_LENGTH + ' letters and numbers.');
    const target = await ctx.db
      .query('worlds')
      .withIndex('by_invite', (q) => q.eq('inviteCode', code))
      .first();
    if (!target || target.deleted) return fail('No colony has that code. Check it with your friend.');
    if (target._id === current._id) return { ok: true, worldId: target._id };
    if (target._id === session.homeWorldId) return await moveTo(ctx, session, target, undefined);
    const players = await playersIn(ctx, target);
    if (players.length >= MAX_PLAYERS) return fail('That colony is full (' + MAX_PLAYERS + ' players).');
    return await moveTo(ctx, session, target, session.homeWorldId ?? current._id);
  },
});

/** Guests only. Back to the player's own world, or a fresh one if it is gone. */
export const leave = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<MultiplayerResult> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) return fail('This session is not recognised.');
    const { session } = auth;
    if (!session.homeWorldId) return fail('This is your own colony.');
    const home = await ctx.db.get(session.homeWorldId);
    if (home && !home.deleted) return await moveTo(ctx, session, home, undefined);
    const fresh = (await ctx.db.get(await seedWorld(ctx, session.deviceId, DEFAULT_SEED)))!;
    return await moveTo(ctx, session, fresh, undefined);
  },
});

async function moveTo(ctx: MutationCtx, session: Doc<'sessions'>, world: Doc<'worlds'>, homeWorldId: Doc<'worlds'>['_id'] | undefined): Promise<MultiplayerResult> {
  const now = Date.now();
  await ctx.db.patch(session._id, { worldId: world._id, homeWorldId, focusAgentId: undefined, joinedAt: now, lastHeartbeatAt: now });
  const fresh = { ...world, lastHeartbeatAt: now };
  const loop = await ensureLoop(ctx, fresh, now);
  await ctx.db.patch(world._id, { lastHeartbeatAt: now, ...(loop ?? {}) });
  return { ok: true, worldId: world._id };
}
