/** Converters from stored documents to the public shapes in shared/types.ts. */
import type { Doc } from '../_generated/dataModel';
import { STEP_SPECS } from '../engine/core';
import type { LocationId, ResourceId, Speed, SpriteId } from '../../shared/colony';
import type {
  ActiveEffect,
  ActivityKind,
  AgentLite,
  EventCategory,
  FactionPublic,
  GoalPublic,
  PersonaPublic,
  StorylinePublic,
  WorldEventPublic,
  WorldPublic,
} from '../../shared/types';

const NO_ACT = new Set(['go', 'wait', 'rest']);

/** The step in progress as the app animates it: its kind and the other person in it. */
function actOf(a: Doc<'agents'>): AgentLite['act'] {
  if (!a.alive || !a.cur) return undefined;
  const [kind, ...args] = a.cur.split('|');
  if (NO_ACT.has(kind)) return undefined;
  const spec = (STEP_SPECS as Record<string, { args: readonly string[] }>)[kind];
  const at = spec ? spec.args.findIndex((n) => /^(agentId|target|targetId)\??$/.test(n)) : -1;
  const arg = at >= 0 ? args[at] : undefined;
  const targetId = a.interactingWithId ?? (arg && arg.length >= 16 && !arg.includes(':') ? arg : undefined);
  return { kind, targetId, startTick: a.curStartTick ?? a.busyUntilTick };
}

export function toAgentLite(a: Doc<'agents'>): AgentLite {
  return {
    act: actOf(a),
    id: a._id,
    name: a.name,
    spriteId: a.spriteId as SpriteId,
    occupation: a.occupation,
    factionId: a.factionId,
    alive: a.alive,
    locationId: a.locationId as LocationId,
    move: a.move ? { from: a.move.from as LocationId, to: a.move.to as LocationId, departTick: a.move.departTick, arriveTick: a.move.arriveTick } : undefined,
    activity: a.activity as ActivityKind,
    activityLabel: a.activityLabel,
    busyUntilTick: a.busyUntilTick,
    interactingWithId: a.interactingWithId,
    speech: a.speech,
    mood: a.mood,
    health: Math.round(a.health),
    needs: {
      hunger: Math.round(a.needs.hunger),
      thirst: Math.round(a.needs.thirst),
      fatigue: Math.round(a.needs.fatigue),
      safety: Math.round(a.needs.safety),
      social: Math.round(a.needs.social),
    },
    updatedAtVersion: a.updatedAtVersion,
    ...(a.ownerName ? { ownerName: a.ownerName } : {}),
  };
}

export function toEventPublic(e: Doc<'events'>): WorldEventPublic {
  return {
    id: e._id,
    tick: e.tick,
    category: e.category as EventCategory,
    eventType: e.eventType,
    actorId: e.actorId,
    participantIds: e.participantIds,
    locationId: e.locationId as LocationId | undefined,
    summary: e.summary,
    salience: e.salience,
    causationEventId: e.causationEventId,
    banner: e.banner,
    storylineId: e.storylineId ?? (typeof e.facts?.storylineId === 'string' ? e.facts.storylineId : undefined),
    visibility: e.visibility as WorldEventPublic['visibility'],
  };
}

/** The public face of a persona: never the secret, never the need. */
export function toPersonaPublic(p: NonNullable<Doc<'minds'>['persona']>): PersonaPublic {
  return { epithet: p.epithet, want: p.want, fear: p.fear, flaw: p.flaw, voice: p.voice, arc: { stage: p.arc.stage as PersonaPublic['arc']['stage'], note: p.arc.note }, key: p.key };
}

/** Newest twelve beats only. */
export function toStorylinePublic(s: Doc<'storylines'>): StorylinePublic {
  return {
    id: s._id,
    title: s.title,
    premise: s.premise,
    status: s.status as StorylinePublic['status'],
    tension: s.tension,
    participantIds: s.participantIds,
    beats: s.beats.slice(-12),
    origin: s.origin as StorylinePublic['origin'],
    createdTick: s.createdTick,
    lastBeatTick: s.lastBeatTick,
  };
}

export function toFactionPublic(f: Doc<'factions'>): FactionPublic {
  return { id: f.key, name: f.name, color: f.color, leaderAgentId: f.leaderAgentId, memberCount: f.memberCount, description: f.description };
}

export function toGoalPublic(g: Doc<'minds'>['goals'][number]): GoalPublic {
  return {
    id: g.id,
    kind: g.kind as GoalPublic['kind'],
    description: g.description,
    priority: g.priority,
    source: g.source as GoalPublic['source'],
    status: g.status as GoalPublic['status'],
    targetAgentId: g.targetAgentId,
    targetAgentName: g.targetAgentName,
    createdAtTick: g.createdAtTick,
  };
}

export function toWorldPublic(w: Doc<'worlds'>, factions: Doc<'factions'>[]): WorldPublic {
  const stockpiles: WorldPublic['stockpiles'] = {};
  for (const [loc, stock] of Object.entries(w.stockpiles)) {
    const out: Partial<Record<ResourceId, number>> = {};
    for (const [res, amount] of Object.entries(stock)) out[res as ResourceId] = Math.round(amount);
    stockpiles[loc as LocationId] = out;
  }
  const damage: WorldPublic['damage'] = {};
  for (const [loc, d] of Object.entries(w.damage)) if (d > 0.005) damage[loc as LocationId] = Math.round(d * 100) / 100;
  const effects: ActiveEffect[] = w.activeEffects.map((e) => ({
    id: e.id,
    type: e.type as ActiveEffect['type'],
    locationIds: e.locationIds as LocationId[],
    severity: e.severity,
    startTick: e.startTick,
    endTick: e.endTick,
    label: e.label,
  }));
  return {
    id: w._id,
    name: w.name,
    tick: w.tick,
    speed: w.speed as Speed,
    status: w.status as WorldPublic['status'],
    version: w.version,
    population: w.population,
    activeEffects: effects,
    stockpiles,
    damage,
    prices: w.prices,
    factions: factions.map(toFactionPublic).sort((a, b) => a.id.localeCompare(b.id)),
    llm: { enabled: w.llm.enabled, callsToday: w.llm.callsToday, budgetPerDay: w.llm.budgetPerDay, queued: w.llm.queued },
    rationLevel: w.econ.rationLevel as 0 | 1 | 2,
    treasury: Math.round(w.econ.treasury),
    regolith: { quarry: Math.round(w.econ.regolith.quarry), workshop: Math.round(w.econ.regolith.workshop) },
    focusWarp: w.focusWarp,
  };
}
