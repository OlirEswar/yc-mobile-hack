/**
 * Trouble: the violent, criminal, devout and hedonistic things colonists do on their own, what
 * people do when someone dies in front of them, and the hourly round that makes cults, gangs and
 * militias form and act. Persona-driven: a colonist's vice (viceOf) decides what tempts them.
 */
import type { Id } from '../_generated/dataModel';
import { ORG_KINDS } from '../../shared/society';
import { TICKS_PER_HOUR } from '../../shared/colony';
import { clamp, hash32, rand, round2 } from '../lib/rng';
import { FAILED, SECURITY, act, fail, say } from '../engine/act';
import { threaten } from '../engine/bonds';
import { firstName, isLocation, locName } from '../engine/conditions';
import { adjustRelationship, agentIndex, agentsAt, emitEvent, encodeStep, interrupt, killAgent, learnBelief, loadAgent, loadMind, tiesOf, touch, touchMind } from '../engine/core';
import type { AgentDoc, AgentId, EventId, MindDoc, Tx } from '../engine/core';
import { eavesdrop } from '../engine/intrigue';
import { cool, cooling } from '../engine/ledger';
import { Plan, findable } from '../engine/plan';
import type { Choice, Ctx } from '../engine/plan';
import { presentWith, tie } from '../engine/social';
import { addMember, canFound, kindAffinity, orgHome, orgsOf } from './orgs';
import { activeOrgs, loadMeta, saveMeta, saveOrg } from './store';
import type { OrgDoc } from './store';

export type Vice = 'violent' | 'greedy' | 'vengeful' | 'zealous' | 'manipulative' | 'hedonistic' | 'paranoid';
const VICES: Vice[] = ['violent', 'greedy', 'vengeful', 'zealous', 'manipulative', 'hedonistic', 'paranoid'];
const VICE_WHY: Record<Vice, string> = {
  violent: 'a temper that wants out',
  greedy: 'wanting more than a fair share',
  vengeful: 'a score that will not settle itself',
  zealous: 'a conviction that will not keep quiet',
  manipulative: 'a taste for pulling strings',
  hedonistic: 'refusing to waste a night on being good',
  paranoid: 'the certainty that someone is plotting',
};

/** The dark streak that drives a colonist's free hours, or null for the decent ones. Stable per person. */
export function viceOf(a: AgentDoc): Vice | null {
  if (SECURITY.has(a.occupation)) return null;
  const t = a.traits;
  const j = (salt: string) => (hash32(a.seq, 'vice' + salt) % 1000) / 1000;
  const dark = (1 - t.empathy) * 0.5 + (1 - t.caution) * 0.3 + t.ambition * 0.2 + j('d') * 0.35;
  if (dark < 0.58) return null;
  const score: Record<Vice, number> = {
    violent: 1 - t.caution + t.stubbornness,
    greedy: t.ambition * 1.7,
    vengeful: t.stubbornness + (1 - t.empathy),
    zealous: t.stubbornness + t.sociability,
    manipulative: t.ambition + (1 - t.empathy),
    hedonistic: t.sociability + (1 - t.caution),
    paranoid: t.caution * 1.2 + (1 - t.sociability),
  };
  return VICES.map((v) => ({ v, s: score[v] + j(v) * 0.9 })).sort((x, y) => y.s - x.s)[0].v;
}

const r = (tx: Tx, a: AgentDoc, salt: string): number => rand(tx.world.seed, tx.tick, a.seq, 'chaos:' + salt);
const pickLine = (lines: string[], x: number): string => lines[Math.min(lines.length - 1, Math.floor(x * lines.length))];
const num = (s: string | undefined, lo: number, hi: number, d: number): number => {
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
};
const idOf = (tx: Tx, s: string | undefined): AgentId | null => (s ? (tx.ctx.db.normalizeId('agents', s) as AgentId | null) : null);

/** True while someone is carrying out a fresh decision of their own (an LLM plan): the colony's pull does not preempt it. */
async function deliberate(tx: Tx, a: AgentDoc): Promise<boolean> {
  const plan = (await loadMind(tx, a))?.plan;
  return !!plan && plan.source === 'llm' && tx.tick - plan.createdAtTick < 18 && (a.q.length > 0 || !!a.cur);
}

async function othersHere(tx: Tx, a: AgentDoc, max = 8): Promise<AgentDoc[]> {
  const ids = await agentsAt(tx, a.locationId, { exclude: [a._id] });
  const start = ids.length > max ? Math.floor(r(tx, a, 'rot') * ids.length) : 0;
  const out: AgentDoc[] = [];
  for (let i = 0; i < ids.length && out.length < max; i++) {
    const b = await loadAgent(tx, ids[(start + i) % ids.length]);
    if (b?.alive) out.push(b);
  }
  return out;
}

/** A guard on the scene fines and holds a troublemaker. */
async function arrestBy(tx: Tx, here: AgentDoc[], culprit: AgentDoc, what: string, cause: EventId): Promise<boolean> {
  const officer = here.find((w) => w.occupation === 'security' && w._id !== culprit._id);
  if (!officer || !culprit.alive) return false;
  const fine = Math.min(culprit.inv.credits, 15);
  culprit.inv.credits = round2(culprit.inv.credits - fine);
  tx.world.econ.treasury = round2(tx.world.econ.treasury + fine);
  culprit.mood = 'angry';
  culprit.q = [encodeStep('rest', 3)];
  touch(tx, culprit);
  act(tx, officer, 'investigating', 'Arresting ' + culprit.name, culprit._id, pickLine(['That is enough. You are coming with me.', 'Hands where I can see them.', 'Fifteen credits or a night in the lockup.'], r(tx, officer, 'arr')));
  await adjustRelationship(tx, culprit, officer, { affinity: -0.2, fear: 0.2 });
  await emitEvent(tx, {
    category: 'social',
    eventType: 'arrest',
    actorId: officer._id,
    participantIds: [culprit._id],
    locationId: culprit.locationId,
    summary: officer.name + ' arrested ' + culprit.name + ' for ' + what + ' and fined them ' + Math.round(fine) + ' credits.',
    salience: 0.66,
    causationEventId: cause,
    visibility: 'public',
    witnesses: 'location',
  });
  return true;
}

const FIGHT_LINES = ['Say that again. Say it to my face.', 'You have had this coming for a long time.', 'I am done talking.', 'Nobody cheats me twice.', 'Come on, then!'];
const HIT_BACK = ['Get your hands off me!', 'You picked the wrong one.', 'I will break your jaw.', 'Help! Somebody!'];

/** A brawl or a duel between two people who are both here. Returns ticks, or FAILED when the actor died. */
async function brawl(tx: Tx, a: AgentDoc, b: AgentDoc, kind: 'fight' | 'duel', why: string, cause?: EventId): Promise<number> {
  const va = viceOf(a);
  const power = (x: AgentDoc, salt: string) => 0.4 + (1 - x.traits.caution) * 0.3 + x.traits.stubbornness * 0.2 + x.health / 200 + rand(tx.world.seed, tx.tick, x.seq, 'pow' + salt) * 0.7;
  const aWins = power(a, 'a') + (va === 'violent' ? 0.15 : 0) >= power(b, 'b');
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const duel = kind === 'duel';
  const hurtW = Math.round(2 + r(tx, a, 'hw') * (duel ? 8 : 5));
  const hurtL = Math.round((duel ? 14 : 7) + r(tx, a, 'hl') * (duel ? 22 : 12));
  act(tx, a, 'talking', (duel ? 'Duelling ' : 'Fighting ') + b.name, b._id, pickLine(FIGHT_LINES, r(tx, a, 'fl')));
  winner.health = Math.max(8, winner.health - hurtW);
  const fatal = r(tx, a, 'fatal') < (duel ? 0.12 : 0.012 + (va === 'violent' ? 0.015 : 0) + (loser.health < 30 ? 0.03 : 0));
  for (const x of [a, b]) {
    const xm = await loadMind(tx, x);
    if (!xm) continue;
    cool(tx, xm, 'brawl', 30);
    for (const g of xm.goals) if (g.predicate === 'vengeance' && g.status === 'active' && (g.targetAgentId === a._id || g.targetAgentId === b._id)) g.status = 'satisfied';
    touchMind(tx, xm);
  }
  a.mood = 'angry';
  touch(tx, winner);
  const here = (await othersHere(tx, a, 10)).filter((w) => w._id !== b._id);
  const where = locName(a.locationId);
  if (fatal) {
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: kind,
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: duel ? a.name + ' and ' + b.name + ' fought a duel at ' + where + ' ' + why + '. ' + firstName(loser.name) + ' did not get up.' : a.name + ' attacked ' + b.name + ' at ' + where + ' ' + why + ', and it went too far.',
      salience: 0.85,
      causationEventId: cause,
      visibility: 'public',
      witnesses: here.map((w) => w._id),
    });
    await killAgent(tx, loser, {
      cause: (duel ? 'killed in a duel with ' : 'beaten to death in a fight with ') + winner.name,
      summary: loser.name + ' was killed by ' + winner.name + (duel ? ' in a duel at ' : ' in a fight at ') + where + '.',
      causationEventId: eventId,
      category: 'social',
      salience: 0.95,
      killerId: winner._id,
    });
    return a.alive ? 2 : FAILED;
  }
  loser.health = Math.max(8, loser.health - hurtL);
  loser.mood = hurtL > 14 ? 'afraid' : 'angry';
  loser.needs.safety = Math.min(100, loser.needs.safety + 30);
  touch(tx, loser);
  await adjustRelationship(tx, b, a, { affinity: -0.4, trust: -0.3, fear: aWins ? 0.3 : 0 });
  await adjustRelationship(tx, a, b, { affinity: -0.25, fear: aWins ? 0 : 0.25 });
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: kind,
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: duel
      ? a.name + ' and ' + b.name + ' settled it with a duel at ' + where + ' ' + why + '. ' + firstName(winner.name) + ' won; ' + firstName(loser.name) + ' is badly hurt.'
      : a.name + ' went for ' + b.name + ' at ' + where + ' ' + why + '. ' + firstName(winner.name) + ' came out on top; ' + firstName(loser.name) + ' is bleeding.',
    salience: duel ? 0.8 : 0.68,
    causationEventId: cause,
    visibility: 'public',
    witnesses: here.map((w) => w._id),
    facts: { winnerId: winner._id, loserId: loser._id },
  });
  // The other one fights back where everyone can see, then the beaten one gets away.
  if (b.cur !== encodeStep('fight', a._id) && b.cur !== encodeStep('duel', a._id)) {
    interrupt(tx, b, aWins ? [encodeStep(kind, a._id), encodeStep('flee', b.homeLocationId)] : [encodeStep(kind, a._id)]);
    b.q = b.q.slice(0, 3);
  }
  if (!aWins) a.q = [encodeStep('flee', a.homeLocationId)];
  // Witnesses take sides.
  let i = 0;
  for (const w of here.slice(0, 6)) {
    const ta = (await tie(tx, w._id, a._id))?.affinity ?? 0;
    const tb = (await tie(tx, w._id, b._id))?.affinity ?? 0;
    w.needs.safety = Math.min(100, w.needs.safety + 12);
    if (tb > ta + 0.1) await adjustRelationship(tx, w, a, { affinity: -0.2, trust: -0.15 });
    else if (ta > tb + 0.1) await adjustRelationship(tx, w, b, { affinity: -0.15 });
    else if (i++ < 2) await learnBelief(tx, w, { kind: 'untrustworthy', text: a.name + ' starts fights.', valence: -0.7, confidence: 0.7, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId });
    say(tx, w, a._id, pickLine(ta > tb ? ['Hit him, ' + firstName(a.name) + '!', 'Finish it!'] : ['Stop it! Both of you!', 'Somebody call security!', 'Leave them alone!'], r(tx, w, 'side')));
  }
  await arrestBy(tx, here, a, duel ? 'duelling' : 'brawling', eventId);
  return 2;
}

async function fight(tx: Tx, a: AgentDoc, who: string | undefined, kind: 'fight' | 'duel'): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'Came looking for a fight, but they were gone');
  if (b.cur === encodeStep('fight', a._id) || b.cur === encodeStep('duel', a._id)) {
    act(tx, a, 'talking', 'Fighting back against ' + b.name, b._id, pickLine(HIT_BACK, r(tx, a, 'hb')));
    return 2;
  }
  const t = await tie(tx, a._id, b._id);
  if (kind === 'duel' && t?.kind === 'family') kind = 'fight';
  const why = (t?.obligation ?? 0) > 0.1 ? 'over a debt' : (t?.kind === 'romance' || t?.kind === 'partner') ? 'in a jealous rage' : (t?.affinity ?? 0) < -0.4 ? 'over an old grudge' : 'over an insult';
  return brawl(tx, a, b, kind, why);
}

async function rob(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The mark was gone');
  if (b.traits.stubbornness > 0.62 && r(tx, a, 'resist') < 0.3) return brawl(tx, a, b, 'fight', 'when ' + firstName(b.name) + ' refused to hand over their credits');
  const res = b.inv.credits >= 4 ? 'credits' : b.inv.food >= 1 ? 'food' : 'water';
  const take = res === 'credits' ? Math.min(b.inv.credits, Math.round(6 + r(tx, a, 'take') * 22)) : Math.min(b.inv[res], 2);
  if (take <= 0) return fail(tx, a, firstName(b.name) + ' had nothing worth taking');
  b.inv[res] = round2(b.inv[res] - take);
  a.inv[res] = round2(a.inv[res] + take);
  act(tx, a, 'stealing', 'Robbing ' + b.name, b._id, pickLine(['Empty your pockets. Quietly.', 'Your credits. Now.', 'Do not make me ask twice.'], r(tx, a, 'rl')));
  say(tx, b, a._id, pickLine(['Take it! Just take it!', 'You will pay for this.', 'Please, that is all I have.'], r(tx, b, 'rv')));
  b.mood = 'afraid';
  b.needs.safety = Math.min(100, b.needs.safety + 40);
  touch(tx, b);
  await adjustRelationship(tx, b, a, { affinity: -0.5, trust: -0.5, fear: 0.35 });
  const here = (await othersHere(tx, a, 8)).filter((w) => w._id !== b._id);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'robbery',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' robbed ' + b.name + ' of ' + Math.round(take) + ' ' + res + ' at ' + locName(a.locationId) + '.',
    salience: 0.68,
    visibility: here.length > 0 ? 'public' : 'local',
    witnesses: here.map((w) => w._id),
    facts: { resource: res, quantity: take },
  });
  const belief = { kind: 'thief', text: a.name + ' robs people.', valence: -0.9, subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId };
  await learnBelief(tx, b, { ...belief, confidence: 1, sourceType: 'observed' });
  for (const w of here.slice(0, 3)) await learnBelief(tx, w, { ...belief, confidence: 0.8, sourceType: 'observed' });
  await arrestBy(tx, here, a, 'robbery', eventId);
  return 1;
}

async function extort(tx: Tx, a: AgentDoc, mind: MindDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'Nobody to shake down here');
  const org = (await orgsOf(tx, mind)).find((o) => o.kind === 'gang' || o.kind === 'militia' || o.kind === 'cult');
  const banner = org ? org.name : firstName(a.name);
  act(tx, a, 'talking', 'Shaking down ' + b.name, b._id, pickLine(['Nice stall. Shame if something happened to it.', 'Protection is ten credits a sol. You want protection.', 'Everyone pays ' + banner + '. Today it is your turn.'], r(tx, a, 'el')));
  const grit = b.traits.stubbornness * 0.6 + (1 - b.traits.caution) * 0.3 + rand(tx.world.seed, tx.tick, b.seq, 'grit') * 0.4;
  if (b.inv.credits < 3 || grit > 0.85) {
    say(tx, b, a._id, pickLine(['I am not paying you a thing.', 'Get out before I call the wardens.'], r(tx, b, 'er')));
    await adjustRelationship(tx, b, a, { affinity: -0.3, trust: -0.3 });
    await emitEvent(tx, { category: 'social', eventType: 'extortion_refused', actorId: b._id, participantIds: [a._id], locationId: a.locationId, summary: b.name + ' refused to pay protection to ' + banner + (org ? ' when ' + a.name + ' came collecting' : '') + '.', salience: 0.6, visibility: 'public', witnesses: 'location' });
    a.q = [encodeStep(viceOf(a) === 'vengeful' ? 'vandalize' : 'fight', viceOf(a) === 'vengeful' ? a.locationId : b._id), ...a.q].slice(0, 6);
    return 1;
  }
  const pay = Math.min(b.inv.credits, Math.round(5 + r(tx, a, 'pay') * 10));
  b.inv.credits = round2(b.inv.credits - pay);
  if (org) {
    org.treasury = round2(org.treasury + pay / 2);
    await saveOrg(tx, org);
    a.inv.credits = round2(a.inv.credits + pay / 2);
  } else a.inv.credits = round2(a.inv.credits + pay);
  say(tx, b, a._id, pickLine(['Fine. Take it and go.', 'This is the last time.', 'Here. Just leave my family alone.'], r(tx, b, 'ep')));
  b.mood = 'afraid';
  b.needs.safety = Math.min(100, b.needs.safety + 25);
  touch(tx, b);
  await adjustRelationship(tx, b, a, { affinity: -0.3, trust: -0.3, fear: 0.3 });
  await emitEvent(tx, {
    category: 'social',
    eventType: 'extortion',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' collected ' + Math.round(pay) + ' credits of protection money from ' + b.name + (org ? ' for ' + org.name : '') + ' at ' + locName(a.locationId) + '.',
    salience: 0.62,
    visibility: 'local',
    witnesses: 'location',
    facts: { orgId: org?._id, quantity: pay },
  });
  return 1;
}

async function vandalize(tx: Tx, a: AgentDoc, loc: string | undefined): Promise<number> {
  const here = a.locationId;
  if (loc && isLocation(loc) && loc !== here) return fail(tx, a, 'Not where the damage was meant to be done');
  tx.world.damage[here] = round2(Math.min(1, (tx.world.damage[here] ?? 0) + 0.04));
  act(tx, a, 'stealing', 'Smashing things up at ' + locName(here), undefined, pickLine(['Let them clean this up.', 'This is what they get.', 'Burn it all.'], r(tx, a, 'vl')));
  const seen = await othersHere(tx, a, 6);
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'vandalism', actorId: seen.length > 0 ? a._id : undefined, participantIds: seen.length > 0 ? [] : [], locationId: here, summary: seen.length > 0 ? a.name + ' smashed up equipment at ' + locName(here) + ' in front of everyone.' : 'Someone smashed up equipment at ' + locName(here) + ' while nobody was looking.', salience: 0.5, visibility: 'public', witnesses: seen.map((w) => w._id) });
  for (const w of seen.slice(0, 3)) await learnBelief(tx, w, { kind: 'saboteur', text: a.name + ' wrecks colony equipment.', valence: -0.8, confidence: 0.85, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId });
  await arrestBy(tx, seen, a, 'vandalism', eventId);
  return 2;
}

async function gamble(tx: Tx, a: AgentDoc, ticks: number): Promise<number> {
  const b = (await othersHere(tx, a, 6)).find((x) => x.inv.credits >= 2 && x.occupation !== 'security' && !x.move);
  if (!b || a.inv.credits < 1) {
    act(tx, a, 'resting', 'Rolling dice alone at ' + locName(a.locationId), undefined, 'Anyone want to make this interesting?');
    return 1;
  }
  const stake = Math.round(Math.min(a.inv.credits, b.inv.credits, 3 + r(tx, a, 'stake') * 14));
  const cheat = viceOf(a) === 'manipulative' || viceOf(a) === 'greedy';
  const win = r(tx, a, 'dice') < (cheat ? 0.66 : 0.5);
  const winner = win ? a : b;
  const loser = win ? b : a;
  winner.inv.credits = round2(winner.inv.credits + stake);
  loser.inv.credits = round2(loser.inv.credits - stake);
  act(tx, a, 'trading', 'Gambling with ' + b.name, b._id, win ? pickLine(['Read them and weep.', 'Double or nothing?'], r(tx, a, 'gl')) : pickLine(['One more round. My luck is turning.', 'You rigged that.'], r(tx, a, 'gl')));
  say(tx, b, a._id, win ? pickLine(['Nobody rolls that well.', 'Again. I want it back.'], r(tx, b, 'gb')) : 'Pleasure doing business.');
  touch(tx, b);
  const sore = stake >= 8 || loser.inv.credits < 5;
  if (sore) await adjustRelationship(tx, loser, winner, { affinity: -0.2, trust: -0.15 });
  const caught = cheat && win && r(tx, a, 'caught') < 0.25;
  await emitEvent(tx, { category: 'social', eventType: 'gambling', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: winner.name + ' took ' + stake + ' credits off ' + loser.name + ' at dice in ' + locName(a.locationId) + (caught ? ', and ' + firstName(b.name) + ' caught the loaded die.' : sore ? '. ' + firstName(loser.name) + ' did not take it well.' : '.'), salience: caught ? 0.6 : sore ? 0.45 : 0.3, visibility: 'local', witnesses: sore ? 'location' : undefined });
  if (caught || (sore && loser._id === b._id && b.traits.stubbornness > 0.6 && r(tx, b, 'sore') < 0.4)) interrupt(tx, b, [encodeStep('fight', a._id)]);
  return Math.max(1, ticks);
}

async function carouse(tx: Tx, a: AgentDoc, ticks: number): Promise<number> {
  const others = await othersHere(tx, a, 5);
  const b = others[0];
  a.needs.social = Math.max(0, a.needs.social - 30);
  a.needs.fatigue = Math.min(100, a.needs.fatigue + 4);
  a.mood = 'merry';
  act(tx, a, 'drinking', 'Drinking hard at ' + locName(a.locationId), b?._id, pickLine(['Another round! The council is paying!', 'To the eleven, and to hell with the rest.', 'I could run this colony better drunk.', 'Sing with me, you cowards!'], r(tx, a, 'cl')));
  if (b && r(tx, a, 'insult') < 0.06 + (1 - a.traits.caution) * 0.12) {
    say(tx, b, a._id, pickLine(['Watch your mouth.', 'You are drunk. Sit down.'], r(tx, b, 'ci')));
    await adjustRelationship(tx, b, a, { affinity: -0.2 });
    await emitEvent(tx, { category: 'social', eventType: 'insult', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ', drunk at ' + locName(a.locationId) + ', insulted ' + b.name + ' in front of everyone.', salience: 0.45, visibility: 'local', witnesses: 'location' });
    if (b.traits.stubbornness > 0.7 || viceOf(b) === 'violent') interrupt(tx, b, [encodeStep('fight', a._id)]);
  } else if (b) await adjustRelationship(tx, b, a, { affinity: 0.05 });
  return Math.max(1, ticks);
}

const FLAVOUR: Record<string, { activity: 'resting' | 'talking' | 'mourning'; label: string; lines: string[]; mood?: string }> = {
  dance: { activity: 'talking', label: 'Dancing at ', lines: ['Come on, dance with me!', 'Louder! Play it louder!', 'One night without the dark. Just one.'], mood: 'merry' },
  celebrate: { activity: 'talking', label: 'Celebrating at ', lines: ['We did it! Did you see that?', 'Tonight I buy the water!', 'I cannot believe my luck!'], mood: 'elated' },
  cry: { activity: 'mourning', label: 'Weeping at ', lines: ['No. No, no, no.', 'Why them? Why now?', 'I cannot do this.'], mood: 'grieving' },
  pray: { activity: 'resting', label: 'Praying at ', lines: ['Eleven lamps, watch over us.', 'The dark comes back. Let me be ready.', 'Forgive what I am about to do.'] },
};

async function flavour(tx: Tx, a: AgentDoc, kind: string, ticks: number): Promise<number> {
  const f = FLAVOUR[kind];
  const b = kind === 'dance' || kind === 'celebrate' ? (await othersHere(tx, a, 3))[0] : undefined;
  if (f.mood) a.mood = f.mood;
  if (kind !== 'cry') a.needs.social = Math.max(0, a.needs.social - 15);
  act(tx, a, f.activity, f.label + locName(a.locationId), b?._id, pickLine(f.lines, r(tx, a, kind)));
  if (b) await adjustRelationship(tx, b, a, { affinity: 0.06 });
  return Math.max(1, ticks);
}

async function kiss(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'They were not there');
  const back = await tie(tx, b._id, a._id);
  if (back?.kind === 'family') return fail(tx, a, 'Thought better of it');
  act(tx, a, 'talking', 'Kissing ' + b.name, b._id, pickLine(['Nobody is looking. Come here.', 'I have wanted to do that all sol.', 'Tell me to stop.'], r(tx, a, 'kl')));
  if ((back?.affinity ?? 0) < 0.2 && viceOf(b) !== 'hedonistic') {
    say(tx, b, a._id, pickLine(['What do you think you are doing?', 'Do not ever try that again.'], r(tx, b, 'kr')));
    await adjustRelationship(tx, b, a, { affinity: -0.2, trust: -0.1 });
    a.mood = 'humiliated';
    return 1;
  }
  say(tx, b, a._id, pickLine(['Not here. ...All right, here.', 'You took your time.'], r(tx, b, 'ky')));
  a.mood = 'elated';
  b.mood = 'elated';
  touch(tx, b);
  const pair = back?.kind === 'partner';
  await adjustRelationship(tx, a, b, { affinity: 0.15, trust: 0.05, kind: pair ? undefined : 'romance' });
  await adjustRelationship(tx, b, a, { affinity: 0.15, trust: 0.05, kind: pair ? undefined : 'romance' });
  const cheated: AgentDoc[] = [];
  for (const x of [a, b]) {
    const partner = (await tiesOf(tx, x._id)).find((t) => t.kind === 'partner' && t.toAlive && t.toAgentId !== a._id && t.toAgentId !== b._id);
    const p = partner ? await loadAgent(tx, partner.toAgentId) : null;
    if (p) cheated.push(p);
  }
  const seen = (await othersHere(tx, a, 6)).filter((w) => w._id !== b._id);
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: cheated.length > 0 ? 'affair_tryst' : 'tryst', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' and ' + b.name + ' were kissing at ' + locName(a.locationId) + (cheated.length > 0 ? ', and ' + firstName(cheated[0].name) + ' does not know.' : '.'), salience: cheated.length > 0 ? 0.62 : 0.45, visibility: 'local', witnesses: seen.map((w) => w._id) });
  if (cheated.length > 0) {
    for (const w of seen.slice(0, 3)) await learnBelief(tx, w, { kind: 'affair', text: a.name + ' and ' + b.name + ' are having an affair.', valence: -0.5, confidence: 0.85, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId });
    const p = cheated.find((c) => seen.some((w) => w._id === c._id));
    if (p) interrupt(tx, p, [encodeStep('fight', (p._id === cheated[0]._id ? a : b)._id)]);
  }
  return 1;
}

async function chase(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'Lost them');
  const dest = b.homeLocationId !== a.locationId ? b.homeLocationId : 'plaza';
  act(tx, a, 'walking', 'Chasing ' + b.name, b._id, pickLine(['Get back here!', 'You cannot run forever!'], r(tx, a, 'ch')));
  interrupt(tx, b, [encodeStep('flee', dest)]);
  b.mood = 'afraid';
  a.q = [encodeStep('go', dest), encodeStep('fight', b._id), ...a.q].slice(0, 6);
  return 1;
}

async function ritual(tx: Tx, a: AgentDoc, mind: MindDoc, orgId: string | undefined): Promise<number> {
  const org = (await orgsOf(tx, mind)).find((o) => o._id === orgId) ?? (await orgsOf(tx, mind))[0];
  if (!org) return fail(tx, a, 'Had nobody to gather');
  const gathered: AgentId[] = [];
  for (const id of org.memberIds) {
    if (id === a._id || gathered.length >= 8) continue;
    const m = await loadAgent(tx, id);
    if (!m?.alive || m.activity === 'sleeping' || (await deliberate(tx, m))) continue;
    interrupt(tx, m, m.locationId === a.locationId ? [encodeStep('pray', 3)] : [encodeStep('go', a.locationId), encodeStep('pray', 3)]);
    m.q = m.q.slice(0, 4);
    gathered.push(m._id);
  }
  const gang = org.kind === 'gang' || org.kind === 'militia';
  act(tx, a, 'talking', (gang ? 'Swearing in the crew of ' : 'Leading the rite of ') + org.name, gathered[0], gang ? pickLine(['Blood in. Nobody walks out.', 'We take care of our own. Say it.'], r(tx, a, 'rg')) : pickLine(['The eleven are watching. Kneel.', 'The dark is coming back, and only we will be ready.', 'Give what you owe, and be counted.'], r(tx, a, 'rc')));
  const bystanders = (await othersHere(tx, a, 6)).filter((w) => !org.memberIds.includes(w._id));
  for (const w of bystanders.slice(0, 4)) {
    w.needs.safety = Math.min(100, w.needs.safety + 8);
    touch(tx, w);
  }
  await emitEvent(tx, { category: 'social', eventType: 'ritual', actorId: a._id, participantIds: gathered, locationId: a.locationId, summary: gang ? a.name + ' gathered ' + org.name + ' at ' + locName(a.locationId) + ' and made every one of them swear an oath.' : a.name + ' called ' + org.name + ' together at ' + locName(a.locationId) + ' for a rite; ' + (gathered.length + 1) + ' of them knelt in the open.', salience: 0.6, visibility: 'public', witnesses: 'location', facts: { orgId: org._id } });
  return 3;
}

async function overBody(tx: Tx, a: AgentDoc, kind: 'gloat' | 'rush' | 'inspect', who: string | undefined, suspect: string | undefined): Promise<number> {
  const id = idOf(tx, who);
  const d = id ? await loadAgent(tx, id) : null;
  if (!d) return 0;
  const body = d.alive ? '' : "'s body";
  if (kind === 'gloat') {
    act(tx, a, 'talking', 'Gloating over ' + d.name + body, d._id, pickLine(['Good riddance.', 'Not so loud now, are you?', 'I told you how this would end.'], r(tx, a, 'gl')));
    for (const w of (await othersHere(tx, a, 4)).slice(0, 3)) await adjustRelationship(tx, w, a, { affinity: -0.12 });
    return 1;
  }
  if (kind === 'rush') {
    act(tx, a, 'helping', 'Rushing to ' + d.name + body, d._id, pickLine(['Somebody get a medic!', firstName(d.name) + '! Can you hear me?', 'Oh no. Oh, no.', 'Give them air!'], r(tx, a, 'ru')));
    return 1;
  }
  act(tx, a, 'investigating', 'Examining ' + d.name + body, d._id, pickLine(['Nobody leaves. What happened here?', 'Who saw it? Speak up.', 'Stand back, all of you.'], r(tx, a, 'in')));
  const sid = idOf(tx, suspect);
  const killer = sid ? await loadAgent(tx, sid) : null;
  if (killer?.alive) {
    const fine = round2(killer.inv.credits / 2);
    killer.inv.credits = round2(killer.inv.credits - fine);
    tx.world.econ.treasury = round2(tx.world.econ.treasury + fine);
    interrupt(tx, killer, [encodeStep('go', 'plaza'), encodeStep('rest', 12)]);
    killer.q = killer.q.slice(0, 2);
    killer.mood = 'afraid';
    await emitEvent(tx, { category: 'social', eventType: 'arrest', actorId: a._id, participantIds: [killer._id, d._id], locationId: a.locationId, summary: a.name + ' arrested ' + killer.name + ' for the killing of ' + d.name + ' and marched them to the plaza lockup.', salience: 0.82, visibility: 'public', witnesses: 'location' });
  }
  return 2;
}

async function loot(tx: Tx, a: AgentDoc): Promise<number> {
  const pile = tx.world.stockpiles[a.locationId];
  const res = pile && (pile.water ?? 0) >= 3 ? 'water' : pile && (pile.food ?? 0) >= 3 ? 'food' : null;
  if (!pile || !res) return fail(tx, a, 'Nothing here worth grabbing');
  pile[res] = round2(pile[res] - 3);
  a.inv[res] = round2(a.inv[res] + 3);
  act(tx, a, 'stealing', 'Looting ' + res + ' at ' + locName(a.locationId), undefined, pickLine(['Take what you can carry!', 'It is every household for itself now.'], r(tx, a, 'lo')));
  const { eventId } = await emitEvent(tx, { category: 'social', eventType: 'looting', actorId: a._id, locationId: a.locationId, summary: a.name + ' grabbed armfuls of ' + res + ' from ' + locName(a.locationId) + ' and ran.', salience: 0.6, visibility: 'public', witnesses: 'location', facts: { resource: res } });
  await arrestBy(tx, await othersHere(tx, a, 8), a, 'looting', eventId);
  return 1;
}

/** Starts one of the steps above. Returns null when the step is not one of them. */
export async function startChaosStep(tx: Tx, a: AgentDoc, mind: MindDoc, type: string, args: string[]): Promise<number | null> {
  const [x, y] = args;
  switch (type) {
    case 'fight':
    case 'duel':
      return fight(tx, a, x, type);
    case 'rob':
      return rob(tx, a, x);
    case 'extort':
      return extort(tx, a, mind, x);
    case 'vandalize':
      return vandalize(tx, a, x);
    case 'intimidate':
      return threaten(tx, a, x);
    case 'spy':
      return eavesdrop(tx, a, x);
    case 'gamble':
      return gamble(tx, a, num(x, 1, 3, 2));
    case 'carouse':
      return carouse(tx, a, num(x, 1, 3, 2));
    case 'dance':
    case 'celebrate':
    case 'cry':
    case 'pray':
      return flavour(tx, a, type, num(x, 1, 3, 2));
    case 'kiss':
      return kiss(tx, a, x);
    case 'chase':
      return chase(tx, a, x);
    case 'ritual':
      return ritual(tx, a, mind, x);
    case 'gloat':
    case 'rush':
    case 'inspect':
      return overBody(tx, a, type, x, y);
    case 'loot':
      return loot(tx, a);
    default:
      return null;
  }
}

// ---------- what tempts them ----------

type Cand = { w: number; intent: string; plan: Plan; key: string; score?: number };

/** One non-routine thing this colonist feels like doing now, by their vice, their enemies and who is around. */
export async function chaosChoices(c: Ctx): Promise<Choice[]> {
  const { tx, a, mind, p } = c;
  if (mind.ageBand === 'child' || p >= 96 || p < 2 || a.health < 30) return [];
  if (cooling(mind, 'chaos', tx.tick)) return [];
  const watched = tx.world.focusAgentId === a._id || !!tx.world.orbitIds?.includes(a._id);
  const vice = viceOf(a);
  const roll = (s: string) => r(tx, a, 'c' + s);
  if (!watched && roll('gate') > (c.free ? 0.75 : vice ? 0.45 : 0.25)) return [];
  const calm = cooling(mind, 'brawl', tx.tick) || a.health < 50;
  const here = (await othersHere(tx, a, 6)).filter((b) => !b.move);
  const enemyTie = c.ties.filter((t) => t.toAlive && t.affinity < -0.25).sort((x, y) => x.affinity - y.affinity)[0];
  const found = enemyTie ? await findable(c, enemyTie.toAgentId) : null;
  const enemy = found && found.health >= 35 ? found : null;
  const crushTie = c.ties.filter((t) => t.toAlive && t.affinity > 0.35 && t.kind !== 'family').sort((x, y) => y.affinity - x.affinity)[0];
  const crush = crushTie ? await findable(c, crushTie.toAgentId) : null;
  const orgs = await orgsOf(tx, mind);
  const gang = orgs.find((o) => o.kind === 'gang' || o.kind === 'militia');
  const cult = orgs.find((o) => o.kind === 'cult');
  const is = (...v: Vice[]) => !!vice && v.includes(vice);
  const at = (to: string) => new Plan(a.locationId).go(to);
  const out: Cand[] = [];

  const avenge = mind.goals.find((g) => g.status === 'active' && g.targetAgentId && /^(Make|Avenge) /.test(g.description));
  const killer = avenge ? await findable(c, avenge.targetAgentId) : null;
  if (killer && !calm) out.push({ w: 6, score: 1.1, key: 'avenge', intent: 'Going to make ' + killer.name + ' answer for it, face to face', plan: at(killer.locationId).add(a.traits.stubbornness > 0.5 ? 'duel' : 'fight', [killer._id], 'Confronting ' + killer.name) });

  if (enemy) {
    const n = firstName(enemy.name);
    if (!calm && (is('violent', 'vengeful') || enemyTie.affinity < -0.6)) out.push({ w: is('violent', 'vengeful') ? 1.6 : 0.5, key: 'fight', intent: 'Done swallowing it: going to have it out with ' + enemy.name, plan: at(enemy.locationId).add(enemyTie.affinity < -0.85 && a.traits.stubbornness > 0.7 ? 'duel' : 'fight', [enemy._id], 'Picking a fight with ' + n) });
    if (is('paranoid', 'manipulative')) out.push({ w: 2.5, key: 'spy', intent: 'Finding out what ' + enemy.name + ' is really up to', plan: at(enemy.locationId).add('spy', [enemy._id], 'Spying on ' + n) });
    if (is('greedy', 'manipulative', 'violent')) out.push({ w: 1.5, key: 'intimidate', intent: 'Reminding ' + enemy.name + ' who they are dealing with', plan: at(enemy.locationId).add('intimidate', [enemy._id], 'Leaning on ' + n) });
    if (is('vengeful') && enemy.workLocationId) out.push({ w: 2, key: 'vandalize', intent: 'Wrecking something ' + enemy.name + ' cares about', plan: at(enemy.workLocationId).add('vandalize', [enemy.workLocationId], 'Smashing up ' + n + "'s workplace") });
    const hearer = here.find((b) => b._id !== enemy._id);
    if (is('manipulative', 'vengeful', 'paranoid') && hearer) out.push({ w: 2, key: 'lie', intent: 'Poisoning ' + firstName(hearer.name) + ' against ' + enemy.name, plan: new Plan(a.locationId).add('lie', [hearer._id, enemy._id, pickLine(['thief', 'hoarding', 'corrupt', 'affair', 'coward'], roll('lk'))], 'Telling ' + firstName(hearer.name) + ' a story about ' + n) });
  }
  const outsider = (b: AgentDoc) => !orgs.some((o) => o.memberIds.includes(b._id)) && b.occupation !== 'security';
  const mark = here.filter((b) => outsider(b) && b.inv.credits >= 8).sort((x, y) => y.inv.credits - x.inv.credits)[0];
  if (gang || is('greedy')) {
    if (mark) out.push({ w: gang ? 3.5 : 1.5, key: 'extort', intent: gang ? 'Collecting what ' + firstName(mark.name) + ' owes ' + gang.name : 'Squeezing ' + mark.name + ' for protection money', plan: new Plan(a.locationId).add('extort', [mark._id], 'Shaking down ' + firstName(mark.name)) });
    else if (gang) {
      const ids = await agentsAt(tx, 'market', { exclude: [a._id] });
      const shop = ids.length > 0 ? await loadAgent(tx, ids[Math.floor(roll('shop') * ids.length)]) : null;
      if (shop && outsider(shop)) out.push({ w: 3, key: 'extort', intent: 'Making the rounds of the stalls for ' + gang.name, plan: at('market').add('extort', [shop._id], 'Shaking down ' + firstName(shop.name)) });
    }
  }
  if (is('greedy', 'violent') && mark && here.length <= 4 && mark.inv.credits >= 15) out.push({ w: 2, key: 'rob', intent: 'Nobody much is watching, and ' + mark.name + ' is carrying credits', plan: new Plan(a.locationId).add('rob', [mark._id], 'Robbing ' + firstName(mark.name)) });
  if (a.inv.credits >= 3) out.push({ w: is('hedonistic') ? 3 : is('greedy') ? 2.2 : 0.8, key: 'gamble', intent: 'Trying my luck at dice in the canteen', plan: at('canteen').add('gamble', [2], 'Gambling at the Airlock Canteen').add('talk', ['any'], 'Crowing about it') });
  if (c.free || is('hedonistic')) {
    out.push({ w: is('hedonistic') ? 3 : is('violent') ? 1.5 : 0.6, key: 'carouse', intent: 'Drinking until this sol stops mattering', plan: at('canteen').add('carouse', [2], 'Drinking hard at the Airlock Canteen').add('talk', ['any'], 'Holding forth at the bar') });
    out.push({ w: is('hedonistic') ? 2 : 0.7, key: 'dance', intent: 'Dancing, because nobody knows how many sols are left', plan: at(roll('dv') < 0.5 ? 'canteen' : 'plaza').add('dance', [2], 'Dancing').add('talk', ['any'], 'Catching my breath with someone') });
  }
  if (crush && (is('hedonistic') || crushTie.affinity > 0.5)) out.push({ w: is('hedonistic') ? 2.5 : 1, key: 'kiss', intent: 'Finding ' + crush.name + ' and not being careful about it', plan: at(crush.locationId).add('court', [crush._id], 'Flirting with ' + firstName(crush.name)).add('kiss', [crush._id], 'Kissing ' + firstName(crush.name)) });
  if (cult && cult.leaderId === a._id && !cooling(mind, 'ritual', tx.tick)) out.push({ w: 4, key: 'ritual', intent: 'Calling ' + cult.name + ' together for a rite', plan: at(roll('rv') < 0.5 ? 'plaza' : orgHome(cult)).add('ritual', [cult._id], 'Leading the rite').add('preach', [''], 'Preaching to whoever stayed') });
  if (gang && gang.leaderId === a._id && !cooling(mind, 'ritual', tx.tick) && roll('oath') < 0.3) out.push({ w: 2, key: 'ritual', intent: 'Making the crew swear to ' + gang.name + ' again', plan: at(orgHome(gang)).add('ritual', [gang._id], 'Swearing in the crew') });
  if (is('zealous') || cult) {
    out.push({ w: 2.5, key: 'preach', intent: 'Telling the plaza what is coming, whether they want to hear it or not', plan: at('plaza').add('preach', [''], 'Preaching at the Commons Plaza').add('talk', ['any'], 'Arguing with a doubter') });
    out.push({ w: 1, key: 'pray', intent: 'Praying at the memorial wall', plan: at('plaza').add('pray', [2], 'Praying at the memorial wall') });
  }
  const stranger = here.find((b) => b._id !== enemy?._id && b.occupation !== 'security');
  if (stranger) {
    if (is('paranoid', 'manipulative')) out.push({ w: 1.5, key: 'spy', intent: 'Listening in on ' + stranger.name + '; everyone is hiding something', plan: new Plan(a.locationId).add('spy', [stranger._id], 'Eavesdropping on ' + firstName(stranger.name)) });
    if (is('violent') && !enemy && !calm) out.push({ w: 1, key: 'fight', intent: 'Did not like the way ' + stranger.name + ' looked at me', plan: new Plan(a.locationId).add(roll('vf') < 0.3 ? 'fight' : 'intimidate', [stranger._id], 'Squaring up to ' + firstName(stranger.name)) });
  }
  if (is('vengeful') && !enemy && tx.world.econ.rationLevel >= 1) out.push({ w: 1, key: 'vandalize', intent: 'Making the council feel it', plan: at('depot').add('vandalize', ['depot'], 'Smashing up the Supply Depot') });

  const total = out.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return [];
  let x = roll('pick') * total;
  const chosen = out.find((o) => (x -= o.w) <= 0) ?? out[0];
  return [
    {
      score: chosen.score ?? 0.8 + (vice ? 0.06 : 0) + (watched ? 0.08 : 0) + (c.free ? 0.05 : 0),
      routine: false,
      intent: chosen.intent,
      steps: chosen.plan.steps,
      labels: chosen.plan.labels,
      trigger: chosen.key === 'avenge' ? 'a death to answer for' : vice ? VICE_WHY[vice] : 'restless',
      cooldown: { key: chosen.key === 'ritual' ? 'ritual' : 'chaos', ticks: chosen.key === 'ritual' ? 30 : watched ? 2 : 7 },
    },
  ];
}

// ---------- death in front of people ----------

export type DeathScene = { cause: string; killerId?: AgentId; here: AgentId[]; closeIds: AgentId[] };

/** Everyone at the scene reacts at once: guards investigate, loved ones run to the body, enemies gloat, the timid run. */
export async function deathReactions(tx: Tx, dead: AgentDoc, eventId: EventId, scene: DeathScene): Promise<void> {
  const killer = scene.killerId ? await loadAgent(tx, scene.killerId) : null;
  const elsewhere = dead.locationId === dead.homeLocationId ? 'plaza' : dead.homeLocationId;
  let guard = false;
  for (const id of scene.here.slice(0, 10)) {
    const w = await loadAgent(tx, id);
    if (!w?.alive || w.activity === 'sleeping') continue;
    if (killer && w._id === killer._id) {
      if (w.traits.caution > 0.5) interrupt(tx, w, [encodeStep('flee', w.homeLocationId === w.locationId ? 'plaza' : w.homeLocationId)]);
      else interrupt(tx, w, [encodeStep('gloat', dead._id)]);
      w.q = w.q.slice(0, 2);
      continue;
    }
    const aff = (await tie(tx, w._id, dead._id))?.affinity ?? 0;
    const close = scene.closeIds.includes(w._id) || aff >= 0.3;
    let line: string;
    if (w.occupation === 'security' && !guard) {
      guard = true;
      interrupt(tx, w, [killer ? encodeStep('inspect', dead._id, killer._id) : encodeStep('inspect', dead._id)]);
      line = 'Everybody stay where you are!';
    } else if (close) {
      interrupt(tx, w, [encodeStep('rush', dead._id), encodeStep('cry', 2)]);
      w.mood = 'grieving';
      line = firstName(dead.name) + '! No!';
    } else if (w.occupation === 'medic') {
      interrupt(tx, w, [encodeStep('rush', dead._id)]);
      line = 'Let me through, I am a medic!';
    } else if (aff <= -0.3) {
      interrupt(tx, w, [w.traits.empathy < 0.45 ? encodeStep('gloat', dead._id) : encodeStep('flee', elsewhere)]);
      line = 'Well. That settles that.';
    } else if (w.traits.caution > 0.55) {
      interrupt(tx, w, [encodeStep('flee', w.homeLocationId === w.locationId ? 'plaza' : w.homeLocationId)]);
      w.mood = 'afraid';
      line = 'Run! Get out of here!';
    } else {
      interrupt(tx, w, [encodeStep('rush', dead._id)]);
      line = 'Is ' + firstName(dead.name) + ' breathing?';
    }
    w.speech = line;
    w.interactingWithId = dead._id;
    w.needs.safety = Math.min(100, w.needs.safety + 20);
    touch(tx, w);
    if (killer) await learnBelief(tx, w, { kind: 'suspect', text: killer.name + ' killed ' + dead.name + '.', valence: -1, confidence: 0.95, sourceType: 'observed', subjectAgentId: killer._id, subjectName: killer.name, originEventId: eventId, truthEventId: eventId });
  }
  for (const id of scene.closeIds.slice(0, 4)) {
    const m = await loadAgent(tx, id);
    const mind = m?.alive ? await loadMind(tx, m) : null;
    if (!m || !mind) continue;
    if (killer?.alive && killer._id !== m._id) {
      await learnBelief(tx, m, { kind: 'suspect', text: killer.name + ' killed ' + dead.name + '.', valence: -1, confidence: 0.9, sourceType: 'told', subjectAgentId: killer._id, subjectName: killer.name, originEventId: eventId, truthEventId: eventId });
      if (m.traits.empathy < 0.75) mind.goals.push({ id: 'g' + mind.nextGoalSeq++, kind: 'custom', description: 'Make ' + killer.name + ' pay for killing ' + dead.name, priority: 0.9, source: 'event', status: 'active', targetAgentId: killer._id, targetAgentName: killer.name, createdAtTick: tx.tick, predicate: 'vengeance', drive: 'revenge' });
    } else {
      mind.goals.push({ id: 'g' + mind.nextGoalSeq++, kind: 'custom', description: 'Grieve for ' + dead.name + ' and see them buried properly', priority: 0.6, source: 'event', status: 'active', createdAtTick: tx.tick, expiresAtTick: tx.tick + 144, predicate: 'none' });
    }
    mind.goals = mind.goals.slice(-8);
    touchMind(tx, mind);
  }
  const meta = (await loadMeta(tx)) as unknown as { funerals?: { id: string; name: string; tick: number; eventId: string }[] };
  meta.funerals = [...(meta.funerals ?? []), { id: dead._id, name: dead.name, tick: tx.tick + 3 * TICKS_PER_HOUR, eventId }].slice(-6);
  await saveMeta(tx);
}

async function funerals(tx: Tx): Promise<void> {
  const meta = (await loadMeta(tx)) as unknown as { funerals?: { id: string; name: string; tick: number; eventId: string }[] };
  const due = (meta.funerals ?? []).filter((f) => f.tick <= tx.tick);
  if (due.length === 0) return;
  meta.funerals = (meta.funerals ?? []).filter((f) => f.tick > tx.tick);
  for (const f of due) {
    const ties = await tx.ctx.db.query('relationships').withIndex('by_to', (q) => q.eq('toAgentId', f.id as Id<'agents'>)).collect();
    const mourners: AgentDoc[] = [];
    for (const t of ties.sort((x, y) => y.affinity - x.affinity)) {
      if (mourners.length >= 10 || t.affinity < 0.15) break;
      const m = await loadAgent(tx, t.fromAgentId);
      if (m?.alive && m.activity !== 'sleeping' && !(await deliberate(tx, m))) mourners.push(m);
    }
    if (mourners.length === 0) continue;
    mourners.forEach((m, i) => {
      interrupt(tx, m, [encodeStep('go', 'plaza'), ...(i < 2 ? [encodeStep('cry', 2)] : []), encodeStep('mourn', f.id)]);
      m.q = m.q.slice(0, 5);
      m.mood = 'grieving';
    });
    await emitEvent(tx, { category: 'social', eventType: 'funeral', actorId: mourners[0]._id, participantIds: mourners.slice(1).map((m) => m._id), locationId: 'plaza', summary: 'The colony is gathering at the memorial wall to bury ' + f.name + '. ' + firstName(mourners[0].name) + ' will speak for them.', salience: 0.75, causationEventId: f.eventId as EventId, visibility: 'public' });
  }
}

// ---------- cults, gangs and militias form and act ----------

const DARK = ['gang', 'cult', 'militia'];

async function emerge(tx: Tx, orgs: OrgDoc[]): Promise<void> {
  const meta = await loadMeta(tx);
  const dark = orgs.filter((o) => DARK.includes(o.kind)).length;
  const want = 2 + Math.floor(tx.tick / 60);
  if (dark >= want || tx.tick - meta.lastFoundTick < 2 * TICKS_PER_HOUR) return;
  const scared = meta.fearUntil > tx.tick || tx.world.econ.rationLevel >= 1;
  const order = scared ? ['cult', 'gang', 'militia'] : tx.tick % 2 === 0 ? ['gang', 'militia', 'cult'] : ['militia', 'gang', 'cult'];
  let kind: string | undefined;
  for (const k of order) if (await canFound(tx, k)) { kind = k; break; }
  if (!kind) return;
  const index = await agentIndex(tx);
  const start = Math.floor(rand(tx.world.seed, tx.tick, 'emerge') * index.length);
  let best: { a: AgentDoc; f: number } | null = null;
  for (let i = 0; i < 24; i++) {
    const a = await loadAgent(tx, index[(start + i * 3) % index.length]);
    if (!a?.alive || a.activity === 'sleeping' || a.role || a.occupation === 'security' || a._id === tx.world.focusAgentId || (await deliberate(tx, a))) continue;
    if (orgs.some((o) => o.leaderId === a._id)) continue;
    const mind = await loadMind(tx, a);
    if (!mind || mind.ageBand === 'child') continue;
    const f = kindAffinity(kind, a, mind) + (viceOf(a) ? 0.15 : 0) + a.traits.sociability * 0.1;
    if (!best || f > best.f) best = { a, f };
  }
  if (!best) return;
  const home = kind === 'gang' ? (orgs.some((o) => o.kind === 'gang') ? 'depot' : 'landing_pad') : (ORG_KINDS[kind]?.home ?? 'plaza');
  interrupt(tx, best.a, [encodeStep('go', home), encodeStep('found_org', kind, ''), encodeStep('preach', '')]);
  best.a.q = best.a.q.slice(0, 4);
}

async function awake(tx: Tx, ids: AgentId[], max: number, skip?: AgentId): Promise<AgentDoc[]> {
  const out: AgentDoc[] = [];
  for (const id of ids) {
    if (out.length >= max) break;
    const m = await loadAgent(tx, id);
    if (m?.alive && m.activity !== 'sleeping' && m._id !== skip && m._id !== tx.world.focusAgentId && !(await deliberate(tx, m))) out.push(m);
  }
  return out;
}

async function orgsAct(tx: Tx, orgs: OrgDoc[]): Promise<void> {
  for (const org of orgs) {
    if (!DARK.includes(org.kind) || org.memberIds.length < 2) continue;
    const x = rand(tx.world.seed, tx.tick, org._id, 'orgact');
    if (x > 0.3) continue;
    const members = await awake(tx, org.memberIds, 4, org.leaderId);
    if (members.length === 0) continue;
    const rival = orgs.find((o) => o._id !== org._id && DARK.includes(o.kind) && o.kind !== 'cult' && org.kind !== 'cult' && o.memberIds.length > 0);
    if (rival && x < 0.05) {
      const foes = await awake(tx, rival.memberIds, 2);
      if (foes.length > 0) {
        if (!org.rivalIds.includes(rival._id)) {
          org.rivalIds.push(rival._id);
          await saveOrg(tx, org);
        }
        members.slice(0, 2).forEach((m, i) => {
          const foe = foes[i % foes.length];
          interrupt(tx, m, [encodeStep('go', foe.locationId), encodeStep('fight', foe._id)]);
          m.q = m.q.slice(0, 3);
        });
        await emitEvent(tx, { category: 'social', eventType: 'turf_war', actorId: members[0]._id, participantIds: [...members.slice(1, 2).map((m) => m._id), ...foes.map((f) => f._id)], locationId: foes[0].locationId, summary: org.name + ' is moving on ' + rival.name + ': ' + firstName(members[0].name) + ' has gone looking for ' + firstName(foes[0].name) + ' at ' + locName(foes[0].locationId) + '.', salience: 0.72, visibility: 'public', facts: { orgId: org._id, rivalId: rival._id } });
        continue;
      }
    }
    if (org.kind === 'cult') {
      const leader = org.leaderId ? await loadAgent(tx, org.leaderId) : null;
      if (leader?.alive && leader.activity !== 'sleeping' && leader._id !== tx.world.focusAgentId && x < 0.25 && !(await deliberate(tx, leader))) {
        const where = x < 0.12 ? 'plaza' : orgHome(org);
        interrupt(tx, leader, [encodeStep('go', where), encodeStep('ritual', org._id), encodeStep('preach', '')]);
        leader.q = leader.q.slice(0, 4);
      } else {
        const m = members[0];
        interrupt(tx, m, [encodeStep('go', 'plaza'), encodeStep('preach', ''), encodeStep('pray', 2)]);
        m.q = m.q.slice(0, 4);
      }
      continue;
    }
    // gangs and militias make the rounds
    for (const venue of ['market', 'canteen', 'depot']) {
      const ids = await agentsAt(tx, venue, { exclude: org.memberIds });
      if (ids.length === 0) continue;
      const mark = await loadAgent(tx, ids[Math.floor(x * 97) % ids.length]);
      if (!mark || mark.occupation === 'security') continue;
      members.slice(0, 2).forEach((m, i) => {
        interrupt(tx, m, [encodeStep('go', venue), encodeStep(i === 0 ? 'extort' : 'intimidate', mark._id)]);
        m.q = m.q.slice(0, 3);
      });
      break;
    }
  }
}

/** A small cult, gang or militia swears in whoever near its leader is the type. */
async function initiations(tx: Tx, orgs: OrgDoc[]): Promise<void> {
  for (const org of orgs) {
    if (!DARK.includes(org.kind) || org.memberIds.length >= 5 || !org.leaderId) continue;
    const leader = await loadAgent(tx, org.leaderId);
    if (!leader?.alive || leader.activity === 'sleeping' || leader.move || (await deliberate(tx, leader))) continue;
    let best: { a: AgentDoc; mind: MindDoc; f: number } | null = null;
    for (const b of await othersHere(tx, leader, 8)) {
      if (b.role || b.occupation === 'security' || b.move || orgs.some((o) => o.memberIds.includes(b._id)) || (await deliberate(tx, b))) continue;
      const mind = await loadMind(tx, b);
      if (!mind || mind.ageBand === 'child') continue;
      const f = kindAffinity(org.kind, b, mind) + (viceOf(b) ? 0.2 : 0);
      if (f > 0.45 && (!best || f > best.f)) best = { a: b, mind, f };
    }
    if (!best) continue;
    await addMember(tx, org, best.a, best.mind);
    act(tx, leader, 'talking', 'Swearing ' + best.a.name + ' into ' + org.name, best.a._id, org.kind === 'cult' ? 'Kneel. The eleven see you now.' : 'You are one of us now. There is no leaving.');
    say(tx, best.a, leader._id, org.kind === 'cult' ? 'I am ready.' : 'I am in.');
    await emitEvent(tx, { category: 'social', eventType: 'org_initiation', actorId: leader._id, participantIds: [best.a._id], locationId: leader.locationId, summary: leader.name + ' swore ' + best.a.name + ' into ' + org.name + ' at ' + locName(leader.locationId) + '.', salience: 0.58, visibility: 'local', witnesses: 'location', facts: { orgId: org._id } });
  }
}

/** Once an hour: funerals that are due, new cults/gangs/militias from the colony's mood, and the ones that exist making themselves felt. */
export async function chaosHourly(tx: Tx): Promise<void> {
  await funerals(tx);
  const hour = (Math.floor(tx.tick / TICKS_PER_HOUR) + 6) % 24;
  if (hour < 8 || hour >= 23) return;
  const orgs = await activeOrgs(tx);
  await emerge(tx, orgs);
  await initiations(tx, orgs);
  await orgsAct(tx, orgs);
}
