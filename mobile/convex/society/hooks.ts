/**
 * The society layer: organizations, status, families, education and jobs, building and discovery,
 * arts and culture, obsessions and random events (docs/STORY_SPEC.md 8). The engine calls these
 * four hooks and nothing else. Owned by the society owner.
 *
 * Cost: societyTick reads nothing on most ticks. Once per transaction it reacts to the events since
 * the last one (one indexed query); hourly it applies production bonuses from the roster, births,
 * missing persons, territories and the random event scheduler; once a day (14:00) it reads every
 * colonist for status drift and the daily round of organizations, families, pets, culture and jobs.
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../shared/colony';
import { clamp, round2 } from '../lib/rng';
import { loadMind, touchMind } from '../engine/core';
import type { AgentDoc, MindDoc, StepType, Tx } from '../engine/core';
import { allAgents } from '../engine/state';
import { choicesFor } from './choices';
import { buildDone, buildStart, experimentDone, experimentStart, mechanicsDaily, observatoryHourly, productionHourly } from './craft';
import { createArtDone, createArtStart, cultureDaily, performDone, performStart } from './culture';
import { missingHourly, randomEventsHourly, reactToEvents } from './events';
import { adoptPet, care, familiesDaily, familiesHourly, petsDaily, propose } from './family';
import { maybeNewObsession, obsessionsDaily } from './obsession';
import { foundOrg, joinOrg, leaveOrg, orgAction, orgActionDone, orgsDaily, preach, rankOf, recruit, territoriesHourly } from './orgs';
import type { Person } from './orgs';
import { activeOrgs, cacheOf, loadMeta, saveMeta, societyOf, targetStatus } from './store';
import { applyJob, jobsDaily, studyDone, studyStart, teachDone, teachStart } from './work';

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

/** The hour of the day the daily society round runs (ticks after 06:00). */
const DAILY_AT = 8 * TICKS_PER_HOUR;

/** Runs once per tick before agents step: random events, births and aging, org upkeep, building progress, culture. */
export async function societyTick(tx: Tx): Promise<void> {
  const cache = cacheOf(tx);
  if (!cache.reacted) {
    cache.reacted = true;
    await reactToEvents(tx, await loadMeta(tx));
  }
  if (tx.tick % TICKS_PER_HOUR === 0) {
    const meta = await loadMeta(tx);
    productionHourly(tx, meta);
    await observatoryHourly(tx, meta);
    await familiesHourly(tx, meta);
    await missingHourly(tx, meta);
    await territoriesHourly(tx);
    await randomEventsHourly(tx, meta);
    await saveMeta(tx);
  }
  const day = Math.floor(tx.tick / TICKS_PER_DAY);
  if (tx.tick % TICKS_PER_DAY === DAILY_AT) {
    const meta = await loadMeta(tx);
    if (meta.lastDailyDay < day) {
      meta.lastDailyDay = day;
      await societyDaily(tx);
      await saveMeta(tx);
    }
  }
}

/** The once-a-day round: everyone's standing settles, then organizations, families, pets, culture, jobs, obsessions. */
export async function societyDaily(tx: Tx): Promise<void> {
  const meta = await loadMeta(tx);
  const people = new Map<string, Person>();
  for (const a of await allAgents(tx)) {
    if (!a.alive) continue;
    const mind = await loadMind(tx, a);
    if (mind) people.set(a._id, { a, mind });
  }
  const orgs = await activeOrgs(tx);
  for (const { a, mind } of people.values()) {
    const s = societyOf(tx, a, mind);
    const target = targetStatus(a, mind, rankOf(orgs, a._id)) - (meta.scandals[a._id] && tx.tick - meta.scandals[a._id] < 3 * TICKS_PER_DAY ? 10 : 0);
    s.status = round2(clamp(s.status + (target - s.status) * 0.15, 0, 100));
    touchMind(tx, mind);
  }
  await orgsDaily(tx, people);
  await familiesDaily(tx, people, meta);
  await petsDaily(tx, meta, people);
  await mechanicsDaily(tx, meta, people);
  await cultureDaily(tx, people);
  jobsDaily(tx, people);
  await obsessionsDaily(tx, people);
  await maybeNewObsession(tx, people);
  await saveMeta(tx);
}

/** Extra options for an agent with nothing queued. Called by planFor. */
export async function societyChoices(tx: Tx, a: AgentDoc, mind: MindDoc, free: boolean): Promise<SocietyChoice[]> {
  if (!a.alive) return [];
  return await choicesFor(tx, a, mind, free);
}

const num = (s: string | undefined, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};

/** Starts a society step. Returns ticks it occupies, 0 for instant, or -1 when it cannot be done. */
export async function startSocietyStep(tx: Tx, a: AgentDoc, type: StepType, args: string[], _label?: string): Promise<number> {
  const mind = await loadMind(tx, a);
  if (!mind) return -1;
  societyOf(tx, a, mind);
  const [x, y] = args;
  switch (type) {
    case 'found_org':
      return foundOrg(tx, a, mind, x, y);
    case 'join_org':
      return joinOrg(tx, a, mind, x);
    case 'leave_org':
      return leaveOrg(tx, a, mind, x);
    case 'recruit':
      return recruit(tx, a, mind, x, y);
    case 'preach':
      return preach(tx, a, mind, x);
    case 'org_action':
      return orgAction(tx, a, mind, x, y ?? '');
    case 'study':
      return studyStart(tx, a, x, num(y, 2, 18, 9));
    case 'teach':
      return teachStart(tx, a, mind, x, y);
    case 'apply_job':
      return applyJob(tx, a, mind, x);
    case 'build':
      return buildStart(tx, a, mind, x);
    case 'experiment':
      return experimentStart(tx, a, mind, num(x, 2, 18, 9));
    case 'create_art':
      return createArtStart(tx, a, x);
    case 'perform':
      return performStart(tx, a, num(x, 2, 6, 4));
    case 'adopt_pet':
      return adoptPet(tx, a, mind, x);
    case 'care':
      return care(tx, a, mind, x);
    case 'propose':
      return propose(tx, a, mind, x);
    default:
      return -1;
  }
}

/** Applies what a timed society step achieves when it ends. */
export async function finishSocietyStep(tx: Tx, a: AgentDoc, type: StepType, args: string[], startTick: number): Promise<void> {
  const ticks = Math.max(1, tx.tick - startTick);
  const [x, y] = args;
  switch (type) {
    case 'org_action':
      return orgActionDone(tx, a, x, y ?? '', ticks);
    case 'study':
      return studyDone(tx, a, x, ticks);
    case 'teach':
      return teachDone(tx, a, x, y, ticks);
    case 'build':
      return buildDone(tx, a, ticks);
    case 'experiment':
      return experimentDone(tx, a, ticks);
    case 'create_art':
      return createArtDone(tx, a, x);
    case 'perform':
      return performDone(tx, a);
  }
}
