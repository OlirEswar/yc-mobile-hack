/**
 * The engine's per-colonist bookkeeping on the mind (minds.ledger): debts, a hidden stash, the
 * strategies someone tried and whether they worked, hidden deeds an investigation can uncover, and
 * favours others have bought from them. Created on first use, so older worlds need no migration.
 */
import { round2 } from '../lib/rng';
import type { AgentDoc, AgentId, EventId, MindDoc, Tx } from './core';

export type Ledger = NonNullable<MindDoc['ledger']>;
export type Debt = Ledger['owes'][number];

const TRIED_KEPT = 10;

export function ledgerOf(mind: MindDoc): Ledger {
  mind.ledger ??= { owes: [], stash: { food: 0, water: 0, parts: 0, medicine: 0, credits: 0 }, tried: [], deeds: {}, favors: [] };
  return mind.ledger;
}

/** Records that someone did something an investigation could later uncover. */
export function addDeed(mind: MindDoc, kind: string): void {
  const deeds = ledgerOf(mind).deeds;
  deeds[kind] = (deeds[kind] ?? 0) + 1;
}

export const deedCount = (mind: MindDoc | null, kind: string): number => mind?.ledger?.deeds[kind] ?? 0;

/** Remembers which way of meeting a need the current plan follows. */
export function startStrategy(tx: Tx, mind: MindDoc, strategy: string, res: string): void {
  ledgerOf(mind).pending = { s: strategy, res, tick: tx.tick };
}

/** Settles the pending strategy as a success or a failure; planners learn from the record. */
export function settleStrategy(tx: Tx, mind: MindDoc, ok: boolean): void {
  const ledger = ledgerOf(mind);
  if (!ledger.pending) return;
  ledger.tried = [...ledger.tried, { s: ledger.pending.s, ok, tick: tx.tick }].slice(-TRIED_KEPT);
  ledger.pending = undefined;
}

/** How recent outcomes colour a strategy: each success nudges it up, each failure (and getting caught) down. */
export function strategyMemory(mind: MindDoc, strategy: string, tick: number): number {
  let shift = 0;
  for (const t of mind.ledger?.tried ?? []) {
    if (t.s !== strategy) continue;
    const fresh = tick - t.tick < 288 ? 1 : 0.5;
    shift += (t.ok ? 0.1 : -0.22) * fresh;
  }
  // What worked before helps, but never so much that someone stops trying anything else.
  return Math.max(-0.5, Math.min(0.2, shift));
}

export function addDebt(tx: Tx, mind: MindDoc, lender: AgentDoc, res: string, qty: number, eventId: EventId): Debt {
  const ledger = ledgerOf(mind);
  const existing = ledger.owes.find((d) => d.to === lender._id && d.res === res);
  if (existing) {
    existing.qty = round2(existing.qty + qty);
    existing.dueTick = tx.tick + 288;
    existing.eventId = eventId;
    return existing;
  }
  const debt: Debt = { to: lender._id, toName: lender.name, res, qty, tick: tx.tick, dueTick: tx.tick + 288, pressed: 0, eventId };
  ledger.owes.push(debt);
  return debt;
}

export const debtsTo = (mind: MindDoc | null, lender: AgentId): Debt[] => (mind?.ledger?.owes ?? []).filter((d) => d.to === lender);

export function grantFavor(tx: Tx, mind: MindDoc, forId: AgentId, kind: string, ticks: number): void {
  const ledger = ledgerOf(mind);
  ledger.favors = [...ledger.favors.filter((f) => f.until > tx.tick && !(f.forId === forId && f.kind === kind)), { forId, kind, until: tx.tick + ticks }];
}

/** Whether this colonist has been paid (or pressed) to do this favour for that person. */
export const owesFavor = (mind: MindDoc | null, forId: string, kind: string, tick: number): boolean =>
  !!mind?.ledger?.favors.some((f) => f.forId === forId && f.kind === kind && f.until > tick);

/** Holds off a move (keyed by kind and target) for a while. Expired keys are dropped as new ones arrive. */
export function cool(tx: Tx, mind: MindDoc, key: string, ticks: number): void {
  const ledger = ledgerOf(mind);
  const live = Object.entries(ledger.cooldowns ?? {}).filter(([, until]) => until > tx.tick);
  ledger.cooldowns = Object.fromEntries([...live, [key, tx.tick + ticks]]);
}

export const cooling = (mind: MindDoc, key: string, tick: number): boolean => (mind.ledger?.cooldowns?.[key] ?? 0) > tick;

export const stashTotal = (mind: MindDoc | null): number => {
  const s = mind?.ledger?.stash;
  return s ? s.food + s.water + s.parts + s.medicine + s.credits : 0;
};
