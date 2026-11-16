/**
 * Scheming: bribes, blackmail, lies, eavesdropping, sabotage and confession. Every scheme leaves a
 * trace an investigation can find (ledger deeds, beliefs with origin events), and every target
 * answers in character: some pay, some refuse, some strike back.
 */
import { clamp, pick, rand, round2 } from '../lib/rng';
import { FAILED, act, fail, int, roll, say, units } from './act';
import { firstName, isLocation, locName, lowerFirst, stormAt } from './conditions';
import { adjustRelationship, agentsAt, emitEvent, encodeStep, enqueueCognition, interrupt, learnBelief, loadAgent, loadMind, patchBelief, touch, touchMind } from './core';
import type { AgentDoc, BeliefDoc, EventId, Tx } from './core';
import { addDeed, deedCount, grantFavor, ledgerOf } from './ledger';
import { agentById, statusOf, sway } from './people';
import { exposeSecret, isScandal, learnSecret, secretOf, secretText } from './secrets';
import { beliefsOf, getBelief, markActed, presentWith, tie, truthAbout } from './social';
import { simState } from './state';
import { lieText, line } from './text';

const FAVORS = ['silence', 'vote', 'ration', 'look_away'] as const;
type Favor = (typeof FAVORS)[number];
const FAVOR_TICKS: Record<Favor, number> = { silence: 432, vote: 144, ration: 0, look_away: 288 };
const FAVOR_WORDS: Record<Favor, string> = { silence: 'to keep quiet', vote: 'for a vote in council', ration: 'for an extra ration', look_away: 'to look the other way' };

/** Whether this person is in a position to sell the favour at all. */
function canGrant(b: AgentDoc, favor: Favor): boolean {
  if (favor === 'vote') return b.occupation === 'councilor';
  if (favor === 'ration') return b.occupation === 'quartermaster' || b.occupation === 'hauler';
  if (favor === 'look_away') return b.occupation === 'security' || b.occupation === 'quartermaster';
  return true;
}

// ---------- bribery ----------

export async function bribe(tx: Tx, a: AgentDoc, who: string | undefined, qtyArg: string | undefined, favorArg: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The person to bribe was not at ' + locName(a.locationId));
  const favor = (FAVORS as readonly string[]).includes(favorArg ?? '') ? (favorArg as Favor) : 'silence';
  if (!canGrant(b, favor)) return fail(tx, a, b.name + ' had no say over ' + favor.replace('_', ' '));
  const n = Math.min(int(qtyArg, 1, 300, 20), Math.floor(a.inv.credits));
  if (n < 1) return fail(tx, a, 'Had no credits to make it worth ' + b.name + "'s while");
  const [am, bm] = [await loadMind(tx, a), await loadMind(tx, b)];
  if (!am || !bm) return fail(tx, a, 'Could not find the words');
  const r = roll(tx, a, 'bribe');
  const toA = await tie(tx, b._id, a._id);
  const greed = (1 - b.traits.empathy) * 0.35 + bm.values.wealth * 0.4 + b.traits.ambition * 0.15;
  const scruple = bm.values.harmony * 0.25 + (b.occupation === 'security' ? 0.15 : 0) + b.traits.caution * 0.1;
  const tempting = Math.min(0.5, n / (b.inv.credits + 30));
  const takes = greed + tempting + (toA?.affinity ?? 0) * 0.15 + (statusOf(am) - statusOf(bm)) * 0.2 - scruple + (rand(tx.world.seed, tx.tick, b.seq, 'greed') - 0.5) * 0.35 > 0.35;
  act(tx, a, 'talking', 'Pressing ' + n + ' credits into ' + b.name + "'s hand", b._id, line('bribe.offer', r, { you: b.name, n }));
  addDeed(am, 'briber');
  touchMind(tx, am);
  if (!takes) {
    say(tx, b, a._id, line('bribe.no', r, { you: a.name }));
    await adjustRelationship(tx, b, a, { affinity: -0.15, trust: -0.3 });
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: 'bribe_refused',
      actorId: b._id,
      participantIds: [a._id],
      locationId: a.locationId,
      summary: b.name + ' refused ' + n + ' credits from ' + a.name + ' ' + FAVOR_WORDS[favor] + ', and will not forget the offer.',
      salience: 0.6,
      visibility: 'local',
      witnesses: 'location',
    });
    const learned = await learnBelief(tx, b, { kind: 'briber', text: a.name + ' tried to buy ' + b.name + ' with ' + n + ' credits.', valence: -1, confidence: 0.9, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId });
    if (b.occupation === 'security') interrupt(tx, b, [encodeStep('accuse', a._id, learned.key)]);
    return 1;
  }
  a.inv.credits = round2(a.inv.credits - n);
  b.inv.credits = round2(b.inv.credits + n);
  touch(tx, b);
  addDeed(bm, 'corrupt');
  if (favor !== 'ration') grantFavor(tx, bm, a._id, favor, FAVOR_TICKS[favor]);
  touchMind(tx, bm);
  say(tx, b, a._id, line('bribe.yes', r, { you: a.name }));
  await adjustRelationship(tx, b, a, { obligation: 0.3 });
  let extra = '';
  if (favor === 'ration') {
    const moved = (['food', 'water'] as const).map((res) => {
      const k = Math.min(2, Math.floor(tx.world.stockpiles.depot?.[res] ?? 0));
      tx.world.stockpiles.depot[res] = round2((tx.world.stockpiles.depot[res] ?? 0) - k);
      a.inv[res] += k;
      return k;
    });
    extra = ', walking off with ' + units(moved[0], 'food') + ' and ' + units(moved[1], 'water') + ' from the reserve';
  }
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'bribe',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: a.name + ' paid ' + b.name + ' ' + n + ' credits ' + FAVOR_WORDS[favor] + extra + '.',
    salience: 0.6,
    visibility: 'private',
  });
  // Whoever paid now holds something over whoever took it.
  const held = await learnBelief(tx, a, { kind: 'corrupt', text: b.name + ' took ' + n + ' credits from ' + a.name + ' ' + FAVOR_WORDS[favor] + '.', valence: -0.4, confidence: 1, sourceType: 'observed', subjectAgentId: b._id, subjectName: b.name, originEventId: eventId, truthEventId: eventId, private: true });
  const doc = await getBelief(tx, a._id, held.key);
  if (doc) await patchBelief(tx, doc, { acted: tx.tick });
  return 1;
}

// ---------- blackmail ----------

/** The belief a blackmailer can use against target: named, or the strongest scandal they hold. */
async function leverageOn(tx: Tx, a: AgentDoc, target: AgentDoc, key: string | undefined): Promise<BeliefDoc | null> {
  if (key) {
    const b = await getBelief(tx, a._id, key);
    return b && b.subjectAgentId === target._id ? b : null;
  }
  const held = (await beliefsOf(tx, a._id)).filter((b) => b.subjectAgentId === target._id && b.valence < 0 && isScandal(b.kind) && b.confidence >= 0.5);
  return held.sort((x, y) => y.confidence - x.confidence)[0] ?? null;
}

export async function blackmail(tx: Tx, a: AgentDoc, who: string | undefined, key: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'The mark was not at ' + locName(a.locationId));
  const belief = await leverageOn(tx, a, b, key);
  if (!belief || belief.confidence < 0.45) return fail(tx, a, 'Had nothing on ' + b.name + ' worth threatening with');
  const truth = await truthAbout(tx, belief.kind, b);
  const secret = await secretOf(tx, b);
  const real = truth.truth === true || secret?.kind === belief.kind;
  if (truth.settled || ((await loadMind(tx, b))?.persona?.secret?.kind === belief.kind && !secret)) {
    await markActed(tx, belief);
    return fail(tx, a, 'Everyone already knows what ' + b.name + ' did; there is nothing left to sell');
  }
  const [am, bm] = [await loadMind(tx, a), await loadMind(tx, b)];
  if (!am || !bm) return fail(tx, a, 'Lost the nerve');
  await markActed(tx, belief);
  addDeed(am, 'blackmailer');
  touchMind(tx, am);
  const r = roll(tx, a, 'blackmail');
  act(tx, a, 'talking', 'Cornering ' + b.name + ' about what ' + firstName(a.name) + ' knows', b._id, line('blackmail.demand', r, { you: b.name }));
  const t = b.traits;
  const stakes = (real ? 0.35 : 0.05) + bm.values.status * 0.2 + statusOf(bm) * 0.15 + (b.role ? 0.1 : 0);
  const nerve = t.stubbornness * 0.35 + (1 - t.caution) * 0.2 + (real ? 0 : 0.3);
  const cunning = t.ambition * 0.3 + (1 - t.empathy) * 0.25;
  const noise = (rand(tx.world.seed, tx.tick, b.seq, 'mark') - 0.5) * 0.3;
  const demand = Math.min(60, Math.floor(b.inv.credits * 0.4));
  let outcome: 'pay' | 'comply' | 'refuse' | 'retaliate';
  if (cunning + noise > stakes + 0.25 && cunning > nerve) outcome = 'retaliate';
  else if (nerve + noise > stakes + 0.15) outcome = 'refuse';
  else outcome = demand >= 5 ? 'pay' : 'comply';
  const what = belief.text.replace(/\.$/, '');
  const that = lowerFirst(what, b.name);
  let summary: string;
  if (outcome === 'pay' || outcome === 'comply') {
    if (outcome === 'pay') {
      b.inv.credits = round2(b.inv.credits - demand);
      a.inv.credits = round2(a.inv.credits + demand);
    } else {
      const favor: Favor = b.occupation === 'councilor' ? 'vote' : b.occupation === 'security' ? 'look_away' : 'silence';
      grantFavor(tx, bm, a._id, favor, 432);
      if (b.inv.food >= 2) {
        b.inv.food -= 1;
        a.inv.food += 1;
      }
    }
    grantFavor(tx, am, b._id, 'silence', 576);
    touchMind(tx, am);
    touchMind(tx, bm);
    say(tx, b, a._id, line('blackmail.pay', r, { you: a.name }));
    b.mood = 'afraid';
    await adjustRelationship(tx, b, a, { affinity: -0.4, trust: -0.4, fear: 0.4 });
    summary = outcome === 'pay' ? a.name + ' made ' + b.name + ' pay ' + demand + ' credits to keep quiet about it: "' + what + '"' : b.name + ', with no credits to give, agreed to do ' + a.name + "'s bidding rather than have it come out that " + that + '.';
  } else if (outcome === 'refuse') {
    say(tx, b, a._id, line('blackmail.refuse', r, { you: a.name }));
    b.mood = 'angry';
    await adjustRelationship(tx, b, a, { affinity: -0.5, trust: -0.5 });
    summary = b.name + ' told ' + a.name + ' to do their worst when ' + firstName(a.name) + ' threatened to tell everyone that ' + that + '.';
    // A refused blackmailer either backs down or makes good on the threat.
    if (a.traits.stubbornness + a.traits.ambition * 0.5 > 0.7) a.q = [encodeStep('accuse', b._id, belief.key), ...a.q].slice(0, 24);
  } else {
    say(tx, b, a._id, line('blackmail.retaliate', r, { you: a.name }));
    b.mood = 'angry';
    await adjustRelationship(tx, b, a, { affinity: -0.6, trust: -0.6 });
    summary = b.name + ' turned the threat around on ' + a.name + ', who tried to blackmail ' + firstName(b.name) + ' over what ' + firstName(a.name) + ' knows.';
  }
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'blackmail',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary,
    salience: outcome === 'pay' ? 0.62 : 0.68,
    causationEventId: belief.originEventId ?? belief.truthEventId,
    visibility: 'private',
    facts: { outcome, beliefKey: belief.key },
  });
  const known = await learnBelief(tx, b, { kind: 'blackmailer', text: a.name + ' is blackmailing ' + b.name + '.', valence: -1, confidence: 1, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId, private: outcome !== 'retaliate' });
  if (outcome === 'retaliate') interrupt(tx, b, [encodeStep('threaten', a._id)]);
  if (outcome === 'refuse' && b.traits.stubbornness > 0.6) b.q = [encodeStep('accuse', a._id, known.key), ...b.q].slice(0, 24);
  await enqueueCognition(tx, b, { kind: 'plan', trigger: 'being blackmailed by ' + a.name, priority: 0.75, lane: 'crisis', eventId });
  return 2;
}

// ---------- lies ----------

const LIE_KINDS = new Set(['thief', 'hoarding', 'saboteur', 'corrupt', 'affair', 'coward']);

export async function lie(tx: Tx, a: AgentDoc, who: string | undefined, subjectArg: string | undefined, kindArg: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'Nobody to whisper to at ' + locName(a.locationId));
  const subject = await agentById(tx, subjectArg);
  if (!subject || !subject.alive || subject._id === b._id || subject._id === a._id) return fail(tx, a, 'Had nobody to tell tales about');
  const kind = LIE_KINDS.has(kindArg ?? '') ? kindArg! : 'corrupt';
  const r = roll(tx, a, 'lie');
  const text = lieText(kind, subject.name, r);
  const mind = await loadMind(tx, a);
  if (mind) {
    addDeed(mind, 'liar');
    touchMind(tx, mind);
  }
  act(tx, a, 'talking', 'Telling ' + b.name + ' a story about ' + subject.name, b._id, line('lie', r, { you: b.name, s: subject.name }));
  const loyal = ((await tie(tx, b._id, subject._id))?.affinity ?? 0) >= 0.45;
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'lie',
    actorId: a._id,
    participantIds: [b._id, subject._id],
    locationId: a.locationId,
    summary: a.name + ' made up a story for ' + b.name + ': "' + text + '"' + (loyal ? ' ' + firstName(b.name) + ', who is fond of ' + firstName(subject.name) + ', did not buy it.' : ' None of it is true.'),
    salience: 0.48,
    visibility: 'private',
    facts: { liarId: a._id, kind },
  });
  if (loyal) {
    say(tx, b, a._id, 'That is a lie, ' + firstName(a.name) + ', and you know it.');
    await adjustRelationship(tx, b, a, { affinity: -0.15, trust: -0.25 });
    return FAILED;
  }
  const confidence = round2(clamp(0.2 + (await sway(tx, a, b)) * 0.6, 0.15, 0.85));
  await learnBelief(tx, b, { kind, text, valence: -1, confidence, sourceType: 'told', subjectAgentId: subject._id, subjectName: subject.name, sourceAgentId: a._id, sourceName: a.name, originEventId: eventId, hops: 1 });
  say(tx, b, a._id, confidence > 0.5 ? 'I always wondered about ' + firstName(subject.name) + '.' : 'Hm. Maybe.');
  return 2;
}

/** After an investigation shows a story false: if it began as a lie, the investigator learns who made it up. */
export async function unmaskLiar(tx: Tx, investigator: AgentDoc, originEventId: EventId | undefined): Promise<void> {
  const origin = originEventId ? await tx.ctx.db.get(originEventId) : null;
  if (!origin || origin.eventType !== 'lie' || !origin.actorId) return;
  const liar = await loadAgent(tx, origin.actorId);
  if (!liar?.alive || liar._id === investigator._id) return;
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'liar_exposed',
    actorId: investigator._id,
    participantIds: [liar._id],
    locationId: investigator.locationId,
    summary: investigator.name + ' traced the story back to its source: ' + liar.name + ' made the whole thing up.',
    salience: 0.66,
    causationEventId: originEventId,
    visibility: 'public',
  });
  await learnBelief(tx, investigator, { kind: 'liar', text: liar.name + ' spreads lies about people.', valence: -1, confidence: 0.9, sourceType: 'observed', subjectAgentId: liar._id, subjectName: liar.name, originEventId: eventId, truthEventId: eventId });
  await adjustRelationship(tx, investigator, liar, { trust: -0.4, affinity: -0.2 });
}

// ---------- eavesdropping ----------

export async function eavesdrop(tx: Tx, a: AgentDoc, who: string | undefined): Promise<number> {
  const b = who ? await presentWith(tx, a, who) : null;
  if (!b) return fail(tx, a, 'Lost track of the person to listen in on');
  act(tx, a, 'investigating', 'Lingering within earshot of ' + b.name + ' at ' + locName(a.locationId), undefined, line('eavesdrop', roll(tx, a, 'ear')));
  const chatty = b.activity === 'talking' || !!b.interactingWithId;
  const odds = 0.3 + a.traits.curiosity * 0.3 + (chatty ? 0.2 : 0) - b.traits.caution * 0.2;
  const noticed = rand(tx.world.seed, tx.tick, b.seq, 'spotted:' + a.seq) < 0.08 + b.traits.caution * 0.3;
  let learned = '';
  let salience = 0.22;
  let eventId: EventId | undefined;
  if (roll(tx, a, 'overhear') < odds) {
    const secret = await secretOf(tx, b);
    if (secret && !(await getBelief(tx, a._id, secret.kind + ':' + b._id)) && roll(tx, a, 'secret') < 0.55) {
      ({ eventId } = await emitEvent(tx, {
        category: 'social',
        eventType: 'secret_overheard',
        actorId: a._id,
        participantIds: [b._id],
        locationId: a.locationId,
        summary: a.name + ' overheard ' + b.name + ' at ' + locName(a.locationId) + ' and learned something nobody was meant to know: ' + secretText(b, secret),
        salience: 0.66,
        visibility: 'private',
      }));
      await learnSecret(tx, a, b, secret, 'overheard', eventId);
      learned = 'secret';
    } else {
      const theirs = (await beliefsOf(tx, b._id)).filter((x) => x.subjectAgentId !== a._id && (x.private || (x.subjectAgentId && x.valence < 0)) && x.confidence >= 0.4);
      const debt = (await loadMind(tx, b))?.ledger?.owes[0];
      const top = theirs.sort((x, y) => (y.private ? 1 : 0) - (x.private ? 1 : 0) || y.confidence - x.confidence)[0];
      if (top) {
        salience = top.private ? 0.4 : 0.28;
        ({ eventId } = await emitEvent(tx, {
          category: 'social',
          eventType: 'eavesdrop',
          actorId: a._id,
          participantIds: [b._id],
          locationId: a.locationId,
          summary: a.name + ' listened in on ' + b.name + ' and heard: "' + top.text + '"',
          salience,
          visibility: 'private',
          causationEventId: top.originEventId,
        }));
        await learnBelief(tx, a, { kind: top.kind, text: top.text, valence: top.valence, confidence: top.confidence * 0.8, sourceType: 'told', subjectAgentId: top.subjectAgentId, subjectName: top.subjectName, worldKey: top.subjectAgentId ? undefined : top.key, sourceAgentId: b._id, sourceName: b.name, originEventId: top.originEventId, hops: top.hops + 1, private: top.private });
        learned = 'belief';
      } else if (debt) {
        ({ eventId } = await emitEvent(tx, { category: 'social', eventType: 'eavesdrop', actorId: a._id, participantIds: [b._id], locationId: a.locationId, summary: a.name + ' overheard ' + b.name + ' fretting about the ' + units(debt.qty, debt.res) + ' still owed to ' + debt.toName + '.', salience: 0.3, visibility: 'private' }));
        await learnBelief(tx, a, { kind: 'debt', text: b.name + ' owes ' + debt.toName + ' ' + units(debt.qty, debt.res) + '.', valence: -0.1, confidence: 0.8, sourceType: 'observed', subjectAgentId: b._id, subjectName: b.name, originEventId: eventId, private: true });
        learned = 'debt';
      }
    }
  }
  if (noticed) {
    say(tx, b, a._id, pick(['Can I help you, ' + firstName(a.name) + '?', 'Were you listening to me?', 'Mind your own business, ' + firstName(a.name) + '.'], roll(tx, a, 'caught')));
    await adjustRelationship(tx, b, a, { trust: -0.25, affinity: -0.12 });
    await learnBelief(tx, b, { kind: learned === 'secret' ? 'knows_secret' : 'untrustworthy', text: learned === 'secret' ? a.name + ' may have overheard what ' + b.name + ' is hiding.' : a.name + ' sneaks around listening to other people.', valence: -0.8, confidence: 0.7, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, private: true });
    await emitEvent(tx, { category: 'social', eventType: 'caught_eavesdropping', actorId: b._id, participantIds: [a._id], locationId: a.locationId, summary: b.name + ' caught ' + a.name + ' listening in at ' + locName(a.locationId) + '.', salience: learned === 'secret' ? 0.55 : 0.35, causationEventId: eventId, witnesses: 'location' });
    if (learned === 'secret') await enqueueCognition(tx, b, { kind: 'plan', trigger: a.name + ' may know my secret', priority: 0.7, lane: 'crisis', eventId });
  }
  return 2;
}

// ---------- sabotage ----------

export async function sabotage(tx: Tx, a: AgentDoc, loc: string | undefined): Promise<number> {
  if (!loc || !isLocation(loc) || a.locationId !== loc) return fail(tx, a, 'Not at ' + locName(loc ?? 'plaza') + ' to tamper with anything');
  if (loc === 'habitat_a' || loc === 'habitat_b') return fail(tx, a, 'Nothing worth breaking in the bunks');
  if (stormAt(tx.world, loc) > 0) return fail(tx, a, 'Too dangerous to work on anything in the storm');
  const harm = round2(0.12 + a.traits.ambition * 0.08 + roll(tx, a, 'harm') * 0.06);
  tx.world.damage[loc] = round2(clamp((tx.world.damage[loc] ?? 0) + harm, 0, 1));
  const mind = await loadMind(tx, a);
  if (mind) {
    addDeed(mind, 'saboteur');
    touchMind(tx, mind);
  }
  const how = pick(['loosened a coolant coupling', 'cut a sensor line', 'jammed grit into a pump seal', 'spliced a fault into the controller', 'cracked a filter housing'], roll(tx, a, 'how'));
  act(tx, a, 'stealing', 'Fiddling with the machinery at ' + locName(loc), undefined, line('sabotage', roll(tx, a, 'sab')));
  const seen: AgentDoc[] = [];
  for (const id of (await agentsAt(tx, loc, { exclude: [a._id] })).slice(0, 8)) {
    const w = await loadAgent(tx, id);
    if (w && rand(tx.world.seed, tx.tick, w.seq, 'sab:' + a.seq) < 0.1 + w.traits.caution * 0.25 + (w.occupation === 'security' && w.activity === 'working' ? 0.4 : 0)) seen.push(w);
  }
  const { eventId } = await emitEvent(tx, {
    category: 'action',
    eventType: 'sabotage',
    actorId: a._id,
    participantIds: seen.map((w) => w._id),
    locationId: loc,
    summary: a.name + ' ' + how + ' at ' + locName(loc) + (seen.length ? '. ' + seen[0].name + ' saw it.' : ' and walked away unseen.'),
    salience: seen.length ? 0.75 : 0.6,
    visibility: seen.length ? 'public' : 'private',
  });
  await emitEvent(tx, {
    category: 'environment',
    eventType: 'equipment_failure',
    locationId: loc,
    summary: 'Something gave out at ' + locName(loc) + ': it is running at ' + Math.round((1 - tx.world.damage[loc]) * 100) + '% until someone repairs it.',
    salience: 0.55,
    causationEventId: eventId,
    visibility: 'public',
  });
  for (const w of seen) {
    const learned = await learnBelief(tx, w, { kind: 'saboteur', text: a.name + ' wrecked equipment at ' + locName(loc) + ' on purpose.', valence: -1, confidence: 0.9, sourceType: 'observed', subjectAgentId: a._id, subjectName: a.name, originEventId: eventId, truthEventId: eventId });
    await adjustRelationship(tx, w, a, { trust: -0.4, affinity: -0.25 });
    if (w.occupation === 'security' || w.traits.stubbornness > 0.6) interrupt(tx, w, [encodeStep('accuse', a._id, learned.key)]);
  }
  return 2;
}

// ---------- confession ----------

const DEED_KINDS = new Set(['saboteur', 'smuggler', 'liar', 'briber', 'blackmailer', 'corrupt', 'affair']);

/** Public admission. Clears the guilt it names, wins over the forgiving and loses the rest. */
export async function confess(tx: Tx, a: AgentDoc, key: string | undefined): Promise<number> {
  const mind = await loadMind(tx, a);
  if (!mind) return fail(tx, a, 'Could not find the words');
  const kind = (key ?? 'secret').split(':')[0];
  const secret = mind.persona?.secret && mind.persona.secret.exposedAtTick === undefined ? mind.persona.secret : null;
  const confessingSecret = secret && (kind === 'secret' || kind === secret.kind);
  const thefts = kind === 'thief' ? mind.thefts : 0;
  const deeds = DEED_KINDS.has(kind) ? deedCount(mind, kind) : 0;
  if (!confessingSecret && thefts === 0 && deeds === 0) return fail(tx, a, 'Had nothing to confess after all');
  const witnesses = (await agentsAt(tx, a.locationId, { exclude: [a._id] })).slice(0, 8);
  act(tx, a, 'talking', 'Confessing in front of everyone at ' + locName(a.locationId), undefined, line('confess', roll(tx, a, 'confess')));
  const what = confessingSecret ? secretText(a, secret!) : thefts > 0 ? a.name + ' stole from the colony ' + (thefts === 1 ? 'once' : thefts + ' times') + '.' : a.name + ' has been a ' + kind + '.';
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'confession',
    actorId: a._id,
    participantIds: witnesses,
    locationId: a.locationId,
    summary: a.name + ' stood up at ' + locName(a.locationId) + ' and confessed: ' + lowerFirst(what, a.name),
    salience: 0.75,
    visibility: 'public',
  });
  if (confessingSecret) await exposeSecret(tx, a, 'confessed', eventId);
  if (thefts > 0) {
    mind.thefts = 0;
    const sim = await simState(tx);
    sim.punished = { ...sim.punished, [a._id]: tx.tick };
  }
  if (deeds > 0) ledgerOf(mind).deeds[kind] = 0;
  touchMind(tx, mind);
  for (const id of witnesses) {
    const w = await loadAgent(tx, id);
    const wm = w ? await loadMind(tx, w) : null;
    if (!w || !wm) continue;
    const forgiving = w.traits.empathy * 0.5 + wm.values.harmony * 0.4 > 0.5;
    await adjustRelationship(tx, w, a, forgiving ? { affinity: 0.1, trust: 0.08 } : { affinity: -0.05, trust: -0.12 });
  }
  a.mood = 'sombre';
  touch(tx, a);
  return 3;
}
