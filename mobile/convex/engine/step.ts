/**
 * Advancing the world: each tick runs the colony systems, then steps every agent whose current
 * activity has ended (by the by_world_due index), up to a per-tick cap so one mutation stays small.
 * Used by the tick loop (sim:tick) and by world:skipToNotable.
 */
import { AGENT_STEPS_PER_TICK, LEVY_FREE, LEVY_RATE } from '../lib/constants';
import { round2 } from '../lib/rng';
import { locName, scarcityCause } from './conditions';
import { adoptAgent, dayOf, enqueueCognition, killAgent, loadMind, touch } from './core';
import type { AgentDoc, EventId, Tx } from './core';
import { FAILED, addressesNeed, finishStep, startStep } from './executor';
import { applyNeeds, deathCause } from './needs';
import { planFor } from './planner';
import { runSystems } from './systems';

export type AdvanceOptions = {
  /** Stop after the tick in which the total agent steps reach this. */
  stepBudget?: number;
  /** Stop after the tick in which this returns an event id, given the events emitted that tick. */
  stopAt?: (tx: Tx, eventIds: EventId[]) => Promise<EventId | undefined>;
};

export type AdvanceResult = { ticks: number; steps: number; stoppedAt?: EventId };

/** Advances the world by up to `ticks` ticks inside the caller's transaction. */
export async function advance(tx: Tx, ticks: number, options: AdvanceOptions = {}): Promise<AdvanceResult> {
  const horizon = tx.tick + ticks;
  const due = await tx.ctx.db
    .query('agents')
    .withIndex('by_world_due', (q) => q.eq('worldId', tx.world._id).lte('dueTick', horizon))
    .collect();
  for (const doc of due) adoptAgent(tx, doc);
  let steps = 0;
  for (let i = 0; i < ticks; i++) {
    tx.tick += 1;
    tx.world.tick = tx.tick;
    const firstEvent = tx.eventIds.length;
    await runSystems(tx);
    const ready = [...tx.agents.values()]
      .filter((a) => a.alive && a.busyUntilTick <= tx.tick)
      .sort((x, y) => x.busyUntilTick - y.busyUntilTick || x.seq - y.seq)
      .slice(0, AGENT_STEPS_PER_TICK);
    for (const a of ready) await stepAgent(tx, a);
    steps += ready.length;
    const stoppedAt = options.stopAt ? await options.stopAt(tx, tx.eventIds.slice(firstEvent)) : undefined;
    if (stoppedAt) return { ticks: i + 1, steps, stoppedAt };
    if (options.stepBudget !== undefined && steps >= options.stepBudget) return { ticks: i + 1, steps };
  }
  return { ticks, steps };
}

/** Ends the agent's finished step, then starts their next one, planning when the queue is empty. */
async function stepAgent(tx: Tx, a: AgentDoc): Promise<void> {
  applyNeeds(tx, a);
  if (a.health <= 0) {
    const cause = deathCause(a);
    await killAgent(tx, a, {
      cause,
      summary: a.name + ' died of ' + (cause === 'dehydration' ? 'thirst' : cause === 'starvation' ? 'hunger' : cause) + ' at ' + locName(a.locationId) + '.',
      causationEventId: scarcityCause(tx.world, cause === 'starvation' ? 'food' : 'water'),
    });
    return;
  }
  if (a.move && tx.tick >= a.move.arriveTick) a.move = undefined;
  if (a.cur) {
    const cur = a.cur;
    a.cur = undefined;
    await finishStep(tx, a, cur, a.curStartTick ?? tx.tick);
    a.curStartTick = undefined;
    a.failStreak = 0;
  }
  if (a.lastLevyDay < dayOf(tx.tick)) levy(tx, a);
  await checkCrisis(tx, a);
  for (let i = 0; i < 4 && a.alive; i++) {
    if (a.q.length === 0) await planFor(tx, a);
    const next = a.q.shift();
    if (!next) break;
    const ticks = await startStep(tx, a, next, await planLabel(tx, a, next));
    if (ticks > 0) {
      a.cur = next;
      a.curStartTick = tx.tick;
      a.busyUntilTick = tx.tick + ticks;
      touch(tx, a);
      return;
    }
    if (ticks === FAILED) break;
  }
  a.busyUntilTick = tx.tick + 1;
  touch(tx, a);
}

/** The label the plan gave this step, when the step is the plan's next one. */
async function planLabel(tx: Tx, a: AgentDoc, step: string): Promise<string | undefined> {
  const plan = (await loadMind(tx, a))?.plan;
  if (!plan) return undefined;
  const index = plan.steps.length - a.q.length - 1;
  return plan.steps[index] === step ? plan.labels[index] : undefined;
}

/** Dropping a plan that ignores a desperate thirst or hunger, and asking the LLM to think about it. */
async function checkCrisis(tx: Tx, a: AgentDoc): Promise<void> {
  for (const res of ['water', 'food'] as const) {
    const need = res === 'water' ? a.needs.thirst : a.needs.hunger;
    if (need < 80 || a.q.length === 0 || addressesNeed(a.q, res)) continue;
    a.q = [];
    if (need >= 88) {
      await enqueueCognition(tx, a, { kind: 'plan', trigger: res === 'water' ? 'desperately thirsty' : 'starving', priority: 0.8, lane: 'crisis', eventId: scarcityCause(tx.world, res) });
    }
    return;
  }
}

/** A small daily levy on savings above a threshold keeps the treasury able to pay wages. */
function levy(tx: Tx, a: AgentDoc): void {
  a.lastLevyDay = dayOf(tx.tick);
  if (a.inv.credits <= LEVY_FREE) return;
  const due = round2((a.inv.credits - LEVY_FREE) * LEVY_RATE);
  a.inv.credits = round2(a.inv.credits - due);
  tx.world.econ.treasury = round2(tx.world.econ.treasury + due);
}
