/**
 * A read-only summary of the pressure on a colonist's life, for the story director to advance
 * persona arcs and pick who to nudge: hunger and thirst, debts coming due, people who know their
 * secret or are blackmailing them, open feuds, a romance or an affair, a recent public accusation.
 * Never writes anything.
 */
import { TICKS_PER_DAY } from '../../shared/colony';
import { clamp } from '../lib/rng';
import { loadMind, tiesOf } from './core';
import type { AgentDoc, Tx } from './core';
import { beliefsOf } from './social';
import { simState } from './state';

export type Pressure = {
  /** 0 calm, 1 their life is coming apart. */
  score: number;
  /** Plain reasons, worst first, e.g. "owes Tobias Okafor 20 credits, overdue". */
  reasons: string[];
};

export async function pressure(tx: Tx, a: AgentDoc): Promise<Pressure> {
  const parts: { w: number; why: string }[] = [];
  const need = Math.max(a.needs.hunger, a.needs.thirst);
  if (need >= 70) parts.push({ w: (need - 60) / 40, why: a.needs.thirst >= a.needs.hunger ? 'desperately thirsty' : 'going hungry' });
  if (a.health < 50) parts.push({ w: (60 - a.health) / 60, why: 'hurt or ill' });
  const mind = await loadMind(tx, a);
  for (const d of mind?.ledger?.owes ?? []) {
    const late = d.dueTick < tx.tick;
    parts.push({ w: (late ? 0.35 : 0.1) + d.pressed * 0.15, why: 'owes ' + d.toName + ' ' + d.qty + ' ' + d.res + (late ? ', overdue' : '') });
  }
  const secret = mind?.persona?.secret;
  if (secret?.exposedAtTick !== undefined && tx.tick - secret.exposedAtTick < 2 * TICKS_PER_DAY) parts.push({ w: 0.6, why: 'their secret has just come out' });
  for (const b of await beliefsOf(tx, a._id)) {
    if (b.kind === 'blackmailer') parts.push({ w: 0.7, why: 'being blackmailed by ' + b.subjectName });
    else if (b.kind === 'knows_secret') parts.push({ w: 0.45, why: b.subjectName + ' may know their secret' });
    else if (b.kind === 'affair' && b.sourceType === 'observed') parts.push({ w: 0.5, why: 'betrayed by ' + b.subjectName });
  }
  const ties = await tiesOf(tx, a._id, 16);
  for (const t of ties) {
    if (!t.toAlive) continue;
    if (t.affinity <= -0.45) parts.push({ w: -t.affinity * 0.4, why: 'feuding with ' + t.toName });
    if (t.kind === 'romance') parts.push({ w: 0.15, why: 'in love with ' + t.toName });
    if (t.fear >= 0.4) parts.push({ w: t.fear * 0.5, why: 'afraid of ' + t.toName });
  }
  if (mind?.ledger?.deeds.affair) parts.push({ w: 0.35, why: 'hiding an affair' });
  const sim = await simState(tx);
  const accused = sim.accused?.[a._id];
  if (accused !== undefined && tx.tick - accused < TICKS_PER_DAY) parts.push({ w: 0.5, why: 'publicly accused' });
  if (sim.strike && (sim.strike.leaderId === a._id || a.factionId === 'union')) parts.push({ w: sim.strike.leaderId === a._id ? 0.5 : 0.2, why: sim.strike.leaderId === a._id ? 'leading a strike' : 'on strike' });
  parts.sort((x, y) => y.w - x.w);
  const score = clamp(parts.reduce((s, p, i) => s + p.w * Math.pow(0.6, i), 0), 0, 1);
  return { score: Math.round(score * 100) / 100, reasons: parts.map((p) => p.why) };
}
