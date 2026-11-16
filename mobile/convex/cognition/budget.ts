/**
 * The daily LLM budget. Plan and thought calls share world.config.llm.budgetPerDay, but part of it is
 * held back for the followed colonist (focusReserve), the people around them (orbitReserve) and
 * reactions to big events (crisisReserve) until those lanes have used their share. Speech has its own
 * small allowance, speechPerDay. Whatever the sim day, a world stops calling once its spend for the
 * real (UTC) day reaches the dollar cap (LLM_DAILY_USD_CAP, default DEFAULT_DAILY_USD_CAP).
 */
import type { Doc } from '../_generated/dataModel';
import { dayOf } from '../engine/core';
import { DEFAULT_DAILY_USD_CAP, LLM_PRICE } from '../lib/constants';

type Llm = Doc<'worlds'>['llm'];
type LlmConfig = Doc<'worlds'>['config']['llm'];
export type Lane = 'focus' | 'orbit' | 'crisis' | 'normal';

export const LANE_RANK: Record<string, number> = { focus: 0, orbit: 1, crisis: 2, normal: 3 };

/** Resets the daily counters when the sim day changes. Returns true when it did. */
export function rollDay(llm: Llm, config: LlmConfig, tick: number): boolean {
  llm.budgetPerDay = config.budgetPerDay;
  const day = dayOf(tick);
  if (llm.day === day) return false;
  llm.day = day;
  llm.callsToday = 0;
  llm.focusUsed = 0;
  llm.orbitUsed = 0;
  llm.crisisUsed = 0;
  llm.speechToday = 0;
  return true;
}

/** The world's dollar cap per real day. */
export function dailyCapUsd(): number {
  const raw = Number(process.env.LLM_DAILY_USD_CAP);
  return Number.isFinite(raw) && raw >= 0 && process.env.LLM_DAILY_USD_CAP !== '' && process.env.LLM_DAILY_USD_CAP !== undefined ? raw : DEFAULT_DAILY_USD_CAP;
}

const utcDay = (now: number): number => Math.floor(now / 86_400_000);

/** Today's spend so far, zero once the UTC day has turned. */
export const spentToday = (llm: Llm, now: number): number => (llm.spendDay === utcDay(now) ? (llm.spendUsd ?? 0) : 0);

/** Adds what a call cost, from its token usage. */
export function recordSpend(llm: Llm, tokensIn: number, tokensOut: number, now: number): void {
  const cost = tokensIn * LLM_PRICE.input + tokensOut * LLM_PRICE.output;
  llm.spendUsd = spentToday(llm, now) + cost;
  llm.spendDay = utcDay(now);
  llm.spendTotalUsd = (llm.spendTotalUsd ?? 0) + cost;
}

/** Whether a job of this kind and lane may start a call now. */
export function admits(llm: Llm, config: LlmConfig, kind: string, lane: string, now = Date.now()): boolean {
  if (spentToday(llm, now) >= dailyCapUsd()) return false;
  if (kind === 'speech') return llm.speechToday < config.speechPerDay;
  const focusHeld = Math.max(0, config.focusReserve - llm.focusUsed);
  const orbitHeld = Math.max(0, (config.orbitReserve ?? 0) - (llm.orbitUsed ?? 0));
  const crisisHeld = Math.max(0, config.crisisReserve - llm.crisisUsed);
  const held = lane === 'focus' ? 0 : lane === 'orbit' ? focusHeld : lane === 'crisis' ? focusHeld + orbitHeld : focusHeld + orbitHeld + crisisHeld;
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
  if (lane === 'orbit') llm.orbitUsed = (llm.orbitUsed ?? 0) + 1;
  if (lane === 'crisis') llm.crisisUsed += 1;
}
