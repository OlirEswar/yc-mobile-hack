import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/** Deletes a retired world in bounded chunks, rescheduling itself until nothing is left. */
export const purgeWorld = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    let budget = 900;
    const again = async () => {
      await ctx.scheduler.runAfter(200, internal.admin.purgeWorld, { worldId });
    };
    const drain = async (docs: { _id: any }[]) => {
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
        budget -= 1;
      }
    };

    await drain(await ctx.db.query('events').withIndex('by_world_version', (q) => q.eq('worldId', worldId)).take(budget));
    if (budget <= 0) return again();
    await drain(await ctx.db.query('cognitionJobs').withIndex('by_world_status', (q) => q.eq('worldId', worldId)).take(budget));
    if (budget <= 0) return again();
    await drain(await ctx.db.query('interventions').withIndex('by_world_command', (q) => q.eq('worldId', worldId)).take(budget));
    if (budget <= 0) return again();
    await drain(await ctx.db.query('beliefs').withIndex('by_world_key', (q) => q.eq('worldId', worldId)).take(budget));
    if (budget <= 0) return again();

    const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId)).take(12);
    for (const agent of agents) {
      await drain(await ctx.db.query('memories').withIndex('by_agent_tick', (q) => q.eq('agentId', agent._id)).take(budget));
      if (budget <= 0) return again();
      await drain(await ctx.db.query('relationships').withIndex('by_from_to', (q) => q.eq('fromAgentId', agent._id)).take(budget));
      if (budget <= 0) return again();
      if (agent.mindId) await ctx.db.delete(agent.mindId);
      await ctx.db.delete(agent._id);
      budget -= 2;
    }
    if (agents.length > 0) return again();

    await drain(await ctx.db.query('households').withIndex('by_world', (q) => q.eq('worldId', worldId)).take(200));
    await drain(await ctx.db.query('factions').withIndex('by_world', (q) => q.eq('worldId', worldId)).take(20));
    await drain(await ctx.db.query('worldIndex').withIndex('by_world', (q) => q.eq('worldId', worldId)).take(5));
    const world = await ctx.db.get(worldId);
    if (world) await ctx.db.delete(worldId);
  },
});
