/**
 * The renderer's UI-thread state: camera, clock and the per-colonist animation records.
 * These are module-level shared values so the store (JS thread) can drive the scene without
 * re-rendering React, and the Skia canvas reads them on the UI thread every frame.
 */
import { Easing, cancelAnimation, makeMutable, withTiming } from 'react-native-reanimated';
import { MANIFEST } from '../art';

export const MAP_W = MANIFEST.map.width;
export const MAP_H = MANIFEST.map.height;
export const MAX_ZOOM = 4;
/** Zoom at which a colonist is about 76pt tall: close enough to read faces and bubbles. */
export const FOLLOW_ZOOM = Math.max(1.25, Math.min(3, Math.round((76 / MANIFEST.characters.frameHeight) * 2) / 2));
/** Emotes and speech bubbles appear from this zoom up. */
export const DETAIL_ZOOM = 0.8;

/** One colonist as the UI thread sees it. Built on the JS thread by toAnimAgent in store.ts. */
export type AnimAgent = {
  /** Row in the character atlas. */
  row: number;
  alive: boolean;
  /** Resting position (world px) once any walk is over. */
  x: number;
  y: number;
  /** Resting direction: index into CHARACTER_DIRECTIONS. */
  face: number;
  /** 0 still, 1 idle sway, 2 busy (work, eat, trade), 3 asleep. */
  idle: number;
  /** Column in the emote sheet, or -1. */
  emote: number;
  /** 0..1, de-synchronises idle animations. */
  phase: number;
  walking: boolean;
  departTick: number;
  arriveTick: number;
  pts: number[];
  cum: number[];
  total: number;
};

export type Frame = {
  count: number;
  /** Per slot. */
  xs: number[];
  ys: number[];
  cols: number[];
  rows: number[];
  emotes: number[];
  /** Slots of living colonists sorted by y, back to front. */
  order: number[];
};

export const scene = {
  viewW: makeMutable(390),
  viewH: makeMutable(800),
  /** Screen areas covered by HUD, so the camera keeps the map clear of them. */
  insetTop: makeMutable(0),
  insetBottom: makeMutable(0),
  tx: makeMutable(0),
  ty: makeMutable(0),
  zoom: makeMutable(0.3),
  /** True until the first layout has placed the camera. */
  unplaced: makeMutable(true),
  serverTick: makeMutable(0),
  speed: makeMutable(1),
  /** Smoothly extrapolated tick used for all animation. */
  displayTick: makeMutable(0),
  timeMs: makeMutable(0),
  agents: makeMutable<AnimAgent[]>([]),
  frame: makeMutable<Frame>({ count: 0, xs: [], ys: [], cols: [], rows: [], emotes: [], order: [] }),
  followSlot: makeMutable(-1),
  selectedSlot: makeMutable(-1),
  /** 0..1 strength of the active effects, eased on the UI thread. */
  drought: makeMutable(0),
  storm: makeMutable(0),
  /** UI-thread frames per second, smoothed. */
  fps: makeMutable(0),
};

export function fitZoom(viewW: number, viewH: number): number {
  'worklet';
  return Math.min(viewW / MAP_W, viewH / MAP_H);
}

/** Keeps the map on screen: centred when smaller than the view, edge-clamped when larger. */
export function clampAxis(t: number, content: number, lo: number, hi: number): number {
  'worklet';
  if (content <= hi - lo) return lo + (hi - lo - content) / 2;
  return Math.max(hi - content, Math.min(lo, t));
}

export function clampCamera(): void {
  'worklet';
  const zoom = scene.zoom.value;
  scene.tx.value = clampAxis(scene.tx.value, MAP_W * zoom, 0, scene.viewW.value);
  scene.ty.value = clampAxis(scene.ty.value, MAP_H * zoom, scene.insetTop.value, scene.viewH.value - scene.insetBottom.value);
}

/** Screen y where a focused thing should sit: the middle of the area the HUD leaves free. */
export function focusY(): number {
  'worklet';
  return scene.insetTop.value + (scene.viewH.value - scene.insetBottom.value - scene.insetTop.value) / 2;
}

const FLY = { duration: 520, easing: Easing.out(Easing.cubic) };

export type CameraPose = { tx: number; ty: number; zoom: number };

export function cameraPose(): CameraPose {
  return { tx: scene.tx.value, ty: scene.ty.value, zoom: scene.zoom.value };
}

/** Animates the camera so the world point sits at the focus point, at the given zoom. */
export function flyTo(x: number, y: number, zoom?: number): void {
  const z = zoom ?? Math.max(scene.zoom.value, 1);
  const viewW = scene.viewW.value;
  const viewH = scene.viewH.value;
  const top = scene.insetTop.value;
  const bottom = viewH - scene.insetBottom.value;
  const tx = clampAxis(viewW / 2 - x * z, MAP_W * z, 0, viewW);
  const ty = clampAxis(top + (bottom - top) / 2 - y * z, MAP_H * z, top, bottom);
  scene.zoom.value = withTiming(z, FLY);
  scene.tx.value = withTiming(tx, FLY);
  scene.ty.value = withTiming(ty, FLY);
}

export function flyToPose(pose: CameraPose): void {
  scene.zoom.value = withTiming(pose.zoom, FLY);
  scene.tx.value = withTiming(pose.tx, FLY);
  scene.ty.value = withTiming(pose.ty, FLY);
}

export function flyToFit(): void {
  const z = fitZoom(scene.viewW.value, scene.viewH.value);
  flyTo(MAP_W / 2, MAP_H / 2, z);
}

export function setFollowSlot(slot: number): void {
  cancelAnimation(scene.tx);
  cancelAnimation(scene.ty);
  scene.followSlot.value = slot;
  if (slot >= 0) scene.zoom.value = withTiming(FOLLOW_ZOOM, FLY);
}
