/**
 * The building kit: the open-top shell every walled building shares (wall tops, the inside face of
 * the north wall, floor, the outside face of the south wall, doors where routes arrive) and 3/4
 * furniture primitives. Light comes from the upper left, as on the ground.
 */
import { Img } from '../lib/image.mjs';
import { INK, RAMPS, fade, tone } from '../lib/palette.mjs';
import { hash2 } from '../lib/noise.mjs';
import { BUILDING_KIND, HEADROOM, LOCATION_LAYOUT, SOUTH_FACE, WALL_FACE, WALL_TOP, doorsOf, insideOutline } from '../lib/layout.mjs';

export const DOOR = 30;

/** The three layers of one building plus the masks the building's own painter needs. */
export class Building {
  constructor(id) {
    const { w, h } = LOCATION_LAYOUT[id].footprint;
    this.id = id;
    this.w = w;
    this.h = h;
    this.base = new Img(w, h);
    this.overlay = new Img(w, h);
    this.damaged = new Img(w, h);
    this.doors = doorsOf(id).map((d) => ({ ...d, x: Math.round(d.x), y: Math.round(d.y) }));
    this.kind = BUILDING_KIND[id];
    // per-pixel classification: 0 outside, 1 wall top, 2 north face, 3 floor
    this.cls = new Uint8Array(w * h);
    if (this.kind !== 'site') this.classify();
  }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.cls[y * this.w + x];
  }

  isFloor(x, y) {
    return this.at(x, y) === 3;
  }

  classify() {
    const { w, h, id } = this;
    const inside = (x, y) => insideOutline(id, x, y);
    // distance to the outside, in a chamfer approximation, capped at WALL_TOP + 1
    const dist = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        let d = WALL_TOP + 1;
        for (let j = -WALL_TOP; j <= WALL_TOP && d > 1; j++)
          for (let i = -WALL_TOP; i <= WALL_TOP; i++) {
            const dd = Math.max(Math.abs(i), Math.abs(j));
            if (dd < d && Math.hypot(i, j) < WALL_TOP + 0.5 && !inside(x + i, y + j)) d = Math.max(1, Math.round(Math.hypot(i, j)));
          }
        dist[y * w + x] = d;
      }
    for (let x = 0; x < w; x++) {
      let state = 0;
      let faceLeft = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        const d = dist[i];
        if (!d) continue;
        if (d <= WALL_TOP) {
          this.cls[i] = 1;
          if (state === 0) state = 1;
          continue;
        }
        if (state === 1) {
          state = 2;
          faceLeft = WALL_FACE;
        }
        this.cls[i] = faceLeft > 0 ? 2 : 3;
        faceLeft--;
      }
    }
    this.dist = dist;
    // the top row of the face in each column, and the outline's bottom row in each column
    this.faceTop = new Int16Array(w).fill(-1);
    this.bottom = new Int16Array(w).fill(-1);
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const c = this.cls[y * w + x];
        if (c === 2 && this.faceTop[x] < 0) this.faceTop[x] = y;
        if (c) this.bottom[x] = y;
      }
  }

  /**
   * Paints the shell. style: { top: [ramp, i], face: (x, y, depth) => colour, floor: (x, y) => colour,
   * hull: [ramp, i] } where depth runs 0..WALL_FACE-1 down the north face.
   */
  shell(style) {
    const { w, h, base } = this;
    const [topRamp, topI] = style.top ?? ['metal', 6];
    const [hullRamp, hullI] = style.hull ?? ['metal', 3];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = this.cls[y * w + x];
        if (c === 3) base.put(x, y, style.floor(x, y));
        else if (c === 2) base.put(x, y, style.face(x, y, y - this.faceTop[x]));
      }
    // ambient occlusion where the floor meets the walls
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (this.cls[y * w + x] !== 3) continue;
        const nearFace = this.at(x, y - 1) === 2 || this.at(x, y - 2) === 2;
        const nearWall = this.at(x - 1, y) === 1 || this.at(x + 1, y) === 1 || this.at(x, y + 1) === 1;
        if (nearFace || nearWall) base.set(x, y, fade(INK, nearFace && this.at(x, y - 1) === 2 ? 110 : 70));
      }
    // wall tops: light on the outer edge and on the sunny (upper-left) side, a dark inner lip
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (this.cls[y * w + x] !== 1) continue;
        const d = this.dist[y * w + x];
        const outerUp = !insideOutline(this.id, x, y - 1) || !insideOutline(this.id, x - 1, y);
        let c = tone(topRamp, topI);
        if (d === 1) c = outerUp ? tone(topRamp, topI + 2) : tone(topRamp, topI - 2);
        else if (d === 2) c = tone(topRamp, topI + 1);
        else if (d >= WALL_TOP) c = tone(topRamp, topI - 3);
        else if ((x + y * 3) % 23 === 0) c = tone(topRamp, topI - 1);
        base.put(x, y, c);
      }
    // outside face of the south wall, below the outline
    for (let x = 0; x < w; x++) {
      const b = this.bottom[x];
      if (b < 0) continue;
      for (let k = 1; k <= SOUTH_FACE && b + k < h; k++) {
        let c = tone(hullRamp, hullI + (k === 1 ? 1 : 0) - (k >= SOUTH_FACE - 1 ? 1 : 0));
        if (x % 24 === 0 && k > 1) c = tone(hullRamp, hullI - 1);
        if (x % 48 === 12 && k === 4) c = tone('teal', 4);
        base.put(x, b + k, c);
      }
      base.put(x, Math.min(h - 1, b + SOUTH_FACE), tone(hullRamp, Math.max(0, hullI - 2)));
    }
    // outer outline so the building reads against the regolith
    base.outline(() => tone('metal', 0));
  }

  /** Cuts the doors into the shell: an opening in the wall top with frame posts and a threshold. */
  paintDoors(style = {}) {
    const { base } = this;
    const floorAt = style.doorFloor ?? (() => tone('metal', 3));
    for (const d of this.doors) {
      const half = DOOR / 2;
      if (d.side === 'w' || d.side === 'e') {
        const y0 = d.y - half;
        const y1 = d.y + half;
        const xs = d.side === 'w' ? [0, 26] : [this.w - 26, this.w];
        for (let x = xs[0]; x < xs[1]; x++) {
          const k = this.at(x, d.y);
          for (let y = y0 + 3; y < y1 - 3; y++) {
            if (k === 1 || (k === 0 && this.at(x + (d.side === 'w' ? 6 : -6), d.y) === 1)) base.put(x, y, floorAt(x, y));
          }
        }
        // frame posts with a hazard threshold
        const wallX = [];
        for (let x = 0; x < this.w; x++) if (this.at(x, y0) === 1) wallX.push(x);
        const near = wallX.filter((x) => (d.side === 'w' ? x < this.w / 2 : x > this.w / 2));
        if (!near.length) continue;
        const x0 = Math.min(...near);
        const x1 = Math.max(...near);
        for (const py of [y0, y1 - 4]) {
          base.rect(x0 - 1, py, x1 - x0 + 3, 4, tone('metal', 7));
          base.hline(x0 - 1, x1 + 1, py + 3, tone('metal', 2));
          base.hline(x0 - 1, x1 + 1, py, tone('metal', 8));
        }
        for (let y = y0 + 4; y < y1 - 4; y++) base.put(d.side === 'w' ? x1 + 1 : x0 - 1, y, (Math.floor(y / 3) % 2 ? tone('yellow', 3) : INK));
        base.rect(d.side === 'w' ? x0 + 1 : x0 + 1, d.y - 1, 2, 2, tone('teal', 4));
      } else if (d.side === 'n') {
        const x0 = d.x - half;
        const top = this.faceTop[d.x];
        for (let x = x0 + 3; x < x0 + DOOR - 3; x++) {
          for (let y = top - WALL_TOP; y < top + WALL_FACE; y++) {
            if (this.at(x, y) === 2) base.put(x, y, y < top + 4 ? tone('metal', 1) : floorAt(x, y));
            else if (this.at(x, y) === 1 && y >= top - WALL_TOP + 2) base.put(x, y, tone('metal', 2));
          }
        }
        for (const px of [x0, x0 + DOOR - 4]) {
          base.rect(px, top - WALL_TOP, 4, WALL_FACE + WALL_TOP, tone('metal', 6));
          base.vline(px, top - WALL_TOP, top + WALL_FACE - 1, tone('metal', 7));
          base.vline(px + 3, top - WALL_TOP, top + WALL_FACE - 1, tone('metal', 3));
        }
        base.rect(x0, top - 1, DOOR, 3, tone('metal', 6));
        base.hline(x0, x0 + DOOR - 1, top - 1, tone('metal', 8));
        for (let x = x0 + 4; x < x0 + DOOR - 4; x++) base.put(x, top + WALL_FACE, Math.floor(x / 3) % 2 ? tone('yellow', 3) : INK);
        base.rect(d.x - 1, top + 3, 2, 2, tone('teal', 4));
      } else {
        const x0 = d.x - half;
        for (let x = x0 + 3; x < x0 + DOOR - 3; x++) {
          const b = this.bottom[x];
          for (let y = b - WALL_TOP - 1; y < this.h; y++) {
            if (this.at(x, y) === 1 || (this.at(x, y) === 0 && y > b - 2)) base.put(x, y, floorAt(x, y));
          }
        }
        const b = this.bottom[d.x];
        for (const px of [x0, x0 + DOOR - 4]) {
          base.rect(px, b - WALL_TOP - 4, 4, WALL_TOP + 4 + SOUTH_FACE, tone('metal', 6));
          base.vline(px, b - WALL_TOP - 4, b + SOUTH_FACE - 1, tone('metal', 7));
          base.vline(px + 3, b - WALL_TOP - 4, b + SOUTH_FACE - 1, tone('metal', 3));
        }
        for (let x = x0 + 4; x < x0 + DOOR - 4; x++) base.put(x, b - WALL_TOP - 1, Math.floor(x / 3) % 2 ? tone('yellow', 3) : INK);
      }
    }
  }
}

/** Fills rect with a per-pixel colour function. */
export function fill(img, x, y, w, h, fn) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) img.set(x + i, y + j, fn(x + i, y + j, i, j));
}

/**
 * A 3/4 box: a top face `depth` rows deep and a front face `height` rows tall below it, outlined.
 * k is the ramp index of the top face; the front steps down the ramp.
 */
export function box(img, x, y, w, depth, height, ramp, k, { outline = true, shadow = true, topFn = null, frontFn = null } = {}) {
  if (shadow) img.rect(x + 2, y + depth + height, w, 2, fade(INK, 90));
  for (let j = 0; j < depth; j++)
    for (let i = 0; i < w; i++) {
      let c = tone(ramp, k);
      if (j === 0 || i === 0) c = tone(ramp, k + 1);
      if (i === w - 1) c = tone(ramp, k - 1);
      img.put(x + i, y + j, topFn ? (topFn(i, j, c) ?? c) : c);
    }
  for (let j = 0; j < height; j++)
    for (let i = 0; i < w; i++) {
      let c = tone(ramp, k - 2);
      if (j === 0) c = tone(ramp, k - 1);
      if (j === height - 1) c = tone(ramp, k - 3);
      if (i === 0) c = tone(ramp, k - 1);
      img.put(x + i, y + depth + j, frontFn ? (frontFn(i, j, c) ?? c) : c);
    }
  if (outline) {
    const o = tone(ramp, 0);
    img.hline(x - 1, x + w, y - 1, o);
    img.hline(x - 1, x + w, y + depth + height, o);
    img.vline(x - 1, y, y + depth + height - 1, o);
    img.vline(x + w, y, y + depth + height - 1, o);
  }
}

/** A 3/4 cylinder standing on the floor: elliptical top, shaded body. */
export function cylinder(img, cx, y, rx, ry, height, ramp, k, { shadow = true, topFn = null } = {}) {
  if (shadow) img.ellipse(cx + 2, y + height + ry - 1, rx, Math.max(1, ry - 1), fade(INK, 80));
  for (let j = 0; j < height; j++)
    for (let i = -rx; i <= rx; i++) {
      const t = (i + rx) / (2 * rx);
      const c = t < 0.25 ? tone(ramp, k) : t < 0.6 ? tone(ramp, k - 1) : t < 0.85 ? tone(ramp, k - 2) : tone(ramp, k - 3);
      img.put(cx + i, y + j, c);
    }
  img.ellipse(cx, y + height, rx, ry, (i) => {
    const t = (i + rx) / (2 * rx);
    return t < 0.25 ? tone(ramp, k - 1) : t < 0.6 ? tone(ramp, k - 2) : tone(ramp, k - 3);
  });
  img.ellipse(cx, y, rx, ry, (i, j) => (j < -ry / 2 || i < -rx / 2 ? tone(ramp, k + 2) : tone(ramp, k + 1)));
  if (topFn) topFn();
}

/** A soft round light pool or glow, blended. */
export function glow(img, cx, cy, rx, ry, colour, alpha) {
  img.ellipse(cx, cy, rx, ry, (i, j, d) => fade(colour, Math.round(alpha * (1 - d) ** 1.5)));
}

/** A window in a wall face onto the black sky, with stars and a glass glint. */
export function spaceWindow(img, x, y, w, h, seed, { earth = false } = {}) {
  const m = RAMPS.metal;
  img.rect(x - 1, y - 1, w + 2, h + 2, m[7]);
  img.rect(x, y, w, h, tone('cold', 0));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const r = hash2(x + i, y + j, seed);
      if (r < 0.025) img.put(x + i, y + j, r < 0.008 ? RAMPS.ice[4] : tone('cold', 6));
    }
  if (earth) {
    const ex = x + Math.round(w * 0.62);
    const ey = y + Math.round(h * 0.45);
    img.ellipse(ex, ey, 4, 4, (i, j) => (i + j > 2 ? tone('blue', 2) : hash2(i, j, 3) < 0.35 ? tone('green', 4) : i + j < -3 ? RAMPS.ice[4] : tone('blue', 4)));
  }
  for (let k = 0; k < Math.min(w, h); k++) if (k + 2 < w) img.set(x + k + 2, y + h - 1 - k, fade(RAMPS.ice[4], 40));
  img.hline(x - 1, x + w, y + h, m[3]);
  img.vline(x + w, y - 1, y + h, m[5]);
}

/** A wall screen: dark glass with glowing teal rows. */
export function screen(img, x, y, w, h, ramp = 'teal', seed = 1) {
  img.rect(x - 1, y - 1, w + 2, h + 2, tone('metal', 1));
  img.rect(x, y, w, h, tone(ramp, 0));
  for (let j = 1; j < h - 1; j += 2) {
    const len = Math.round((0.3 + hash2(j, seed, 9) * 0.6) * (w - 2));
    img.hline(x + 1, x + len, y + j, tone(ramp, j === 1 ? 4 : 3));
  }
  img.put(x + w - 2, y + 1, tone(ramp, 5));
}

/** A light panel set into a wall face, with a soft spill below. */
export function wallLamp(img, x, y, w, ramp = 'yellow') {
  img.rect(x, y, w, 2, tone(ramp, 4));
  img.hline(x, x + w - 1, y + 2, tone(ramp, 2));
  for (let k = 1; k < 5; k++) img.hline(x - k, x + w - 1 + k, y + 2 + k, fade(tone(ramp, 4), 40 - k * 8));
}

/** A potted plant in 3/4, for warmth in civic rooms. */
export function plant(img, x, y, size = 1) {
  box(img, x - 4, y - 4, 9, 3, 5, 'brown', 3, { outline: true });
  const g = RAMPS.green;
  const r = 5 + size * 2;
  for (let k = 0; k < 18 + size * 6; k++) {
    const a = (k * 2.4) % (Math.PI * 2);
    const d = (k % 5) / 5 * r;
    const px = Math.round(x + Math.cos(a) * d);
    const py = Math.round(y - 7 - Math.abs(Math.sin(a)) * d * 0.8);
    img.rect(px - 1, py - 1, 3, 2, g[2]);
    img.put(px, py - 1, g[k % 3 === 0 ? 5 : 4]);
  }
}

/** A round-canopied tree: trunk, clustered leaves lit from the upper left. */
export function tree(img, x, y, r) {
  img.ellipse(x + 3, y + 1, r - 2, 3, fade(INK, 90));
  img.rect(x - 1, y - r, 3, r, tone('brown', 2));
  img.vline(x - 1, y - r, y - 1, tone('brown', 4));
  const blobs = [[0, -r - 4, r * 0.8], [-r * 0.55, -r - 1, r * 0.55], [r * 0.55, -r, r * 0.55], [-r * 0.2, -r - 9, r * 0.55], [r * 0.3, -r - 7, r * 0.5]];
  for (const shadeK of [1, 0]) {
    for (const [bx, by, br] of blobs)
      img.ellipse(Math.round(x + bx + shadeK), Math.round(y + by + shadeK), br, br * 0.85, (i, j, d) => {
        if (shadeK) return tone('green', 1);
        if (i + j < -br * 0.6) return tone('green', 5);
        if (i + j < 0) return tone('green', 4);
        return d > 0.7 ? tone('green', 2) : tone('green', 3);
      });
  }
  for (let k = 0; k < r * 2; k++) {
    const px = x + Math.round(Math.sin(k * 2.1) * r * 0.8);
    const py = y - r - 4 + Math.round(Math.cos(k * 1.7) * r * 0.6);
    if (hash2(px, py, 4) < 0.5) img.put(px, py, tone('green', 5));
  }
}

/** A seated stool or chair seen from above. */
export function stool(img, x, y, ramp = 'metal', k = 5) {
  img.rect(x - 2, y - 2, 5, 4, tone(ramp, k));
  img.hline(x - 2, x + 2, y - 2, tone(ramp, k + 1));
  img.hline(x - 2, x + 2, y + 2, tone(ramp, k - 3));
  img.put(x, y + 3, tone(ramp, k - 3));
}

export const smooth = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export { HEADROOM, WALL_TOP, WALL_FACE, SOUTH_FACE, INK, RAMPS, tone, fade, hash2 };
