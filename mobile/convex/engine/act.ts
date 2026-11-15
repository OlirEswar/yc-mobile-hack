/**
 * Small helpers every step implementation shares: what the actor is visibly doing, a line over
 * someone else's head, a seeded roll, argument parsing, and failing a step with a legible reason.
 */
import type { TradedResourceId } from '../../shared/colony';
import type { ActivityKind } from '../../shared/types';
import { clamp, rand } from '../lib/rng';
import { enqueueCognition, loadMind, touch, touchMind } from './core';
import type { AgentDoc, AgentId, Tx } from './core';
import { settleStrategy } from './ledger';

export const FAILED = -1;

export const RESOURCES = ['food', 'water', 'parts', 'medicine', 'credits'] as const;
export type Res = (typeof RESOURCES)[number];
export const isRes = (r: string | undefined): r is Res => (RESOURCES as readonly string[]).includes(r ?? '');
export const isTraded = (r: string | undefined): r is TradedResourceId => r === 'food' || r === 'water' || r === 'parts' || r === 'medicine';
export const SECURITY = new Set(['security', 'quartermaster']);

export const roll = (tx: Tx, a: AgentDoc, salt: string): number => rand(tx.world.seed, tx.tick, a.seq, salt);
export const int = (s: string | undefined, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};
export const units = (n: number, res: string): string => n + ' ' + res;

export function act(tx: Tx, a: AgentDoc, activity: ActivityKind, label: string, withId?: AgentId, speech?: string): void {
  a.activity = activity;
  a.activityLabel = label;
  a.interactingWithId = withId;
  a.speech = speech;
  touch(tx, a);
}

/** Shows a short line over someone else's head without changing what they are doing. */
export function say(tx: Tx, b: AgentDoc, withId: AgentId, speech: string): void {
  b.interactingWithId = withId;
  b.speech = speech;
  touch(tx, b);
}

/** Abandons the plan with a legible reason. The planner picks something else next tick. */
export async function fail(tx: Tx, a: AgentDoc, label: string): Promise<number> {
  a.q = [];
  a.failStreak += 1;
  act(tx, a, 'idle', label);
  const mind = await loadMind(tx, a);
  if (mind?.ledger?.pending) {
    settleStrategy(tx, mind, false);
    touchMind(tx, mind);
  }
  if (a.failStreak === 3) {
    await enqueueCognition(tx, a, { kind: 'plan', trigger: 'plans keep failing: ' + label, priority: 0.5, lane: 'normal' });
  }
  return FAILED;
}
