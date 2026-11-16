import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { asAgentId, asWorldId } from './lib/auth';
import { toStorylinePublic } from './lib/public';
import { INTRO_CARD_KEYS, INTRO_HISTORY, INTRO_SETTING, INTRO_TENSIONS, INTRO_TITLE, TUTORIAL } from './seed/worldBible';
import type { KeyCharacterCard, StoryIntro, StorylinePublic, TutorialStep } from '../shared/types';
import type { SpriteId } from '../shared/colony';

/** Storylines still in play. */
export const LIVE_STATUSES = ['climax', 'rising', 'brewing'] as const;
/** How long a resolved storyline stays on the list: two sim days. */
const RESOLVED_SHOWN_TICKS = 288;

export async function liveStorylines(ctx: QueryCtx, worldId: Id<'worlds'>): Promise<Doc<'storylines'>[]> {
  const out: Doc<'storylines'>[] = [];
  for (const status of LIVE_STATUSES) {
    out.push(...(await ctx.db.query('storylines').withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', status)).collect()));
  }
  return out;
}

/** The introduction for this world: setting, history, key characters, starter and tutorial. */
export const intro = query({
  args: { worldId: v.string() },
  handler: async (ctx, args): Promise<StoryIntro | null> => {
    const worldId = asWorldId(ctx, args.worldId);
    const world = worldId ? await ctx.db.get(worldId) : null;
    if (!world || world.deleted || !world.keyAgents || !world.starterAgentId) return null;
    const keyAgents = world.keyAgents;
    const keyCharacters: KeyCharacterCard[] = [];
    for (const key of INTRO_CARD_KEYS) {
      const agent = keyAgents[key] ? await ctx.db.get(keyAgents[key]) : null;
      const persona = agent?.mindId ? (await ctx.db.get(agent.mindId))?.persona : undefined;
      if (!agent || !persona) continue;
      keyCharacters.push({ agentId: agent._id, name: agent.name, spriteId: agent.spriteId as SpriteId, epithet: persona.epithet, hook: persona.hook ?? persona.want, factionId: agent.factionId });
    }
    const tutorial: TutorialStep[] = TUTORIAL.map(({ agentKey, ...step }) => (agentKey && keyAgents[agentKey] ? { ...step, agentId: keyAgents[agentKey] } : step));
    return {
      title: INTRO_TITLE,
      setting: INTRO_SETTING,
      history: INTRO_HISTORY,
      tensions: INTRO_TENSIONS,
      keyCharacters,
      starterAgentId: world.starterAgentId,
      tutorial,
    };
  },
});

/** Reactive. Live and recently resolved storylines, highest tension first. With agentId, only theirs. */
export const storylines = query({
  args: { worldId: v.string(), agentId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<StorylinePublic[]> => {
    const worldId = asWorldId(ctx, args.worldId);
    const world = worldId ? await ctx.db.get(worldId) : null;
    if (!worldId || !world || world.deleted) return [];
    const agentId = args.agentId === undefined ? null : asAgentId(ctx, args.agentId);
    if (args.agentId !== undefined && !agentId) return [];
    const resolved = await ctx.db
      .query('storylines')
      .withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', 'resolved'))
      .order('desc')
      .take(10);
    return [...(await liveStorylines(ctx, worldId)), ...resolved.filter((s) => (s.resolvedTick ?? s.lastBeatTick) >= world.tick - RESOLVED_SHOWN_TICKS)]
      .filter((s) => !agentId || s.participantIds.includes(agentId))
      .sort((a, b) => b.tension - a.tension)
      .map(toStorylinePublic);
  },
});
