/**
 * The society layer: organizations, status, families, education and jobs, building and discovery,
 * arts and culture, obsessions and random events (docs/STORY_SPEC.md 8). The engine calls these
 * four hooks and nothing else. Owned by the society owner.
 */
import type { AgentDoc, MindDoc, StepType, Tx } from '../engine/core';

/** A candidate plan for the planner; same meaning as the planner's internal Choice. */
export type SocietyChoice = {
  /** Comparable to the planner's scores: about 0.3 routine, 0.6 a real want, 1+ urgent or obsessive. */
  score: number;
  routine: boolean;
  intent: string;
  steps: string[];
  labels: string[];
  trigger?: string;
  goalId?: string;
};

/** Runs once per tick before agents step: random events, births and aging, org upkeep, building progress, culture. */
export async function societyTick(_tx: Tx): Promise<void> {}

/** Extra options for an agent with nothing queued. Called by planFor. */
export async function societyChoices(_tx: Tx, _a: AgentDoc, _mind: MindDoc, _free: boolean): Promise<SocietyChoice[]> {
  return [];
}

/** Starts a society step. Returns ticks it occupies, 0 for instant, or -1 when it cannot be done. */
export async function startSocietyStep(_tx: Tx, _a: AgentDoc, _type: StepType, _args: string[], _label?: string): Promise<number> {
  return -1;
}

/** Applies what a timed society step achieves when it ends. */
export async function finishSocietyStep(_tx: Tx, _a: AgentDoc, _type: StepType, _args: string[], _startTick: number): Promise<void> {}
