/**
 * Powers over one colonist's fortune: grant and kill. Both act on a living colonist, write what the
 * people around them saw as beliefs, and leave the consequences (envy, theft, grief, a vacant role)
 * to the simulation and the cognition layer.
 */
import { LOCATIONS, RESOURCES, RESOURCE_LABELS } from '../../shared/colony';
import type { LocationId, ResourceId } from '../../shared/colony';
import { agentsAt, emitEvent, enqueueCognition, killAgent, learnBelief, loadAgent, MAX_WITNESSES, touch } from '../engine/core';
import type { AgentDoc } from '../engine/core';
import { MAX_GRANT } from '../lib/constants';
import { round2 } from '../lib/rng';
import { agentOf, fail, isFailure, oneOf, record, standingAt, textOf } from './common';
import type { Power } from './common';

/**
 * Goods or credits appear in a colonist's locker. They know it came from nowhere; awake bystanders
 * notice the windfall, and the less empathetic of them resent it a little.
 */
export const grant: Power<{ agent: AgentDoc; resource: ResourceId; amount: number }> = {
  async parse(tx, raw) {
    const p = record(raw);
    if (isFailure(p)) return p;
    const agent = await agentOf(tx, p.agentId);
    if (isFailure(agent)) return agent;
    const resource = oneOf(p.resource, RESOURCES, 'resource');
    if (isFailure(resource)) return resource;
    const max = MAX_GRANT[resource];
    if (typeof p.amount !== 'number' || !Number.isInteger(p.amount) || p.amount < 1 || p.amount > max) {
      return fail('invalid', 'Amount must be a whole number from 1 to ' + max + '.');
    }
    return { agent, resource, amount: p.amount };
  },

  async apply(tx, { agent, resource, amount }) {
    agent.inv[resource] += amount;
    agent.mood = 'astonished';
    touch(tx, agent);
    const where = standingAt(tx, agent);
    const bystanders = agent.move || agent.activity === 'sleeping' ? [] : await agentsAt(tx, where, { exclude: [agent._id] });
    const what = amount + ' ' + RESOURCE_LABELS[resource].toLowerCase();
    const { eventId, witnessIds } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'grant',
      actorId: agent._id,
      locationId: where,
      summary: agent.name + ' found ' + what + ' that nobody can account for.',
      salience: 0.6 + 0.2 * Math.min(1, amount / MAX_GRANT[resource]),
      visibility: 'local',
      witnesses: bystanders,
      facts: { resource, amount },
    });
    const belief = {
      kind: 'windfall',
      text: agent.name + ' came into ' + what + ' out of nowhere.',
      subjectAgentId: agent._id,
      subjectName: agent.name,
      truthEventId: eventId,
      originEventId: eventId,
    };
    await learnBelief(tx, agent, { ...belief, valence: 0, confidence: 1, sourceType: 'observed' });
    for (const id of witnessIds) {
      const witness = (await loadAgent(tx, id))!;
      await learnBelief(tx, witness, { ...belief, valence: -round2(0.1 + 0.3 * (1 - witness.traits.empathy)), confidence: 0.8, sourceType: 'observed' });
    }
    return { affectedAgentIds: [agent._id, ...witnessIds] };
  },
};

/**
 * Strikes a colonist dead. killAgent writes the death, vacates their role and sets their family and
 * friends mourning; on top of that bystanders are frightened and remember it, and every close tie
 * is queued for crisis planning.
 */
export const kill: Power<{ agent: AgentDoc; cause: string }> = {
  async parse(tx, raw) {
    const p = record(raw);
    if (isFailure(p)) return p;
    const agent = await agentOf(tx, p.agentId);
    if (isFailure(agent)) return agent;
    const cause = textOf(p.cause, 0, 120, 'The cause');
    if (isFailure(cause)) return cause;
    return { agent, cause: cause.replace(/[.!]+$/, '') || 'struck down by an unseen hand' };
  },

  async apply(tx, { agent, cause }) {
    const where = LOCATIONS[standingAt(tx, agent) as LocationId].name;
    const summary = agent.name + ' died at ' + where + ': ' + cause + '.';
    const eventId = (await killAgent(tx, agent, { cause, summary, category: 'intervention', salience: 1 }))!;
    const belief = { kind: 'death', text: summary, valence: 0, subjectAgentId: agent._id, subjectName: agent.name, truthEventId: eventId, originEventId: eventId };

    const witnesses = (await agentsAt(tx, agent.locationId)).slice(0, MAX_WITNESSES);
    for (const id of witnesses) {
      const w = (await loadAgent(tx, id))!;
      w.needs.safety = Math.min(100, w.needs.safety + 25);
      w.mood = 'shaken';
      await learnBelief(tx, w, { ...belief, confidence: 1, sourceType: 'observed' });
    }

    const ties = await tx.ctx.db
      .query('relationships')
      .withIndex('by_to', (q) => q.eq('toAgentId', agent._id))
      .collect();
    const close: AgentDoc[] = [];
    for (const t of ties) {
      if (t.kind !== 'family' && !(t.kind === 'friend' && t.affinity >= 0.3)) continue;
      const mourner = await loadAgent(tx, t.fromAgentId);
      if (!mourner || !mourner.alive) continue;
      close.push(mourner);
      if (!witnesses.includes(mourner._id)) await learnBelief(tx, mourner, { ...belief, confidence: 0.95, sourceType: 'told' });
      await enqueueCognition(tx, mourner, { kind: 'plan', trigger: agent.name + ' died', detail: cause, priority: 0.85, lane: 'crisis', eventId });
    }
    return { affectedAgentIds: [...new Set([agent._id, ...witnesses, ...close.map((a) => a._id)])] };
  },
};
