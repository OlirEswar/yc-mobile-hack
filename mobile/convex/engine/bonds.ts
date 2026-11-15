/**
 * The verbs of closeness and conflict between two people: confiding, courting, comforting,
 * threatening and making peace. They move affinity, trust, fear and obligation, create romances and
 * affairs, and pass secrets along to people who may not keep them.
 */
import { clamp, rand, round2 } from '../lib/rng';
import { FAILED, act, fail, roll, say } from './act';
import { firstName, locName } from './conditions';
import { adjustRelationship, agentsAt, emitEvent, enqueueCognition, learnBelief, loadAgent, loadMind, touch, touchMind } from './core';
import type { AgentDoc, AgentId, Tx } from './core';
import { addDeed, debtsTo, ledgerOf } from './ledger';
import { repay } from './livelihood';
import { statusOf } from './people';
import { learnSecret, secretOf } from './secrets';
import { beliefsOf, getBelief, presentWith, tie } from './social';
import { line } from './text';

const TROUBLED = new Set(['grieving', 'afraid', 'shaken', 'humiliated', 'betrayed', 'parched', 'starving', 'ailing', 'lonely', 'anxious', 'sombre']);

/** Current romantic partners of a colonist (ties of kind romance they hold). */
export async function partnersOf(tx: Tx, id: AgentId): Promise<AgentId[]> {
  const ties = await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', id))
    .order('desc')
    .take(16);
  return ties.filter((t) => t.kind === 'romance' && t.toAlive).map((t) => t.toAgentId);
}

// ---------- confide ----------

export async function confide(tx: Tx, a: AgentDoc, who: string | undefined, key: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The one person ' + firstName(a.name) + ' trusts was not at ' + locName(a.locationId));
  const toB = await tie(tx, a._id, b._id);
  if ((toB?.trust ?? 0) < 0.15 && (toB?.affinity ?? 0) < 0.35) return fail(tx, a, 'Could not bring ' + firstName(a.name) + 'self to open up to ' + b.name);
  const mind = await loadMind(tx, a);
  const r = roll(tx, a, 'confide');
  act(tx, a, 'talking', 'Confiding in ' + b.name, b._id, line('confide.share', r, { you: b.name }));
  say(tx, b, a._id, line('confide.listen', r, { you: a.name }));
  a.needs.social = Math.max(0, a.needs.social - 35);
  a.needs.safety = Math.max(0, a.needs.safety - 15);
  await adjustRelationship(tx, b, a, { affinity: 0.1, trust: 0.12 });
  await adjustRelationship(tx, a, b, { affinity: 0.06, trust: 0.08 });
  const secret = await secretOf(tx, a);
  const chosen = key ? await getBelief(tx, a._id, key) : null;
  const shareSecret = secret && (key === 'secret' || key?.startsWith(secret.kind + ':') || (!chosen && (toB?.trust ?? 0) + roll(tx, a, 'open') * 0.5 > 0.6));
  let summary: string;
  let salience = 0.3;
  if (shareSecret) {
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: 'secret_shared',
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: a.name + ' trusted ' + b.name + ' with the thing ' + firstName(a.name) + ' has hidden from everyone: ' + secret!.text.replace(/\.$/, '') + '.',
      salience: 0.6,
      visibility: 'private',
    });
    await learnSecret(tx, b, a, secret!, 'confided', eventId, a);
    // Someone who loves to talk and does not much care may not keep it to themselves.
    if (b.traits.sociability - b.traits.empathy > 0.15 || rand(tx.world.seed, tx.tick, b.seq, 'loose') < 0.15) {
      const held = await getBelief(tx, b._id, secret!.kind + ':' + a._id);
      if (held) await tx.ctx.db.patch(held._id, { private: false });
    }
    return 3;
  }
  const worry = chosen ?? (await beliefsOf(tx, a._id)).filter((x) => x.private && x.subjectAgentId !== b._id).sort((x, y) => y.confidence - x.confidence)[0];
  if (worry) {
    await learnBelief(tx, b, { kind: worry.kind, text: worry.text, valence: worry.valence, confidence: worry.confidence * 0.85, sourceType: 'told', subjectAgentId: worry.subjectAgentId, subjectName: worry.subjectName, worldKey: worry.subjectAgentId ? undefined : worry.key, sourceAgentId: a._id, sourceName: a.name, originEventId: worry.originEventId, hops: worry.hops + 1, private: true });
    summary = a.name + ' confided in ' + b.name + ' at ' + locName(a.locationId) + ': "' + worry.text + '"';
    salience = worry.subjectAgentId ? 0.38 : 0.3;
  } else {
    const fear = mind?.persona?.fear;
    summary = a.name + ' opened up to ' + b.name + (fear ? ' about the fear that never leaves: ' + fear.charAt(0).toLowerCase() + fear.slice(1).replace(/\.$/, '') + '.' : ' about how hard things have been.');
  }
  await emitEvent(tx, { category: 'social', eventType: 'confidence', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary, salience, visibility: 'private', causationEventId: worry?.originEventId });
  return 3;
}

// ---------- court ----------

export async function court(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The one ' + firstName(a.name) + ' hoped to see was not at ' + locName(a.locationId));
  const [ab, ba] = [await tie(tx, a._id, b._id), await tie(tx, b._id, a._id)];
  if (ab?.kind === 'family') return fail(tx, a, 'Thought better of it');
  const [am, bm] = [await loadMind(tx, a), await loadMind(tx, b)];
  if (!am || !bm) return fail(tx, a, 'Lost the nerve');
  const already = ab?.kind === 'romance' && ba?.kind === 'romance';
  const aPartners = (await partnersOf(tx, a._id)).filter((id) => id !== b._id);
  const bPartners = (await partnersOf(tx, b._id)).filter((id) => id !== a._id);
  const r = roll(tx, a, 'court');
  const charm = ((am.skills.persuasion ?? 40) / 100) * 0.2 + statusOf(am) * 0.1;
  const taken = bPartners.length > 0 ? 0.5 - (1 - bm.values.harmony) * 0.3 - (1 - b.traits.caution) * 0.1 : 0;
  const warmth = (ba?.affinity ?? 0) * 0.6 + b.traits.sociability * 0.15 + charm + rand(tx.world.seed, tx.tick, b.seq, 'spark') * 0.35 - taken + (already ? 0.4 : 0);
  act(tx, a, 'talking', (already ? 'Spending time with ' : 'Flirting with ') + b.name + ' at ' + locName(a.locationId), b._id, line('court.flirt', r, { you: b.name }));
  a.needs.social = Math.max(0, a.needs.social - 30);
  const witnesses = (await agentsAt(tx, a.locationId, { exclude: [a._id, b._id] })).slice(0, 8);
  if (warmth < 0.42) {
    say(tx, b, a._id, line('court.no', r, { you: a.name }));
    await adjustRelationship(tx, b, a, { affinity: (ba?.affinity ?? 0) < 0 ? -0.08 : -0.02 });
    await adjustRelationship(tx, a, b, { affinity: -0.02 });
    if (witnesses.length > 1) a.mood = 'humiliated';
    await emitEvent(tx, {
      category: 'social',
      eventType: 'rebuff',
      actorId: b._id,
      participantIds: [a._id],
      locationId: a.locationId,
      summary: b.name + ' gently turned ' + a.name + ' down at ' + locName(a.locationId) + (bPartners.length ? '; ' + firstName(b.name) + ' is already spoken for.' : '.'),
      salience: 0.3,
      witnesses,
    });
    return FAILED;
  }
  say(tx, b, a._id, line('court.yes', r, { you: a.name }));
  const fromB = await adjustRelationship(tx, b, a, { affinity: 0.12, trust: 0.05 });
  const fromA = await adjustRelationship(tx, a, b, { affinity: 0.1, trust: 0.04 });
  if (already) {
    await emitEvent(tx, { category: 'social', eventType: 'courtship', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' and ' + b.name + ' stole an hour together at ' + locName(a.locationId) + '.', salience: 0.2 });
    return 2;
  }
  // Courtship builds over several meetings before it becomes a romance.
  const admirer = await learnBelief(tx, b, { kind: 'admirer', text: a.name + ' has been courting ' + b.name + '.', valence: 0.3, confidence: 0.35, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, private: true });
  const smitten = (await getBelief(tx, b._id, admirer.key))?.confidence ?? 0;
  if (fromA.affinity < 0.5 || fromB.affinity < 0.45 || smitten < 0.65) {
    await emitEvent(tx, { category: 'social', eventType: 'courtship', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' has been finding reasons to be wherever ' + b.name + ' is, and ' + firstName(b.name) + ' does not seem to mind.', salience: 0.3, witnesses });
    return 2;
  }
  await adjustRelationship(tx, a, b, { kind: 'romance' });
  await adjustRelationship(tx, b, a, { kind: 'romance' });
  a.mood = 'hopeful';
  b.mood = 'hopeful';
  touch(tx, b);
  const cheating = [...aPartners.map((p) => ({ cheat: a, mind: am, partner: p })), ...bPartners.map((p) => ({ cheat: b, mind: bm, partner: p }))];
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: cheating.length ? 'affair' : 'romance',
    actorId: a._id,
    participantIds: [b._id, ...cheating.map((c) => c.partner)],
    locationId: a.locationId,
    summary: cheating.length
      ? a.name + ' and ' + b.name + ' have started an affair behind ' + (await nameOf(tx, cheating[0].partner)) + "'s back."
      : a.name + ' and ' + b.name + ' are together now, after weeks of finding excuses to share a table at ' + locName(a.locationId) + '.',
    salience: cheating.length ? 0.72 : 0.62,
    visibility: cheating.length ? 'private' : 'local',
  });
  for (const c of cheating) {
    addDeed(c.mind, 'affair');
    touchMind(tx, c.mind);
    const partner = await loadAgent(tx, c.partner);
    if (partner?.alive && partner.locationId === a.locationId && partner.activity !== 'sleeping') await jealousy(tx, partner, c.cheat, c.cheat._id === a._id ? b : a, eventId);
  }
  for (const id of witnesses) {
    const w = await loadAgent(tx, id);
    const toB = w ? await tie(tx, w._id, b._id) : null;
    if (w && toB && toB.affinity >= 0.65 && toB.kind !== 'family' && w.traits.stubbornness > 0.5 && (await partnersOf(tx, w._id)).length === 0) await jealousy(tx, w, b, a, eventId);
  }
  return 2;
}

async function nameOf(tx: Tx, id: AgentId): Promise<string> {
  return (await loadAgent(tx, id))?.name ?? 'someone';
}

/** Someone who wanted (or had) the beloved sees the new pair and takes it badly. */
async function jealousy(tx: Tx, jealous: AgentDoc, beloved: AgentDoc, rival: AgentDoc, causeId: Awaited<ReturnType<typeof emitEvent>>['eventId']): Promise<void> {
  jealous.mood = 'betrayed';
  touch(tx, jealous);
  await adjustRelationship(tx, jealous, rival, { affinity: -0.35, trust: -0.2 });
  await adjustRelationship(tx, jealous, beloved, { affinity: -0.2, trust: -0.3 });
  const partner = (await tie(tx, jealous._id, beloved._id))?.kind === 'romance';
  if (partner) {
    await learnBelief(tx, jealous, { kind: 'affair', text: beloved.name + ' is cheating with ' + rival.name + '.', valence: -1, confidence: 0.95, sourceType: 'observed', subjectAgentId: beloved._id, subjectName: beloved.name, originEventId: causeId, truthEventId: causeId });
  }
  await emitEvent(tx, {
    category: 'social',
    eventType: 'jealousy',
    actorId: jealous._id,
    participantIds: [beloved._id, rival._id],
    locationId: jealous.locationId,
    summary: partner ? jealous.name + ' walked in on ' + beloved.name + ' and ' + rival.name + ' together, and the whole room heard what came next.' : jealous.name + ' watched ' + rival.name + ' win over ' + beloved.name + ' and could not hide it.',
    salience: partner ? 0.75 : 0.45,
    causationEventId: causeId,
    visibility: partner ? 'public' : 'local',
    witnesses: 'location',
  });
  await enqueueCognition(tx, jealous, { kind: 'plan', trigger: partner ? 'caught ' + beloved.name + ' with ' + rival.name : 'lost ' + beloved.name + ' to ' + rival.name, priority: 0.7, lane: 'crisis', eventId: causeId });
}

// ---------- comfort ----------

export async function comfort(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'Came to console someone who was not at ' + locName(a.locationId));
  const troubled = TROUBLED.has(b.mood) || b.needs.safety >= 40 || b.needs.social >= 75;
  const r = roll(tx, a, 'comfort');
  act(tx, a, 'helping', 'Sitting with ' + b.name, b._id, line('comfort.offer', r, { you: b.name }));
  say(tx, b, a._id, line('comfort.thanks', r, { you: a.name }));
  b.needs.safety = Math.max(0, b.needs.safety - (troubled ? 30 : 10));
  b.needs.social = Math.max(0, b.needs.social - 25);
  a.needs.social = Math.max(0, a.needs.social - 15);
  const was = b.mood;
  if (troubled && b.mood !== 'grieving') b.mood = 'grateful';
  touch(tx, b);
  await adjustRelationship(tx, b, a, { affinity: troubled ? 0.14 : 0.05, trust: troubled ? 0.1 : 0.03, obligation: troubled ? 0.05 : 0 });
  await adjustRelationship(tx, a, b, { affinity: 0.05 });
  await emitEvent(tx, {
    category: 'social',
    eventType: 'comfort',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: troubled ? a.name + ' sat with ' + b.name + ', who was ' + was + ', until the worst of it passed.' : a.name + ' kept ' + b.name + ' company at ' + locName(a.locationId) + '.',
    salience: was === 'grieving' ? 0.42 : troubled ? 0.3 : 0.12,
  });
  return 2;
}

// ---------- threaten ----------

export async function threaten(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The person to lean on was not at ' + locName(a.locationId));
  const bm = await loadMind(tx, b);
  const owed = debtsTo(bm, a._id)[0];
  const knows = (await getBelief(tx, a._id, 'knows_secret:' + b._id)) ?? (await getBelief(tx, a._id, 'blackmailer:' + b._id));
  const context = owed ? 'threaten.debt' : knows ? 'threaten.quiet' : 'threaten.grudge';
  const r = roll(tx, a, 'threaten');
  act(tx, a, 'talking', 'Leaning on ' + b.name, b._id, line(context, r, { you: b.name, res: owed?.res }));
  const am = await loadMind(tx, a);
  const menace = a.traits.ambition * 0.3 + (1 - a.traits.empathy) * 0.2 + statusOf(am) * 0.2;
  const grit = b.traits.stubbornness * 0.5 + (1 - b.traits.caution) * 0.3 + rand(tx.world.seed, tx.tick, b.seq, 'grit') * 0.3;
  const witnesses = (await agentsAt(tx, a.locationId, { exclude: [a._id, b._id] })).slice(0, 8);
  if (grit > menace + 0.35) {
    say(tx, b, a._id, line('threaten.defiant', r, { you: a.name }));
    const hurtA = Math.round(8 + rand(tx.world.seed, tx.tick, b.seq, 'blow') * 15);
    const hurtB = Math.round(8 + roll(tx, a, 'blow') * 18);
    a.health = Math.max(1, a.health - hurtA);
    b.health = Math.max(1, b.health - hurtB);
    a.mood = 'angry';
    b.mood = 'angry';
    touch(tx, b);
    await adjustRelationship(tx, b, a, { affinity: -0.35, trust: -0.3 });
    await adjustRelationship(tx, a, b, { affinity: -0.25 });
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: 'fight',
      actorId: a._id,
      participantIds: [b._id],
      locationId: a.locationId,
      summary: a.name + ' threatened ' + b.name + (owed ? ' over an unpaid debt' : knows ? ' to keep a secret buried' : '') + ' and ' + firstName(b.name) + ' swung first. Both came away bloodied.',
      salience: 0.72,
      visibility: 'public',
      witnesses,
    });
    for (const id of witnesses.slice(0, 4)) {
      const w = await loadAgent(tx, id);
      if (w) await learnBelief(tx, w, { kind: 'untrustworthy', text: a.name + ' starts fights.', valence: -0.8, confidence: 0.7, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId });
    }
    return 2;
  }
  say(tx, b, a._id, line('threaten.cowed', r, { you: a.name }));
  b.mood = 'afraid';
  b.needs.safety = Math.min(100, b.needs.safety + 35);
  touch(tx, b);
  await adjustRelationship(tx, b, a, { fear: 0.35, affinity: -0.25, trust: -0.2 });
  await emitEvent(tx, {
    category: 'social',
    eventType: 'threat',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' cornered ' + b.name + ' at ' + locName(a.locationId) + (owed ? ' and demanded the ' + owed.qty + ' ' + owed.res + ' owed since ' + 'Sol ' + (Math.floor(owed.tick / 144) + 1) : knows ? ' and warned ' + firstName(b.name) + ' to keep quiet' : ' and made it plain what would happen if ' + firstName(b.name) + ' crossed them') + '.',
    salience: 0.5,
    causationEventId: owed?.eventId,
    witnesses,
  });
  if (owed && bm) {
    ledgerOf(bm).owes.forEach((d) => {
      if (d.to === a._id) d.pressed += 1;
    });
    touchMind(tx, bm);
    await repay(tx, b, a._id);
    act(tx, a, 'talking', 'Leaning on ' + b.name, b._id, line(context, r, { you: b.name, res: owed.res }));
  }
  return 2;
}

// ---------- reconcile ----------

export async function reconcile(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The person to make peace with was not at ' + locName(a.locationId));
  const ba = await tie(tx, b._id, a._id);
  const bm = await loadMind(tx, b);
  const grievance = Math.max(0, -(ba?.affinity ?? 0)) + Math.max(0, -(ba?.trust ?? 0)) * 0.5;
  const r = roll(tx, a, 'reconcile');
  act(tx, a, 'talking', 'Trying to make peace with ' + b.name, b._id, line('reconcile.offer', r, { you: b.name }));
  const accepts = 0.35 + b.traits.empathy * 0.3 + (bm?.values.harmony ?? 0.5) * 0.3 - b.traits.stubbornness * 0.3 - grievance * 0.35 + rand(tx.world.seed, tx.tick, b.seq, 'forgive') * 0.35 > 0.4;
  if (!accepts) {
    say(tx, b, a._id, line('reconcile.no', r, { you: a.name }));
    a.mood = 'sombre';
    await emitEvent(tx, { category: 'social', eventType: 'reconcile_refused', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' tried to apologise to ' + b.name + ' at ' + locName(a.locationId) + ', and ' + firstName(b.name) + ' would not hear it.', salience: grievance > 0.4 ? 0.42 : 0.28 });
    return FAILED;
  }
  say(tx, b, a._id, line('reconcile.yes', r, { you: a.name }));
  const wasRival = ba?.kind === 'rival';
  await adjustRelationship(tx, b, a, { affinity: clamp(0.15 + grievance * 0.4, 0.15, 0.45), trust: 0.15, fear: -0.2, ...(wasRival ? { kind: 'acquaintance' } : {}) });
  const ab = await tie(tx, a._id, b._id);
  await adjustRelationship(tx, a, b, { affinity: round2(Math.max(0.1, -(ab?.affinity ?? 0) * 0.5 + 0.1)), trust: 0.1, ...(ab?.kind === 'rival' ? { kind: 'acquaintance' } : {}) });
  b.mood = 'calm';
  touch(tx, b);
  await emitEvent(tx, {
    category: 'social',
    eventType: 'reconciliation',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: wasRival ? a.name + ' and ' + b.name + ' buried the hatchet at ' + locName(a.locationId) + ', to the surprise of everyone who knows them.' : a.name + ' apologised to ' + b.name + ', and the two of them are on speaking terms again.',
    salience: wasRival ? 0.58 : 0.4,
  });
  return 2;
}
