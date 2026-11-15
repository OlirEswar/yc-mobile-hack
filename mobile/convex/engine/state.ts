/** The engine's own bookkeeping on the world document (world.sim) and whole-colony scans. */
import type { Doc } from '../_generated/dataModel';
import { adoptAgent, loadHousehold } from './core';
import type { AgentDoc, HouseholdDoc, Tx } from './core';

export type SimState = NonNullable<Doc<'worlds'>['sim']>;

/** Every agent of the world as working copies. About 100 reads: use for rare, colony-wide decisions. */
export async function allAgents(tx: Tx): Promise<AgentDoc[]> {
  const docs = await tx.ctx.db
    .query('agents')
    .withIndex('by_world_seq', (q) => q.eq('worldId', tx.world._id))
    .collect();
  return docs.map((d) => adoptAgent(tx, d));
}

/** Every household of the world as working copies. */
export async function allHouseholds(tx: Tx): Promise<HouseholdDoc[]> {
  const docs = await tx.ctx.db
    .query('households')
    .withIndex('by_world', (q) => q.eq('worldId', tx.world._id))
    .collect();
  const out: HouseholdDoc[] = [];
  for (const d of docs) out.push((await loadHousehold(tx, d._id))!);
  return out;
}

/** world.sim, created on first use with the sitting council read from the colony. */
export async function simState(tx: Tx): Promise<SimState> {
  if (tx.world.sim) return tx.world.sim;
  const council = (await allAgents(tx)).filter((a) => a.alive && a.occupation === 'councilor').map((a) => a._id);
  tx.world.sim = { seenEffects: [], petitions: [], lastCouncilTick: 0, council, cases: [], missing: { food: 0, water: 0, parts: 0 } };
  return tx.world.sim;
}
