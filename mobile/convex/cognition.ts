import { v } from 'convex/values';
import { internalAction } from './_generated/server';

/**
 * Works through the queued cognition jobs of a world. Scheduled by enqueueCognition in
 * engine/core.ts. Filled in by the LLM cognition layer.
 */
export const drain = internalAction({
  args: { worldId: v.id('worlds') },
  handler: async () => {},
});
