import { OCCUPATIONS, tickToClock } from '../../shared/colony';
import type { WorldEventPublic } from '../../shared/types';
import { categoryColor, colors } from './theme';

/** "Sol 3 · 15:30" */
export function clock(tick: number): string {
  const c = tickToClock(tick);
  return 'Sol ' + c.sol + ' · ' + c.label.slice(-5);
}
export const timeOf = (tick: number) => tickToClock(tick).label.slice(-5);

export const occupationLabel = (id: string) => OCCUPATIONS.find((o) => o.id === id)?.label ?? 'Resident';
export const firstName = (name: string) => name.split(' ')[0] ?? name;

const BELIEF_EVENTS = new Set(['whisper', 'rumor_started', 'rumor_spread', 'suspicion']);

/** Amber is something the player did; blue (earthlight) is something someone only believes. */
export function eventTint(e: WorldEventPublic): string {
  if (BELIEF_EVENTS.has(e.eventType)) return colors.earth;
  if (e.category === 'intervention') return colors.amber;
  return categoryColor[e.category];
}

/** The player sees public news, plus their own interventions even when private (a whisper). */
export const visibleToPlayer = (e: WorldEventPublic) => e.visibility !== 'private' || e.category === 'intervention';
