/**
 * Lifecycle of the tick loop. One self-rescheduling mutation chain runs per world, identified by
 * world.loop.token: starting a new chain bumps the token, so an older chain stops at its next wake.
 */
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { TICK_MS_AT_1X } from '../../shared/colony';
import { FOCUS_WARP, HEARTBEAT_FRESH_MS, WARP_MAX_TICKS } from '../lib/constants';

/** Ticks per invocation and the gap between invocations, so nothing is scheduled faster than about once a second. */
export function cadence(speed: number): { ticks: number; intervalMs: number } {
  if (speed <= 0) return { ticks: 0, intervalMs: TICK_MS_AT_1X };
  const tickMs = TICK_MS_AT_1X / speed;
  const ticks = Math.max(1, Math.ceil(1000 / tickMs));
  return { ticks, intervalMs: Math.round(tickMs * ticks) };
}

/**
 * Cadence while the world fast-forwards through the followed colonist's routine (world.focusWarp):
 * FOCUS_WARP times the speed, at most WARP_MAX_TICKS per invocation so a mutation stays small.
 */
export function warpCadence(speed: number): { ticks: number; intervalMs: number } {
  const fast = cadence(Math.max(1, speed) * FOCUS_WARP);
  if (fast.ticks <= WARP_MAX_TICKS) return fast;
  return { ticks: WARP_MAX_TICKS, intervalMs: Math.round((fast.intervalMs / fast.ticks) * WARP_MAX_TICKS) };
}

export function shouldRun(world: Doc<'worlds'>, now: number): boolean {
  return !world.deleted && !world.timeskip && world.speed > 0 && now - world.lastHeartbeatAt < HEARTBEAT_FRESH_MS;
}

/**
 * Starts the loop if the world should be ticking and no live chain exists. Returns the fields to
 * patch on the world, or null when nothing changes. The caller writes them with its own changes.
 */
export async function ensureLoop(
  ctx: MutationCtx,
  world: Doc<'worlds'>,
  now: number,
  options: { restart?: boolean } = {},
): Promise<Pick<Doc<'worlds'>, 'loop' | 'status'> | null> {
  if (!shouldRun(world, now)) {
    if (world.loop.running || world.status !== 'paused') return { loop: { ...world.loop, running: false }, status: 'paused' };
    return null;
  }
  // A chain is live if its next wake is not long overdue.
  const live = world.loop.running && world.loop.nextAt > now - 10_000;
  if (live && !options.restart) return world.status === 'running' ? null : { loop: world.loop, status: 'running' };
  const token = world.loop.token + 1;
  const { intervalMs } = cadence(world.speed);
  const delay = options.restart ? Math.min(intervalMs, 400) : Math.min(intervalMs, 1000);
  await ctx.scheduler.runAfter(delay, internal.sim.tick, { worldId: world._id, token });
  return { loop: { token, running: true, nextAt: now + delay }, status: 'running' };
}
