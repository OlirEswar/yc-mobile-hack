/**
 * Powers over minds: whisper and rumor. Both only plant beliefs (and, for a whisper, a goal) with
 * learnBelief. What the colonists do with them, retelling a rumor in a talk step, investigating,
 * accusing, befriending, is up to the simulation and the cognition layer.
 */
import { LOCATION_IDS, LOCATIONS, RUMOR_PRESETS, TICKS_PER_DAY, WHISPER_PRESETS } from '../../shared/colony';
import type { IdeaPreset, LocationId } from '../../shared/colony';
import type { GoalKind } from '../../shared/types';
import { agentsAt, emitEvent, encodeStep, enqueueCognition, interrupt, learnBelief, loadAgent, loadMind, replan, tieTo, touch, touchMind } from '../engine/core';
import type { AgentDoc, AgentId, MindDoc, Tx } from '../engine/core';
import { rand, round2 } from '../lib/rng';
import { ACCUSABLE } from '../engine/social';
import { agentOf, fail, isFailure, locationOf, record, standingAt, textOf, withName } from './common';
import type { Power, PowerFailure } from './common';

type GoalSpec = { kind: GoalKind; description: string; predicate: string; targetQuantity?: number };

/**
 * What each whisper preset means mechanically: the kind of belief it plants (about the subject when
 * the preset has one) and the goal it adds. Predicates are the ones the seed uses, checked by the
 * simulation; a goal's drive is always the preset key.
 */
const WHISPER_EFFECTS: Record<string, { belief?: { kind: string; valence: number }; goal?: (agent: AgentDoc, about: AgentDoc | undefined, strength: number, text: string) => GoalSpec }> = {
  suspect_hoarding: {
    belief: { kind: 'hoarding', valence: -1 },
    goal: (_a, about) => ({ kind: 'investigate', description: 'Find out what ' + about!.name + ' is hiding', predicate: 'belief_resolved' }),
  },
  distrust: { belief: { kind: 'untrustworthy', valence: -1 } },
  befriend: {
    belief: { kind: 'admirable', valence: 1 },
    goal: (_a, about) => ({ kind: 'improve_relationship', description: 'Get closer to ' + about!.name, predicate: 'affinity_at_least', targetQuantity: 0.6 }),
  },
  seek_power: { goal: () => ({ kind: 'gain_influence', description: 'Win a seat on the council', predicate: 'on_council' }) },
  get_rich: {
    goal: (a, _about, strength) => {
      const target = Math.round(a.inv.credits + 150 + 350 * strength);
      return { kind: 'earn_wealth', description: 'Save up ' + target + ' credits', predicate: 'credits_at_least', targetQuantity: target };
    },
  },
  share: { goal: () => ({ kind: 'custom', description: 'Give to those who have less', predicate: 'none' }) },
  custom: {
    belief: { kind: 'custom', valence: 0 },
    goal: (_a, _about, _s, text) => ({ kind: 'custom', description: text, predicate: 'none' }),
  },
};

/** Preset by key, the player's text (or the preset's) with the subject's name filled in. */
function ideaText(presets: IdeaPreset[], key: unknown, raw: unknown, about: AgentDoc | undefined, label: string): { preset: IdeaPreset; text: string } | PowerFailure {
  const preset = presets.find((k) => k.key === key);
  if (!preset) return fail('invalid', 'Unknown ' + label.toLowerCase() + ' preset.');
  const typed = textOf(raw, 0, 200, label);
  if (isFailure(typed)) return typed;
  const text = withName(typed || preset.text, about?.name);
  if (text.includes('{name}')) return fail('invalid', 'Choose who the ' + label.toLowerCase() + ' is about.');
  if (text.length < 3) return fail('invalid', label + ' needs some words.');
  return { preset, text };
}

type WhisperParams = { agent: AgentDoc; presetKey: string; text: string; strength: number; about?: AgentDoc; kind?: string };

/** Belief kinds a whisper about someone may plant instead of its preset's (focus:plant reads them from free text). */
export const WHISPER_KINDS = new Set([...ACCUSABLE, 'admirable']);

/**
 * Plants an idea in one mind: a private belief from a divine source and, for most presets, a goal
 * that expires after one to five sols by strength. The agent drops their queued plan, so they
 * replan around the idea when their current step ends, and is queued for crisis LLM planning.
 */
export const whisper: Power<WhisperParams> = {
  async parse(tx, raw) {
    const p = record(raw);
    if (isFailure(p)) return p;
    const agent = await agentOf(tx, p.agentId);
    if (isFailure(agent)) return agent;
    const strength = typeof p.strength === 'number' && p.strength >= 0 && p.strength <= 1 ? p.strength : fail('invalid', 'Strength must be from 0 to 1.');
    if (isFailure(strength)) return strength;
    const preset = WHISPER_PRESETS.find((k) => k.key === p.presetKey);
    let about: AgentDoc | undefined;
    if (p.aboutAgentId && (preset?.needsSubject || preset?.key === 'custom')) {
      const found = await agentOf(tx, p.aboutAgentId);
      if (isFailure(found)) return found;
      if (found._id === agent._id) return fail('invalid', 'A whisper cannot be about its own target.');
      about = found;
    }
    if (preset?.needsSubject && !about) return fail('invalid', 'Choose who the whisper is about.');
    const idea = ideaText(WHISPER_PRESETS, p.presetKey, p.text, about, 'The whisper');
    if (isFailure(idea)) return idea;
    const kind = typeof p.kind === 'string' && WHISPER_KINDS.has(p.kind) && about ? p.kind : undefined;
    return { agent, presetKey: idea.preset.key, text: idea.text, strength: round2(strength), about, kind };
  },

  async apply(tx, { agent, presetKey, text, strength, about, kind: planted }) {
    const base = WHISPER_EFFECTS[presetKey];
    // A planted suspicion of a named person works like suspect_hoarding, for whatever they are suspected of.
    const effect = planted
      ? {
          belief: { kind: planted, valence: planted === 'admirable' ? 1 : -1 },
          goal: planted === 'admirable' ? WHISPER_EFFECTS.befriend.goal : (_a: AgentDoc, b: AgentDoc | undefined): GoalSpec => ({ kind: 'investigate', description: 'Find out whether it is true: ' + text, predicate: 'belief_resolved' }),
        }
      : base;
    const { eventId } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'whisper',
      actorId: agent._id,
      locationId: standingAt(tx, agent),
      summary: 'A voice whispered to ' + agent.name + ': "' + text + '"',
      salience: 0.5,
      visibility: 'private',
      witnesses: [],
      facts: { presetKey, strength, text, aboutAgentId: about?._id, ...(planted ? { kind: planted } : {}) },
    });

    const kind = effect.belief?.kind ?? presetKey;
    await learnBelief(tx, agent, {
      kind,
      text,
      valence: about ? (effect.belief?.valence ?? 0) : 0,
      confidence: round2(0.35 + 0.6 * strength),
      sourceType: 'divine',
      subjectAgentId: about?._id,
      subjectName: about?.name,
      worldKey: about ? undefined : presetKey === 'custom' ? 'whisper:' + eventId : 'whisper:' + presetKey,
      originEventId: eventId,
      private: true,
    });

    const mind = (await loadMind(tx, agent))!;
    const spec = effect.goal?.(agent, about, strength, text);
    if (spec) addDivineGoal(tx, mind, spec, { drive: planted && planted !== 'admirable' ? planted : presetKey, strength, about, originEventId: eventId });
    mind.stateVersion += 1;
    touchMind(tx, mind);
    replan(tx, agent);
    await enqueueCognition(tx, agent, {
      kind: 'plan',
      trigger: 'A thought took hold: "' + text + '"',
      priority: round2(0.7 + 0.25 * strength),
      lane: 'crisis',
      eventId,
    });
    // Visible at once: they stop what they are doing with the thought on their face.
    if (agent.activity !== 'sleeping') {
      agent.mood = 'struck';
      agent.speech = '...Where did that come from?';
      touch(tx, agent);
    }
    return { affectedAgentIds: [agent._id] };
  },
};

/** Adds a whispered goal, replacing an earlier active one with the same drive and target. */
function addDivineGoal(
  tx: Tx,
  mind: MindDoc,
  spec: GoalSpec,
  origin: { drive: string; strength: number; about?: AgentDoc; originEventId: MindDoc['goals'][number]['originEventId'] },
): void {
  mind.goals = mind.goals.filter((g) => !(g.source === 'divine' && g.status === 'active' && g.drive === origin.drive && g.targetAgentId === origin.about?._id));
  mind.goals.push({
    id: 'g' + mind.nextGoalSeq,
    kind: spec.kind,
    description: spec.description,
    priority: round2(0.5 + 0.45 * origin.strength),
    source: 'divine',
    status: 'active',
    targetAgentId: origin.about?._id,
    targetAgentName: origin.about?.name,
    targetQuantity: spec.targetQuantity,
    createdAtTick: tx.tick,
    expiresAtTick: tx.tick + Math.round((1 + 4 * origin.strength) * TICKS_PER_DAY),
    predicate: spec.predicate,
    drive: origin.drive,
    originEventId: origin.originEventId,
  });
  mind.nextGoalSeq += 1;
}

/** Where a rumor starts by default: the colony's social spots, busiest first. */
const SOCIAL_SPOTS: LocationId[] = ['canteen', 'plaza', 'market'];

/**
 * Two to four people to first hear a rumor, never its subject. Prefers awake people at the chosen
 * spot (default: the busiest social spot); with too few there, the busiest place anywhere; and in
 * the dead of night, a habitat ring where it is overheard among the sleepers.
 */
async function rumorHearers(tx: Tx, subjectId: AgentId, seed: LocationId | undefined): Promise<{ locationId: LocationId; hearerIds: AgentId[] }> {
  const options = { exclude: [subjectId] };
  const busiest = async (ids: readonly LocationId[], includeAsleep = false) => {
    let best = { locationId: ids[0], pool: [] as AgentId[] };
    for (const id of ids) {
      const pool = await agentsAt(tx, id, { ...options, includeAsleep });
      if (pool.length > best.pool.length) best = { locationId: id, pool };
    }
    return best;
  };
  let found = seed ? { locationId: seed, pool: await agentsAt(tx, seed, options) } : await busiest(SOCIAL_SPOTS);
  if (found.pool.length < 2) found = await busiest(LOCATION_IDS);
  if (found.pool.length < 2) found = await busiest(['habitat_a', 'habitat_b'], true);
  const count = 2 + Math.floor(rand(tx.world.seed, tx.tick, subjectId, 'rumor') * 3);
  const shuffled = found.pool
    .map((id) => ({ id, r: rand(tx.world.seed, tx.tick, id, 'rumor-hearer') }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.id);
  return { locationId: found.locationId, hearerIds: shuffled.slice(0, count) };
}

type RumorParams = { subject: AgentDoc; preset: IdeaPreset; text: string; locationId: LocationId; hearerIds: AgentId[] };

/**
 * Starts a rumor about a colonist: two to four people at one spot come to believe it, as a rumor
 * with no known source. It spreads further only when they bring it up in a talk step.
 */
export const rumor: Power<RumorParams> = {
  async parse(tx, raw) {
    const p = record(raw);
    if (isFailure(p)) return p;
    const subject = await agentOf(tx, p.aboutAgentId);
    if (isFailure(subject)) return subject;
    const idea = ideaText(RUMOR_PRESETS, p.presetKey, p.text, subject, 'The rumor');
    if (isFailure(idea)) return idea;
    const seed = p.seedLocationId === undefined || p.seedLocationId === null ? undefined : locationOf(p.seedLocationId);
    if (isFailure(seed)) return seed;
    const { locationId, hearerIds } = await rumorHearers(tx, subject._id, seed);
    if (hearerIds.length === 0) return fail('invalid', 'There is nobody left to hear a rumor.');
    return { subject, preset: idea.preset, text: idea.text, locationId, hearerIds };
  },

  async apply(tx, { subject, preset, text, locationId, hearerIds }) {
    const { eventId } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'rumor_started',
      participantIds: hearerIds,
      locationId,
      summary: 'A rumor is going round ' + LOCATIONS[locationId].name + ' about ' + subject.name + ': "' + text + '"',
      salience: 0.72,
      visibility: 'local',
      witnesses: [],
      facts: { presetKey: preset.key, subjectAgentId: subject._id, text },
    });
    for (const id of hearerIds) {
      await learnBelief(tx, (await loadAgent(tx, id))!, {
        kind: preset.key,
        text,
        valence: preset.valence,
        confidence: 0.6,
        sourceType: 'rumor',
        subjectAgentId: subject._id,
        subjectName: subject.name,
        originEventId: eventId,
        hops: 1,
      });
    }
    // Most affected first: the hearer with the strongest feelings about the subject reacts in the open.
    const ranked: { id: AgentId; w: number }[] = [];
    for (const id of hearerIds) {
      const t = await tieTo(tx, id, subject._id);
      ranked.push({ id, w: t ? Math.abs(t.affinity) + Math.abs(t.trust) / 2 + (t.kind === 'family' || t.kind === 'partner' ? 1 : 0) : 0 });
    }
    ranked.sort((x, y) => y.w - x.w);
    const first = await loadAgent(tx, ranked[0].id);
    if (first?.alive && first.activity !== 'sleeping') {
      const other = ranked[1]?.id;
      first.mood = 'agitated';
      interrupt(tx, first, other ? [encodeStep('talk', other, preset.key + ':' + subject._id)] : [encodeStep('talk', 'any', preset.key + ':' + subject._id)]);
      first.speech = 'Have you heard what they are saying about ' + subject.name.split(' ')[0] + '?';
      touch(tx, first);
    }
    return { affectedAgentIds: ranked.map((x) => x.id) };
  },
};
