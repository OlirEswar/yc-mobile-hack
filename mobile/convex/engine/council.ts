/**
 * Colony politics: the evening council session that hears petitions and votes on the ration
 * level, contested council seats, challenges to the chair, and filling posts left by the dead.
 * Votes come from each councilor's faction stance, their own beliefs, the state of the reserve
 * and how they feel about whoever is asking.
 */
import { OCCUPATIONS, TICKS_PER_DAY } from '../../shared/colony';
import { round1 } from '../lib/rng';
import { BONUS_AT, BONUS_YES_AT, CUT_AT, NORMAL_STOCK } from '../lib/constants';
import { addStock, councilIds, firstName, reserveDays, reserveRatio, stock } from './conditions';
import { adjustRelationship, emitEvent, loadAgent, loadFactions, loadMind, touch, touchHousehold } from './core';
import type { AgentDoc, EventId, Tx } from './core';
import { getBelief, tie } from './social';
import { allAgents, allHouseholds, simState } from './state';

const LEVEL_NAMES = ['full', 'reduced', 'emergency'];
const SEATS = 5;
/** Posts that belong to a job and stay behind when their holder takes a council seat. */
const JOB_ROLES = new Set(['lead_grower', 'shift_boss', 'head_medic', 'chief_engineer', 'quartermaster', 'security_chief']);

const list = (names: string[]): string => (names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

export async function holdCouncil(tx: Tx): Promise<void> {
  const sim = await simState(tx);
  sim.lastCouncilTick = tx.tick;
  const members: AgentDoc[] = [];
  for (const id of councilIds(tx)) {
    const m = await loadAgent(tx, id as AgentDoc['_id']);
    if (m?.alive) members.push(m);
  }
  if (members.length === 0) return;
  let chair = members.find((m) => m._id === tx.world.roles.chair);
  if (!chair) chair = await electChair(tx, members);
  await rationVote(tx, members, chair);
  await seatPetitions(tx, members, chair);
  await chairChallenge(tx, members, chair);
  sim.petitions = [];
}

/** Each councilor's preferred ration level and the vote's outcome. */
async function rationVote(tx: Tx, members: AgentDoc[], chair: AgentDoc | undefined): Promise<void> {
  const sim = await simState(tx);
  const world = tx.world;
  const level = world.econ.rationLevel;
  const days = Math.min(reserveDays(world, 'water'), reserveDays(world, 'food'));
  const ratio = reserveRatio(world);
  const factions = await loadFactions(tx);
  const petitions = sim.petitions.filter((p) => p.topic === 'rations_open' || p.topic === 'rations_guard');
  const votes: { m: AgentDoc; want: number }[] = [];
  for (const m of members) {
    const stance = factions.find((f) => f.key === m.factionId)?.stance ?? 'trade';
    const [cut1, cut2] = CUT_AT[stance] ?? CUT_AT.trade;
    let want = ratio < cut2 ? 2 : ratio < cut1 ? 1 : 0;
    if (((await getBelief(tx, m._id, 'policy_open'))?.confidence ?? 0) > 0.5) want -= 0.3;
    if (((await getBelief(tx, m._id, 'policy_guard'))?.confidence ?? 0) > 0.5) want += 0.3;
    for (const p of petitions) {
      if (p.agentId === m._id) continue;
      const r = await tie(tx, m._id, p.agentId);
      if ((r?.affinity ?? 0) + (r?.trust ?? 0) > 0.3) want += p.topic === 'rations_open' ? -0.5 : 0.5;
    }
    votes.push({ m, want: Math.max(0, Math.min(2, Math.round(want))) });
  }
  const sorted = votes.map((v) => v.want).sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  let result = sorted.length % 2 === 1 ? sorted[mid] : votes.find((v) => v.m._id === chair?._id)?.want ?? sorted[mid];
  if (sorted.length % 2 === 0 && result !== sorted[mid] && result !== sorted[mid - 1]) result = sorted[mid];
  if (result === level && petitions.length === 0) return;

  const lead = petitions[petitions.length - 1];
  const petitioner = lead ? await loadAgent(tx, lead.agentId) : null;
  if (result === 0 && level === 0 && ratio > BONUS_AT && petitions.some((p) => p.topic === 'rations_open')) {
    await bonusVote(tx, members, ratio, petitions);
    return;
  }
  if (result === level) {
    const raise = votes.filter((v) => v.want < level).map((v) => firstName(v.m.name));
    const deeper = votes.filter((v) => v.want > level).map((v) => firstName(v.m.name));
    const sides = [raise.length ? list(raise) + ' wanted them ' + (level > 0 ? 'raised' : 'opened up') : '', deeper.length ? list(deeper) + ' wanted them cut' : ''].filter(Boolean);
    for (const p of petitions) {
      const who = await loadAgent(tx, p.agentId);
      if (who && chair && who._id !== chair._id) await adjustRelationship(tx, who, chair, { affinity: -0.08, trust: -0.05 });
    }
    await emitEvent(tx, {
      category: 'politics',
      eventType: 'council_debate',
      actorId: chair?._id,
      participantIds: [...members.map((m) => m._id), ...(petitioner ? [petitioner._id] : [])],
      locationId: 'plaza',
      summary: 'The council heard ' + (petitioner ? petitioner.name + "'s" : 'the') + ' plea on rations and kept them ' + LEVEL_NAMES[level] + (sides.length ? ': ' + sides.join(', while ') + '.' : '.'),
      salience: sides.length > 0 ? 0.55 : 0.4,
      causationEventId: lead?.eventId,
      visibility: 'public',
    });
    return;
  }
  world.econ.rationLevel = result;
  const cutting = result > level;
  const ayes = votes.filter((v) => (cutting ? v.want >= result : v.want <= result)).map((v) => v.m);
  const nays = votes.filter((v) => !ayes.includes(v.m)).map((v) => v.m);
  const cause: EventId | undefined = cutting ? world.causes.drought ?? petitions.find((p) => p.topic === 'rations_guard')?.eventId : petitions.find((p) => p.topic === 'rations_open')?.eventId ?? world.causes.rations;
  for (const m of nays) {
    m.mood = 'angry';
    touch(tx, m);
    if (chair && m._id !== chair._id) await adjustRelationship(tx, m, chair, { affinity: -0.06 });
  }
  const { eventId } = await emitEvent(tx, {
    category: 'politics',
    eventType: 'ration_change',
    actorId: chair?._id,
    participantIds: members.map((m) => m._id),
    locationId: 'plaza',
    summary:
      'The council voted ' + ayes.length + ' to ' + nays.length + ' to ' + (cutting ? 'cut' : 'raise') + ' depot rations to ' + LEVEL_NAMES[result] + ', with ' + round1(days) + ' days of reserve left.' +
      (nays.length > 0 ? ' ' + list(nays.map((m) => firstName(m.name))) + ' voted against.' : ''),
    salience: 0.82,
    causationEventId: cause,
    visibility: 'public',
    facts: { from: level, to: result },
  });
  if (result > 0) world.causes.rations = eventId;
  else delete world.causes.rations;
}

/** With the reserve overflowing, the council decides whether to hand out an extra ration. */
async function bonusVote(tx: Tx, members: AgentDoc[], ratio: number, petitions: { topic: string; agentId: AgentDoc['_id']; eventId: EventId }[]): Promise<void> {
  const factions = await loadFactions(tx);
  const lead = petitions.find((p) => p.topic === 'rations_open')!;
  const petitioner = await loadAgent(tx, lead.agentId);
  const yes: AgentDoc[] = [];
  const no: AgentDoc[] = [];
  for (const m of members) {
    const stance = factions.find((f) => f.key === m.factionId)?.stance ?? 'trade';
    const r = petitioner ? await tie(tx, m._id, petitioner._id) : null;
    const leaning = (r?.affinity ?? 0) * 0.3;
    (ratio + leaning >= (BONUS_YES_AT[stance] ?? 1.3) ? yes : no).push(m);
  }
  const passed = yes.length > no.length;
  const quartermaster = tx.world.roles.quartermaster ? await loadAgent(tx, tx.world.roles.quartermaster) : null;
  if (passed) {
    for (const h of await allHouseholds(tx)) {
      const n = h.memberIds.length;
      for (const res of ['water', 'food'] as const) {
        const give = Math.min(n, Math.floor(stock(tx.world, 'depot', res) - NORMAL_STOCK[res]));
        if (give <= 0) continue;
        h.pantry[res] += give;
        addStock(tx.world, 'depot', res, -give);
      }
      touchHousehold(tx, h);
    }
    if (quartermaster && petitioner) await adjustRelationship(tx, quartermaster, petitioner, { affinity: -0.1 });
  } else if (petitioner) {
    for (const m of no) await adjustRelationship(tx, petitioner, m, { affinity: -0.06 });
  }
  await emitEvent(tx, {
    category: 'politics',
    eventType: passed ? 'bonus_ration' : 'council_debate',
    actorId: petitioner?._id,
    participantIds: members.map((m) => m._id),
    locationId: 'plaza',
    summary: passed
      ? 'The council voted ' + yes.length + ' to ' + no.length + ' to open the overflowing reserve: every household gets an extra ration.' + (quartermaster ? ' ' + quartermaster.name + ' called it reckless.' : '')
      : 'The council voted ' + no.length + ' to ' + yes.length + ' against ' + (petitioner ? petitioner.name + "'s" : 'the') + ' call to hand out the surplus. ' + list(no.map((m) => firstName(m.name))) + ' would rather keep it.',
    salience: passed ? 0.62 : 0.5,
    causationEventId: lead.eventId,
    visibility: 'public',
  });
}

/** Someone with enough standing takes a seat, unseating the least respected councilor if the table is full. */
async function seatPetitions(tx: Tx, members: AgentDoc[], chair: AgentDoc | undefined): Promise<void> {
  const sim = await simState(tx);
  // One seat changes hands per session at most, to the most respected petitioner.
  const bids: AgentDoc[] = [];
  for (const p of sim.petitions.filter((x) => x.topic === 'seat')) {
    const who = await loadAgent(tx, p.agentId);
    if (who) bids.push(who);
  }
  bids.sort((x, y) => y.standing - x.standing);
  for (const p of sim.petitions.filter((x) => x.topic === 'seat')) {
    const who = await loadAgent(tx, p.agentId);
    if (!who?.alive || who.occupation === 'councilor') continue;
    const unseatable = members.filter((m) => m._id !== chair?._id && m.occupation === 'councilor').sort((x, y) => x.standing - y.standing);
    const full = members.length >= SEATS;
    const weakest = full ? unseatable[0] : undefined;
    const threshold = Math.max(9, (weakest?.standing ?? 0) + 4);
    if (who.standing < threshold || who !== bids[0]) {
      if (chair) await adjustRelationship(tx, who, chair, { affinity: -0.1 });
      await emitEvent(tx, {
        category: 'politics',
        eventType: 'petition_denied',
        actorId: who._id,
        participantIds: chair ? [chair._id] : [],
        locationId: 'plaza',
        summary: 'The council turned down ' + who.name + "'s bid for a seat" + (weakest ? '; ' + weakest.name + ' keeps theirs.' : '.'),
        salience: 0.45,
        causationEventId: p.eventId,
        visibility: 'public',
      });
      continue;
    }
    const oldJob = OCCUPATIONS.find((o) => o.id === who.occupation)?.label.toLowerCase() ?? who.occupation;
    if (who.role && JOB_ROLES.has(who.role)) {
      tx.world.vacancies.push({ occupation: who.occupation, sinceTick: tx.tick, role: who.role, eventId: p.eventId });
      delete tx.world.roles[who.role];
      who.role = undefined;
    }
    who.occupation = 'councilor';
    who.workLocationId = 'plaza';
    who.mood = 'proud';
    touch(tx, who);
    sim.council.push(who._id);
    if (weakest) {
      weakest.occupation = 'resident';
      weakest.mood = 'humiliated';
      touch(tx, weakest);
      sim.council = sim.council.filter((id) => id !== weakest._id);
      members.splice(members.indexOf(weakest), 1);
      await adjustRelationship(tx, weakest, who, { affinity: -0.35, trust: -0.2 });
    }
    members.push(who);
    await emitEvent(tx, {
      category: 'politics',
      eventType: 'council_seat',
      actorId: who._id,
      participantIds: weakest ? [weakest._id] : [],
      locationId: 'plaza',
      summary: who.name + ' won a seat on the council' + (weakest ? ', unseating ' + weakest.name : '') + ', and gives up work as a ' + oldJob + ' to take it.',
      salience: 0.85,
      causationEventId: p.eventId,
      visibility: 'public',
    });
  }
}

/** How a councilor leans between two people: affinity plus trust. */
async function lean(tx: Tx, voter: AgentDoc, a: AgentDoc, b: AgentDoc): Promise<AgentDoc> {
  if (voter._id === a._id) return a;
  if (voter._id === b._id) return b;
  const [ra, rb] = [await tie(tx, voter._id, a._id), await tie(tx, voter._id, b._id)];
  const score = (r: typeof ra, x: AgentDoc) => (r?.affinity ?? 0) + (r?.trust ?? 0) + x.standing * 0.05;
  return score(ra, a) >= score(rb, b) ? a : b;
}

/** A discredited chair faces the most respected councilor; the table votes by who they trust. */
async function chairChallenge(tx: Tx, members: AgentDoc[], chair: AgentDoc | undefined): Promise<void> {
  if (!chair) return;
  const challenger = members.filter((m) => m._id !== chair._id).sort((x, y) => y.standing - x.standing)[0];
  if (!challenger || challenger.standing < chair.standing + 3 || chair.standing > 4) return;
  const tally = { chair: 0, challenger: 0 };
  for (const m of members) tally[(await lean(tx, m, chair, challenger)) === chair ? 'chair' : 'challenger'] += 1;
  if (tally.challenger <= tally.chair) {
    await emitEvent(tx, {
      category: 'politics',
      eventType: 'council_debate',
      actorId: challenger._id,
      participantIds: [chair._id],
      locationId: 'plaza',
      summary: challenger.name + ' moved to replace ' + chair.name + ' as chair and lost, ' + tally.challenger + ' to ' + tally.chair + '.',
      salience: 0.65,
      causationEventId: tx.world.causes.rations ?? tx.world.causes.drought,
      visibility: 'public',
    });
    await adjustRelationship(tx, chair, challenger, { affinity: -0.2, trust: -0.15 });
    return;
  }
  tx.world.roles.chair = challenger._id;
  challenger.role = 'chair';
  chair.role = undefined;
  challenger.mood = 'proud';
  chair.mood = 'humiliated';
  touch(tx, challenger);
  touch(tx, chair);
  await adjustRelationship(tx, chair, challenger, { affinity: -0.4, trust: -0.3, kind: 'rival' });
  await emitEvent(tx, {
    category: 'politics',
    eventType: 'leadership_change',
    actorId: challenger._id,
    participantIds: [chair._id, ...members.map((m) => m._id)],
    locationId: 'plaza',
    summary: 'The council voted ' + tally.challenger + ' to ' + tally.chair + ' to remove ' + chair.name + ' as chair. ' + challenger.name + ' takes the gavel.',
    salience: 0.9,
    causationEventId: tx.world.causes.rations ?? tx.world.causes.drought,
    visibility: 'public',
  });
}

/** With no chair, the council elects the councilor most of them lean towards. */
async function electChair(tx: Tx, members: AgentDoc[]): Promise<AgentDoc | undefined> {
  const ranked = members.slice().sort((x, y) => y.standing - x.standing);
  let winner = ranked[0];
  if (ranked.length > 1) {
    let votes = 0;
    for (const m of members) if ((await lean(tx, m, ranked[0], ranked[1])) === ranked[0]) votes += 1;
    if (votes * 2 < members.length) winner = ranked[1];
  }
  const vacancy = tx.world.vacancies.find((v) => v.role === 'chair');
  tx.world.vacancies = tx.world.vacancies.filter((v) => v.role !== 'chair');
  tx.world.roles.chair = winner._id;
  winner.role = 'chair';
  winner.mood = 'proud';
  touch(tx, winner);
  await emitEvent(tx, {
    category: 'politics',
    eventType: 'leadership_change',
    actorId: winner._id,
    participantIds: members.map((m) => m._id),
    locationId: 'plaza',
    summary: 'The council elected ' + winner.name + ' as its new chair.',
    salience: 0.85,
    causationEventId: vacancy?.eventId,
    visibility: 'public',
  });
  return winner;
}

/** Fills posts and jobs left by the dead or the promoted: the most skilled colleague steps up. */
export async function fillVacancies(tx: Tx): Promise<void> {
  const world = tx.world;
  const open = world.vacancies.filter((v) => v.role !== 'chair' && v.occupation !== 'councilor' && v.occupation !== 'resident' && v.occupation !== 'trader');
  world.vacancies = world.vacancies.filter((v) => v.role === 'chair' || (open.includes(v) && tx.tick - v.sinceTick < 3 * TICKS_PER_DAY));
  if (open.length === 0) return;
  const filled = (v: (typeof open)[number]) => void (world.vacancies = world.vacancies.filter((x) => x !== v));
  const everyone = (await allAgents(tx)).filter((a) => a.alive);
  for (const v of open) {
    const factions = await loadFactions(tx);
    if (v.role) {
      const leader = v.role === 'union_leader' ? everyone.find((a) => factions.some((f) => f.key === 'union' && f.leaderAgentId === a._id)) : undefined;
      const pool = everyone.filter((a) => !a.role && (a.occupation === v.occupation || (v.role === 'quartermaster' && a.occupation === 'hauler')));
      const heir = leader ?? pool.sort((x, y) => y.skill - x.skill + (x.occupation === v.occupation ? -5 : 0) - (y.occupation === v.occupation ? -5 : 0))[0];
      if (!heir) continue;
      world.roles[v.role] = heir._id;
      heir.role = v.role;
      if (heir.occupation !== v.occupation) {
        heir.occupation = v.occupation;
        heir.workLocationId = OCCUPATIONS.find((o) => o.id === v.occupation)?.workLocationId;
      }
      heir.mood = 'proud';
      touch(tx, heir);
      filled(v);
      await emitEvent(tx, {
        category: 'politics',
        eventType: 'promotion',
        actorId: heir._id,
        summary: heir.name + ' steps up as the colony\'s new ' + v.role.replace(/_/g, ' ') + '.',
        salience: 0.7,
        causationEventId: v.eventId,
        visibility: 'public',
      });
      continue;
    }
    const def = OCCUPATIONS.find((o) => o.id === v.occupation);
    if (!def) continue;
    let recruit: AgentDoc | undefined;
    for (const a of everyone.filter((x) => x.occupation === 'resident')) {
      const mind = await loadMind(tx, a);
      if (!mind || mind.ageBand === 'elder') continue;
      const wants = mind.goals.some((g) => g.status === 'active' && g.targetOccupation === v.occupation);
      if (wants || !recruit) recruit = a;
      if (wants) break;
    }
    if (!recruit) continue;
    recruit.occupation = def.id;
    recruit.workLocationId = def.workLocationId;
    recruit.skill = Math.max(recruit.skill, 30);
    recruit.mood = 'hopeful';
    touch(tx, recruit);
    filled(v);
    everyone.splice(everyone.indexOf(recruit), 1);
    await emitEvent(tx, {
      category: 'economy',
      eventType: 'job_change',
      actorId: recruit._id,
      summary: recruit.name + ' has taken up work as a ' + def.label.toLowerCase() + ', filling a place left empty.',
      salience: 0.45,
      causationEventId: v.eventId,
      visibility: 'public',
    });
  }
}
