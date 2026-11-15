/**
 * The daily LLM budget. Plan calls share world.config.llm.budgetPerDay, but part of it is held back
 * for the followed colonist (focusReserve) and for reactions to big events (crisisReserve) until
 * those lanes have used their share. Speech has its own small allowance, speechPerDay.
 */
import type { Doc } from '../_generated/dataModel';
import { dayOf } from '../engine/core';

type Llm = Doc<'worlds'>['llm'];
type LlmConfig = Doc<'worlds'>['config']['llm'];
export type Lane = 'focus' | 'crisis' | 'normal';

export const LANE_RANK: Record<string, number> = { focus: 0, crisis: 1, normal: 2 };

/** Resets the daily counters when the sim day changes. Returns true when it did. */
export function rollDay(llm: Llm, config: LlmConfig, tick: number): boolean {
  llm.budgetPerDay = config.budgetPerDay;
  const day = dayOf(tick);
  if (llm.day === day) return false;
  llm.day = day;
  llm.callsToday = 0;
  llm.focusUsed = 0;
  llm.crisisUsed = 0;
  llm.speechToday = 0;
  return true;
}

/** Whether a job of this kind and lane may start a call now. */
export function admits(llm: Llm, config: LlmConfig, kind: string, lane: string): boolean {
  if (kind === 'speech') return llm.speechToday < config.speechPerDay;
  const focusHeld = Math.max(0, config.focusReserve - llm.focusUsed);
  const crisisHeld = Math.max(0, config.crisisReserve - llm.crisisUsed);
  const held = lane === 'focus' ? 0 : lane === 'crisis' ? focusHeld : focusHeld + crisisHeld;
  return llm.callsToday + held < config.budgetPerDay;
}

/** Counts a started call against the budget. */
export function charge(llm: Llm, kind: string, lane: string): void {
  if (kind === 'speech') {
    llm.speechToday += 1;
    return;
  }
  llm.callsToday += 1;
  if (lane === 'focus') llm.focusUsed += 1;
  if (lane === 'crisis') llm.crisisUsed += 1;
}
