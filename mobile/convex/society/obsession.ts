/**
 * Obsessions: now and then someone becomes consumed by one goal (a person, a discovery, a
 * masterpiece, revenge, the secret of the Long Dark, a structure, money, their organization, a lost
 * pet or child). It dominates their choices, pushes them into risky ones, and ends in euphoria when
 * fulfilled or despair when it breaks.
 */
import type { Id } from '../_generated/dataModel';
import { DISCOVERY_BY_KEY, FIELD_LOCATIONS, STRUCTURE_BY_KEY } from '../../shared/society';
import { clamp, pick, round2 } from '../lib/rng';
import { firstName, isLocation, locName, stormAt } from '../engine/conditions';
import { emitEvent, encodeStep, enqueueCognition, loadAgent, touch, touchMind } from '../engine/core';
import type { AgentDoc, EventId, MindDoc, Tx } from '../engine/core';
import { getBelief } from '../engine/social';
import { availableDiscoveries } from './craft';
import type { SocietyChoice } from './hooks';
import { DAY, loadMeta, roll, shiftStatus, societyOf } from './store';

export type ObsessionKind = 'person' | 'discovery' | 'masterpiece' | 'revenge' | 'long_dark' | 'structure' | 'wealth' | 'org' | 'pet' | 'child';
export type ObsessionSpec = { kind: ObsessionKind; target?: string; text: string };

/** Someone becomes obsessed. Their LLM mind is asked to think about it at once. */
export async function startObsession(tx: Tx, a: AgentDoc, mind: MindDoc, o: ObsessionSpec, cause?: EventId): Promise<boolean> {
  const s = societyOf(tx, a, mind);
  if (s.obsession || mind.ageBand === 'child' || !a.alive) return false;
  s.obsession = { text: o.text, kind: o.kind, target: o.target, intensity: round2(0.75 + roll(tx, a.seq, 'obint') * 0.25), sinceTick: tx.tick };
  touchMind(tx, mind);
  a.mood = o.kind === 'revenge' ? 'angry' : 'restless';
  touch(tx, a);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: 'obsession',
    actorId: a._id,
    summary: a.name + ' has become obsessed with ' + o.text + '.',
    salience: 0.62,
    causationEventId: cause,
    visibility: 'local',
    facts: { kind: o.kind, target: o.target },
  });
  await enqueueCognition(tx, a, { kind: 'plan', trigger: 'became obsessed with ' + o.text, priority: 0.75, lane: 'crisis', eventId });
  return true;
}

/** An obsession ends: euphoria when fulfilled, despair when it breaks. */
export async function endObsession(tx: Tx, a: AgentDoc, mind: MindDoc, fulfilled: boolean, cause?: EventId): Promise<void> {
  const ob = mind.society?.obsession;
  if (!ob) return;
  mind.society!.obsession = undefined;
  if (fulfilled) {
    a.mood = 'euphoric';
    shiftStatus(tx, mind, 4);
    mind.values.status = round2(clamp(mind.values.status + 0.02, 0, 1));
  } else {
    a.mood = 'despairing';
    shiftStatus(tx, mind, -4);
    mind.values.harmony = round2(clamp(mind.values.harmony - 0.04, 0, 1));
    a.traits.caution = round2(clamp(a.traits.caution + 0.04, 0, 1));
  }
  touchMind(tx, mind);
  touch(tx, a);
  const { eventId } = await emitEvent(tx, {
    category: 'social',
    eventType: fulfilled ? 'obsession_fulfilled' : 'obsession_broken',
    actorId: a._id,
    summary: fulfilled ? a.name + ' got what they were obsessed with, ' + ob.text + ', and is walking on air.' : a.name + ' has given up on ' + ob.text + '. Something in ' + firstName(a.name) + ' has gone quiet.',
    salience: 0.62,
    causationEventId: cause,
    visibility: 'local',
  });
  await enqueueCognition(tx, a, { kind: 'plan', trigger: fulfilled ? 'achieved an obsession: ' + ob.text : 'gave up on an obsession: ' + ob.text, priority: 0.6, lane: 'normal', eventId });
}

/** Ends an obsession of this kind and target if someone has one: fulfilled when the world delivers it. */
export async function fulfil(tx: Tx, a: AgentDoc, mind: MindDoc, kind: ObsessionKind, target: string | undefined, cause?: EventId): Promise<void> {
  const ob = mind.society?.obsession;
  if (ob && ob.kind === kind && (ob.target === undefined || target === undefined || ob.target === target)) await endObsession(tx, a, mind, true, cause);
}

/** The plan an obsession demands right now. Scores above routine and most needs. */
export async function obsessionChoice(tx: Tx, a: AgentDoc, mind: MindDoc): Promise<SocietyChoice | null> {
  const ob = mind.society?.obsession;
  if (!ob) return null;
  const score = 1.2 + ob.intensity * 0.3;
  const steps: string[] = [];
  const labels: string[] = [];
  const go = (to: string) => {
    if (to !== a.locationId && isLocation(to) && stormAt(tx.world, to) === 0) {
      steps.push(encodeStep('go', to));
      labels.push('Hurrying to ' + locName(to));
    }
  };
  const base = { score, routine: false, trigger: 'obsessed with ' + ob.text };
  switch (ob.kind) {
    case 'discovery':
    case 'long_dark': {
      const def = ob.target ? DISCOVERY_BY_KEY[ob.target] : undefined;
      go(def ? FIELD_LOCATIONS[def.field] : 'observatory');
      steps.push(encodeStep('experiment', 12));
      labels.push(ob.kind === 'long_dark' ? 'Poring over the old Long Dark records' : 'Working through the night on ' + (def?.name.toLowerCase() ?? 'the problem'));
      return { ...base, intent: 'I cannot stop until I understand ' + ob.text, steps, labels };
    }
    case 'masterpiece': {
      go(a.locationId === a.homeLocationId ? 'canteen' : a.locationId);
      steps.push(encodeStep('create_art', ob.target ?? 'mural'));
      labels.push('Working on the piece that will be remembered');
      return { ...base, intent: 'Making the masterpiece I was born to make', steps, labels };
    }
    case 'structure': {
      const def = ob.target ? STRUCTURE_BY_KEY[ob.target] : undefined;
      if (!def) return null;
      const here = def.locations.includes(a.locationId as never) ? a.locationId : def.locations[0];
      go(here);
      steps.push(encodeStep('build', def.key));
      labels.push('Building the ' + def.name + ', whatever it takes');
      return { ...base, intent: 'The ' + def.name + ' will be finished, by my hands', steps, labels };
    }
    case 'person':
    case 'revenge': {
      const target = ob.target ? await loadAgent(tx, ob.target as Id<'agents'>) : null;
      if (!target?.alive || target.move || !isLocation(target.locationId) || target.activity === 'sleeping') return null;
      go(target.locationId);
      if (ob.kind === 'person') {
        steps.push(encodeStep('talk', target._id));
        labels.push('Trying again with ' + target.name);
        return { ...base, intent: 'I have to make ' + firstName(target.name) + ' see me', steps, labels };
      }
      const belief = (await getBelief(tx, a._id, 'thief:' + target._id)) ?? (await getBelief(tx, a._id, 'suspect:' + target._id)) ?? (await getBelief(tx, a._id, 'saboteur:' + target._id));
      if (belief) {
        steps.push(encodeStep('accuse', target._id, belief.key));
        labels.push('Accusing ' + target.name + ' in front of everyone');
      } else {
        steps.push(encodeStep('investigate', target._id));
        labels.push('Digging for dirt on ' + target.name);
      }
      return { ...base, intent: firstName(target.name) + ' will pay for what happened', steps, labels };
    }
    case 'wealth': {
      if (!a.workLocationId) return null;
      go(a.workLocationId);
      steps.push(encodeStep('work', 12));
      labels.push('Working a second shift for the money');
      return { ...base, score: score - 0.2, intent: 'Every credit counts until I have enough', steps, labels };
    }
    case 'org': {
      steps.push(encodeStep('preach', ob.target ?? ''));
      labels.push('Preaching to anyone who will listen');
      go('plaza');
      return { ...base, score: score - 0.2, intent: 'Everyone must hear about us', steps: steps.reverse(), labels: labels.reverse() };
    }
    case 'pet':
    case 'child': {
      const loc = pick(['habitat_a', 'habitat_b', 'depot', 'workshop', 'hydroponics', 'plaza'], roll(tx, a.seq, 'search'));
      go(loc);
      steps.push(encodeStep('rest', 3));
      labels.push('Searching every corner of ' + locName(loc) + ' for ' + ob.text.replace(/^finding /, ''));
      return { ...base, score: score + 0.2, intent: 'I have to find ' + ob.text.replace(/^finding /, ''), steps, labels };
    }
  }
  return null;
}

/** An obsession nobody can bear forever: after days without fulfilment it breaks. */
export async function obsessionsDaily(tx: Tx, people: Map<string, { a: AgentDoc; mind: MindDoc }>): Promise<void> {
  for (const { a, mind } of people.values()) {
    const ob = mind.society?.obsession;
    if (!ob) continue;
    if (ob.target && (ob.kind === 'person' || ob.kind === 'revenge') && !people.has(ob.target)) {
      await endObsession(tx, a, mind, ob.kind === 'revenge');
      continue;
    }
    if (tx.tick - ob.sinceTick > 4 * DAY && roll(tx, a.seq, 'obbreak') < 0.5) await endObsession(tx, a, mind, false);
  }
}

/** Once a day, rarely, someone is seized by an obsession that fits who they are. */
export async function maybeNewObsession(tx: Tx, people: Map<string, { a: AgentDoc; mind: MindDoc }>): Promise<void> {
  if (roll(tx, 0, 'newob') > 0.55) return;
  const pool = [...people.values()].filter((p) => p.mind.ageBand !== 'child' && !p.mind.society?.obsession);
  if (pool.length === 0) return;
  const weights = pool.map((p) => p.a.traits.stubbornness * 0.6 + p.a.traits.curiosity * 0.4 + (p.mind.persona?.key ? 0.4 : 0));
  const total = weights.reduce((s, w) => s + w, 0);
  let x = roll(tx, 1, 'newobwho') * total;
  const who = pool.find((_, i) => (x -= weights[i]) <= 0) ?? pool[0];
  const spec = await fittingObsession(tx, who.a, who.mind);
  if (spec) await startObsession(tx, who.a, who.mind, spec);
}

async function fittingObsession(tx: Tx, a: AgentDoc, mind: MindDoc): Promise<ObsessionSpec | null> {
  const meta = await loadMeta(tx);
  const r = roll(tx, a.seq, 'obkind');
  if ((mind.skills.art ?? 0) >= 35 && r < 0.5) return { kind: 'masterpiece', target: pick(['mural', 'song', 'play', 'poem'], r * 2), text: 'making a masterpiece' };
  if (a.traits.curiosity > 0.6) {
    if (r < 0.4) return { kind: 'long_dark', text: 'the truth about the Long Dark' };
    const open = availableDiscoveries(meta.discovered);
    if (open.length) {
      const d = pick(open, r);
      return { kind: 'discovery', target: d.key, text: 'discovering ' + d.name.toLowerCase() };
    }
  }
  const ties = await tx.ctx.db.query('relationships').withIndex('by_from_strength', (q) => q.eq('fromAgentId', a._id)).order('desc').take(10);
  const rival = ties.find((t) => t.toAlive && t.affinity < -0.4);
  if (rival && a.traits.empathy < 0.5) return { kind: 'revenge', target: rival.toAgentId, text: 'getting even with ' + rival.toName };
  const crush = ties.find((t) => t.toAlive && t.affinity > 0.45 && t.kind !== 'family');
  if (crush && !mind.society?.partnerId) return { kind: 'person', target: crush.toAgentId, text: crush.toName };
  if (a.traits.ambition > 0.6) return { kind: 'wealth', target: String(Math.round(a.inv.credits + 150)), text: 'getting rich' };
  return { kind: 'long_dark', text: 'the truth about the Long Dark' };
}
