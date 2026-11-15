/**
 * Shared pieces of the god powers: the Power shape every power implements, parameter checks that
 * turn bad input into an InterventionResult failure instead of a thrown error, and the helpers
 * more than one power needs.
 *
 * A power runs in two phases inside one mutation. parse reads the world and checks every parameter
 * without writing anything, so a rejected command leaves no trace. apply then writes the immediate
 * effect and its events through the Tx. The simulation plays out everything after that.
 */
import { LOCATION_IDS } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import type { InterventionResult } from '../../shared/types';
import { loadAgent } from '../engine/core';
import type { AgentDoc, AgentId, EventId, Tx } from '../engine/core';
import { round2 } from '../lib/rng';

export type PowerFailure = Extract<InterventionResult, { ok: false }>;

/** What a power reports back, beyond the event ids the Tx collected. */
export type PowerOutcome = { affectedAgentIds: AgentId[]; createdAgentId?: AgentId };

export type Power<P> = {
  /** Checks the raw params against the world. Reads only; returns the parsed params or a failure. */
  parse: (tx: Tx, raw: unknown) => Promise<P | PowerFailure>;
  /** Writes the immediate effect and its events. Runs only after parse succeeded. */
  apply: (tx: Tx, params: P) => Promise<PowerOutcome>;
};

export const fail = (code: PowerFailure['code'], message: string): PowerFailure => ({ ok: false, code, message });

export function isFailure(x: unknown): x is PowerFailure {
  return typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false;
}

/** The params object of a command, or a failure when it is not an object. */
export function record(raw: unknown): Record<string, unknown> | PowerFailure {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : fail('invalid', 'Missing parameters.');
}

/** A finite number within [lo, hi]. */
export function numberIn(x: unknown, lo: number, hi: number, label: string): number | PowerFailure {
  return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : fail('invalid', label + ' must be a number from ' + lo + ' to ' + hi + '.');
}

/** A severity: more than 0, at most 1. */
export function severityOf(x: unknown): number | PowerFailure {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1 ? round2(Math.max(0.01, x)) : fail('invalid', 'Severity must be above 0 and at most 1.');
}

/** Trimmed text of at most max characters (min 0 allows empty). */
export function textOf(x: unknown, min: number, max: number, label: string): string | PowerFailure {
  if (x === undefined && min === 0) return '';
  if (typeof x !== 'string') return fail('invalid', label + ' must be text.');
  const text = x.trim().replace(/\s+/g, ' ');
  if (text.length < min || text.length > max) return fail('invalid', label + ' must be ' + min + ' to ' + max + ' characters.');
  return text;
}

export function oneOf<T extends string>(x: unknown, options: readonly T[], label: string): T | PowerFailure {
  return typeof x === 'string' && (options as readonly string[]).includes(x) ? (x as T) : fail('invalid', 'Unknown ' + label + '.');
}

export const locationOf = (x: unknown): LocationId | PowerFailure => oneOf(x, LOCATION_IDS, 'location');

/**
 * The working copy of an agent of this world named by a client id. Fails with not_found for a bad
 * or foreign id and, unless allowDead, with dead_target for the dead.
 */
export async function agentOf(tx: Tx, raw: unknown, options: { allowDead?: boolean } = {}): Promise<AgentDoc | PowerFailure> {
  const id = typeof raw === 'string' ? tx.ctx.db.normalizeId('agents', raw) : null;
  const agent = id ? await loadAgent(tx, id) : null;
  if (!agent) return fail('not_found', 'That colonist does not exist.');
  if (!agent.alive && !options.allowDead) return fail('dead_target', agent.name + ' is already dead.');
  return agent;
}

/** Where an agent physically is now: the start of a walk still under way, else their location. */
export const standingAt = (tx: Tx, a: AgentDoc): string => (a.move && tx.tick < a.move.arriveTick ? a.move.from : a.locationId);

/** Substitutes a subject's name for {name} in preset or player text. */
export const withName = (text: string, name: string | undefined): string => (name ? text.split('{name}').join(name) : text);

/** The drought or storm currently running, if any. */
export const currentEffect = (tx: Tx, type: 'drought' | 'storm') => tx.world.activeEffects.find((e) => e.type === type && e.endTick > tx.tick);

/**
 * Starts a standing condition, or strengthens the one already running: a second drought or storm
 * keeps the original start, takes the harsher severity and the later end, and covers both sets of
 * locations. Records the event as the condition's cause so the simulation can cite it.
 */
export function upsertEffect(
  tx: Tx,
  effect: { type: 'drought' | 'storm'; locationIds: string[]; severity: number; endTick: number; label: string; eventId: EventId },
): void {
  const existing = currentEffect(tx, effect.type);
  if (existing) {
    existing.severity = round2(Math.max(existing.severity, effect.severity));
    existing.endTick = Math.max(existing.endTick, effect.endTick);
    existing.locationIds = [...new Set([...existing.locationIds, ...effect.locationIds])];
    existing.label = effect.label;
    existing.eventId = effect.eventId;
  } else {
    tx.world.activeEffects.push({
      id: effect.type + '-' + tx.version,
      type: effect.type,
      locationIds: effect.locationIds,
      severity: effect.severity,
      startTick: tx.tick,
      endTick: effect.endTick,
      label: effect.label,
      eventId: effect.eventId,
    });
  }
  tx.world.causes[effect.type] = effect.eventId;
}
