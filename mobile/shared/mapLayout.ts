/**
 * Pixel geometry of the colony in world pixels (1 world px = 1 art px, nearest-neighbour scaled).
 * Rendering only. The backend never reads this file; travel time comes from ROUTES in ./colony.ts.
 * Owner after the foundation commit: the art subagent (it may move things to fit the painted map,
 * but must keep every LocationId and every route).
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

const box = (cx: number, cy: number, w: number, h: number): Rect => ({ x: cx - w / 2, y: cy - h / 2, w, h });
const inner = (cx: number, cy: number, w: number, h: number): Rect[] => [box(cx, cy + 8, w - 96, h - 104)];

export const LOCATION_LAYOUT: Record<LocationId, LocationLayout> = {
  solar_farm: { center: { x: 300, y: 230 }, footprint: box(300, 230, 384, 256), entry: { x: 400, y: 360 }, standAreas: inner(300, 230, 384, 256) },
  observatory: { center: { x: 640, y: 330 }, footprint: box(640, 330, 224, 224), entry: { x: 640, y: 444 }, standAreas: inner(640, 330, 224, 224) },
  landing_pad: { center: { x: 980, y: 220 }, footprint: box(980, 220, 320, 256), entry: { x: 900, y: 350 }, standAreas: inner(980, 220, 320, 256) },
  canteen: { center: { x: 300, y: 680 }, footprint: box(300, 680, 256, 224), entry: { x: 430, y: 700 }, standAreas: inner(300, 680, 256, 224) },
  market: { center: { x: 980, y: 690 }, footprint: box(980, 690, 288, 224), entry: { x: 834, y: 710 }, standAreas: inner(980, 690, 288, 224) },
  plaza: { center: { x: 640, y: 860 }, footprint: box(640, 860, 320, 288), entry: { x: 640, y: 860 }, standAreas: inner(640, 860, 320, 288) },
  hydroponics: { center: { x: 290, y: 1140 }, footprint: box(290, 1140, 384, 288), entry: { x: 484, y: 1160 }, standAreas: inner(290, 1140, 384, 288) },
  depot: { center: { x: 640, y: 1200 }, footprint: box(640, 1200, 224, 192), entry: { x: 640, y: 1102 }, standAreas: inner(640, 1200, 224, 192) },
  workshop: { center: { x: 990, y: 1150 }, footprint: box(990, 1150, 288, 256), entry: { x: 844, y: 1170 }, standAreas: inner(990, 1150, 288, 256) },
  habitat_a: { center: { x: 330, y: 1520 }, footprint: box(330, 1520, 352, 288), entry: { x: 508, y: 1500 }, standAreas: inner(330, 1520, 352, 288) },
  medbay: { center: { x: 660, y: 1480 }, footprint: box(660, 1480, 224, 192), entry: { x: 660, y: 1382 }, standAreas: inner(660, 1480, 224, 192) },
  habitat_b: { center: { x: 980, y: 1530 }, footprint: box(980, 1530, 352, 288), entry: { x: 802, y: 1510 }, standAreas: inner(980, 1530, 352, 288) },
  ice_wells: { center: { x: 360, y: 1800 }, footprint: box(360, 1800, 352, 176), entry: { x: 380, y: 1710 }, standAreas: inner(360, 1800, 352, 176) },
  quarry: { center: { x: 960, y: 1810 }, footprint: box(960, 1810, 352, 176), entry: { x: 940, y: 1720 }, standAreas: inner(960, 1810, 352, 176) },
};

/**
 * Optional intermediate points for a route, keyed by routeKey(a, b) from ./colony.ts and listed
 * in the direction from the alphabetically smaller id to the larger. A route with no entry is a
 * straight line between the two entries.
 */
export const ROUTE_WAYPOINTS: Record<string, Point[]> = {};
