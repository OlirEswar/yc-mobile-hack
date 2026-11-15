/**
 * Map geometry helpers: where a colonist stands inside a location and the polyline they walk
 * between two locations. Pure functions over shared/mapLayout.ts, run on the JS thread; the
 * results are handed to the UI thread as plain number arrays.
 */
import { LOCATION_IDS, findPath, routeKey, type LocationId } from '../../shared/colony';
import { LOCATION_LAYOUT, ROUTE_WAYPOINTS, type Point } from '../../shared/mapLayout';

export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Avalanche, so strings that differ in one character give unrelated numbers.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 0..1 from a string. */
export function hash01(text: string): number {
  return hash32(text) / 4294967296;
}

/**
 * A stable spot for this colonist inside a location's stand areas. The same id and salt always
 * give the same spot, so a colonist returns to "their" place.
 */
export function standSpot(agentId: string, locationId: LocationId, salt = ''): Point {
  const layout = LOCATION_LAYOUT[locationId];
  const areas = layout.standAreas.length > 0 ? layout.standAreas : [layout.footprint];
  const total = areas.reduce((sum, a) => sum + a.w * a.h, 0);
  let pick = hash01(agentId + '|' + locationId + '|a' + salt) * total;
  let area = areas[0];
  for (const a of areas) {
    area = a;
    pick -= a.w * a.h;
    if (pick <= 0) break;
  }
  const pad = 6;
  const w = Math.max(1, area.w - pad * 2);
  const h = Math.max(1, area.h - pad * 2);
  return {
    x: Math.round(area.x + pad + hash01(agentId + '|' + locationId + '|x' + salt) * w),
    y: Math.round(area.y + pad + hash01(agentId + '|' + locationId + '|y' + salt) * h),
  };
}

/** Entry-to-entry polyline between two locations, following findPath and ROUTE_WAYPOINTS. */
export function routePolyline(from: LocationId, to: LocationId): Point[] {
  const path = findPath(from, to);
  const nodes = path ? path.nodes : [from, to];
  const points: Point[] = [LOCATION_LAYOUT[nodes[0]].entry];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const waypoints = ROUTE_WAYPOINTS[routeKey(a, b)] ?? [];
    points.push(...(a < b ? waypoints : [...waypoints].reverse()));
    points.push(LOCATION_LAYOUT[b].entry);
  }
  return points;
}

export type WalkPath = {
  /** Flat x,y pairs. */
  pts: number[];
  /** Cumulative length at each point. */
  cum: number[];
  total: number;
};

export function makeWalkPath(points: Point[]): WalkPath {
  const pts: number[] = [];
  const cum: number[] = [];
  let total = 0;
  let last: Point | undefined;
  for (const p of points) {
    if (last && last.x === p.x && last.y === p.y) continue;
    if (last) total += Math.hypot(p.x - last.x, p.y - last.y);
    pts.push(p.x, p.y);
    cum.push(total);
    last = p;
  }
  return { pts, cum, total };
}

/** Full walk for a move: stand spot, out of the door, along the route, in at the door, stand spot. */
export function moveWalkPath(start: Point, from: LocationId, to: LocationId, end: Point): WalkPath {
  return makeWalkPath([start, ...routePolyline(from, to), end]);
}

/** The location whose footprint contains the point, if any. */
export function locationAt(x: number, y: number): LocationId | null {
  for (const id of LOCATION_IDS) {
    const f = LOCATION_LAYOUT[id].footprint;
    if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return id;
  }
  return null;
}
