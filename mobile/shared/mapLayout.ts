/**
 * Pixel geometry of the colony in world pixels (1 world px = 1 art px, nearest-neighbour scaled).
 * Rendering only. The backend never reads this file; travel time comes from ROUTES in ./colony.ts.
 * Owned by the art: footprints, doors and stand areas match the painted buildings in
 * mobile/assets/game, and the tubes and rover tracks painted on the ground follow the entries and
 * ROUTE_WAYPOINTS below (see mobile/tools/art/STYLE.md).
 */
import type { LocationId } from './colony';

export const TILE = 32;
export const MAP_WIDTH = 1280;
export const MAP_HEIGHT = 1920;

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export type LocationLayout = {
  /** Visual centre, also where the name label sits. */
  center: Point;
  /** Bounding box of the building art. Tapping inside selects the location. */
  footprint: Rect;
  /** Door: where routes attach and where colonists enter and leave. */
  entry: Point;
  /** Walkable floor where colonists stand, work and idle while at this location. */
  standAreas: Rect[];
};

/**
 * One location from its centre and size. `stand` lists open floor as [x0, y0, x1, y1] in the
 * building's own pixels (0,0 = footprint top-left): the aisles between racks, tables and stalls,
 * so a standing colonist's feet never land on furniture.
 */
function place(cx: number, cy: number, w: number, h: number, entry: Point, stand: [number, number, number, number][]): LocationLayout {
  const x = cx - w / 2;
  const y = cy - h / 2;
  return {
    center: { x: cx, y: cy },
    footprint: { x, y, w, h },
    entry,
    standAreas: stand.map(([x0, y0, x1, y1]) => ({ x: x + x0, y: y + y0, w: x1 - x0, h: y1 - y0 })),
  };
}

/*
 * The pressurised core is a grid of tubes: rows at y 704, 1064 and 1424, columns at x 461, 640
 * and 820. Plaza, depot and medbay are hubs whose entry is their centre (one door per side).
 * The exposed sites (solar farm, observatory approach, landing pad, ice wells, quarry) hang off
 * the core by rover tracks over open regolith.
 */
export const LOCATION_LAYOUT: Record<LocationId, LocationLayout> = {
  solar_farm: place(280, 208, 384, 256, { x: 380, y: 344 }, [[24, 58, 300, 72], [24, 112, 300, 126], [24, 166, 300, 180], [24, 220, 360, 240]]),
  observatory: place(640, 212, 224, 224, { x: 640, y: 330 }, [[30, 82, 70, 190], [154, 82, 194, 190], [70, 166, 154, 196]]),
  landing_pad: place(1000, 208, 320, 256, { x: 900, y: 344 }, [[24, 112, 92, 232], [228, 112, 296, 232], [92, 184, 228, 232]]),
  canteen: place(270, 704, 256, 224, { x: 402, y: 704 }, [[20, 80, 236, 96], [20, 130, 236, 146], [20, 182, 236, 204]]),
  plaza: place(640, 704, 320, 288, { x: 640, y: 704 }, [[60, 112, 260, 236]]),
  market: place(1000, 704, 288, 224, { x: 852, y: 704 }, [[20, 94, 268, 124], [20, 162, 268, 204]]),
  hydroponics: place(250, 1064, 384, 288, { x: 446, y: 1064 }, [[20, 82, 364, 102], [20, 136, 364, 156], [20, 190, 364, 210], [20, 244, 364, 266]]),
  depot: place(640, 1064, 224, 192, { x: 640, y: 1064 }, [[64, 88, 160, 176]]),
  workshop: place(1000, 1064, 288, 256, { x: 852, y: 1064 }, [[20, 94, 268, 134], [20, 174, 268, 234]]),
  habitat_a: place(260, 1424, 352, 288, { x: 440, y: 1424 }, [[20, 118, 332, 150], [20, 194, 332, 266]]),
  medbay: place(640, 1424, 224, 192, { x: 640, y: 1424 }, [[20, 98, 204, 176]]),
  habitat_b: place(1020, 1424, 352, 288, { x: 840, y: 1424 }, [[20, 104, 332, 140], [20, 194, 332, 266]]),
  ice_wells: place(340, 1800, 352, 176, { x: 380, y: 1706 }, [[24, 124, 328, 166], [128, 64, 224, 124]]),
  quarry: place(960, 1800, 352, 176, { x: 930, y: 1706 }, [[44, 104, 308, 160]]),
};

/**
 * Optional intermediate points for a route, keyed by routeKey(a, b) from ./colony.ts and listed
 * in the direction from the alphabetically smaller id to the larger. A route with no entry is a
 * straight line between the two entries.
 */
export const ROUTE_WAYPOINTS: Record<string, Point[]> = {
  // tubes along the west and east columns of the core
  'canteen|hydroponics': [{ x: 461, y: 704 }, { x: 461, y: 1064 }],
  'habitat_a|hydroponics': [{ x: 461, y: 1424 }, { x: 461, y: 1064 }],
  'market|workshop': [{ x: 820, y: 704 }, { x: 820, y: 1064 }],
  'habitat_b|workshop': [{ x: 820, y: 1424 }, { x: 820, y: 1064 }],
  // rover tracks over the surface
  'observatory|solar_farm': [{ x: 604, y: 368 }, { x: 440, y: 384 }],
  'landing_pad|observatory': [{ x: 860, y: 384 }, { x: 680, y: 368 }],
  'landing_pad|market': [{ x: 900, y: 420 }, { x: 836, y: 500 }, { x: 836, y: 660 }],
  'canteen|solar_farm': [{ x: 424, y: 664 }, { x: 424, y: 420 }, { x: 392, y: 384 }],
  'habitat_a|ice_wells': [{ x: 461, y: 1470 }, { x: 461, y: 1600 }, { x: 404, y: 1662 }],
  'habitat_b|quarry': [{ x: 820, y: 1470 }, { x: 820, y: 1600 }, { x: 900, y: 1662 }],
  'ice_wells|quarry': [{ x: 440, y: 1676 }, { x: 640, y: 1652 }, { x: 860, y: 1676 }],
};
