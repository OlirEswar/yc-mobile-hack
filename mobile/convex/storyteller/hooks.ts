/**
 * Story hooks: reasons to switch the camera from the followed colonist to someone else (docs/
 * STORY_SPEC.md 5, "follow the thread"). A hook is a person who just shared a moment with the
 * followed colonist, or is with them now, and who is part of a live storyline.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { StoryHook } from '../../shared/types';
import { clip, involvedIn } from './storylines';
import type { StorylineDoc } from './storylines';

const MAX_HOOKS = 3;
/** How far back a shared moment still makes a hook (3 hours). */
const HOOK_WINDOW = 18;

export async function storyHooks(ctx: QueryCtx, world: Doc<'worlds'>, agent: Doc<'agents'>, live: StorylineDoc[]): Promise<StoryHook[]> {
  const moments = new Map<string, Doc<'events'> | undefined>();
  if (agent.interactingWithId) moments.set(agent.interactingWithId, undefined);
  const memories = await ctx.db
    .query('memories')
    .withIndex('by_agent_tick', (q) => q.eq('agentId', agent._id).gte('tick', world.tick - HOOK_WINDOW))
    .order('desc')
    .take(16);
  for (const m of memories) {
    const e = await ctx.db.get(m.eventId);
    if (!e || e.salience < 0.3) continue;
    for (const id of involvedIn(e)) if (id !== agent._id && !moments.get(id)) moments.set(id, e);
  }
  const hooks: StoryHook[] = [];
  for (const [id, e] of moments) {
    if (hooks.length >= MAX_HOOKS) break;
    const story = live.find((s) => s._id === e?.storylineId && s.participantIds.includes(id as Id<'agents'>)) ?? live.find((s) => s.participantIds.includes(id as Id<'agents'>));
    if (!story) continue;
    const other = await ctx.db.get(id as Id<'agents'>);
    if (!other?.alive) continue;
    const last = story.beats[story.beats.length - 1];
    const reason = e ? clip(e.summary, 90) : last ? clip(last.text, 90) : 'Caught up in ' + story.title;
    hooks.push({ agentId: other._id, name: other.name, reason, storylineId: story._id });
  }
  return hooks;
}
