/**
 * Collective action: rallies in the Commons Plaza and strikes. A rally gathers supporters from
 * whoever is there and agrees; enough supporters force the issue (a walkout, an emergency council
 * session, a vote to recall the chair). A strike stops work, so production really falls, until the
 * council answers it with a concession or a crackdown.
 */
import { TICKS_PER_DAY } from '../../shared/colony';
import { rand, round2 } from '../lib/rng';
import { act, fail, roll, say } from './act';
import { councilIds, firstName, locName } from './conditions';
import { adjustRelationship, agentsAt, emitEvent, encodeStep, interrupt, loadAgent, loadFactions, loadMind, touch } from './core';
import type { AgentDoc, EventId, Tx } from './core';
import { holdCouncil, recallVote } from './council';
import { getBelief, tie } from './social';
import { allAgents, simState } from './state';
import { line } from './text';

export const RALLY_TOPICS = ['strike', 'rations_open', 'recall_chair', 'trade'] as const;
/** Supporters a cause needs in one day before it forces the issue. */
export const RALLY_QUORUM = 7;
const STRIKE_TICKS = 36;

const CAUSE: Record<string, string> = {
  strike: 'a walkout until the council listens to the crews',
  rations_open: 'opening the depot reserve to the people who fill it',
  recall_chair: 'recalling the chair of the council',
  trade: 'getting the council out of the Exchange',
};

/** How much a listener sides with a cause and its organiser, -1..1. */
async function sympathy(tx: Tx, w: AgentDoc, organizer: AgentDoc, topic: string): Promise<number> {
  const toOrganizer = await tie(tx, w._id, organizer._id);
  const mind = await loadMind(tx, w);
  let s = (toOrganizer?.affinity ?? 0) * 0.4 + (toOrganizer?.trust ?? 0) * 0.2 + (w.factionId === organizer.factionId && w.factionId ? 0.25 : 0);
  const chair = tx.world.roles.chair;
  if (topic === 'strike' || topic === 'rations_open') {
    s += (w.factionId === 'union' ? 0.25 : 0) + (w.factionId === 'founders' ? -0.3 : 0) + tx.world.econ.rationLevel * 0.15 + (tx.world.econ.wagesUnpaid > 0 ? 0.15 : 0);
    if (((await getBelief(tx, w._id, 'policy_open'))?.confidence ?? 0) > 0.4) s += 0.2;
    if (w.role && w.occupation !== 'councilor') s -= 0.15;
  } else if (topic === 'recall_chair' && chair) {
    const toChair = await tie(tx, w._id, chair);
    s += -(toChair?.affinity ?? 0) * 0.5 - (toChair?.trust ?? 0) * 0.3 + (w.factionId === 'founders' ? -0.25 : 0.05);
  } else if (topic === 'trade') {
    s += w.factionId === 'exchange' ? 0.3 : 0;
  }
  return s + (mind?.values.freedom ?? 0.5) * 0.15 - (mind?.values.harmony ?? 0.5) * 0.1;
}

export async function rally(tx: Tx, a: AgentDoc, topicArg: string | undefined): Promise<number> {
  if (a.locationId !== 'plaza') return fail(tx, a, 'A rally needs the crowd at the Commons Plaza');
  const topic = (RALLY_TOPICS as readonly string[]).includes(topicArg ?? '') ? topicArg! : 'rations_open';
  if (topic === 'recall_chair' && (!tx.world.roles.chair || tx.world.roles.chair === a._id)) return fail(tx, a, 'There is no chair to recall');
  const sim = await simState(tx);
  sim.rallies = (sim.rallies ?? []).filter((x) => tx.tick - x.tick < TICKS_PER_DAY);
  if (sim.strike && topic === 'strike') return fail(tx, a, 'The crews are already out on strike');
  let cause = sim.rallies.find((x) => x.topic === topic);
  const r = roll(tx, a, 'rally');
  act(tx, a, 'talking', 'Rallying the plaza for ' + CAUSE[topic], undefined, line('rally.call', r));
  const joined: AgentDoc[] = [];
  const balked: AgentDoc[] = [];
  for (const id of (await agentsAt(tx, 'plaza', { exclude: [a._id] })).slice(0, 12)) {
    const w = await loadAgent(tx, id);
    if (!w || cause?.supporters.includes(w._id)) continue;
    const s = await sympathy(tx, w, a, topic);
    if (s + (rand(tx.world.seed, tx.tick, w.seq, 'rally') - 0.5) * 0.3 > 0.2) joined.push(w);
    else if (s < -0.2) balked.push(w);
  }
  for (const w of joined.slice(0, 3)) say(tx, w, a._id, line('rally.join', rand(tx.world.seed, tx.tick, w.seq, 'cheer')));
  for (const w of joined) await adjustRelationship(tx, w, a, { affinity: 0.06, trust: 0.05 });
  for (const w of balked) await adjustRelationship(tx, w, a, { affinity: -0.05 });
  const fresh = !cause;
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'rally',
    actorId: a._id,
    participantIds: joined.map((w) => w._id),
    locationId: 'plaza',
    summary:
      a.name + ' climbed onto a crate in the Commons Plaza and called for ' + CAUSE[topic] + '. ' +
      (joined.length === 0 ? 'Nobody stepped forward.' : joined.length === 1 ? joined[0].name + ' stepped forward.' : joined.length + ' people, ' + joined.slice(0, 2).map((w) => firstName(w.name)).join(' and ') + ' among them, stepped forward.') +
      (balked.length ? ' ' + firstName(balked[0].name) + ' walked off shaking their head.' : ''),
    salience: joined.length >= 3 ? 0.6 : 0.42,
    causationEventId: topic === 'rations_open' || topic === 'strike' ? tx.world.causes.rations : undefined,
    visibility: 'public',
    witnesses: 'location',
  });
  if (!cause) {
    cause = { topic, organizerId: a._id, supporters: [a._id], tick: tx.tick, eventId };
    sim.rallies.push(cause);
  }
  cause.supporters.push(...joined.map((w) => w._id));
  if (cause.supporters.length >= RALLY_QUORUM) {
    sim.rallies = sim.rallies.filter((x) => x !== cause);
    const organizer = (await loadAgent(tx, cause.organizerId)) ?? a;
    await quorum(tx, organizer, topic, cause.supporters.length, fresh ? eventId : cause.eventId);
  }
  return 3;
}

/** A cause with enough people behind it forces the issue. */
async function quorum(tx: Tx, organizer: AgentDoc, topic: string, count: number, causeId: EventId): Promise<void> {
  const sim = await simState(tx);
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'rally_quorum',
    actorId: organizer._id,
    locationId: 'plaza',
    summary:
      count + ' colonists now stand behind ' + organizer.name + ' and ' + CAUSE[topic] + '. ' +
      (topic === 'strike' ? 'The crews are walking off the job.' : topic === 'recall_chair' ? 'The council has to vote on its chair tonight.' : 'The council is called into emergency session.'),
    salience: 0.8,
    causationEventId: causeId,
    visibility: 'public',
  });
  if (topic === 'strike') {
    await startStrike(tx, organizer, 'full rations and wages paid', eventId);
    return;
  }
  if (topic === 'recall_chair') {
    await recallVote(tx, organizer, count, eventId);
    return;
  }
  sim.petitions.push({ topic, agentId: organizer._id, tick: tx.tick, eventId });
  await holdCouncil(tx);
}

/** Calls the crews out: every union member awake stops what they are doing and walks out. */
export async function startStrike(tx: Tx, leader: AgentDoc, demand: string, causeId: EventId): Promise<void> {
  const sim = await simState(tx);
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'strike',
    actorId: leader._id,
    summary: leader.name + ' has called the crews out on strike, demanding ' + demand + '. The wells, the quarry and the works are falling silent.',
    salience: 0.88,
    causationEventId: causeId,
    visibility: 'public',
  });
  sim.strike = { leaderId: leader._id, demand, startTick: tx.tick, untilTick: tx.tick + STRIKE_TICKS, eventId };
  for (const m of await allAgents(tx)) {
    if (!m.alive || m.factionId !== 'union' || m.activity === 'sleeping' || m._id === leader._id) continue;
    interrupt(tx, m, [encodeStep('go', 'plaza'), encodeStep('strike', 12)]);
  }
}

/** A colonist stops work in protest, alone or as part of the strike. */
export async function strikeStart(tx: Tx, a: AgentDoc, ticks: number): Promise<number> {
  const sim = await simState(tx);
  const r = roll(tx, a, 'strike');
  act(tx, a, 'idle', sim.strike ? 'On strike outside ' + locName(a.locationId) : 'Refusing to work, alone, at ' + locName(a.locationId), undefined, line('strike', r));
  if (!sim.strike && a.workLocationId) {
    await emitEvent(tx, {
      category: 'politics',
      eventType: 'walkout',
      actorId: a._id,
      locationId: a.locationId,
      summary: a.name + ' put down tools and refused to work at ' + locName(a.workLocationId) + ', alone if need be.',
      salience: 0.45,
      causationEventId: tx.world.causes.rations,
      visibility: 'public',
    });
  }
  return ticks;
}

/**
 * Hourly while a strike lasts: the chair answers it once it has bitten (concession or crackdown),
 * and it ends when its time runs out.
 */
export async function strikeHour(tx: Tx): Promise<void> {
  const sim = await simState(tx);
  const strike = sim.strike;
  if (!strike) return;
  const leader = await loadAgent(tx, strike.leaderId);
  if (tx.tick >= strike.untilTick || !leader?.alive) {
    sim.strike = undefined;
    await emitEvent(tx, { category: 'politics', eventType: 'strike_ended', actorId: leader?._id, summary: 'The strike is over. The crews drift back to the wells, the quarry and the works.', salience: 0.6, causationEventId: strike.eventId, visibility: 'public' });
    return;
  }
  if (strike.answered || tx.tick - strike.startTick < 12) return;
  strike.answered = true;
  const chairId = tx.world.roles.chair;
  const chair = chairId ? await loadAgent(tx, chairId) : null;
  const stance = (await loadFactions(tx)).find((f) => f.key === chair?.factionId)?.stance ?? 'trade';
  const toLeader = chair ? await tie(tx, chair._id, leader._id) : null;
  const yields = stance !== 'guard' || (toLeader?.affinity ?? 0) > 0.2 || tx.world.econ.wagesUnpaid > 0;
  const who = chair ? chair.name : 'The council';
  if (yields) {
    const econ = tx.world.econ;
    const before = econ.rationLevel;
    econ.rationLevel = Math.max(0, econ.rationLevel - 1);
    const wages = Math.min(econ.wagesUnpaid, econ.treasury);
    econ.treasury = round2(econ.treasury - wages);
    econ.wagesUnpaid = round2(econ.wagesUnpaid - wages);
    sim.strike = undefined;
    leader.mood = 'proud';
    touch(tx, leader);
    if (chair) await adjustRelationship(tx, chair, leader, { affinity: -0.15, trust: 0.05 });
    await emitEvent(tx, {
      category: 'politics',
      eventType: 'strike_won',
      actorId: chair?._id,
      participantIds: [leader._id, ...councilIds(tx).map((id) => id as AgentDoc['_id'])],
      locationId: 'plaza',
      summary: who + ' gave in to the strike after a day of silent drills: ' + (econ.rationLevel < before ? 'rations go back up' : 'the council promises fairer shares') + (wages > 0 ? ' and ' + Math.round(wages) + ' credits of back wages are paid' : '') + '. ' + leader.name + ' is the hero of the crews tonight.',
      salience: 0.85,
      causationEventId: strike.eventId,
      visibility: 'public',
    });
    return;
  }
  const fine = Math.min(15, Math.floor(leader.inv.credits));
  leader.inv.credits = round2(leader.inv.credits - fine);
  tx.world.econ.treasury = round2(tx.world.econ.treasury + fine);
  leader.mood = 'angry';
  touch(tx, leader);
  if (chair) await adjustRelationship(tx, leader, chair, { affinity: -0.35, trust: -0.3, kind: 'rival' });
  await emitEvent(tx, {
    category: 'politics',
    eventType: 'crackdown',
    actorId: chair?._id,
    participantIds: [leader._id],
    locationId: 'plaza',
    summary: who + ' refused to bargain with strikers and had security fine ' + leader.name + ' ' + fine + ' credits for leading the walkout. The crews are furious.',
    salience: 0.82,
    causationEventId: strike.eventId,
    visibility: 'public',
  });
}
