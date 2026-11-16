/**
 * Powers over the environment: drought and storm. Each starts a standing condition in
 * world.activeEffects (recorded in world.causes) and applies only its immediate effect. The
 * simulation reads the condition every tick (water output, prices, rationing, blocked routes,
 * repairs) and ends it at endTick.
 */
import { findPath, LOCATION_IDS, LOCATIONS, ROUTES, routeKey, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { agentIndex, agentsAt, emitEvent, encodeStep, enqueueCognition, interrupt, killAgent, learnBelief, loadAgent, touch } from '../engine/core';
import type { AgentDoc, AgentId, Tx } from '../engine/core';
import { clamp, rand, round1, round2 } from '../lib/rng';
import { ROSTER_TRANSIT } from '../seed/insert';
import { currentEffect, isFailure, locationOf, numberIn, record, severityOf, standingAt, upsertEffect } from './common';
import type { Power } from './common';

/** Roles told at once when the wells fail, so the colony's leaders react the same day. */
const DROUGHT_ROLES = ['quartermaster', 'chair', 'union_leader'];

/**
 * The ice wells run dry for durationDays sols. The well crew notices at once: whoever is at the
 * wells sees it, the rest of the crew hears over the radio, and the quartermaster, chair and union
 * leader are told and queued for crisis planning.
 */
export const drought: Power<{ severity: number; durationDays: number }> = {
  async parse(_tx, raw) {
    const p = record(raw);
    if (isFailure(p)) return p;
    const severity = severityOf(p.severity);
    if (isFailure(severity)) return severity;
    const durationDays = numberIn(p.durationDays, 1, 7, 'Duration in sols');
    if (isFailure(durationDays)) return durationDays;
    return { severity, durationDays: round1(durationDays) };
  },

  async apply(tx, { severity, durationDays }) {
    const percent = Math.round(severity * 100);
    const endTick = tx.tick + Math.round(durationDays * TICKS_PER_DAY);
    const deepens = !!currentEffect(tx, 'drought');

    const onSite = new Set<string>(await agentsAt(tx, 'ice_wells'));
    const crew: AgentDoc[] = [];
    for (const id of await agentIndex(tx)) {
      const a = id && (await loadAgent(tx, id));
      if (a && a.alive && (a.workLocationId === 'ice_wells' || onSite.has(a._id))) crew.push(a);
    }
    const leaders: AgentDoc[] = [];
    for (const role of DROUGHT_ROLES) {
      const id = tx.world.roles[role];
      const a = id && (await loadAgent(tx, id));
      if (a && a.alive && !leaders.includes(a)) leaders.push(a);
    }

    const { eventId } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'drought',
      locationId: 'ice_wells',
      summary: deepens
        ? 'The drought at the Ice Wells deepens: water output is down ' + percent + '% for ' + durationDays + ' sols.'
        : 'The ice wells are running dry. Water output has fallen by ' + percent + '% for ' + durationDays + ' sols.',
      salience: 0.95,
      visibility: 'public',
      witnesses: crew.filter((a) => onSite.has(a._id)).map((a) => a._id),
      facts: { severity, durationDays, endTick },
    });
    upsertEffect(tx, { type: 'drought', locationIds: [], severity, endTick, label: 'Drought ' + percent + '%', eventId });

    const belief = { kind: 'scarcity', worldKey: 'scarcity:water', text: 'The ice wells are running dry.', valence: -1, originEventId: eventId, truthEventId: eventId };
    for (const a of crew) {
      const saw = onSite.has(a._id);
      await learnBelief(tx, a, { ...belief, confidence: saw ? 0.9 : 0.7, sourceType: saw ? 'observed' : 'told', sourceName: saw ? undefined : 'the well crew' });
      a.mood = 'worried';
      touch(tx, a);
    }
    for (const a of leaders) {
      if (!crew.includes(a)) await learnBelief(tx, a, { ...belief, confidence: 0.8, sourceType: 'told', sourceName: 'the well crew' });
      await enqueueCognition(tx, a, {
        kind: 'plan',
        trigger: 'The ice wells are running dry',
        detail: 'Water output is down ' + percent + '% for ' + durationDays + ' sols.',
        priority: 0.9,
        lane: 'crisis',
        eventId,
      });
    }
    // Someone takes it hardest, in the open: the thirstiest of the well crew on site (or anyone awake) panics.
    const awake = crew.filter((a) => a.activity !== 'sleeping');
    const hit = [...awake].sort((x, y) => Number(onSite.has(y._id)) - Number(onSite.has(x._id)) || y.needs.thirst - x.needs.thirst)[0] ?? leaders[0];
    if (hit) {
      hit.mood = 'panicked';
      hit.needs.safety = Math.min(100, hit.needs.safety + 40);
      const reaction = hit.traits.empathy < 0.4 ? [encodeStep('go', 'depot'), encodeStep('loot', 'depot')] : hit.traits.caution > 0.55 ? [encodeStep('go', 'market'), encodeStep('buy', 'water', 4), encodeStep('hide', 'water', 3)] : [encodeStep('pray', 2), encodeStep('go', 'plaza'), encodeStep('preach', 'the wells are dying and the council knew')];
      interrupt(tx, hit, reaction);
      hit.speech = 'The wells are dying! There will not be enough for all of us!';
      touch(tx, hit);
    }
    return { affectedAgentIds: [...new Set([...(hit ? [hit] : []), ...crew.filter((a) => onSite.has(a._id)), ...crew, ...leaders].map((a) => a._id))] };
  },
};

/** The nearest pressurised location the storm did not hit, or null when there is none. */
function nearestShelter(from: LocationId, hit: ReadonlySet<string>): LocationId | null {
  let best: LocationId | null = null;
  let bestTicks = Infinity;
  for (const id of LOCATION_IDS) {
    if (LOCATIONS[id].exposed || hit.has(id)) continue;
    const path = findPath(from, id);
    if (path && path.ticks < bestTicks) {
      best = id;
      bestTicks = path.ticks;
    }
  }
  return best;
}

/** Surface routes that touch a hit location: anyone walking one is caught in the open. */
function exposedRoutes(hit: ReadonlySet<string>): Set<string> {
  return new Set(ROUTES.filter((r) => r.surface && (hit.has(r.a) || hit.has(r.b))).map((r) => routeKey(r.a, r.b)));
}

/**
 * A solar or meteor storm over the given locations (default: every exposed one) for two to six
 * hours by severity. Damages the buildings at once, injures everyone there or walking a surface
 * route beside them (killing the already frail in a severe storm), and sends the survivors running
 * for the nearest pressurised dome.
 */
export const storm: Power<{ severity: number; locationIds: LocationId[] }> = {
  async parse(_tx, raw) {
    const p = record(raw);
    if (isFailure(p)) return p;
    const severity = severityOf(p.severity);
    if (isFailure(severity)) return severity;
    if (p.locationIds !== undefined && !Array.isArray(p.locationIds)) return { ok: false, code: 'invalid', message: 'locationIds must be a list.' };
    const locationIds: LocationId[] = [];
    for (const raw of p.locationIds ?? []) {
      const id = locationOf(raw);
      if (isFailure(id)) return id;
      if (!locationIds.includes(id)) locationIds.push(id);
    }
    return { severity, locationIds: locationIds.length > 0 ? locationIds : LOCATION_IDS.filter((id) => LOCATIONS[id].exposed) };
  },

  async apply(tx, { severity, locationIds }) {
    const hit = new Set<string>(locationIds);
    const endTick = tx.tick + TICKS_PER_HOUR * (2 + Math.round(severity * 4));
    const kind = severity >= 0.5 ? 'meteor storm' : 'solar storm';
    const names = locationIds.map((id) => LOCATIONS[id].name).join(', ');
    const { eventId } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'storm',
      locationId: locationIds[0],
      summary: 'A ' + kind + ' is hitting ' + names + '.',
      salience: 0.95,
      visibility: 'public',
      witnesses: [],
      facts: { severity, locationIds, endTick },
    });
    upsertEffect(tx, { type: 'storm', locationIds, severity, endTick, label: kind === 'meteor storm' ? 'Meteor storm' : 'Solar storm', eventId });

    for (const id of locationIds) {
      const damage = round2(clamp((tx.world.damage[id] ?? 0) + 0.15 + 0.5 * severity, 0, 1));
      tx.world.damage[id] = damage;
      await emitEvent(tx, {
        category: 'environment',
        eventType: 'damage',
        locationId: id,
        summary: LOCATIONS[id].name + ' was damaged by the ' + kind + '.',
        salience: 0.45 + 0.3 * severity,
        causationEventId: eventId,
        visibility: 'public',
        witnesses: 'location',
        banner: false,
        facts: { damage },
      });
    }

    const caught: AgentDoc[] = [];
    for (const id of locationIds) {
      for (const agentId of await agentsAt(tx, id, { includeAsleep: true })) caught.push((await loadAgent(tx, agentId))!);
    }
    const routes = exposedRoutes(hit);
    const index = await agentIndex(tx);
    for (let seq = 0; seq < tx.rosterSt.length; seq++) {
      if (tx.rosterSt[seq] !== ROSTER_TRANSIT || !index[seq]) continue;
      const a = await loadAgent(tx, index[seq]);
      const path = a?.move && findPath(a.move.from as LocationId, a.move.to as LocationId);
      if (!a || !path || caught.includes(a)) continue;
      if (path.nodes.some((node, i) => i > 0 && routes.has(routeKey(path.nodes[i - 1], node)))) caught.push(a);
    }

    const affected: AgentId[] = [];
    const lossOf = new Map<string, number>();
    for (const a of caught) {
      const where = standingAt(tx, a) as LocationId;
      const loss = Math.max(1, Math.round(severity * (10 + 30 * rand(tx.world.seed, tx.tick, a.seq, 'storm'))));
      a.health = Math.max(0, a.health - loss);
      affected.push(a._id);
      lossOf.set(a._id, loss + (a.activity === 'sleeping' ? -100 : 0));
      if (a.health <= 0 || (severity >= 0.75 && a.health < 12)) {
        await killAgent(tx, a, { cause: 'caught in the ' + kind + ' at ' + LOCATIONS[where].name, causationEventId: eventId, category: 'environment' });
        continue;
      }
      a.needs.safety = Math.min(100, a.needs.safety + 30 + 50 * severity);
      a.mood = 'frightened';
      await emitEvent(tx, {
        category: 'health',
        eventType: 'injury',
        actorId: a._id,
        locationId: where,
        summary: a.name + ' was hurt by the ' + kind + ' at ' + LOCATIONS[where].name + '.',
        salience: 0.35 + loss / 100,
        causationEventId: eventId,
        visibility: 'local',
        witnesses: [],
        facts: { healthLost: loss },
      });
      const shelter = nearestShelter(where, hit);
      if (shelter && shelter !== where) interrupt(tx, a, [encodeStep('flee', shelter), encodeStep(a.traits.caution > 0.5 ? 'pray' : 'cry', 2)]);
      else if (a.activity !== 'sleeping') interrupt(tx, a, [encodeStep('pray', 2)]);
      a.speech = 'Get inside! Everybody get inside!';
      touch(tx, a);
    }
    // Hardest hit first (the living and awake before the rest).
    affected.sort((x, y) => (lossOf.get(y) ?? 0) - (lossOf.get(x) ?? 0));
    return { affectedAgentIds: affected };
  },
};
