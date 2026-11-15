/**
 * The story director (docs/STORY_SPEC.md 4 and 5). Runs once per tick after the agents step, inside
 * the tick's Tx. Owned by the story/focus owner; the engine only calls directorTick.
 */
import type { Tx } from '../engine/core';

/** Attaches this tick's events (tx.eventIds since firstEvent) to storylines and nudges the story. */
export async function directorTick(_tx: Tx, _firstEvent: number): Promise<void> {}
