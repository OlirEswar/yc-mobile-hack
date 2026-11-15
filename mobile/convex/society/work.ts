/**
 * Education and careers. Study (at the Observatory school, from a teacher, or alone) and teaching
 * raise skills; mastery is recognised; colonists apply for jobs and are hired on skill, status and
 * openings; the unemployed lose standing and grow restless.
 */
import type { Id } from '../_generated/dataModel';
import { OCCUPATIONS } from '../../shared/colony';
import { STUDY_SKILLS } from '../../shared/society';
import { clamp, round2 } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import { firstName, locName } from '../engine/conditions';
import { adjustRelationship, agentsAt, emitEvent, loadAgent, loadMind, touch, touchMind } from '../engine/core';
import type { AgentDoc, MindDoc, Tx } from '../engine/core';
import { presentWith } from '../engine/social';
import { bonusFor } from './craft';
import { orgsOf } from './orgs';
import { DAY, act, activeOrgs, loadMeta, roll, shiftStatus, societyOf } from './store';

export const MASTERY = 70;
const SKILL_LABEL: Record<string, string> = { drilling: 'ice drilling', healing: 'medicine', art: 'the arts', logistics: 'logistics', persuasion: 'persuasion' };
export const skillLabel = (s: string): string => SKILL_LABEL[s] ?? s;
const isSkill = (s: string): boolean => (STUDY_SKILLS as readonly string[]).includes(s);

export function studyStart(tx: Tx, a: AgentDoc, skill: string, ticks: number): number {
  if (!isSkill(skill)) return -1;
  const where = a.locationId === 'observatory' ? 'at the Observatory school' : a.locationId === a.homeLocationId ? 'at home' : 'at ' + locName(a.locationId);
  act(tx, a, 'investigating', 'Studying ' + skillLabel(skill) + ' ' + where);
  return clamp(ticks, 2, 18);
}

export async function studyDone(tx: Tx, a: AgentDoc, skill: string, ticks: number): Promise<void> {
  if (!isSkill(skill)) return;
  const mind = await loadMind(tx, a);
  if (!mind) return;
  const meta = await loadMeta(tx);
  let bonus = bonusFor(meta, 'study', a.locationId);
  if (a.locationId === 'observatory') bonus += 0.5;
  const schools = (await orgsOf(tx, mind)).filter((o) => o.kind === 'school');
  if (schools.length) bonus += 0.2;
  let teacher: AgentDoc | null = null;
  for (const id of (await agentsAt(tx, a.locationId, { exclude: [a._id] })).slice(0, 6)) {
    const b = await loadAgent(tx, id);
    const bm = b ? await loadMind(tx, b) : null;
    if (b && bm && (bm.skills[skill] ?? 0) >= MASTERY) {
      teacher = b;
      break;
    }
  }
  if (teacher) bonus += 0.5;
  const before = mind.skills[skill] ?? 0;
  const child = mind.ageBand === 'child' ? 1.5 : 1;
  const gain = (ticks / 6) * 1.4 * (0.6 + a.traits.curiosity * 0.8) * (1 + bonus) * child * Math.max(0.15, 1 - before / 120);
  await improve(tx, a, mind, skill, gain, teacher);
}

/** Raises a skill, keeps the primary job skill in step, and recognises mastery. */
export async function improve(tx: Tx, a: AgentDoc, mind: MindDoc, skill: string, gain: number, teacher?: AgentDoc | null): Promise<void> {
  const s = societyOf(tx, a, mind);
  const before = mind.skills[skill] ?? 0;
  const after = round2(Math.min(100, before + gain));
  mind.skills[skill] = after;
  const ed = s.education ?? { progress: 0, mastered: [] };
  ed.studying = skill;
  ed.progress = round2(Math.min(1, after / MASTERY));
  s.education = ed;
  touchMind(tx, mind);
  if (PRIMARY_SKILL[a.occupation] === skill) {
    a.skill = after;
    touch(tx, a);
  }
  if (before < MASTERY && after >= MASTERY && !ed.mastered.includes(skill)) {
    ed.mastered.push(skill);
    ed.studying = undefined;
    shiftStatus(tx, mind, 5);
    await emitEvent(tx, {
      category: 'social',
      eventType: 'mastery',
      actorId: a._id,
      participantIds: teacher ? [teacher._id] : [],
      summary: a.name + ' has mastered ' + skillLabel(skill) + (teacher ? ', taught by ' + teacher.name : mind.ageBand === 'child' ? ', still only a child' : '') + '.',
      salience: 0.5,
      visibility: 'public',
    });
  }
}

export async function teachStart(tx: Tx, a: AgentDoc, mind: MindDoc, studentId: string, skill: string): Promise<number> {
  const b = await presentWith(tx, a, studentId);
  if (!b || !isSkill(skill)) return -1;
  const bm = await loadMind(tx, b);
  const mine = mind.skills[skill] ?? 0;
  if (!bm || mine < 40 || mine < (bm.skills[skill] ?? 0) + 15) return -1;
  act(tx, a, 'talking', 'Teaching ' + firstName(b.name) + ' ' + skillLabel(skill), b._id, 'Watch my hands. Now you.');
  b.interactingWithId = a._id;
  b.speech = bm.ageBand === 'child' ? 'Like this?' : 'Show me again.';
  touch(tx, b);
  return 4;
}

export async function teachDone(tx: Tx, a: AgentDoc, studentId: string, skill: string, ticks: number): Promise<void> {
  const b = await loadAgent(tx, studentId as Id<'agents'>);
  if (!b?.alive || b.locationId !== a.locationId) return;
  const [am, bm] = [await loadMind(tx, a), await loadMind(tx, b)];
  if (!am || !bm) return;
  const before = bm.skills[skill] ?? 0;
  await improve(tx, b, bm, skill, (ticks / 6) * 2.4 * (0.6 + b.traits.curiosity * 0.6) * Math.max(0.15, 1 - before / 120) * (bm.ageBand === 'child' ? 1.5 : 1), a);
  am.skills.persuasion = round2(Math.min(100, (am.skills.persuasion ?? 20) + 0.3));
  touchMind(tx, am);
  shiftStatus(tx, am, 1);
  await adjustRelationship(tx, b, a, { affinity: 0.06, trust: 0.06, obligation: 0.03 });
  await emitEvent(tx, { category: 'social', eventType: 'lesson', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' taught ' + b.name + ' ' + skillLabel(skill) + ' at ' + locName(a.locationId) + '.', salience: 0.3, visibility: 'local' });
}

/** Applying for a job: an opening or a good impression, then skill and status decide. */
export async function applyJob(tx: Tx, a: AgentDoc, mind: MindDoc, occupation: string): Promise<number> {
  const def = OCCUPATIONS.find((o) => o.id === occupation);
  if (!def || occupation === 'resident' || occupation === 'councilor' || occupation === 'quartermaster' || a.occupation === occupation || a.role || mind.ageBand === 'child') return -1;
  if (a.locationId !== 'plaza' && a.locationId !== def.workLocationId) return -1;
  const s = societyOf(tx, a, mind);
  const skill = mind.skills[PRIMARY_SKILL[occupation]] ?? 0;
  const vacancy = tx.world.vacancies.find((v) => v.occupation === occupation && !v.role);
  const company = (await activeOrgs(tx)).some((o) => o.kind === 'company' && o.state && (o.state as { home?: string }).home === def.workLocationId);
  const score = skill / 100 * 0.6 + s.status / 100 * 0.3 + roll(tx, a.seq, 'hire') * 0.3 + (vacancy ? 0.25 : 0) + (company ? 0.05 : 0);
  const hired = skill >= 25 && score >= (vacancy ? 0.4 : 0.62);
  act(tx, a, 'talking', 'Applying for work as a ' + def.label.toLowerCase(), undefined, 'I can do this job. Try me.');
  if (!hired) {
    if (a.traits.ambition > 0.6) a.mood = 'humiliated';
    await emitEvent(tx, { category: 'economy', eventType: 'job_rejected', actorId: a._id, locationId: a.locationId, summary: a.name + ' asked for work as a ' + def.label.toLowerCase() + ' and was turned away.', salience: 0.3, visibility: 'private' });
    return 2;
  }
  if (vacancy) tx.world.vacancies = tx.world.vacancies.filter((v) => v !== vacancy);
  const old = OCCUPATIONS.find((o) => o.id === a.occupation);
  a.occupation = occupation;
  a.workLocationId = def.workLocationId;
  a.skill = skill;
  a.mood = 'hopeful';
  touch(tx, a);
  s.jobHistory.push({ occupation, fromTick: tx.tick });
  shiftStatus(tx, mind, old?.id === 'resident' ? 6 : 2);
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'hired',
    actorId: a._id,
    locationId: a.locationId,
    summary: a.name + ' was taken on as a ' + def.label.toLowerCase() + (old && old.id !== 'resident' ? ', leaving the ' + old.label.toLowerCase() + "'s life behind" : old?.id === 'resident' ? ' after a long stretch without work' : '') + '.',
    salience: 0.5,
    causationEventId: vacancy?.eventId,
    visibility: 'public',
  });
  return 2;
}

/** The colony job someone would apply for, if any: where their skills beat their current work. */
export function jobWanted(a: AgentDoc, mind: MindDoc, vacancies: string[]): string | null {
  if (a.role || mind.ageBand === 'child' || mind.ageBand === 'elder') return null;
  const current = mind.skills[PRIMARY_SKILL[a.occupation]] ?? 0;
  let best: { occ: string; s: number } | null = null;
  for (const o of OCCUPATIONS) {
    if (o.id === a.occupation || o.id === 'resident' || o.id === 'councilor' || o.id === 'quartermaster') continue;
    const skill = mind.skills[PRIMARY_SKILL[o.id]] ?? 0;
    const s = skill - current + (vacancies.includes(o.id) ? 25 : 0) + (a.occupation === 'resident' ? 20 : 0);
    if (skill >= 30 && s > 15 && (!best || s > best.s)) best = { occ: o.id, s };
  }
  return best?.occ ?? null;
}

/** Once a day: the long unemployed lose standing and grow anxious. */
export function jobsDaily(tx: Tx, people: Map<string, { a: AgentDoc; mind: MindDoc }>): void {
  for (const { a, mind } of people.values()) {
    if (a.occupation !== 'resident' || mind.ageBand === 'child' || mind.ageBand === 'elder') continue;
    const since = mind.society?.jobHistory.at(-1)?.fromTick ?? 0;
    if (tx.tick - since < 2 * DAY) continue;
    shiftStatus(tx, mind, -1);
    if (a.mood === 'calm' || a.mood === 'content') {
      a.mood = 'anxious';
      touch(tx, a);
    }
  }
}
