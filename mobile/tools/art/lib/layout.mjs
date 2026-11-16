/**
 * Colony geometry as the art generators see it: the shared layout and routes, plus each
 * building's outline (the solid part of its art) and the doors where routes meet its walls.
 */
import { LOCATION_LAYOUT, MAP_HEIGHT, MAP_WIDTH, ROUTE_WAYPOINTS } from '../../../shared/mapLayout.ts';
import { LOCATIONS, LOCATION_IDS, RESOURCES, ROUTES, SPRITE_ARCHETYPES, SPRITE_VARIANTS, routeKey } from '../../../shared/colony.ts';

export { LOCATION_LAYOUT, MAP_HEIGHT, MAP_WIDTH, LOCATIONS, LOCATION_IDS, RESOURCES, ROUTES, SPRITE_ARCHETYPES, SPRITE_VARIANTS };

/** Art pixels per world pixel. Generators draw in world pixels; the PNGs are written at this density. */
export const ART_SCALE = 1;

/** Rows of transparent space above a walled building's north wall, for masts and signs. */
export const HEADROOM = 16;
/** Thickness of a wall seen from above. */
export const WALL_TOP = 6;
/** Height of the inside face of a north wall. */
export const WALL_FACE = 28;
/** Height of the outside face of a south wall. */
export const SOUTH_FACE = 8;
/** Inset of the outer wall from the footprint's left and right edges (the bottom keeps SOUTH_FACE). */
export const SIDE = 4;

/**
 * How each building is built: 'room' is a rounded rectangle of walls, 'dome' a superellipse,
 * 'site' an exposed yard with no walls (its outline is the fence).
 */
export const BUILDING_KIND = {
  plaza: 'dome',
  observatory: 'dome',
  market: 'room',
  canteen: 'room',
  hydroponics: 'room',
  depot: 'room',
  workshop: 'room',
  medbay: 'room',
  habitat_a: 'room',
  habitat_b: 'room',
  ice_wells: 'site',
  quarry: 'site',
  solar_farm: 'site',
  landing_pad: 'site',
};

const CORNER = 14;

/**
 * True when the building-local pixel lies inside the building's outer wall line. For sites this
 * is the whole footprint.
 */
export function insideOutline(id, x, y) {
  const { w, h } = LOCATION_LAYOUT[id].footprint;
  const kind = BUILDING_KIND[id];
  if (kind === 'site') return x >= 0 && y >= 0 && x < w && y < h;
  const x0 = SIDE;
  const y0 = HEADROOM;
  const x1 = w - SIDE;
  const y1 = h - SOUTH_FACE;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  if (kind === 'dome') {
    const ax = (x1 - x0) / 2;
    const ay = (y1 - y0) / 2;
    const dx = Math.abs(x + 0.5 - (x0 + ax)) / ax;
    const dy = Math.abs(y + 0.5 - (y0 + ay)) / ay;
    return dx ** 4 + dy ** 4 <= 1;
  }
  const cx = Math.min(Math.max(x + 0.5, x0 + CORNER), x1 - CORNER);
  const cy = Math.min(Math.max(y + 0.5, y0 + CORNER), y1 - CORNER);
  return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= CORNER * CORNER;
}

/** Same as insideOutline, in world pixels. */
export function insideBuilding(id, wx, wy) {
  const f = LOCATION_LAYOUT[id].footprint;
  return insideOutline(id, wx - f.x, wy - f.y);
}

/** The building whose outline contains the world pixel, if any. */
export function buildingAt(wx, wy) {
  for (const id of LOCATION_IDS) {
    const f = LOCATION_LAYOUT[id].footprint;
    if (wx >= f.x && wy >= f.y && wx < f.x + f.w && wy < f.y + f.h && insideBuilding(id, wx, wy)) return id;
  }
  return null;
}

/** Every route as a world-space polyline from a's entry to b's entry, through its waypoints. */
export const ROUTE_LINES = ROUTES.map((r) => {
  const [a, b] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
  const pts = [LOCATION_LAYOUT[a].entry, ...(ROUTE_WAYPOINTS[routeKey(a, b)] ?? []), LOCATION_LAYOUT[b].entry];
  return { a, b, surface: r.surface, pts };
});

/**
 * Doors in building-local pixels: where each route crosses the building's outline. A building
 * whose entry is outside its walls gets one door, on the wall nearest the entry; a hub whose entry
 * is inside gets one door per route. side is 'n' | 's' | 'w' | 'e'.
 */
export function doorsOf(id) {
  const f = LOCATION_LAYOUT[id].footprint;
  const entry = LOCATION_LAYOUT[id].entry;
  const sideOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : dy < 0 ? 'n' : 's');
  const doors = [];
  const add = (x, y, side, surface) => {
    const same = doors.find((d) => Math.abs(d.x - x) < 4 && Math.abs(d.y - y) < 4);
    if (same) same.surface = same.surface || surface;
    else doors.push({ x, y, side, surface });
  };
  for (const line of ROUTE_LINES) {
    if (line.a !== id && line.b !== id) continue;
    const pts = line.a === id ? line.pts : [...line.pts].reverse();
    if (!insideBuilding(id, entry.x, entry.y)) {
      // Nearest outline pixel to the entry, searched outward along the axis towards the building centre.
      const c = LOCATION_LAYOUT[id].center;
      const side = sideOf(entry.x - c.x, entry.y - c.y);
      let x = entry.x;
      let y = entry.y;
      const step = { w: [1, 0], e: [-1, 0], n: [0, 1], s: [0, -1] }[side];
      for (let i = 0; i < 64 && !insideBuilding(id, x, y); i++) {
        x += step[0];
        y += step[1];
      }
      add(x - f.x, y - f.y, side, line.surface);
      continue;
    }
    // Walk the polyline outward until it leaves the outline.
    let found = false;
    for (let s = 0; s < pts.length - 1 && !found; s++) {
      const p = pts[s];
      const q = pts[s + 1];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      for (let t = 0; t <= len; t++) {
        const x = Math.round(p.x + ((q.x - p.x) * t) / len);
        const y = Math.round(p.y + ((q.y - p.y) * t) / len);
        if (!insideBuilding(id, x, y)) {
          add(x - f.x, y - f.y, sideOf(q.x - p.x, q.y - p.y), line.surface);
          found = true;
          break;
        }
      }
    }
  }
  return doors;
}
