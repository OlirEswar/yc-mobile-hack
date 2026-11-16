/**
 * The per-frame step, run on the UI thread from a Reanimated frame callback:
 * smooths the clock, places every colonist, sorts them by y and moves the follow camera.
 * Nothing here touches React.
 */
import { makeMutable, type FrameInfo } from 'react-native-reanimated';
import { TICK_MS_AT_1X } from '../../shared/colony';
import { MANIFEST } from '../art';
import { scene, focusY, type Frame } from './scene';

const FPD = MANIFEST.characters.framesPerDirection;
const FRAME_H = MANIFEST.characters.frameHeight;
/** World px walked per walk-cycle frame, so feet do not slide. */
const STRIDE = Math.max(4, Math.round(MANIFEST.characters.frameWidth / 3));
/** Colonists are drawn at least this tall on screen (pt), so they stay readable zoomed out. */
const MIN_SPRITE_PT = 17;

const seenTick = makeMutable(-1);
const anchorTime = makeMutable(0);
const fpsWindowStart = makeMutable(0);
const fpsFrames = makeMutable(0);

export function spriteScale(zoom: number): number {
  'worklet';
  return Math.max(1, Math.min(3, MIN_SPRITE_PT / (FRAME_H * zoom)));
}

export function stepScene(info: FrameInfo): void {
  'worklet';
  const dt = Math.min(100, info.timeSincePreviousFrame ?? 16);
  const now = info.timestamp;
  scene.timeMs.value = info.timeSinceFirstFrame;

  // frames per second over half-second windows
  fpsFrames.value += 1;
  if (now - fpsWindowStart.value >= 500) {
    scene.fps.value = Math.round((fpsFrames.value * 1000) / (now - fpsWindowStart.value));
    fpsWindowStart.value = now;
    fpsFrames.value = 0;
  }

  // clock: run ahead of the last server tick by at most one tick, and ease towards that target
  if (scene.serverTick.value !== seenTick.value) {
    seenTick.value = scene.serverTick.value;
    anchorTime.value = now;
  }
  const target = seenTick.value + Math.min(1, ((now - anchorTime.value) * scene.speed.value) / TICK_MS_AT_1X);
  let tick = scene.displayTick.value;
  const gap = target - tick;
  tick = Math.abs(gap) > 2.5 ? target : tick + gap * Math.min(1, dt / 140);
  scene.displayTick.value = tick;

  const time = info.timeSinceFirstFrame;
  const list = scene.agents.value;
  const n = list.length;
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  const cols = new Array<number>(n);
  const rows = new Array<number>(n);
  const emotes = new Array<number>(n);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = list[i];
    let x = a.x;
    let y = a.y;
    let dir = a.face;
    let frame = 0;
    let emote = a.emote;
    if (a.walking && tick < a.arriveTick && a.total > 0) {
      const span = a.arriveTick - a.departTick;
      const p = span > 0 ? Math.max(0, Math.min(1, (tick - a.departTick) / span)) : 1;
      const dist = p * a.total;
      let s = 1;
      while (s < a.cum.length - 1 && a.cum[s] < dist) s++;
      const x0 = a.pts[(s - 1) * 2];
      const y0 = a.pts[(s - 1) * 2 + 1];
      const x1 = a.pts[s * 2];
      const y1 = a.pts[s * 2 + 1];
      const segLen = a.cum[s] - a.cum[s - 1];
      const q = segLen > 0 ? (dist - a.cum[s - 1]) / segLen : 1;
      x = x0 + (x1 - x0) * q;
      y = y0 + (y1 - y0) * q;
      const dx = x1 - x0;
      const dy = y1 - y0;
      dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
      frame = Math.floor(dist / STRIDE) % FPD;
      emote = -1;
    } else if (a.idle === 1) {
      const beat = Math.floor(time / 700 + a.phase * 40) % 12;
      if (beat === 5) dir = 1;
      else if (beat === 9) dir = 2;
      if (beat === 2) y -= 1;
    } else if (a.idle === 2) {
      const beat = Math.floor(time / 300 + a.phase * 40) % 4;
      if (beat === 1) y -= 1;
      if (FPD > 2) frame = beat === 1 ? 1 : beat === 3 ? FPD - 1 : 0;
    }
    xs[i] = Math.round(x);
    ys[i] = Math.round(y);
    cols[i] = dir * FPD + frame;
    rows[i] = a.alive ? a.row : -1;
    emotes[i] = a.alive ? emote : -1;
    if (a.alive) order.push(i);
  }
  order.sort((p, q) => ys[p] - ys[q] || p - q);
  const next: Frame = { count: order.length, xs, ys, cols, rows, emotes, order };
  scene.frame.value = next;

  // follow camera: keep the colonist at the focus point
  const slot = scene.followSlot.value;
  if (slot >= 0 && slot < n) {
    const zoom = scene.zoom.value;
    const k = Math.min(1, dt / 160);
    const wantX = scene.viewW.value / 2 - xs[slot] * zoom;
    const wantY = focusY() - (ys[slot] - FRAME_H / 2) * zoom;
    scene.tx.value += (wantX - scene.tx.value) * k;
    scene.ty.value += (wantY - scene.ty.value) * k;
  }
}
