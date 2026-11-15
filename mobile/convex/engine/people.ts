/**
 * Finding the other party of an interaction and reading what they think: someone present to beg
 * from or court, how far one colonist listens to another, and the hidden social status (owned by
 * the society layer, read only here) that makes some voices carry further.
 */
import { agentsAt, loadAgent, loadMind } from './core';
import type { AgentDoc, AgentId, MindDoc, RelationshipDoc, Tx } from './core';
import { presentWith, tie } from './social';

/** Social status as 0..1 (minds.society.status is 0..100). Strangers to the society layer count as middling. */
export const statusOf = (mind: MindDoc | null): number => (mind?.society?.status ?? 40) / 100;

/** The named person if present, or for "any" (or no id) the best match present by score. */
export async function partyFor(tx: Tx, a: AgentDoc, who: string | undefined, score: (b: AgentDoc, r: RelationshipDoc | null) => number = () => 0): Promise<AgentDoc | null> {
  if (who && who !== 'any') return presentWith(tx, a, who);
  let best: AgentDoc | null = null;
  let bestScore = -Infinity;
  for (const id of (await agentsAt(tx, a.locationId, { exclude: [a._id] })).slice(0, 10)) {
    const b = await presentWith(tx, a, id);
    if (!b) continue;
    const s = score(b, await tie(tx, a._id, b._id));
    if (s > bestScore) {
      best = b;
      bestScore = s;
    }
  }
  return best;
}

/**
 * How much listener takes in what speaker says, 0..1: trust in them, and the weight their status
 * carries over the listener's own.
 */
export async function sway(tx: Tx, speaker: AgentDoc, listener: AgentDoc): Promise<number> {
  const r = await tie(tx, listener._id, speaker._id);
  const [sm, lm] = [await loadMind(tx, speaker), await loadMind(tx, listener)];
  const persuasion = (sm?.skills.persuasion ?? 40) / 100;
  const status = statusOf(sm) - statusOf(lm);
  return Math.max(0, Math.min(1, 0.35 + (r?.trust ?? 0) * 0.3 + (r?.affinity ?? 0) * 0.1 + persuasion * 0.2 + status * 0.25 - listener.traits.caution * 0.15));
}

/** Loads an agent by any id string, alive or not. */
export async function agentById(tx: Tx, id: string | undefined): Promise<AgentDoc | null> {
  const normalized = id ? tx.ctx.db.normalizeId('agents', id) : null;
  return normalized ? await loadAgent(tx, normalized as AgentId) : null;
}
