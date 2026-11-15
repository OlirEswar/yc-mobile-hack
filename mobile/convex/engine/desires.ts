/**
 * Plans that come from wanting something rather than needing it: romance, revenge or peace,
 * digging for the truth, comforting a friend, confiding or confessing a secret, protecting a secret
 * someone has found out, using leverage, settling or collecting debts, rallying the crews, buying
 * off an investigation, and squirrelling supplies away when times look bad. Each is scored from the
 * persona's drives, traits, ties and what the agent believes, so schedules bend to desire.
 */
import { TICKS_PER_DAY } from '../../shared/colony';
import { clamp } from '../lib/rng';
import { BONUS_AT } from '../lib/constants';
import { droughtSeverity, locName, reserveRatio, scarcityCause, stormAt } from './conditions';
import { learnBelief, loadAgent, loadMind, touchMind } from './core';
import type { AgentDoc, BeliefDoc, Tx } from './core';
import { cooling, ledgerOf } from './ledger';
import { Plan, chance, findable } from './plan';
import type { Choice, Ctx } from './plan';
import { isScandal } from './secrets';
import { RALLY_QUORUM } from './collective';
import { simState } from './state';
import { ACCUSE_KINDS, truthAbout } from './social';
import { intentLine } from './text';

const TROUBLED = new Set(['grieving', 'afraid', 'shaken', 'humiliated', 'betrayed', 'ailing', 'lonely', 'sombre']);

export async function desireChoices(c: Ctx): Promise<Choice[]> {
  const out: (Choice | null)[] = [];
  // Desires mostly fill free time; a strong one can pull someone off shift.
  const weight = c.free ? 1 : c.shift ? 0.55 : 0;
  if (weight === 0) return [];
  out.push(await romance(c), await feud(c), await uncover(c), await comfortFriend(c), await confideIn(c));
  out.push(await guardSecret(c), await useLeverage(c), ...(await debts(c)), await rallyCrews(c), await buyOffCase(c), await hoard(c));
  return out.filter((x): x is Choice => !!x).map((x) => ({ ...x, score: x.score * weight }));
}

const vars = (c: Ctx, who?: AgentDoc, place?: string) => ({ me: c.a.name, who: who?.name, place: place ?? who?.locationId });

/** The person this colonist is drawn to: a partner first, else the warmest unattached tie. */
async function beloved(c: Ctx): Promise<{ b: AgentDoc; partner: boolean } | null> {
  const partner = c.ties.find((t) => t.kind === 'romance' && t.toAlive);
  if (partner) {
    const b = await findable(c, partner.toAgentId);
    return b ? { b, partner: true } : null;
  }
  const crush = c.ties.filter((t) => t.toAlive && t.kind !== 'family' && t.kind !== 'rival' && t.affinity >= 0.3 && !c.household?.memberIds.includes(t.toAgentId)).sort((x, y) => y.affinity - x.affinity)[0];
  const b = crush ? await findable(c, crush.toAgentId) : null;
  return b ? { b, partner: false } : null;
}

async function romance(c: Ctx): Promise<Choice | null> {
  const { a } = c;
  const drawn = c.drives.has('romance') ? 0.25 : 0;
  const lonely = a.needs.social > 60 && a.traits.sociability > 0.6;
  if (!drawn && !lonely && chance(c, 'romance?') > 0.05) return null;
  const found = await beloved(c);
  if (!found) return null;
  const { b, partner } = found;
  if (cooling(c.mind, 'court:' + b._id, c.tx.tick)) return null;
  const secretAffair = !partner && c.ties.some((t) => t.kind === 'romance' && t.toAlive);
  const key = partner ? 'desire.partner' : secretAffair ? 'desire.affair' : 'desire.court';
  const plan = new Plan(a.locationId).go(b.locationId, 'Looking for ' + b.name + ' at ' + locName(b.locationId)).add('court', [b._id], (partner ? 'Spending time with ' : 'Flirting with ') + b.name);
  if (b.locationId === 'canteen' || b.locationId === 'plaza') plan.add('rest', [4], 'Lingering at ' + locName(b.locationId) + ' near ' + b.name);
  return {
    score: (partner ? 0.28 : 0.3) + drawn + a.traits.sociability * 0.15 + a.needs.social / 250 + chance(c, 'love') * 0.1,
    routine: false,
    intent: intentLine(key, chance(c, 'i-love'), vars(c, b)),
    ...plan,
    trigger: partner ? 'misses ' + b.name : 'drawn to ' + b.name,
    cooldown: { key: 'court:' + b._id, ticks: partner ? 48 : 18 },
  };
}

/** A grudge played out by temperament: lies, listening for dirt, threats, sabotage, or peace. */
async function feud(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  const grudge = c.ties.filter((t) => t.toAlive && t.affinity <= -0.3 && t.kind !== 'family').sort((x, y) => x.affinity - y.affinity)[0];
  if (!grudge) return null;
  const enemy = await findable(c, grudge.toAgentId);
  if (!enemy || cooling(c.mind, 'feud:' + enemy._id, tx.tick)) return null;
  const cooldown = { key: 'feud:' + enemy._id, ticks: 48 };
  const t = a.traits;
  const vengeful = c.drives.has('revenge') ? 0.3 : 0;
  const heat = -grudge.affinity * 0.4 + vengeful + (1 - t.empathy) * 0.1;
  const peace = t.empathy * 0.35 + c.mind.values.harmony * 0.35 - t.stubbornness * 0.25 - vengeful;
  const r = chance(c, 'feud');
  if (peace > 0.3 && r < 0.5) {
    return { score: 0.22 + peace * 0.4, routine: false, intent: intentLine('desire.reconcile', chance(c, 'i-rec'), vars(c, enemy)), ...new Plan(a.locationId).go(enemy.locationId, 'Looking for ' + enemy.name).add('reconcile', [enemy._id], 'Making peace with ' + enemy.name), trigger: 'tired of the feud with ' + enemy.name, cooldown };
  }
  if (heat < 0.3 || r > 0.35 + vengeful) return null;
  const scheme = c.weights.scheme + c.weights.steal * 0.3;
  let plan: Plan;
  let key: string;
  let place = enemy.locationId;
  if (scheme >= 0.5 && chance(c, 'feud-how') < 0.5) {
    place = chance(c, 'feud-venue') < 0.6 ? 'canteen' : 'plaza';
    key = 'desire.lie';
    const kinds = ['thief', 'hoarding', 'corrupt', 'affair', 'coward', 'saboteur'];
    plan = new Plan(a.locationId).go(place).add('lie', ['any', enemy._id, kinds[Math.floor(chance(c, 'lie-kind') * kinds.length)]], 'Telling tales about ' + enemy.name);
  } else if (t.curiosity > 0.5 || scheme >= 0.5) {
    key = 'desire.eavesdrop';
    plan = new Plan(a.locationId).go(enemy.locationId, 'Following ' + enemy.name).add('eavesdrop', [enemy._id], 'Listening in on ' + enemy.name);
  } else if (t.empathy < 0.3 && t.ambition > 0.65 && enemy.workLocationId && enemy.workLocationId !== a.workLocationId && stormAt(tx.world, enemy.workLocationId) === 0 && chance(c, 'sab') < 0.25) {
    key = 'desire.sabotage';
    place = enemy.workLocationId;
    plan = new Plan(a.locationId).go(place).add('sabotage', [place], 'Tampering with the machinery at ' + locName(place));
  } else if (t.stubbornness > 0.5) {
    key = 'desire.threaten';
    plan = new Plan(a.locationId).go(enemy.locationId, 'Going after ' + enemy.name).add('threaten', [enemy._id], 'Threatening ' + enemy.name);
  } else return null;
  return { score: 0.25 + heat * 0.5, routine: false, intent: intentLine(key, chance(c, 'i-feud'), vars(c, enemy, place)), ...plan, trigger: 'a grudge against ' + enemy.name, cooldown };
}

/** The curious, and anyone driven to know what really happened, listen in on people who matter. */
async function uncover(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  if ((!c.drives.has('uncover') && a.traits.curiosity < 0.7) || cooling(c.mind, 'uncover', tx.tick)) return null;
  if (chance(c, 'uncover') > 0.25 + (c.drives.has('uncover') ? 0.25 : 0)) return null;
  const roles = Object.values(tx.world.roles).filter((id) => id !== a._id);
  const candidates = [...c.ties.filter((t) => t.toAlive && t.trust < 0).map((t) => t.toAgentId), ...roles];
  const pickId = candidates[Math.floor(chance(c, 'mark') * candidates.length)];
  const target = await findable(c, pickId);
  if (!target) return null;
  return { score: 0.3 + a.traits.curiosity * 0.2 + (c.drives.has('uncover') ? 0.2 : 0), routine: false, intent: intentLine('desire.uncover', chance(c, 'i-unc'), vars(c, target)), ...new Plan(a.locationId).go(target.locationId, 'Following ' + target.name).add('eavesdrop', [target._id], 'Listening in on ' + target.name), trigger: 'wants to know what ' + target.name + ' is hiding', cooldown: { key: 'uncover', ticks: 48 } };
}

async function comfortFriend(c: Ctx): Promise<Choice | null> {
  const { a } = c;
  if (a.traits.empathy < 0.45) return null;
  for (const t of c.ties.slice(0, 8)) {
    if (!t.toAlive || t.affinity < 0.25) continue;
    const b = await findable(c, t.toAgentId);
    if (!b || !(TROUBLED.has(b.mood) || b.needs.safety > 50) || cooling(c.mind, 'comfort:' + b._id, c.tx.tick)) continue;
    return { score: 0.3 + a.traits.empathy * 0.3 + t.affinity * 0.2, routine: false, intent: intentLine('desire.comfort', chance(c, 'i-com'), vars(c, b)), ...new Plan(a.locationId).go(b.locationId, 'Going to ' + b.name).add('comfort', [b._id], 'Comforting ' + b.name), trigger: b.name + ' is ' + b.mood, cooldown: { key: 'comfort:' + b._id, ticks: 72 } };
  }
  return null;
}

/** Someone carrying a secret or a heavy worry, lonely enough, opens up to the person they trust most. */
async function confideIn(c: Ctx): Promise<Choice | null> {
  const { a } = c;
  const secret = c.mind.persona?.secret;
  const burdened = (secret && secret.exposedAtTick === undefined) || c.beliefs.some((b) => b.private && b.confidence > 0.6);
  if (!burdened || a.needs.social < 40 || cooling(c.mind, 'confide', c.tx.tick) || chance(c, 'confide?') > 0.25 + a.traits.sociability * 0.2) return null;
  const tie = c.ties.filter((t) => t.toAlive && t.trust >= 0.3 && t.affinity >= 0.3).sort((x, y) => y.trust - x.trust)[0];
  const b = tie ? await findable(c, tie.toAgentId) : null;
  if (!b) return null;
  const crisis = c.mind.persona?.arc.stage === 'crisis' ? 0.2 : 0;
  return { score: 0.25 + a.needs.social / 300 + crisis, routine: false, intent: intentLine('desire.confide', chance(c, 'i-conf'), vars(c, b)), ...new Plan(a.locationId).go(b.locationId, 'Looking for ' + b.name).add('confide', [b._id], 'Confiding in ' + b.name), trigger: 'needs to tell someone', cooldown: { key: 'confide', ticks: 96 } };
}

/** The people who know (or may know) this colonist's secret, by the beliefs that say so. */
const threats = (c: Ctx): BeliefDoc[] => c.beliefs.filter((b) => (b.kind === 'knows_secret' || b.kind === 'blackmailer') && b.subjectAgentId && (b.acted === undefined || c.tx.tick - b.acted > TICKS_PER_DAY));

/** Someone whose secret is known moves to contain it: buy silence, scare them off, discredit them, or confess. */
async function guardSecret(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  const secret = c.mind.persona?.secret;
  const known = threats(c)[0];
  if (!known || !secret || secret.exposedAtTick !== undefined) return null;
  const holder = await findable(c, known.subjectAgentId);
  if (!holder || cooling(c.mind, 'guard:' + holder._id, tx.tick)) return null;
  const t = a.traits;
  const decency = t.empathy * 0.4 + c.mind.values.harmony * 0.4;
  const blackmailed = known.kind === 'blackmailer';
  let key: string;
  let plan: Plan;
  if (decency > 0.55 && (blackmailed || chance(c, 'confess') < 0.3)) {
    key = 'desire.confess';
    plan = new Plan(a.locationId).go('plaza').add('confess', ['secret'], 'Confessing at the Commons Plaza');
  } else if (a.inv.credits >= 25 && !blackmailed) {
    key = 'secret.bribe';
    plan = new Plan(a.locationId).go(holder.locationId, 'Finding ' + holder.name).add('bribe', [holder._id, Math.min(40, Math.floor(a.inv.credits * 0.5)), 'silence'], 'Buying ' + holder.name + "'s silence");
  } else if (t.stubbornness > 0.55 || blackmailed) {
    key = 'secret.threaten';
    plan = new Plan(a.locationId).go(holder.locationId, 'Finding ' + holder.name).add('threaten', [holder._id], 'Warning ' + holder.name + ' off');
  } else {
    key = 'secret.discredit';
    plan = new Plan(a.locationId).go('canteen').add('lie', ['any', holder._id, 'thief'], 'Spreading a story about ' + holder.name);
  }
  await tx.ctx.db.patch(known._id, { acted: tx.tick });
  return { score: 0.55 + (blackmailed ? 0.2 : 0), routine: false, intent: intentLine(key, chance(c, 'i-guard'), vars(c, holder)), ...plan, trigger: holder.name + (blackmailed ? ' is blackmailing me' : ' may know my secret'), causeEventId: known.originEventId, cooldown: { key: 'guard:' + holder._id, ticks: 144 } };
}

/** What to do with a scandal one knows about someone: blackmail them, or tell the world. */
async function useLeverage(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  const lever = c.beliefs.filter((b) => b.subjectAgentId && b.subjectAgentId !== a._id && b.valence < 0 && isScandal(b.kind) && b.confidence >= 0.6 && (b.acted === undefined || tx.tick - b.acted > TICKS_PER_DAY)).sort((x, y) => y.confidence - x.confidence)[0];
  if (!lever) return null;
  const mark = await findable(c, lever.subjectAgentId);
  if (!mark || cooling(c.mind, 'lever:' + mark._id, tx.tick)) return null;
  const affinity = c.ties.find((t) => t.toAgentId === mark._id)?.affinity ?? 0;
  if (affinity > 0.4) return null;
  const schemer = c.weights.scheme;
  const greed = (c.drives.has('wealth') || c.drives.has('escape') || c.drives.has('power') ? 0.2 : 0) + (1 - a.traits.empathy) * 0.2;
  if (schemer >= 0.45 && greed + schemer > 0.6 && chance(c, 'lever') < 0.5) {
    return { score: 0.35 + schemer * 0.3 + greed, routine: false, intent: intentLine('desire.blackmail', chance(c, 'i-bm'), vars(c, mark)), ...new Plan(a.locationId).go(mark.locationId, 'Finding ' + mark.name).add('blackmail', [mark._id, lever.key], 'Leaning on ' + mark.name), trigger: 'knows what ' + mark.name + ' is hiding', causeEventId: lever.originEventId, cooldown: { key: 'lever:' + mark._id, ticks: 144 } };
  }
  // Scandals the planner's accusation logic does not cover get thrown into the open by the righteous.
  if (ACCUSE_KINDS.has(lever.kind) || a.traits.stubbornness + c.mind.values.harmony < 1 || chance(c, 'expose') > 0.4) return null;
  if ((await truthAbout(tx, lever.kind, mark)).settled) return null;
  return { score: 0.4 + a.traits.stubbornness * 0.2, routine: false, intent: intentLine('desire.expose', chance(c, 'i-exp'), vars(c, mark)), ...new Plan(a.locationId).go(mark.locationId, 'Finding ' + mark.name).add('accuse', [mark._id, lever.key], 'Exposing ' + mark.name), trigger: 'will not keep ' + mark.name + "'s secret", causeEventId: lever.originEventId, cooldown: { key: 'lever:' + mark._id, ticks: 144 } };
}

/** Debtors pay back when they can; lenders chase, lean, gossip or forgive. */
async function debts(c: Ctx): Promise<Choice[]> {
  const { a, tx } = c;
  const out: Choice[] = [];
  for (const d of (c.mind.ledger?.owes ?? []).slice(0, 2)) {
    const res = d.res as 'food' | 'water' | 'credits' | 'parts' | 'medicine';
    const can = a.inv[res] >= Math.min(d.qty, 1) || (res !== 'credits' && a.inv.credits >= d.qty * (tx.world.prices[res] ?? 1));
    if (!can) continue;
    const lender = await findable(c, d.to);
    if (!lender || cooling(c.mind, 'repay:' + lender._id, tx.tick)) continue;
    const late = d.dueTick < tx.tick ? 0.25 : 0;
    out.push({ score: 0.3 + late + d.pressed * 0.15 + a.traits.empathy * 0.1 + (c.mind.values.status > 0.6 ? 0.05 : 0), routine: false, intent: intentLine('debt.repay', chance(c, 'i-repay'), vars(c, lender)), ...new Plan(a.locationId).go(lender.locationId, 'Looking for ' + lender.name).add('repay', [lender._id], 'Paying ' + lender.name + ' back'), trigger: 'owes ' + lender.name + ' ' + d.qty + ' ' + d.res, causeEventId: d.eventId, cooldown: { key: 'repay:' + lender._id, ticks: 18 } });
  }
  for (const b of c.beliefs) {
    if (b.kind !== 'debt' || !b.subjectAgentId || (b.acted !== undefined && tx.tick - b.acted < 72)) continue;
    const debtor = await loadAgent(tx, b.subjectAgentId);
    const dm = debtor?.alive ? await loadMind(tx, debtor) : null;
    const owed = dm ? ledgerOf(dm).owes.find((d) => d.to === a._id && d.dueTick < tx.tick) : undefined;
    if (!debtor || !dm || !owed) continue;
    await tx.ctx.db.patch(b._id, { acted: tx.tick });
    const t = a.traits;
    if (t.empathy > 0.7 && owed.pressed >= 1 && chance(c, 'forgive') < 0.4) {
      ledgerOf(dm).owes = ledgerOf(dm).owes.filter((d) => d !== owed);
      touchMind(tx, dm);
      await tx.ctx.db.patch(b._id, { text: a.name + ' forgave ' + debtor.name + ' the ' + owed.qty + ' ' + owed.res + ' owed.', valence: 0.3 });
      continue;
    }
    if (owed.pressed >= 2 && t.stubbornness > 0.45) {
      await learnBelief(tx, a, { kind: 'untrustworthy', text: debtor.name + ' borrows and never pays back.', valence: -1, confidence: 0.8, sourceType: 'observed', subjectAgentId: debtor._id, subjectName: debtor.name, originEventId: owed.eventId, truthEventId: owed.eventId });
      out.push({ score: 0.35 + t.stubbornness * 0.2, routine: false, intent: intentLine('debt.slander', chance(c, 'i-sland'), vars(c, debtor, 'canteen')), ...new Plan(a.locationId).go('canteen').add('talk', ['any', 'untrustworthy:' + debtor._id], 'Warning people about ' + debtor.name).add('talk', ['any', 'untrustworthy:' + debtor._id], 'Telling someone else about ' + debtor.name), trigger: debtor.name + ' still has not paid', causeEventId: owed.eventId });
      continue;
    }
    const target = await findable(c, debtor._id);
    if (!target) continue;
    owed.pressed += 1;
    touchMind(tx, dm);
    out.push({ score: 0.35 + (1 - t.empathy) * 0.2 + owed.pressed * 0.05, routine: false, intent: intentLine('debt.collect', chance(c, 'i-coll'), { ...vars(c, target), res: owed.res, when: 'Sol ' + (Math.floor(owed.tick / TICKS_PER_DAY) + 1) }), ...new Plan(a.locationId).go(target.locationId, 'Tracking down ' + target.name).add(t.empathy > 0.6 && owed.pressed <= 1 ? 'talk' : 'threaten', [target._id], 'Collecting from ' + target.name), trigger: target.name + ' owes ' + owed.qty + ' ' + owed.res, causeEventId: owed.eventId });
  }
  return out;
}

/** How aggrieved the crews feel: cut rations, unpaid wages, a hostile chair, a cause they believe in. */
function grievance(c: Ctx): number {
  const econ = c.tx.world.econ;
  const chair = c.tx.world.roles.chair;
  const toChair = chair ? c.ties.find((t) => t.toAgentId === chair)?.affinity ?? 0 : 0;
  const believes = c.beliefs.find((b) => b.key === 'policy_open')?.confidence ?? 0;
  return econ.rationLevel * 0.25 + (econ.wagesUnpaid > 0 ? 0.25 : 0) - toChair * 0.3 + believes * 0.2 + (c.drives.has('union') ? 0.25 : 0) + droughtSeverity(c.tx.world) * 0.2;
}

/** A union voice with a grievance, or anyone who loathes the chair, takes it to the plaza. */
async function rallyCrews(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  const sim = await simState(tx);
  const leads = c.factions.some((f) => f.leaderAgentId === a._id || f.officerIds.includes(a._id));
  const g = grievance(c);
  const chair = tx.world.roles.chair;
  const hatesChair = chair && chair !== a._id ? -(c.ties.find((t) => t.toAgentId === chair)?.affinity ?? 0) : 0;
  let topic: string | null = null;
  const hardship = tx.world.econ.rationLevel > 0 || tx.world.econ.wagesUnpaid > 0 || c.drought > 0;
  if (a.factionId === 'union' && (leads || c.drives.has('union')) && !sim.strike && g > 0.45) topic = g > 0.6 && (hardship || leads) ? 'strike' : hardship || reserveRatio(tx.world) > BONUS_AT ? 'rations_open' : null;
  if (!topic && hatesChair > 0.45 && a.standing > 2 && (c.drives.has('power') || leads)) topic = 'recall_chair';
  if (!topic || cooling(c.mind, 'rally', tx.tick)) return null;
  if ((sim.rallies ?? []).some((x) => x.topic === topic && x.supporters.length >= RALLY_QUORUM && tx.tick - x.tick < TICKS_PER_DAY)) return null;
  const why = { strike: 'a strike', rations_open: 'full rations', recall_chair: 'the recall of the chair' }[topic];
  return { score: 0.3 + clamp(Math.max(g, hatesChair), 0, 1) * 0.4 + (leads ? 0.1 : 0), routine: false, intent: intentLine('desire.rally', chance(c, 'i-rally'), { me: a.name, why }), ...new Plan(a.locationId).go('plaza').add('rally', [topic], 'Rallying the plaza for ' + why), trigger: topic === 'recall_chair' ? 'fed up with the chair' : 'the crews have had enough', causeEventId: tx.world.causes.rations ?? scarcityCause(tx.world), cooldown: { key: 'rally', ticks: 36 } };
}

/** A thief with an open case against them tries to buy off the officer on it. */
async function buyOffCase(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  if (a.inv.credits < 15 || c.weights.scheme < 0.4) return null;
  const sim = await simState(tx);
  const kase = sim.cases.find((k) => k.suspectId === a._id);
  if (!kase) return null;
  const chiefId = tx.world.roles.security_chief;
  const officer = chiefId ? await findable(c, chiefId) : null;
  if (!officer || cooling(c.mind, 'bribe:' + officer._id, tx.tick)) return null;
  return { score: 0.55 + (1 - a.traits.empathy) * 0.2, routine: false, intent: intentLine('case.bribe', chance(c, 'i-case'), vars(c, officer)), ...new Plan(a.locationId).go(officer.locationId, 'Finding ' + officer.name).add('bribe', [officer._id, Math.min(40, Math.floor(a.inv.credits * 0.6)), 'look_away'], 'Paying off ' + officer.name), trigger: 'an open case with my name on it', causeEventId: kase.eventId, cooldown: { key: 'bribe:' + officer._id, ticks: 288 } };
}

/** When the wells run dry, the anxious hide some of what they carry at home. */
async function hoard(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  const scared = droughtSeverity(tx.world) > 0 || c.beliefs.some((b) => b.key === 'scarcity:water' && b.confidence > 0.5);
  const res = a.inv.water >= 4 ? 'water' : a.inv.food >= 4 ? 'food' : null;
  if (!scared || !res || a.traits.caution < 0.5 || cooling(c.mind, 'hoard', tx.tick) || chance(c, 'hoard') > 0.4) return null;
  const n = Math.floor(a.inv[res] - 1);
  return { score: 0.35 + a.traits.caution * 0.2, routine: false, intent: intentLine('hide', chance(c, 'i-hide'), { me: a.name, res, n }), ...new Plan(a.locationId).go(a.homeLocationId, 'Going home').add('hide', [res, n], 'Hiding ' + n + ' ' + res + ' at home'), trigger: 'expects things to get worse', causeEventId: scarcityCause(tx.world, res), cooldown: { key: 'hoard', ticks: 72 } };
}

/** Whether the striker should stay off the job: union members during a strike, unless they scab. */
export async function onStrike(tx: Tx, a: AgentDoc): Promise<boolean> {
  const sim = await simState(tx);
  if (!sim.strike || a.factionId !== 'union') return false;
  const mind = await loadMind(tx, a);
  return (mind?.values.wealth ?? 0) - (mind?.values.harmony ?? 0) < 0.4;
}
