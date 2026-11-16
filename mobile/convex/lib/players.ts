/** Who owns which colonist, and who is playing in which world. */
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const MAX_PLAYERS = 8;

/** The session's avatar in a world: the living one if any, else the newest. */
export async function avatarIn(ctx: QueryCtx | MutationCtx, sessionId: Id<'sessions'>, worldId: Id<'worlds'>): Promise<Doc<'agents'> | null> {
  const owned = await ctx.db
    .query('agents')
    .withIndex('by_owner', (q) => q.eq('ownerSessionId', sessionId))
    .collect();
  const here = owned.filter((a) => a.worldId === worldId);
  return here.find((a) => a.alive) ?? here.sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
}

/** The sessions currently in a world, host first, then by join time. */
export async function playersIn(ctx: QueryCtx | MutationCtx, world: Doc<'worlds'>): Promise<Doc<'sessions'>[]> {
  const sessions = await ctx.db
    .query('sessions')
    .withIndex('by_world', (q) => q.eq('worldId', world._id))
    .take(MAX_PLAYERS * 4);
  const isHost = (s: Doc<'sessions'>) => s.deviceId === world.deviceId;
  return sessions.sort((a, b) => Number(isHost(b)) - Number(isHost(a)) || (a.joinedAt ?? a.createdAt) - (b.joinedAt ?? b.createdAt));
}

/** The name other players see: the chosen display name, else the avatar's name, else a placeholder. */
export async function playerName(ctx: QueryCtx | MutationCtx, session: Doc<'sessions'>): Promise<string> {
  if (session.playerName) return session.playerName;
  const persona = await ctx.db
    .query('personas')
    .withIndex('by_session', (q) => q.eq('sessionId', session._id))
    .first();
  return persona?.profile?.name.split(' ')[0] ?? 'Player';
}
