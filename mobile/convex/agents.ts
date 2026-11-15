import { v } from 'convex/values';
import { query } from './_generated/server';
import { asAgentId, asWorldId } from './lib/auth';
import { toAgentLite, toEventPublic, toGoalPublic } from './lib/public';
import type { LocationId, ResourceId } from '../shared/colony';
import type { AgentDetail, AgentLite, BeliefPublic, PlanPublic, RelationshipPublic, WorldEventPublic } from '../shared/types';

/** Every colonist, alive or dead. Call once on load, then keep current with sync:updates. */
export const list = query({
  args: { worldId: v.string() },
  handler: async (ctx, args): Promise<AgentLite[]> => {
    const worldId = asWorldId(ctx, args.worldId);
    if (!worldId) return [];
    const agents = await ctx.db
      .query('agents')
      .withIndex('by_world_seq', (q) => q.eq('worldId', worldId))
      .collect();
    return agents.map(toAgentLite);
  },
});

const GOAL_STATUS_ORDER: Record<string, number> = { active: 0, blocked: 1, satisfied: 2, abandoned: 3 };

/** Reactive detail for the inspector and the follow HUD. */
export const get = query({
  args: { worldId: v.string(), agentId: v.string() },
  handler: async (ctx, args): Promise<AgentDetail | null> => {
    const worldId = asWorldId(ctx, args.worldId);
    const agentId = asAgentId(ctx, args.agentId);
    if (!worldId || !agentId) return null;
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.worldId !== worldId) return null;
    const mind = agent.mindId ? await ctx.db.get(agent.mindId) : null;
    if (!mind) return null;
    const household = agent.householdId ? await ctx.db.get(agent.householdId) : null;
    const faction = agent.factionId
      ? (await ctx.db.query('factions').withIndex('by_world', (q) => q.eq('worldId', worldId)).collect()).find((f) => f.key === agent.factionId)
      : undefined;

    const beliefDocs = await ctx.db
      .query('beliefs')
      .withIndex('by_agent_key', (q) => q.eq('agentId', agentId))
      .collect();
    const beliefs: BeliefPublic[] = beliefDocs
      .sort((a, b) => b.confidence + b.lastReinforcedTick / 2000 - (a.confidence + a.lastReinforcedTick / 2000))
      .slice(0, 12)
      .map((b) => ({
        id: b._id,
        text: b.text,
        subjectAgentId: b.subjectAgentId,
        subjectAgentName: b.subjectName,
        confidence: Math.round(b.confidence * 100) / 100,
        sourceType: b.sourceType as BeliefPublic['sourceType'],
        sourceAgentName: b.sourceName,
        learnedAtTick: b.learnedAtTick,
      }));

    const relationshipDocs = await ctx.db
      .query('relationships')
      .withIndex('by_from_strength', (q) => q.eq('fromAgentId', agentId))
      .order('desc')
      .take(14);
    const relationships: RelationshipPublic[] = relationshipDocs.map((r) => ({
      toAgentId: r.toAgentId,
      toAgentName: r.toName,
      toAgentAlive: r.toAlive,
      kind: r.kind as RelationshipPublic['kind'],
      affinity: r.affinity,
      trust: r.trust,
      fear: r.fear,
    }));

    const memories = await ctx.db
      .query('memories')
      .withIndex('by_agent_tick', (q) => q.eq('agentId', agentId))
      .order('desc')
      .take(20);
    const recentEvents: WorldEventPublic[] = [];
    const seen = new Set<string>();
    for (const m of memories) {
      if (seen.has(m.eventId)) continue;
      seen.add(m.eventId);
      const event = await ctx.db.get(m.eventId);
      if (event) recentEvents.push(toEventPublic(event));
    }

    let plan: PlanPublic | undefined;
    if (mind.plan && agent.alive) {
      const total = mind.plan.steps.length;
      const cursor = Math.max(0, Math.min(total, total - agent.q.length - (agent.cur ? 1 : 0)));
      plan = {
        intent: mind.plan.intent,
        source: mind.plan.source as PlanPublic['source'],
        goalId: mind.plan.goalId,
        steps: mind.plan.labels.map((label, i) => ({ label, status: i < cursor ? 'done' : i === cursor && agent.cur ? 'running' : 'pending' })),
        cursor,
      };
    }

    const inventory: Partial<Record<ResourceId, number>> = {};
    for (const [res, amount] of Object.entries(agent.inv)) if (amount > 0) inventory[res as ResourceId] = amount;

    return {
      ...toAgentLite(agent),
      ageBand: mind.ageBand as AgentDetail['ageBand'],
      background: mind.background,
      homeLocationId: agent.homeLocationId as LocationId,
      workLocationId: agent.workLocationId as LocationId | undefined,
      householdName: household?.name,
      householdMemberIds: household ? household.memberIds.filter((id) => id !== agent._id) : [],
      factionName: faction?.name,
      traits: agent.traits,
      values: mind.values,
      skills: mind.skills,
      inventory,
      goals: mind.goals
        .slice()
        .sort((a, b) => (GOAL_STATUS_ORDER[a.status] ?? 9) - (GOAL_STATUS_ORDER[b.status] ?? 9) || b.priority - a.priority)
        .map(toGoalPublic),
      plan,
      beliefs,
      relationships,
      recentEvents,
      lastThought: mind.lastThought
        ? { tick: mind.lastThought.tick, trigger: mind.lastThought.trigger, intent: mind.lastThought.intent, source: mind.lastThought.source as 'llm' | 'rules' }
        : undefined,
      death: mind.death,
      persona: mind.persona,
    };
  },
});
