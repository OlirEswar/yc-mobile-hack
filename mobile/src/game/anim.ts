/**
 * Turns an AgentLite from the backend into the record the UI thread animates.
 * Where a colonist stands inside a location is the client's choice (see shared/mapLayout.ts).
 */
import type { AgentLite } from '../../shared/types';
import { EMOTES, MANIFEST } from '../art';
import type { AnimAgent } from '../render/scene';
import { hash01, makeWalkPath, moveWalkPath, standSpot } from './geometry';

const PAIR_ACTIVITIES = new Set(['talking', 'trading', 'giving', 'helping']);
const BUSY = new Set(['working', 'eating', 'drinking', 'trading', 'giving', 'helping', 'stealing', 'investigating']);

function restingSpot(agent: AgentLite, partner: AgentLite | undefined) {
  const salt = agent.activity === 'working' ? 'w' : agent.activity === 'sleeping' || agent.activity === 'resting' ? 's' : '';
  const own = standSpot(agent.id, agent.locationId, salt);
  if (partner && PAIR_ACTIVITIES.has(agent.activity) && partner.locationId === agent.locationId && !partner.move && partner.alive) {
    // Both sides compute the same meeting point and stand either side of it, facing each other.
    const first = agent.id < partner.id ? agent : partner;
    const second = first === agent ? partner : agent;
    const a = standSpot(first.id, first.locationId, '');
    const b = standSpot(second.id, second.locationId, '');
    const gap = Math.round(MANIFEST.characters.frameWidth * 0.45);
    const left = agent === first;
    return { x: Math.round((a.x + b.x) / 2) + (left ? -gap : gap), y: Math.round((a.y + b.y) / 2), face: left ? 2 : 1 };
  }
  return { x: own.x, y: own.y, face: agent.activity === 'working' ? 3 : 0 };
}

export function toAnimAgent(agent: AgentLite, partner: AgentLite | undefined, prev: AnimAgent | undefined, nowTick: number): AnimAgent {
  const rest = restingSpot(agent, partner);
  const base = {
    row: MANIFEST.characters.rows[agent.spriteId] ?? 0,
    alive: agent.alive,
    x: rest.x,
    y: rest.y,
    face: rest.face,
    idle: !agent.alive ? 0 : agent.activity === 'sleeping' ? 3 : BUSY.has(agent.activity) ? 2 : agent.activity === 'mourning' ? 0 : 1,
    emote: agent.alive ? (EMOTES.columns[agent.activity] ?? -1) : -1,
    phase: hash01(agent.id),
  };
  if (!agent.alive) {
    // A grave stays where the colonist last stood.
    return { ...base, x: prev?.x ?? rest.x, y: prev?.y ?? rest.y, walking: false, departTick: 0, arriveTick: 0, pts: [], cum: [], total: 0 };
  }
  if (agent.move && agent.move.arriveTick > nowTick - 0.5) {
    const same = prev && prev.walking && prev.departTick === agent.move.departTick && prev.arriveTick === agent.move.arriveTick;
    if (same) return { ...base, walking: true, departTick: prev.departTick, arriveTick: prev.arriveTick, pts: prev.pts, cum: prev.cum, total: prev.total };
    const start = prev ? { x: prev.x, y: prev.y } : standSpot(agent.id, agent.move.from, '');
    const end = standSpot(agent.id, agent.move.to, '');
    const path = moveWalkPath(start, agent.move.from, agent.move.to, end);
    return { ...base, x: end.x, y: end.y, face: 0, walking: true, departTick: agent.move.departTick, arriveTick: agent.move.arriveTick, ...path };
  }
  if (prev && prev.walking && prev.x === rest.x && prev.y === rest.y && prev.arriveTick > nowTick) {
    // Still on the way to this same spot: keep walking.
    return { ...base, walking: true, departTick: prev.departTick, arriveTick: prev.arriveTick, pts: prev.pts, cum: prev.cum, total: prev.total };
  }
  if (prev && (prev.x !== rest.x || prev.y !== rest.y)) {
    // Same location, new spot (work bench, meeting someone): stroll over instead of teleporting.
    const dist = Math.hypot(rest.x - prev.x, rest.y - prev.y);
    if (dist < 420) {
      const path = makeWalkPath([{ x: prev.x, y: prev.y }, { x: rest.x, y: rest.y }]);
      return { ...base, walking: true, departTick: nowTick, arriveTick: nowTick + Math.max(0.12, Math.min(0.6, dist / 220)), ...path };
    }
  }
  return { ...base, walking: false, departTick: 0, arriveTick: 0, pts: [], cum: [], total: 0 };
}
