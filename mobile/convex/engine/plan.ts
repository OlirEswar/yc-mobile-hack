/**
 * What the planner modules share: the decision context read once per plan, a scored candidate plan
 * (Choice), a step-list builder that tracks where the agent will be, and small lookups.
 */
import { rand } from '../lib/rng';
import { locName, stormAt } from './conditions';
import { encodeStep, loadAgent } from './core';
import type { AgentDoc, BeliefDoc, CognitionRequest, EventId, FactionDoc, HouseholdDoc, MindDoc, RelationshipDoc, StepType, Tx } from './core';

export type Goal = MindDoc['goals'][number];

/** Ways to meet a need, as named in persona.strategies (docs/STORY_SPEC.md 3.1). */
export const STRATEGIES = ['work', 'grow', 'trade', 'charm', 'borrow', 'beg', 'scavenge', 'smuggle', 'steal', 'scheme'] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Everything the planner looks at, read once per decision. */
export type Ctx = {
  tx: Tx;
  a: AgentDoc;
  mind: MindDoc;
  p: number;
  day: number;
  beliefs: BeliefDoc[];
  ties: RelationshipDoc[];
  household: HouseholdDoc | null;
  factions: FactionDoc[];
  drought: number;
  /** In the personal work shift. */
  shift: boolean;
  /** Awake and off shift. */
  free: boolean;
  /** How much this person leans on each strategy, 0..1, from persona.strategies or traits. */
  weights: Record<Strategy, number>;
  /** What they want out of life, from persona text and goals: romance, revenge, power, escape, protect, uncover, wealth, union. */
  drives: Set<string>;
};

export type Choice = {
  score: number;
  /** routine plans need no "why" panel entry; the rest set a trigger. */
  routine: boolean;
  intent: string;
  steps: string[];
  labels: string[];
  trigger?: string;
  goalId?: string;
  causeEventId?: EventId;
  /** Asks the LLM to think again about this decision. */
  llm?: CognitionRequest;
  /** The strategy this plan follows to meet a need, recorded so its outcome can be learned from. */
  strategy?: { s: string; res: string };
  /** Holds this move off for a while once chosen (engine/ledger.ts cool), keyed by kind and target. */
  cooldown?: { key: string; ticks: number };
};

/** Builds a step list while tracking where the agent will be. */
export class Plan {
  steps: string[] = [];
  labels: string[] = [];
  constructor(public loc: string) {}
  go(to: string, label?: string): this {
    if (to !== this.loc) {
      this.steps.push(encodeStep('go', to));
      this.labels.push(label ?? 'Walk to ' + locName(to));
      this.loc = to;
    }
    return this;
  }
  add(type: StepType, args: (string | number)[], label: string): this {
    this.steps.push(encodeStep(type, ...args));
    this.labels.push(label);
    return this;
  }
}

/** A seeded roll for this agent's decision now. */
export const chance = (c: Ctx, salt: string): number => rand(c.tx.world.seed, c.tx.tick, c.a.seq, salt);

/** Where to find someone right now, if they can be reached and talked to. */
export async function findable(c: Ctx, id: string | undefined): Promise<AgentDoc | null> {
  if (!id) return null;
  const b = await loadAgent(c.tx, id as AgentDoc['_id']);
  if (!b || !b.alive || b._id === c.a._id || b.activity === 'sleeping' || stormAt(c.tx.world, b.locationId) > 0) return null;
  if (b.move && b.move.arriveTick > c.tx.tick + 2) return null;
  return b;
}
