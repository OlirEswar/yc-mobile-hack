import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { beginTx, commitTx } from './engine/core';
import { authorizeWorld } from './lib/auth';
import { RATE_LIMITS } from './lib/constants';
import { POWERS } from './powers';
import { fail, isFailure } from './powers/common';
import type { InterventionResult, PowerType } from '../shared/types';

/**
 * Applies a god power. Validated (bad input returns ok: false with a code, never throws) and
 * idempotent on commandId: a retry returns the stored result of the first success. The immediate
 * effect and its events are written in one Tx, so the whole power is one world version; the
 * simulation propagates the consequences on later ticks.
 *
 * Rate limits come from RATE_LIMITS and the session's recent powerTimes and createTimes. Only
 * successes are recorded and counted, so a rejected command can be fixed and retried.
 */
export const apply = mutation({
  args: { commandId: v.string(), worldId: v.string(), sessionToken: v.string(), type: v.string(), params: v.any() },
  handler: async (ctx, args): Promise<InterventionResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken, args.worldId);
    if (!auth) return fail('unauthorized', 'This session cannot act on that world.');
    const { session, world } = auth;
    const commandId = args.commandId.trim();
    if (commandId.length < 8 || commandId.length > 64) return fail('invalid', 'commandId must be 8 to 64 characters.');

    const previous = await ctx.db
      .query('interventions')
      .withIndex('by_world_command', (q) => q.eq('worldId', world._id).eq('commandId', commandId))
      .first();
    if (previous) return previous.result as InterventionResult;

    const type = args.type as PowerType;
    if (!Object.hasOwn(POWERS, type)) return fail('invalid', 'Unknown power.');
    const now = Date.now();
    const powerTimes = session.powerTimes.filter((t) => now - t < RATE_LIMITS.powerWindowMs);
    const createTimes = session.createTimes.filter((t) => now - t < RATE_LIMITS.createWindowMs);
    if (powerTimes.length >= RATE_LIMITS.powersPerWindow) return fail('rate_limited', 'Too many powers at once. Give the colony a moment.');
    if (type === 'create_character' && createTimes.length >= RATE_LIMITS.createsPerWindow) {
      return fail('rate_limited', 'Too many arrivals at once. The next shuttle is a minute away.');
    }

    if (type === 'kill' || type === 'whisper') {
      const raw = (args.params as { agentId?: unknown } | null)?.agentId;
      const targetId = typeof raw === 'string' ? ctx.db.normalizeId('agents', raw) : null;
      const target = targetId ? await ctx.db.get(targetId) : null;
      if (target?.ownerSessionId && target.ownerSessionId !== session._id) {
        return fail('unauthorized', target.name + ' is ' + (target.ownerName ?? 'another player') + "'s avatar. Only they can guide them.");
      }
    }

    const tx = beginTx(ctx, world);
    const outcome = await POWERS[type](tx, args.params);
    if (isFailure(outcome)) return outcome;
    await commitTx(tx);

    const interventionId = await ctx.db.insert('interventions', {
      worldId: world._id,
      commandId,
      type,
      params: args.params,
      result: null,
      tick: tx.tick,
      createdAt: now,
    });
    const result: InterventionResult = {
      ok: true,
      interventionId,
      worldVersion: tx.version,
      eventIds: tx.eventIds,
      affectedAgentIds: [...new Set(outcome.affectedAgentIds)],
      ...(outcome.createdAgentId ? { createdAgentId: outcome.createdAgentId } : {}),
    };
    await ctx.db.patch(interventionId, { result });
    await ctx.db.patch(session._id, {
      powerTimes: [...powerTimes, now],
      ...(type === 'create_character' ? { createTimes: [...createTimes, now] } : {}),
    });
    return result;
  },
});
