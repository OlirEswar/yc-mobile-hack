/**
 * Persona secrets (minds.persona.secret) and how they come out. Someone can learn a secret by
 * overhearing it (eavesdrop), being told it (confide), or digging (investigate); a held secret is a
 * belief whose key is "<secret kind>:<subject id>", so it can be gossiped, used for blackmail, or
 * thrown in someone's face. Exposure (a public accusation backed by evidence, or a confession)
 * stamps exposedAtTick and has real consequences: standing, the role they hold, the faction they
 * lead, and the people the secret was kept from.
 */
import { firstName } from './conditions';
import { adjustRelationship, emitEvent, learnBelief, loadAgent, loadFactions, loadMind, touch, touchFaction, touchMind } from './core';
import type { AgentDoc, EventId, MindDoc, Tx } from './core';

export type Secret = NonNullable<NonNullable<MindDoc['persona']>['secret']>;

/** Kinds of belief about a person that amount to a scandal: leverage for blackmail, grounds for an accusation. */
const SCANDALS = new Set(['thief', 'hoarding', 'saboteur', 'corrupt', 'embezzler', 'smuggler', 'liar', 'affair', 'briber', 'blackmailer', 'traitor', 'coward', 'fraud', 'addict', 'deserter', 'killer', 'informer']);
export const isScandal = (kind: string): boolean => SCANDALS.has(kind) || kind.startsWith('secret');

/** Roles a scandal of this kind costs its holder once it is public. */
const DISQUALIFYING = new Set(['corrupt', 'embezzler', 'thief', 'saboteur', 'smuggler', 'briber', 'fraud', 'traitor']);

/** The colonist's secret while it is still hidden. */
export async function secretOf(tx: Tx, a: AgentDoc): Promise<Secret | null> {
  const secret = (await loadMind(tx, a))?.persona?.secret;
  return secret && secret.exposedAtTick === undefined ? secret : null;
}

/** The secret as a sentence someone else would repeat, with the subject's name in it. */
export function secretText(subject: AgentDoc, secret: Secret): string {
  const text = secret.text.trim().replace(/\.?$/, '.');
  return text.includes(firstName(subject.name)) ? text : subject.name + ': ' + text.charAt(0).toLowerCase() + text.slice(1);
}

/** Puts subject's secret in learner's head. how decides the source type and how sure they are. */
export async function learnSecret(tx: Tx, learner: AgentDoc, subject: AgentDoc, secret: Secret, how: 'overheard' | 'confided' | 'discovered', eventId: EventId, source?: AgentDoc): Promise<string> {
  const learned = await learnBelief(tx, learner, {
    kind: secret.kind,
    text: secretText(subject, secret),
    valence: -0.8,
    confidence: how === 'confided' ? 0.95 : how === 'discovered' ? 0.9 : 0.7,
    sourceType: how === 'confided' ? 'told' : 'observed',
    subjectAgentId: subject._id,
    subjectName: subject.name,
    sourceAgentId: source?._id,
    sourceName: source?.name,
    originEventId: eventId,
    truthEventId: how === 'confided' ? undefined : eventId,
    private: true,
  });
  return learned.key;
}

/**
 * The secret is out. Stamps exposure, costs the subject a disqualified role and the trust of the
 * people it hurt most, and tells the colony. Returns the exposure event.
 */
export async function exposeSecret(tx: Tx, subject: AgentDoc, how: 'accused' | 'confessed', causeId: EventId, by?: AgentDoc): Promise<EventId | undefined> {
  const mind = await loadMind(tx, subject);
  const secret = mind?.persona?.secret;
  if (!mind || !secret || secret.exposedAtTick !== undefined) return undefined;
  secret.exposedAtTick = tx.tick;
  touchMind(tx, mind);
  const consequences: string[] = [];
  if (secret.kind === 'affair') {
    const ties = await tx.ctx.db
      .query('relationships')
      .withIndex('by_to', (q) => q.eq('toAgentId', subject._id))
      .collect();
    for (const t of ties.filter((r) => r.kind === 'romance' && r.toAlive)) {
      const partner = await loadAgent(tx, t.fromAgentId);
      if (!partner?.alive) continue;
      await adjustRelationship(tx, partner, subject, { affinity: -0.7, trust: -0.6, kind: 'rival' });
      partner.mood = 'betrayed';
      touch(tx, partner);
      consequences.push(firstName(partner.name) + ' has thrown ' + firstName(subject.name) + ' out');
    }
  }
  if (subject.role && DISQUALIFYING.has(secret.kind)) {
    const role = subject.role;
    delete tx.world.roles[role];
    tx.world.vacancies.push({ occupation: subject.occupation, sinceTick: tx.tick, role, eventId: causeId });
    subject.role = undefined;
    consequences.push(firstName(subject.name) + ' is stripped of the post of ' + role.replace(/_/g, ' '));
  }
  for (const f of await loadFactions(tx)) {
    if (f.leaderAgentId !== subject._id || how === 'confessed' || !DISQUALIFYING.has(secret.kind)) continue;
    const heir = f.officerIds[0];
    f.leaderAgentId = heir;
    f.officerIds = f.officerIds.slice(1);
    touchFaction(tx, f);
    const next = heir ? await loadAgent(tx, heir) : null;
    consequences.push('the ' + f.name + ' turns to ' + (next ? next.name : 'nobody') + ' to lead it');
  }
  subject.mood = how === 'confessed' ? 'sombre' : 'humiliated';
  touch(tx, subject);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'secret_exposed',
    actorId: subject._id,
    participantIds: by ? [by._id] : [],
    locationId: subject.locationId,
    summary:
      (how === 'confessed' ? subject.name + ' admitted it in front of everyone: ' : (by ? by.name + ' laid it bare' : 'It came out') + ' at last: ') +
      secretText(subject, secret).replace(/\.$/, '') + '.' + (consequences.length ? ' Now ' + consequences.join('; ') + '.' : ''),
    salience: 0.85,
    causationEventId: causeId,
    visibility: 'public',
    witnesses: 'location',
  });
  return eventId;
}
