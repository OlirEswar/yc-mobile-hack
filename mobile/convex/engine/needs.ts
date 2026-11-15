/**
 * Needs drift lazily: an agent's needs are brought up to date only when the engine looks at them,
 * from needsTick to now, at the rates of what the agent was doing meanwhile. Health follows needs.
 */
import { HEALTH_REGEN, NEED_RATES, STARVE_DAMAGE, THIRST_DAMAGE } from '../lib/constants';
import { clamp, rand } from '../lib/rng';
import type { AgentDoc, Tx } from './core';

/** Event moods that outlast the needs that would otherwise set the mood. */
const STICKY_MOODS = new Set(['grieving', 'sombre', 'angry', 'shaken', 'afraid', 'betrayed', 'proud', 'hopeful', 'suspicious', 'humiliated', 'grateful']);

/** Ticks spent at or above 100 while rising from start at rate for dt ticks. */
function ticksAtMax(start: number, rate: number, dt: number): number {
  if (rate <= 0) return start >= 100 ? dt : 0;
  return clamp(dt - (100 - start) / rate, 0, dt);
}

/** Brings needs and health up to tx.tick. */
export function applyNeeds(tx: Tx, a: AgentDoc): void {
  const dt = tx.tick - a.needsTick;
  if (dt <= 0 || !a.alive) return;
  const rates =
    a.activity === 'sleeping' ? NEED_RATES.asleep : a.activity === 'working' ? NEED_RATES.working : a.activity === 'resting' || a.activity === 'mourning' ? NEED_RATES.resting : NEED_RATES.awake;
  const n = a.needs;
  const starving = ticksAtMax(n.hunger, rates.hunger, dt);
  const parched = ticksAtMax(n.thirst, rates.thirst, dt);
  n.hunger = clamp(n.hunger + rates.hunger * dt, 0, 100);
  n.thirst = clamp(n.thirst + rates.thirst * dt, 0, 100);
  n.fatigue = clamp(n.fatigue + rates.fatigue * dt, 0, 100);
  n.social = clamp(n.social + rates.social * (0.4 + a.traits.sociability) * dt, 0, 100);
  n.safety = clamp(n.safety - 0.6 * dt, 0, 100);
  const damage = starving * STARVE_DAMAGE + parched * THIRST_DAMAGE;
  if (damage > 0) a.health = Math.max(0, a.health - damage);
  else if (n.hunger < 75 && n.thirst < 75) a.health = Math.min(100, a.health + HEALTH_REGEN * dt);
  a.needsTick = tx.tick;
  a.mood = moodFor(tx, a);
}

/** The cause of death when health has run out. */
export function deathCause(a: AgentDoc): string {
  if (a.needs.thirst >= 100) return 'dehydration';
  if (a.needs.hunger >= 100) return 'starvation';
  return 'their injuries';
}

function moodFor(tx: Tx, a: AgentDoc): string {
  const n = a.needs;
  if (a.health < 30) return 'ailing';
  if (n.thirst >= 88) return 'parched';
  if (n.hunger >= 88) return 'starving';
  if (STICKY_MOODS.has(a.mood) && rand(tx.world.seed, tx.tick, a.seq, 'mood') > 0.1) return a.mood;
  if (n.safety >= 60) return 'afraid';
  if (n.fatigue >= 85) return 'exhausted';
  if (n.thirst >= 70 || n.hunger >= 70) return 'anxious';
  if (n.social >= 85) return 'lonely';
  if (Math.max(n.hunger, n.thirst, n.fatigue, n.social) < 40) return 'content';
  return 'calm';
}
