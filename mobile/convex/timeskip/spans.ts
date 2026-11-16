/**
 * The skips the player can take, how each is cut into chapters (one LLM decision and one macro
 * mutation per chapter), and how a moment inside a skip is named in the chronicle.
 */
import { TICKS_PER_DAY } from '../../shared/colony';
import type { TimeskipSpan } from '../../shared/types';

export const DAYS_PER_YEAR = 365;
export const TICKS_PER_YEAR = DAYS_PER_YEAR * TICKS_PER_DAY;

export type SpanDef = {
  days: number;
  chapters: number;
  /** How beats are grouped in the timeline. */
  period: 'sol' | 'week' | 'month' | 'year';
  label: string;
};

export const SPANS: Record<TimeskipSpan, SpanDef> = {
  week: { days: 7, chapters: 1, period: 'sol', label: 'a week' },
  month: { days: 30, chapters: 2, period: 'week', label: 'a month' },
  half_year: { days: 182, chapters: 6, period: 'month', label: 'six months' },
  year: { days: 365, chapters: 12, period: 'month', label: 'a year' },
  five_years: { days: 5 * 365, chapters: 20, period: 'year', label: 'five years' },
  decade: { days: 10 * 365, chapters: 40, period: 'year', label: 'ten years' },
};

export const SPAN_KEYS = Object.keys(SPANS) as TimeskipSpan[];
export const isSpan = (x: unknown): x is TimeskipSpan => typeof x === 'string' && x in SPANS;

/** "Year 2", "Month 5", "Week 3" or "Sol 12", counted from the start of the skip. */
export function periodOf(span: TimeskipSpan, startTick: number, tick: number): string {
  const days = Math.max(0, tick - startTick) / TICKS_PER_DAY;
  switch (SPANS[span].period) {
    case 'year':
      return 'Year ' + (Math.floor(days / DAYS_PER_YEAR) + 1);
    case 'month':
      return 'Month ' + (Math.floor(days / 30.4) + 1);
    case 'week':
      return 'Week ' + (Math.floor(days / 7) + 1);
    default:
      return 'Sol ' + (Math.floor(tick / TICKS_PER_DAY) + 1);
  }
}

/** "Year 2 of 5", "Month 3 of 6", "Day 4 of 7": where the skip has got to. */
export function progressOf(span: TimeskipSpan, startTick: number, tick: number): string {
  const def = SPANS[span];
  const days = Math.max(0, tick - startTick) / TICKS_PER_DAY;
  if (def.period === 'year') {
    const years = def.days / DAYS_PER_YEAR;
    return 'Year ' + Math.min(years, Math.floor(days / DAYS_PER_YEAR) + 1) + ' of ' + years;
  }
  if (def.period === 'month') {
    const months = Math.round(def.days / 30.4);
    return 'Month ' + Math.min(months, Math.floor(days / 30.4) + 1) + ' of ' + months;
  }
  if (def.period === 'week') return 'Week ' + Math.min(4, Math.floor(days / 7) + 1) + ' of 4';
  return 'Day ' + Math.min(def.days, Math.floor(days) + 1) + ' of ' + def.days;
}

/** The span in words for prose: "six months", "five years". */
export const spanWords = (span: TimeskipSpan): string => SPANS[span].label;
