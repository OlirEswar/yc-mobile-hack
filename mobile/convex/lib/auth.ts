import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export async function getSession(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<'sessions'> | null> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  return await ctx.db
    .query('sessions')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();
}

/** The session's world, or null when the token is wrong or does not own worldId. */
export async function authorizeWorld(
  ctx: QueryCtx | MutationCtx,
  token: string,
  worldId?: string,
): Promise<{ session: Doc<'sessions'>; world: Doc<'worlds'> } | null> {
  const session = await getSession(ctx, token);
  if (!session) return null;
  if (worldId !== undefined && worldId !== session.worldId) return null;
  const world = await ctx.db.get(session.worldId);
  if (!world || world.deleted) return null;
  return { session, world };
}

export function newToken(): string {
  let token = '';
  for (let i = 0; i < 4; i++) token += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return token;
}

export function asWorldId(ctx: QueryCtx | MutationCtx, id: string): Id<'worlds'> | null {
  return typeof id === 'string' ? ctx.db.normalizeId('worlds', id) : null;
}

export function asAgentId(ctx: QueryCtx | MutationCtx, id: unknown): Id<'agents'> | null {
  return typeof id === 'string' ? ctx.db.normalizeId('agents', id) : null;
}

export function asEventId(ctx: QueryCtx | MutationCtx, id: unknown): Id<'events'> | null {
  return typeof id === 'string' ? ctx.db.normalizeId('events', id) : null;
}
