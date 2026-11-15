/**
 * The art contract. The art subagent delivers `mobile/assets/game/manifest.ts` exporting
 * `MANIFEST: AssetManifest`; the renderer reads every size and position from it and hard-codes none.
 * All art is pixel art drawn at 1 world px = 1 art px and scaled with nearest-neighbour filtering.
 */
import type { LocationId, ResourceId, SpriteId } from './colony';
import type { PowerType } from './types';

/** `source` is the result of require('./file.png'). */
export type ImageAsset = { source: number; width: number; height: number };

export type BuildingArt = {
  /** World px of the top-left corner of `base` (and of `overlay` and `damaged`, which share its size). */
  x: number;
  y: number;
  /** Floor and walls, drawn under the colonists. Open-top so colonists inside stay visible. */
  base: ImageAsset;
  /** Dome glass, roof rims, masts: drawn over the colonists. */
  overlay?: ImageAsset;
  /** Drawn over `base` when the location is damaged (cracks, scorch marks, debris). */
  damaged?: ImageAsset;
};

export const CHARACTER_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type CharacterDirection = (typeof CHARACTER_DIRECTIONS)[number];

export type CharacterAtlas = {
  /**
   * One image holding every sprite. Each spriteId owns one row. Within a row the columns are
   * directionIndex * framesPerDirection + frame, with directions in CHARACTER_DIRECTIONS order.
   * Frame 0 of each direction is the standing pose; all frames together are the walk cycle.
   */
  atlas: ImageAsset;
  frameWidth: number;
  frameHeight: number;
  framesPerDirection: number;
  /** Row index of each sprite in the atlas. */
  rows: Record<SpriteId, number>;
  /** The point between the feet inside a frame; it sits on the agent's world position. */
  feet: { x: number; y: number };
};

export type AssetManifest = {
  map: {
    width: number;
    height: number;
    /** The whole pre-composed terrain (regolith, craters, tubes, tracks, shadows), drawn at 0,0. */
    ground: ImageAsset;
  };
  buildings: Record<LocationId, BuildingArt>;
  characters: CharacterAtlas;
  /** Head-and-shoulders portrait per sprite, square. */
  portraits: Record<SpriteId, ImageAsset>;
  icons: {
    powers: Record<PowerType, ImageAsset>;
    resources: Record<ResourceId, ImageAsset>;
  };
  fx: {
    /** Marker drawn where a colonist died. */
    grave: ImageAsset;
    /** Small pointer drawn above the selected or followed colonist. */
    selection: ImageAsset;
    /** Optional tiling overlays for active effects. */
    stormOverlay?: ImageAsset;
    droughtOverlay?: ImageAsset;
  };
};
