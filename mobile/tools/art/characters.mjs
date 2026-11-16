/**
 * The colonists: 10 archetypes x 16 variants, each in 4 directions x 4 walk frames of 48x96 art px
 * (24x48 world px at ART_SCALE 2), plus a 128x128 portrait. Every sprite is assembled from a seeded
 * spec (build, skin, age, hairstyle and colour, facial hair, outfit silhouette with its own colours,
 * one or two accessories), so no two look alike. Figures are about 6.3 heads tall and shaded per
 * material on five-tone ramps with hue-shifted shadows and highlights, folds, a cool rim light on the
 * right and a selective (colour-matched) outline. Side views are drawn facing left and mirrored.
 */
import { Img, rgba } from './lib/image.mjs';
import { INK, fade } from './lib/palette.mjs';
import { rng } from './lib/noise.mjs';
import { SPRITE_ARCHETYPES, SPRITE_VARIANTS } from './lib/layout.mjs';

export const FRAME_W = 32;
export const FRAME_H = 40;
export const FRAMES = 4;
/** The point between the feet in atlas pixels, which sits on the colonist's world position. */
export const FEET = { x: 16, y: 37 };
export const PORTRAIT = 128;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), 255];

// ---------- colour ramps with hue-shifted shadows and highlights ----------

function hexHsl(hex) {
  const [r, g, b] = rgba(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 230;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [h, s, l];
}

function hslRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 255];
}

const towards = (h, t, amt) => {
  const d = ((t - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amt);
};

/** Five tones, dark to light: shadows drift towards blue-violet, highlights towards warm yellow. */
function ramp(hex) {
  const [h, s, l] = hexHsl(hex);
  return [
    hslRgb(towards(h, 250, 30), clamp(s * 0.8 + 0.08, 0, 1), l * 0.4),
    hslRgb(towards(h, 250, 15), clamp(s * 0.95 + 0.04, 0, 1), l * 0.68),
    hslRgb(h, s, l),
    hslRgb(towards(h, 50, 10), clamp(s * 0.95, 0, 1), l + (1 - l) * 0.28),
    hslRgb(towards(h, 50, 18), clamp(s * 0.8, 0, 1), l + (1 - l) * 0.55),
  ];
}

const RIM = rgba('#bfe2ff');
const EYE = rgba('#16121c');
const WHITE = rgba('#f4f1ea');

// ---------- shaded primitives ----------

const idxOf = (I) => (I < 0.1 ? 0 : I < 0.45 ? 1 : I < 0.97 ? 2 : 3);
const lightAt = (u, v) => 0.6 - 0.42 * u - 0.1 * v + 0.28 * (Math.sqrt(Math.max(0, 1 - u * u)) - 0.75);

/** Fills rows y0..y1 between edges(y) = [left, right], shaded as a cylinder lit from the upper left. */
function band(img, y0, y1, edges, mat, o = {}) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const e = edges(y + 0.5, (y + 0.5 - y0) / Math.max(1, y1 - y0));
    if (!e) continue;
    const [l, r] = e;
    const mid = (l + r) / 2;
    const half = Math.max(0.5, (r - l) / 2);
    for (let x = Math.floor(l); x < Math.ceil(r); x++) {
      if (x + 0.5 < l || x + 0.5 > r) continue;
      const u = (x + 0.5 - mid) / half;
      const v = (y + 0.5 - y0) / Math.max(1, y1 - y0);
      if (o.skip && o.skip(x, y, u, v)) continue;
      const k = idxOf(lightAt(u, v) + (o.bias ?? 0)) + (o.fold ? o.fold(x, y, u, v) : 0);
      img.put(x, y, mat[clamp(k, 0, 4)]);
    }
  }
}

/** A tapered capsule from (x0, y0) to (x1, y1), shaded across its width. */
function limb(img, x0, y0, x1, y1, r0, r1, mat, o = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const len = Math.sqrt(len2);
  const R = Math.max(r0, r1) + 1;
  for (let y = Math.floor(Math.min(y0, y1) - R); y <= Math.ceil(Math.max(y0, y1) + R); y++)
    for (let x = Math.floor(Math.min(x0, x1) - R); x <= Math.ceil(Math.max(x0, x1) + R); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
      const ox = px - (x0 + dx * t);
      const oy = py - (y0 + dy * t);
      const r = r0 + (r1 - r0) * t;
      if (ox * ox + oy * oy > r * r) continue;
      const u = clamp(((ox * dy - oy * dx) / len) / r, -1, 1);
      const k = idxOf(lightAt(u, t) + (o.bias ?? 0)) + (o.fold ? o.fold(x, y, u, t) : 0);
      img.put(x, y, mat[clamp(k, 0, 4)]);
    }
}

/** A shaded ellipse; skip(dx, dy) can cut it. */
function blob(img, cx, cy, rx, ry, mat, o = {}) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1 || (o.skip && o.skip(dx, dy))) continue;
      const I = 0.62 - 0.4 * dx - 0.3 * dy + 0.2 * (Math.sqrt(1 - d) - 0.6) + (o.bias ?? 0);
      img.put(x, y, mat[clamp(idxOf(I) + (o.shift ?? 0), 0, 4)]);
    }
}

function rect(img, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) img.put(Math.round(x) + i, Math.round(y) + j, c);
}

// ---------- the spec: everything that varies per colonist ----------

const SKINS = ['#ead4aa', '#e8b796', '#e4a672', '#d9a07a', '#c28569', '#b86f50', '#8f5640', '#733e39'];
const HAIR_NATURAL = ['#181425', '#3e2731', '#733e39', '#b86f50', '#be4a2f', '#d77643', '#feae34', '#262b44'];
const HAIR_DYED = ['#2ce8f5', '#b55088', '#68386c', '#0099db', '#ead4aa', '#e43b44', '#63c74d'];
const HAIR_AGED = ['#8b9bb4', '#c0cbdc', '#ffffff'];
const CLOTH = ['#be4a2f', '#d77643', '#e4a672', '#b86f50', '#733e39', '#a22633', '#e43b44', '#f77622', '#feae34', '#63c74d', '#3e8948', '#265c42', '#124e89', '#0099db', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466', '#68386c', '#b55088', '#f6757a', '#ead4aa', '#262b44', '#193c3e'];
const STYLES = ['buzz', 'short', 'sidepart', 'pixie', 'undercut', 'mohawk', 'bob', 'long', 'longwavy', 'ponytail', 'braids', 'afro', 'curly', 'bun', 'topknot', 'dreads', 'bald'];
const BUILDS = [
  { H: 31, sw: 5, hw: 4, limb: 0.66 },
  { H: 33, sw: 5.4, hw: 4.2, limb: 0.68 },
  { H: 34, sw: 4.8, hw: 3.8, limb: 0.62 },
  { H: 34, sw: 5.6, hw: 4.4, limb: 0.7 },
  { H: 35, sw: 6.4, hw: 5, limb: 0.78 },
  { H: 36, sw: 5.2, hw: 4, limb: 0.66 },
  { H: 37, sw: 6, hw: 4.6, limb: 0.74 },
  { H: 32, sw: 6.3, hw: 5.1, limb: 0.78 },
];

const OUTFITS = {
  farmer: ['overalls', 'coverall', 'apron', 'poncho', 'jacket', 'tee', 'overalls'],
  miner: ['suit', 'suit', 'coverall', 'jacket', 'poncho', 'hoodie'],
  engineer: ['coverall', 'overalls', 'jacket', 'suit', 'apron', 'coverall'],
  medic: ['scrubs', 'labcoat', 'scrubs', 'longcoat', 'jacket'],
  scientist: ['labcoat', 'labcoat', 'longcoat', 'robe', 'hoodie', 'cloak'],
  merchant: ['longcoat', 'cloak', 'poncho', 'robe', 'jacket', 'apron'],
  guard: ['armor', 'armor', 'longcoat', 'suit', 'jacket', 'armor'],
  official: ['longcoat', 'robe', 'jacket', 'cloak', 'longcoat'],
  worker: ['apron', 'overalls', 'coverall', 'hoodie', 'tee', 'jacket', 'poncho'],
  civilian: ['tee', 'hoodie', 'jacket', 'cloak', 'robe', 'poncho', 'longcoat', 'tee', 'hoodie'],
};
const ACCESSORIES = {
  farmer: ['bandana', 'satchel', 'scarf', 'hat', 'backpack', 'goggles'],
  miner: ['tank', 'respirator', 'hardhat', 'goggles', 'toolbelt', 'prosthetic', 'backpack'],
  engineer: ['toolbelt', 'goggles', 'hardhat', 'prosthetic', 'headset', 'backpack', 'polearm'],
  medic: ['headset', 'satchel', 'goggles', 'scarf', 'respirator'],
  scientist: ['goggles', 'headset', 'satchel', 'backpack', 'visor', 'scarf'],
  merchant: ['satchel', 'scarf', 'backpack', 'bandana', 'goggles', 'prosthetic'],
  guard: ['visor', 'headset', 'polearm', 'respirator', 'prosthetic', 'toolbelt'],
  official: ['scarf', 'headset', 'satchel', 'visor'],
  worker: ['toolbelt', 'bandana', 'beanie', 'backpack', 'respirator', 'prosthetic', 'satchel'],
  civilian: ['scarf', 'backpack', 'beanie', 'bandana', 'satchel', 'goggles', 'polearm', 'headset'],
};
const SUIT_COLOURS = ['#c0cbdc', '#f77622', '#8b9bb4', '#feae34', '#ead4aa'];
const ARMOR_COLOURS = ['#3a4466', '#262b44', '#5a6988', '#733e39', '#124e89'];

const used = new Set();

function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function specFor(archetype, v) {
  for (let attempt = 0; ; attempt++) {
    const r = rng(hash(archetype + ':' + v + ':' + attempt));
    const pick = (a) => a[Math.floor(r() * a.length)];
    const age = r() < 0.18 ? 'elder' : r() < 0.2 ? 'young' : 'adult';
    const build = BUILDS[Math.floor(r() * BUILDS.length)];
    const skin = SKINS[Math.floor(r() * SKINS.length)];
    const style = pick(STYLES);
    const hairHex = age === 'elder' ? pick(HAIR_AGED) : r() < 0.16 ? pick(HAIR_DYED) : pick(HAIR_NATURAL);
    const facial = r() < 0.38 ? pick(['stubble', 'mustache', 'beard', 'goatee', 'beard']) : null;
    const outfit = r() < 0.75 ? pick(OUTFITS[archetype]) : pick(Object.values(OUTFITS).flat());
    const top = outfit === 'suit' ? pick(SUIT_COLOURS) : outfit === 'labcoat' ? '#ffffff' : pick(CLOTH);
    let bottom = pick(CLOTH);
    if (bottom === top) bottom = '#3a3a42';
    const accent = pick(CLOTH.filter((c) => c !== top));
    const boots = pick(['#3a2a22', '#2a2a30', '#5a3f2c', '#6c6f76', '#40342c']);
    const pool = ACCESSORIES[archetype];
    const acc = [pick(pool)];
    if (r() < 0.55) {
      const second = pick(pool);
      if (!acc.includes(second)) acc.push(second);
    }
    const hood = (outfit === 'cloak' || outfit === 'robe' || outfit === 'hoodie') && r() < 0.5 && !acc.includes('hardhat');
    const helmet = outfit === 'suit' && r() < 0.5;
    const sig = [style, hairHex, skin, outfit, top, build.H, build.sw].join('|');
    if (used.has(sig) && attempt < 20) continue;
    used.add(sig);
    return {
      archetype, age, ...build, style, facial, outfit, acc, hood, helmet,
      harness: (outfit === 'coverall' || outfit === 'suit') && r() < 0.5,
      emblem: archetype === 'medic' ? 'cross' : archetype === 'guard' ? 'badge' : r() < 0.3 ? 'patch' : null,
      sleeves: outfit === 'tee' || outfit === 'overalls' || (outfit === 'apron' && r() < 0.5) ? 'short' : 'long',
      patches: Array.from({ length: 2 }, () => [Math.floor(r() * 9) - 4, Math.floor(r() * 12)]),
      m: {
        skin: ramp(skin),
        hair: ramp(hairHex),
        top: ramp(top),
        bottom: ramp(outfit === 'coverall' || outfit === 'scrubs' || outfit === 'suit' ? top : bottom),
        accent: ramp(accent),
        boots: ramp(boots),
        metal: ramp('#8c96a8'),
        dark: ramp('#3b4252'),
        leather: ramp(pick(['#6b4a30', '#4e3a2a', '#7c5a3a'])),
        armor: ramp(pick(ARMOR_COLOURS)),
        glass: ramp(pick(['#3fb6b0', '#d0603c', '#6f9be0', '#9ad04a'])),
        gold: ramp('#d4a640'),
        apron: ramp(pick(['#d6d0c2', '#6b4a30', '#4f6f78', '#7b3b33'])),
      },
    };
  }
}

// ---------- hair ----------

/** Hair coverage at a head-relative point (dx, dy in head radii, dx < 0 is the face side in side view): 0 none, 1 hair, 2 shaved. */
function hairAt(style, view, dx, dy) {
  const r = Math.hypot(dx, dy);
  const inHead = r <= 1;
  const front = view === 'front';
  const side = view === 'side';
  const cover = (nape) => (front ? dy < -0.38 + 0.4 * dx * dx : side ? dy < -0.4 || (dx > 0.05 && dy < nape) : dy < nape);
  const top = (vol, nape) => (inHead && cover(nape)) || (r <= vol && r > 1 && dy < -0.15);
  const shaved = inHead && cover(0.3) ? 2 : 0;
  switch (style) {
    case 'bald':
      return 0;
    case 'buzz':
      return shaved;
    case 'short':
      return top(1.13, 0.35) ? 1 : 0;
    case 'sidepart':
      return top(1.16, 0.35) || (front && dx < 0.1 && dy < -0.15 && r < 1.08) || (side && dy < -0.2 && r < 1.12) ? 1 : 0;
    case 'pixie':
      return top(1.12, 0.25) || (front && dy < -0.2 && r < 1.05 && Math.abs(dx) > 0.25) ? 1 : 0;
    case 'undercut':
      if (r <= 1.24 && dy < -0.3 && Math.abs(dx) < 0.7 && (r > 1 || cover(0.3))) return 1;
      return shaved;
    case 'mohawk':
      if ((front || view === 'back' ? Math.abs(dx) < 0.3 : true) && dy < -0.35 && r < (side ? 1.5 : 1.55) && (side ? dx > -0.6 : true)) return 1;
      return shaved;
    case 'bob':
      return top(1.2, 0.75) || (!side && Math.abs(dx) > 0.58 && dy > -0.6 && dy < 0.78 && r < 1.32) || (side && dx > -0.3 && dy < 0.78 && r < 1.28) ? 1 : 0;
    case 'long':
    case 'longwavy': {
      const w = 1.32 + (style === 'longwavy' ? 0.14 * Math.sin(dy * 7) : 0);
      if (top(1.15, 1)) return 1;
      if (dy < -0.4) return 0;
      if (front) return Math.abs(dx) > 0.62 && Math.abs(dx) < w && dy < 2.3 ? 1 : 0;
      if (side) return dx > -0.2 && dx < w - 0.1 && dy < 2.2 ? 1 : 0;
      return Math.abs(dx) < w && dy < 2.3 ? 1 : 0;
    }
    case 'ponytail':
      if (top(1.1, 0.4)) return 1;
      if (view === 'back') return Math.abs(dx) < 0.32 && dy > 0.2 && dy < 2 ? 1 : 0;
      if (side) return dx > 0.75 && dx < 1.45 && dy > -0.3 && dy < 1.9 - (dx - 0.75) ? 1 : 0;
      return 0;
    case 'braids':
      if (top(1.1, 0.5)) return 1;
      if (side) return Math.abs(dx - 0.55) < 0.3 && dy > 0 && dy < 2.1 ? 1 : 0;
      return Math.abs(Math.abs(dx) - 1) < 0.28 && dy > 0 && dy < 2.1 ? 1 : 0;
    case 'afro': {
      const ra = Math.hypot(dx * 0.95, dy + 0.3);
      if (ra > 1.5) return 0;
      if (front && inHead && dy > -0.38 + 0.4 * dx * dx) return 0;
      if (side && inHead && dx < 0.05 && dy > -0.4) return 0;
      return 1;
    }
    case 'curly': {
      const a = Math.atan2(dy, dx);
      return top(1.24 + 0.08 * Math.sin(a * 9), 0.5) || (!front && r < 1.2 + 0.08 * Math.sin(a * 9) && dy < 0.55 && (side ? dx > 0 : true)) ? 1 : 0;
    }
    case 'bun':
      if (top(1.08, 0.4)) return 1;
      return (side ? Math.hypot(dx - 0.55, dy + 0.95) : Math.hypot(dx, dy + 1.15)) < 0.5 ? 1 : 0;
    case 'topknot':
      if (Math.hypot(dx, dy + 1.12) < 0.38 || (Math.abs(dx) < 0.12 && dy < -0.95 && dy > -1.35)) return 1;
      return shaved;
    case 'dreads':
      if (top(1.15, 0.8)) return 1;
      if (dy < -0.4) return 0;
      if (front) return Math.abs(dx) > 0.56 && Math.abs(dx) < 1.3 && dy < 1.7 ? 1 : 0;
      if (side) return dx > -0.1 && dx < 1.25 && dy < 1.7 ? 1 : 0;
      return Math.abs(dx) < 1.3 && dy < 1.8 ? 1 : 0;
  }
  return 0;
}

function drawHair(img, s, view, hx, hy, rx, ry, layer) {
  const m = s.m.hair;
  for (let y = Math.floor(hy - ry * 2.6); y <= Math.ceil(hy + ry * 2.4); y++)
    for (let x = Math.floor(hx - rx * 1.7); x <= Math.ceil(hx + rx * 1.7); x++) {
      const dx = (x + 0.5 - hx) / rx;
      const dy = (y + 0.5 - hy) / ry;
      // the back layer is hair that hangs behind the body; the front layer is everything on the head
      const behind = dy > 0.9 && view !== 'back';
      if (behind !== (layer === 'back')) continue;
      const h = hairAt(s.style, view, dx, dy);
      if (!h) continue;
      if (h === 2) {
        if (img.alpha(x, y)) img.put(x, y, mix(img.get(x, y), m[(x + y) % 3 === 0 ? 0 : 1], 0.55));
        continue;
      }
      let I = 0.66 - 0.32 * dx - 0.3 * dy;
      if (layer === 'back') I -= 0.25;
      let k = idxOf(I);
      if (s.style === 'dreads' && x % 2 === 0) k -= 1;
      else if (s.style === 'braids' && Math.abs(dy) > 0 && y % 3 === 0 && dy > 0.2) k -= 1;
      else if ((s.style === 'afro' || s.style === 'curly') && (x * 7 + y * 13) % 5 === 0) k -= 1;
      else if ((s.style === 'long' || s.style === 'longwavy' || s.style === 'bob') && x % 3 === 0 && dy > -0.6) k -= 1;
      else if (dy < -0.5 && (x + y * 2) % 7 === 0) k += 1;
      img.put(x, y, m[clamp(k, 0, 4)]);
    }
}

// ---------- one frame ----------

function geometry(s, f) {
  const bob = [0, -1, 0, -1][f];
  const ground = FEET.y;
  const top = ground - s.H + bob;
  const headH = Math.round(s.H / 2.6);
  const ry = headH / 2;
  const rx = ry * 0.98;
  const headCy = top + ry;
  const chin = top + headH;
  const shoulderY = chin;
  const hipY = ground - Math.round(s.H * 0.3) + bob;
  const kneeY = Math.round((hipY + ground) / 2);
  return { bob, ground, top, ry, rx, headCy, chin, shoulderY, hipY, kneeY, cx: 24 };
}

const COATS = new Set(['labcoat', 'longcoat', 'robe']);

function drawFigure(img, s, dir, f) {
  const view = dir === 0 ? 'front' : dir === 3 ? 'back' : 'side';
  const G = geometry(s, f);
  const { cx, ground, shoulderY, hipY, kneeY } = G;
  const m = s.m;
  const swing = [0, 1, 0, -1][f];
  const suit = s.outfit === 'suit';
  const bulk = suit ? 1.2 : s.outfit === 'armor' ? 0.6 : 0;
  const sleeve = s.outfit === 'labcoat' || s.outfit === 'longcoat' ? m.top : s.outfit === 'overalls' ? m.accent : m.top;
  const has = (a) => s.acc.includes(a);
  const side = view === 'side';

  if (side) return drawSide(img, s, G, swing, bulk, sleeve, has);

  const back = view === 'back';
  // behind the body
  if (!back) {
    if (has('polearm')) polearm(img, m, cx - 7, hipY + 5, cx + 8, shoulderY - 10);
    if (has('tank')) for (const sx of [-3, 3]) limb(img, cx + sx, shoulderY - 3, cx + sx, hipY - 2, 1.8, 1.8, m.accent, { bias: -0.1 });
    if (has('backpack')) band(img, shoulderY, hipY - 1, () => [cx - s.sw - 1, cx + s.sw + 1], m.leather, { bias: -0.25 });
    if (s.outfit === 'cloak') band(img, shoulderY - 1, ground - 2, (y, t) => [cx - s.sw - 2 - t * 4, cx + s.sw + 2 + t * 4], m.top, { bias: -0.3, fold: (x) => ((x - cx) % 4 === 0 ? -1 : 0) });
    drawHair(img, s, view, cx, G.headCy, G.rx, G.ry, 'back');
  }
  if (s.hood === false && (s.outfit === 'hoodie')) band(img, shoulderY - 2, shoulderY + 1, () => [cx - 4, cx + 4], m.top, { bias: -0.15 });

  // legs and boots
  for (const sd of [-1, 1]) {
    const lift = (f === 1 && sd === -1) || (f === 3 && sd === 1) ? 1 : 0;
    const lx = cx + sd * s.hw * 0.5;
    const thigh = 3 * s.limb + bulk * 0.5;
    const calf = 2.3 * s.limb + bulk * 0.5;
    const bootTop = ground - 4 - lift;
    band(img, hipY - 1, bootTop + 1, (y) => {
      const t = clamp((y - hipY) / (ground - hipY), 0, 1);
      const r = thigh - (thigh - calf) * t;
      return [lx - r, lx + r];
    }, m.bottom, { fold: (x, y, u) => (y === kneeY && x % 2 === 0 ? -1 : u * sd > 0.5 && y > kneeY && y < kneeY + 4 ? -1 : 0) });
    if (suit) blob(img, lx, kneeY, calf + 0.3, 1, m.metal);
    band(img, bootTop, ground - lift, (y, t) => [lx - calf - 0.8 - t * 0.6, lx + calf + 0.8 + t * 0.6], m.boots, {
      fold: (x, y) => (y < bootTop + 1 ? 1 : y >= ground - lift - 1 ? -1 : 0),
    });
  }

  // long skirts over the legs
  if (s.outfit === 'robe')
    band(img, hipY - 2, ground - 2, (y, t) => [cx - s.hw - 1 - t * 4, cx + s.hw + 1 + t * 4], m.top, {
      fold: (x, y, u, v) => (v > 0.88 ? (back ? 0 : 1) - 0 : (x - cx) % 4 === 0 && v > 0.25 ? -1 : 0),
    });
  if (s.outfit === 'robe') band(img, ground - 4, ground - 2, (y) => [cx - s.hw - 4.6, cx + s.hw + 4.6], m.accent);
  if (s.outfit === 'labcoat' || s.outfit === 'longcoat') {
    const end = kneeY + (s.outfit === 'longcoat' ? 3 : 1);
    band(img, hipY - 1, end, (y, t) => [cx - s.hw - 1.2 - t * 3, cx + s.hw + 1.2 + t * 3], m.top, {
      skip: (x, y, u, v) => !back && Math.abs(x + 0.5 - cx) < 1 + v * 1.8,
      fold: (x, y, u, v) => (Math.abs(x + 0.5 - cx) < 2.6 + v * 1.8 && !back ? -1 : (x - cx + 40) % 5 === 0 && v > 0.3 ? -1 : back && x === cx ? -1 : 0),
    });
  }

  // torso
  const torsoMat = s.outfit === 'overalls' ? m.accent : s.outfit === 'apron' ? m.top : m.top;
  const half = (y) => {
    const t = (y - shoulderY) / (hipY + 2 - shoulderY);
    let h = y < shoulderY + 1 ? s.sw - 1.2 : t < 0.4 ? s.sw : s.sw + (s.hw - 0.5 - s.sw) * ((t - 0.4) / 0.6);
    return h + bulk;
  };
  band(img, G.chin - 1, shoulderY + 1, () => [cx - 1.6, cx + 1.6], m.skin, { bias: -0.25 });
  band(img, shoulderY, hipY + 2, (y) => [cx - half(y), cx + half(y)], torsoMat, {
    fold: (x, y, u, v) => (v > 0.7 && Math.abs(u) < 0.5 && ((x - cx) + y + 40) % 5 === 0 ? -1 : 0),
  });
  if (!back) torsoDetails(img, s, G, half);
  else backDetails(img, s, G, half);

  // arms
  for (const sd of [-1, 1]) {
    const sx = cx + sd * (s.sw - 1.4 + bulk);
    const sy = shoulderY + 1.5;
    const hx = cx + sd * (s.sw + 0.6 + bulk);
    const hy = hipY + 1 - swing * sd * (back ? -1 : 1);
    const ex = (sx + hx) / 2;
    const ey = (sy + hy) / 2;
    const r0 = (s.outfit === 'robe' ? 2.4 : 2.4) * s.limb + bulk * 0.6;
    const r1 = (s.outfit === 'robe' ? 3.1 : 1.9) * s.limb + bulk * 0.5;
    const prosthetic = has('prosthetic') && sd === 1;
    if (prosthetic) {
      limb(img, sx, sy, ex, ey, r0, r0 * 0.9, sleeve);
      limb(img, ex, ey, hx, hy - 1, 1, 0.9, m.metal, { fold: (x, y, u, t) => (t < 0.2 ? -1 : 0) });
      blob(img, hx, hy, 1.3, 1.3, m.metal, { shift: -1 });
      continue;
    }
    if (s.sleeves === 'short') {
      limb(img, sx, sy, hx, hy - 1, r0 * 0.9, r1 * 0.95, m.skin);
      limb(img, sx, sy, ex, ey, r0, r0 * 0.95, sleeve);
    } else limb(img, sx, sy, hx, hy - 1.5, r0, r1, sleeve, { fold: (x, y, u, t) => (t > 0.45 && t < 0.55 && x % 2 === 0 ? -1 : 0) });
    const glove = suit || s.outfit === 'armor' ? m.dark : m.skin;
    blob(img, hx, hy, 1.4, 1.4, glove);
  }
  if (!back) frontOverlays(img, s, G, half);
  if (back) backOverlays(img, s, G, half);
  drawHead(img, s, view, G);
}

function polearm(img, m, x0, y0, x1, y1) {
  limb(img, x0, y0, x1, y1, 0.6, 0.6, m.metal);
  limb(img, x1 - 1, y1 + 1, x1 + 1, y1 - 2, 1.1, 0.6, m.accent, { bias: 0.2 });
}

function torsoDetails(img, s, G, half) {
  const { cx, shoulderY, hipY } = G;
  const m = s.m;
  const o = s.outfit;
  const midline = (mat, k) => {
    for (let y = shoulderY + 2; y < hipY + 2; y++) if (y % 2 === 0) img.put(cx, y, mat[k]);
  };
  if (o === 'tee' || o === 'scrubs') {
    for (let y = shoulderY; y < shoulderY + (o === 'scrubs' ? 4 : 2); y++) for (let x = cx - 2; x < cx + 2; x++) if (Math.abs(x + 0.5 - cx) < 2 - (y - shoulderY) * (o === 'scrubs' ? 0.5 : 0.2)) img.put(x, y, m.skin[2]);
    if (o === 'scrubs') rect(img, cx + 1, shoulderY + 3, 2, 2, m.top[1]);
  }
  if (o === 'hoodie') {
    band(img, hipY - 3, hipY, () => [cx - 3, cx + 3], m.top, { bias: -0.3 });
    for (const x of [cx - 2, cx + 1]) for (let y = shoulderY + 1; y < shoulderY + 3; y++) img.put(x, y, m.accent[3]);
  }
  if (o === 'jacket' || o === 'coverall' || o === 'suit') {
    midline(m.top, 4);
    for (let y = shoulderY; y < shoulderY + 2; y++)
      for (const sd of [-1, 1]) for (let k = 1; k <= 2 - (y - shoulderY); k++) img.put(cx + sd * k - (sd < 0 ? 1 : 0), y, m.top[3]);
    if (o === 'jacket') rect(img, cx - 1, shoulderY, 2, 2, m.accent[2]);
  }
  if (o === 'coverall') {
    rect(img, cx + 1, shoulderY + 2, 3, 2, m.top[1]);
    rect(img, cx + 1, shoulderY + 2, 3, 1, m.top[3]);
  }
  if (o === 'coverall' || o === 'suit' || o === 'jacket' || o === 'armor') band(img, hipY - 1, hipY + 1, (y) => [cx - half(y), cx + half(y)], m.leather);
  if (s.harness) {
    for (const sd of [-1, 1]) for (let y = shoulderY; y < hipY; y++) img.put(cx + sd * 3 - (sd < 0 ? 1 : 0), y, m.gold[2]);
    for (let x = cx - 3; x < cx + 3; x++) img.put(x, shoulderY + 4, m.gold[1]);
    rect(img, cx - 1, shoulderY + 4, 2, 1, m.metal[3]);
  }
  if (o === 'suit') {
    rect(img, cx - 2, shoulderY + 2, 4, 3, m.metal[1]);
    img.put(cx - 1, shoulderY + 3, rgba('#e43b44'));
    img.put(cx + 1, shoulderY + 3, rgba('#63c74d'));
    band(img, shoulderY - 1, shoulderY + 1, () => [cx - 3.5, cx + 3.5], m.metal);
    const [px, py] = s.patches[0];
    rect(img, cx + (px % 3) - 1, hipY + 3 + (py % 3), 2, 2, s.m.top[3]);
  }
  if (o === 'overalls') {
    band(img, shoulderY + 3, hipY + 2, () => [cx - s.hw + 0.5, cx + s.hw - 0.5], m.bottom);
    for (const sd of [-1, 1]) for (let y = shoulderY; y < shoulderY + 3; y++) img.put(cx + sd * 2 - (sd < 0 ? 1 : 0), y, m.bottom[1]);
    for (const sd of [-1, 1]) img.put(cx + sd * 2 - (sd < 0 ? 1 : 0), shoulderY + 3, m.metal[3]);
    rect(img, cx - 1, shoulderY + 5, 2, 2, m.bottom[1]);
  }
  if (o === 'armor') {
    band(img, shoulderY + 1, hipY - 1, (y) => [cx - half(y) + 0.8, cx + half(y) - 0.8], m.armor, {
      fold: (x, y) => ((y - shoulderY) % 3 === 0 ? -1 : 0),
    });
  }
  if (o === 'labcoat' || o === 'longcoat') {
    band(img, shoulderY, hipY + 2, (y, t) => [cx - 1 - t * 0.6, cx + 1 + t * 0.6], m.accent, { bias: -0.1 });
    if (o === 'labcoat') for (let y = shoulderY + 1; y < shoulderY + 5; y++) img.put(cx, y, m.dark[1]);
    for (let y = shoulderY; y < shoulderY + 3; y++) for (const sd of [-1, 1]) img.put(cx + sd * (2 + Math.floor((y - shoulderY) / 2)) - (sd < 0 ? 1 : 0), y, m.top[3]);
    if (o === 'longcoat') band(img, hipY - 3, hipY - 1, (y) => [cx - half(y), cx + half(y)], m.leather);
  }
  if (o === 'robe') {
    for (let y = shoulderY; y < shoulderY + 4; y++) for (let x = cx - 2; x < cx + 2; x++) if (Math.abs(x + 0.5 - cx) < 2 - (y - shoulderY) * 0.5) img.put(x, y, m.skin[1]);
    band(img, hipY - 2, hipY, (y) => [cx - half(y), cx + half(y)], m.accent);
    for (let y = hipY; y < hipY + 4; y++) img.put(cx + 2, y, m.accent[y % 2 ? 1 : 3]);
  }
  if (s.emblem === 'cross' && o !== 'armor') {
    rect(img, cx - 4, shoulderY + 3, 3, 1, rgba('#e43b44'));
    rect(img, cx - 3, shoulderY + 2, 1, 3, rgba('#e43b44'));
  }
  if (s.emblem === 'badge') rect(img, cx - 4, shoulderY + 2, 2, 2, m.gold[3]);
  if (s.emblem === 'patch' && o !== 'overalls') rect(img, cx - 4, shoulderY + 2, 2, 1, m.accent[3]);
}

function backDetails(img, s, G, half) {
  const { cx, shoulderY, hipY } = G;
  const m = s.m;
  if (s.outfit === 'overalls') {
    band(img, hipY - 2, hipY + 2, () => [cx - s.hw + 0.5, cx + s.hw - 0.5], m.bottom);
    for (let y = shoulderY; y < hipY - 2; y++) {
      const k = Math.round((y - shoulderY) * 0.4);
      img.put(cx - 3 + k, y, m.bottom[1]);
      img.put(cx + 2 - k, y, m.bottom[1]);
    }
  }
  if (s.outfit === 'armor') band(img, shoulderY + 1, hipY - 1, (y) => [cx - half(y) + 0.8, cx + half(y) - 0.8], m.armor, { fold: (x, y) => ((y - shoulderY) % 3 === 0 ? -1 : 0) });
  if (s.outfit === 'robe' || s.outfit === 'longcoat' || s.outfit === 'coverall') for (let y = shoulderY + 2; y < hipY; y++) img.put(cx, y, m.top[1]);
  if (s.emblem === 'cross') {
    rect(img, cx - 2, shoulderY + 3, 4, 2, rgba('#e43b44'));
    rect(img, cx - 1, shoulderY + 2, 2, 4, rgba('#e43b44'));
  }
}

function frontOverlays(img, s, G, half) {
  const { cx, shoulderY, hipY, kneeY, ground } = G;
  const m = s.m;
  const has = (a) => s.acc.includes(a);
  if (s.outfit === 'apron') {
    band(img, shoulderY + 2, kneeY + 1, (y, t) => [cx - s.hw + 0.4 - t, cx + s.hw - 0.4 + t], m.apron);
    for (const sd of [-1, 1]) for (let y = shoulderY - 1; y < shoulderY + 2; y++) img.put(cx + sd * 2 - (sd < 0 ? 1 : 0), y, m.apron[1]);
    rect(img, cx - 2, hipY, 4, 2, m.apron[1]);
  }
  if (s.outfit === 'poncho') {
    band(img, shoulderY - 1, hipY + 3, (y, t) => [cx - s.sw - t * 3, cx + s.sw + t * 3], m.top, { skip: (x, y, u, v) => v > 0.9 && x % 2 === 0 });
    for (let y = shoulderY - 1; y < hipY + 3; y++) {
      if ((y - shoulderY + 20) % 4 !== 2) continue;
      const t = (y - shoulderY + 1) / (hipY + 4 - shoulderY);
      for (let x = Math.ceil(cx - s.sw - t * 3); x < cx + s.sw + t * 3; x++) if (img.alpha(x, y)) img.put(x, y, m.accent[2]);
    }
    band(img, shoulderY - 1, shoulderY + 1, () => [cx - 2.5, cx + 2.5], m.top, { bias: -0.4 });
  }
  if (s.outfit === 'cloak') {
    band(img, shoulderY - 1, shoulderY + 4, (y, t) => [cx - s.sw - 1 - t, cx + s.sw + 1 + t], m.top, { fold: (x, y, u, v) => (v > 0.75 ? -1 : 0) });
    rect(img, cx - 1, shoulderY, 2, 2, m.gold[3]);
    if (!s.hood) band(img, shoulderY - 2, shoulderY, () => [cx - 4, cx + 4], m.top, { bias: -0.2 });
  }
  if (has('toolbelt')) {
    band(img, hipY - 1, hipY + 1, (y) => [cx - half(y), cx + half(y)], m.leather);
    for (const px of [-4, 2]) rect(img, cx + px, hipY, 2, 2, m.leather[3]);
    for (let y = hipY; y < hipY + 3; y++) img.put(cx + s.hw + 1, y, m.metal[3]);
  }
  if (has('satchel')) {
    for (let k = 0; k < hipY - shoulderY; k++) img.put(Math.round(cx - s.sw + 2 + k * ((2 * s.sw - 3) / (hipY - shoulderY))), shoulderY + k, m.leather[1]);
    band(img, hipY - 1, hipY + 3, () => [cx + s.hw - 1, cx + s.hw + 3], m.leather, { fold: (x, y, u, v) => (v < 0.3 ? 1 : 0) });
  }
  if (has('backpack')) for (const sd of [-1, 1]) for (let y = shoulderY; y < shoulderY + 5; y++) img.put(cx + sd * (s.sw - 2) - (sd < 0 ? 1 : 0), y, m.leather[1]);
  if (has('scarf')) {
    band(img, shoulderY - 1, shoulderY + 1, () => [cx - 3.5, cx + 3.5], m.accent);
    band(img, shoulderY + 1, shoulderY + 5, () => [cx + 1, cx + 3], m.accent, { bias: -0.1 });
  }
}

function backOverlays(img, s, G, half) {
  const { cx, shoulderY, hipY, kneeY, ground } = G;
  const m = s.m;
  const has = (a) => s.acc.includes(a);
  if (s.outfit === 'cloak' || s.outfit === 'poncho')
    band(img, shoulderY - 1, s.outfit === 'cloak' ? ground - 2 : hipY + 3, (y, t) => [cx - s.sw - 1 - t * 3, cx + s.sw + 1 + t * 3], m.top, {
      fold: (x, y, u, v) => (s.outfit === 'poncho' && (y - shoulderY + 20) % 4 === 2 ? 0 : (x - cx + 40) % 4 === 0 && v > 0.3 ? -1 : 0),
    });
  if (has('tank')) {
    for (const sx of [-2.2, 2.2]) limb(img, cx + sx, shoulderY, cx + sx, hipY - 1, 1.8, 1.8, m.accent);
    for (const sx of [-3, 1]) rect(img, cx + sx, shoulderY - 1, 2, 1, m.metal[3]);
  }
  if (has('backpack')) {
    band(img, shoulderY + 1, hipY - 1, () => [cx - s.sw + 1, cx + s.sw - 1], m.leather, { fold: (x, y, u, v) => (v < 0.25 ? 1 : v > 0.55 && v < 0.6 ? -1 : 0) });
    rect(img, cx - 2, shoulderY + 5, 4, 2, m.leather[1]);
  }
  if (has('polearm')) polearm(img, m, cx + 7, hipY + 5, cx - 8, shoulderY - 10);
  if (has('satchel')) for (let k = 0; k < hipY - shoulderY; k++) img.put(Math.round(cx + s.sw - 2 - k * ((2 * s.sw - 3) / (hipY - shoulderY))), shoulderY + k, m.leather[1]);
  if (has('scarf')) band(img, shoulderY - 1, shoulderY + 1, () => [cx - 3.5, cx + 3.5], m.accent);
}

function drawHead(img, s, view, G) {
  const { cx, headCy, rx, ry } = G;
  const m = s.m;
  const has = (a) => s.acc.includes(a);
  const side = view === 'side';
  const hx = side ? cx - 1 : cx;
  const hrx = side ? rx * 1.08 : rx;
  if (!side) for (const sd of [-1, 1]) blob(img, cx + sd * (rx + 0.1), headCy + 0.6, 1.1, 1.5, m.skin, { bias: -0.15 });
  else blob(img, hx + 1, headCy + 0.6, 1.1, 1.5, m.skin, { bias: -0.15 });
  blob(img, hx, headCy, hrx, ry, m.skin, { skip: (dx, dy) => dy > 0.55 && Math.abs(dx) > 0.7 - (dy - 0.55) * 0.6 });
  const eyeY = Math.round(headCy + 1);
  const blush = rgba('#f6757a');
  if (side) {
    const fx = Math.round(hx - hrx);
    img.put(fx - 1, eyeY + 1, m.skin[2]);
    img.put(fx + 2, eyeY - 1, WHITE);
    img.put(fx + 2, eyeY, EYE);
    img.put(fx + 1, eyeY - 1, EYE);
    img.put(fx + 1, eyeY, EYE);
    for (const x of [fx + 1, fx + 2]) img.put(x, eyeY - 2, m.hair[0]);
    img.put(fx + 1, eyeY + 2, m.skin[0]);
    if (s.age !== 'elder') img.put(fx + 3, eyeY + 1, blush);
    facialHair(img, s, 'side', hx, headCy, hrx, ry, eyeY);
  } else if (view === 'front') {
    for (const ex of [cx - 4, cx + 2]) {
      img.put(ex, eyeY - 1, WHITE);
      img.put(ex + 1, eyeY - 1, EYE);
      img.put(ex, eyeY, EYE);
      img.put(ex + 1, eyeY, EYE);
      for (const x of [ex, ex + 1]) img.put(x, eyeY - 2, m.hair[0]);
    }
    img.put(cx - 1, eyeY + 2, m.skin[0]);
    img.put(cx, eyeY + 2, m.skin[0]);
    if (s.age === 'elder') {
      img.put(cx - 5, eyeY, m.skin[1]);
      img.put(cx + 4, eyeY, m.skin[1]);
    } else {
      img.put(cx - 5, eyeY + 1, blush);
      img.put(cx + 4, eyeY + 1, blush);
    }
    facialHair(img, s, 'front', hx, headCy, hrx, ry, eyeY);
  }
  if (!s.helmet) drawHair(img, s, view, hx, headCy, hrx, ry, 'front');
  headgear(img, s, view, hx, headCy, hrx, ry, eyeY);
}

function facialHair(img, s, view, hx, hy, rx, ry, eyeY) {
  if (!s.facial) return;
  const m = s.m.hair;
  for (let y = Math.floor(hy - ry); y <= Math.ceil(hy + ry + 1); y++)
    for (let x = Math.floor(hx - rx - 1); x <= Math.ceil(hx + rx + 1); x++) {
      const dx = (x + 0.5 - hx) / rx;
      const dy = (y + 0.5 - hy) / ry;
      if (dx * dx + dy * dy > 1.05 || !img.alpha(x, y)) continue;
      const mouth = y === eyeY + 2 && Math.abs(x + 0.5 - (view === 'side' ? hx - rx + 1.5 : hx)) < 1.2;
      const lip = y === eyeY + 1 && Math.abs(x + 0.5 - (view === 'side' ? hx - rx + 1.5 : hx)) < 2.2;
      const jaw = dy > 0.42 && (view === 'front' || dx < 0.5);
      let on = false;
      if (s.facial === 'beard') on = (jaw || (Math.abs(dx) > 0.75 && dy > -0.1)) && !mouth;
      else if (s.facial === 'mustache') on = lip;
      else if (s.facial === 'goatee') on = (lip || (dy > 0.55 && Math.abs(x + 0.5 - (view === 'side' ? hx - rx + 1 : hx)) < 1.6)) && !mouth;
      else if (s.facial === 'stubble') {
        if (jaw && !mouth && (x + y) % 2 === 0) img.put(x, y, mix(img.get(x, y), m[1], 0.45));
        continue;
      }
      if (on) img.put(x, y, m[clamp(idxOf(0.6 - 0.3 * dx - 0.2 * dy), 0, 3)]);
    }
}

function headgear(img, s, view, hx, hy, rx, ry, eyeY) {
  const m = s.m;
  const has = (a) => s.acc.includes(a);
  const side = view === 'side';
  const front = view === 'front';
  const fx = Math.round(hx - rx);
  if (has('goggles')) {
    const gy = s.helmet || has('visor') ? eyeY - 3 : eyeY;
    for (let x = Math.floor(hx - rx - 0.5); x <= Math.ceil(hx + rx - 0.5); x++) if (img.alpha(x, gy)) img.put(x, gy, m.dark[1]);
    if (front) for (const ex of [Math.round(hx) - 5, Math.round(hx) + 1]) {
      rect(img, ex, gy - 1, 4, 2, m.glass[2]);
      img.put(ex, gy - 1, m.glass[3]);
    }
    if (side) {
      rect(img, fx, gy - 1, 3, 2, m.glass[2]);
      img.put(fx, gy - 1, m.glass[3]);
    }
  }
  if (has('visor') && !s.helmet && view !== 'back') {
    const x0 = side ? fx - 1 : Math.round(hx - rx);
    const w = side ? 5 : Math.round(rx * 2);
    rect(img, x0, eyeY - 1, w, 2, m.glass[2]);
    rect(img, x0, eyeY - 1, w, 1, m.glass[3]);
  }
  if (has('respirator') && view !== 'back') {
    if (front) {
      band(img, eyeY + 1, eyeY + 4, () => [hx - 3, hx + 3], m.metal);
      for (const sd of [-1, 1]) blob(img, hx + sd * 3.2, eyeY + 2.5, 1.2, 1.2, m.accent);
    } else {
      band(img, eyeY + 1, eyeY + 4, () => [fx - 1, fx + 3], m.metal);
      blob(img, fx - 1, eyeY + 2.5, 1.2, 1.2, m.accent);
    }
  }
  if (has('headset')) {
    const ex = side ? hx + 1 : hx + rx + 0.2;
    blob(img, ex, hy + 0.5, 1.2, 1.5, m.dark);
    for (let k = 0; k < 3; k++) img.put(Math.round(ex - 1 - k), Math.round(hy + 2 + k * 0.5), m.dark[2]);
  }
  if (has('bandana')) {
    for (let y = Math.round(hy - ry * 0.62); y < Math.round(hy - ry * 0.62) + 2; y++)
      for (let x = Math.floor(hx - rx - 1); x <= Math.ceil(hx + rx + 1); x++) if (img.alpha(x, y) && Math.abs((x + 0.5 - hx) / rx) <= 1.15) img.put(x, y, m.accent[y % 2 ? 2 : 3]);
    if (!front) rect(img, Math.round(hx + rx), Math.round(hy - ry * 0.6), 2, 4, m.accent[1]);
  }
  if (has('beanie') && !s.hood && !s.helmet) {
    blob(img, hx, hy - ry * 0.35, rx * 1.12, ry * 0.85, m.accent, { skip: (dx, dy) => dy > 0.15 });
    band(img, hy - ry * 0.25, hy - ry * 0.05, () => [hx - rx * 1.12, hx + rx * 1.12], m.accent, { bias: 0.15, fold: (x) => (x % 2 ? -1 : 0) });
  }
  if ((has('hardhat') || has('hat')) && !s.hood && !s.helmet) {
    const mat = has('hardhat') ? m.gold : m.leather;
    blob(img, hx, hy - ry * 0.45, rx * 1.15, ry * 0.72, mat, { skip: (dx, dy) => dy > 0.3 });
    const brim = has('hat') ? 1.75 : 1.32;
    band(img, hy - ry * 0.27, hy - ry * 0.1, () => [hx - rx * brim - (side ? 1 : 0), hx + rx * (side ? 1.2 : brim)], mat, { bias: -0.15 });
    if (has('hardhat')) for (let y = Math.round(hy - ry * 1.1); y < hy - ry * 0.3; y++) img.put(Math.round(hx), y, mat[4]);
  }
  if (s.hood && !s.helmet) {
    const mat = m.top;
    for (let y = Math.floor(hy - ry * 1.5); y <= Math.ceil(hy + ry * 1.4); y++)
      for (let x = Math.floor(hx - rx * 1.6); x <= Math.ceil(hx + rx * 1.6); x++) {
        const dx = (x + 0.5 - hx) / rx;
        const dy = (y + 0.5 - hy) / ry;
        if ((dx / 1.38) ** 2 + ((dy + 0.08) / 1.3) ** 2 > 1) continue;
        const open = front ? (dx / 0.86) ** 2 + ((dy - 0.2) / 0.98) ** 2 < 1 : side ? dx < 0.15 && dy > -0.62 && (dx / 1.1) ** 2 + ((dy - 0.2) / 0.98) ** 2 < 1.25 : false;
        if (open) {
          const edge = front ? (dx / 0.86) ** 2 + ((dy - 0.2) / 0.98) ** 2 > 0.72 && dy < 0.2 : false;
          if (edge) img.put(x, y, mix(img.get(x, y), mat[0], 0.55));
          continue;
        }
        const I = 0.62 - 0.35 * dx - 0.3 * dy;
        img.put(x, y, mat[clamp(idxOf(I) + ((x + y) % 5 === 0 ? -1 : 0), 0, 4)]);
      }
  }
  if (s.helmet) {
    for (let y = Math.floor(hy - ry * 1.5); y <= Math.ceil(hy + ry * 1.5); y++)
      for (let x = Math.floor(hx - rx * 1.6); x <= Math.ceil(hx + rx * 1.6); x++) {
        const dx = (x + 0.5 - hx) / (rx * 1.48);
        const dy = (y + 0.5 - hy) / (ry * 1.32);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        if (d > 0.8) img.put(x, y, m.metal[dx + dy < -0.3 ? 4 : dx + dy > 0.6 ? 1 : 3]);
        else if (view === 'back') img.put(x, y, m.top[idxOf(0.62 - 0.4 * dx - 0.3 * dy)]);
        else if (dx < -0.25 && dy < -0.2 && d > 0.35) img.set(x, y, [255, 255, 255, 150]);
        else img.set(x, y, fade(m.glass[3], img.alpha(x, y) ? 70 : 120));
      }
  }
}

// ---------- side view (facing left) ----------

function drawSide(img, s, G, swing, bulk, sleeve, has) {
  const { cx, ground, shoulderY, hipY, kneeY } = G;
  const m = s.m;
  const depth = s.sw * 0.75 + bulk;
  const hipD = s.hw * 0.78 + bulk * 0.5;
  const step = 3 * swing;
  const thigh = 3 * s.limb + bulk * 0.5;
  const calf = 2.3 * s.limb + bulk * 0.5;

  if (has('polearm')) polearm(img, m, cx - 6, hipY + 5, cx + 7, shoulderY - 10);
  if (s.outfit === 'cloak') band(img, shoulderY - 1, ground - 2, (y, t) => [cx - 1, cx + depth + 2 + t * 5], m.top, { bias: -0.2, fold: (x) => ((x - cx) % 4 === 0 ? -1 : 0) });
  drawHair(img, s, 'side', cx - 1, G.headCy, G.rx * 1.08, G.ry, 'back');
  if (has('tank')) limb(img, cx + depth + 1, shoulderY, cx + depth + 1, hipY - 1, 1.8, 1.8, m.accent);
  if (has('backpack')) band(img, shoulderY + 1, hipY, () => [cx + depth - 1, cx + depth + 3], m.leather, { fold: (x, y, u, v) => (v < 0.2 ? 1 : 0) });

  const leg = (fx, near, lift) => {
    const ankleY = ground - 2 - lift;
    limb(img, cx + 0.5, hipY, fx, ankleY - 1, thigh, calf, m.bottom, { bias: near ? 0 : -0.3 });
    limb(img, fx, ankleY - 2, fx, ankleY, calf + 0.4, calf + 0.5, m.boots, { bias: near ? 0 : -0.3, fold: (x, y) => (y < ankleY - 1 ? 1 : 0) });
    blob(img, fx - 1.2, ankleY + 0.6, 2.2, 1.2, m.boots, { bias: near ? 0 : -0.3 });
  };
  leg(cx + step, false, swing !== 0 ? 1 : 0);
  // far arm
  const armR0 = 2.3 * s.limb + bulk * 0.6;
  const armR1 = (s.outfit === 'robe' ? 3 : 1.9) * s.limb + bulk * 0.5;
  limb(img, cx + 0.5, shoulderY + 1.5, cx - 3 * swing, hipY + 1, armR0, armR1, sleeve, { bias: -0.35 });
  leg(cx - step, true, 0);

  if (s.outfit === 'robe') band(img, hipY - 2, ground - 2, (y, t) => [cx - hipD - 1 - t * 3, cx + hipD + 1 + t * 4], m.top, { fold: (x, y, u, v) => ((x - cx + 40) % 4 === 0 && v > 0.25 ? -1 : 0) });
  if (s.outfit === 'labcoat' || s.outfit === 'longcoat')
    band(img, hipY - 1, kneeY + (s.outfit === 'longcoat' ? 3 : 1), (y, t) => [cx - hipD - 1 - t * 2 - Math.max(0, swing) * t * 2, cx + hipD + 1 + t * 3], m.top, { fold: (x, y, u, v) => ((x - cx + 40) % 5 === 0 && v > 0.3 ? -1 : 0) });

  band(img, G.chin - 1, shoulderY + 1, () => [cx - 2, cx + 1.2], m.skin, { bias: -0.25 });
  const torsoMat = s.outfit === 'overalls' ? m.accent : m.top;
  band(img, shoulderY, hipY + 2, (y, t) => {
    const chest = t > 0.1 && t < 0.5 ? 1 : 0;
    const d = y < shoulderY + 1 ? depth - 1 : depth;
    return [cx - d - chest + (t > 0.6 ? (t - 0.6) * 3 : 0), cx + d - (t > 0.5 ? (t - 0.5) * 2 : 0)];
  }, torsoMat, { fold: (x, y, u, v) => (v > 0.55 && (x + y) % 5 === 0 ? -1 : 0) });
  if (s.outfit === 'overalls') band(img, shoulderY + 3, hipY + 2, () => [cx - depth - 0.5, cx + depth - 1], m.bottom);
  if (s.outfit === 'armor') band(img, shoulderY + 1, hipY - 1, () => [cx - depth - 1, cx + depth - 0.5], m.armor, { fold: (x, y) => ((y - shoulderY) % 3 === 0 ? -1 : 0) });
  if (s.outfit === 'apron') band(img, shoulderY + 2, kneeY + 1, (y, t) => [cx - depth - 1.5 - t, cx - depth + 1], m.apron);
  if (['coverall', 'suit', 'jacket', 'armor', 'longcoat'].includes(s.outfit) || has('toolbelt')) band(img, hipY - 1, hipY + 1, () => [cx - depth - 0.5, cx + depth], m.leather);
  if (has('toolbelt')) rect(img, cx - 2, hipY, 2, 2, m.leather[3]);
  if (has('satchel')) band(img, hipY - 1, hipY + 3, () => [cx + depth - 1, cx + depth + 2], m.leather);
  if (s.emblem === 'cross') {
    rect(img, cx - 1, shoulderY + 3, 3, 1, rgba('#e43b44'));
    rect(img, cx, shoulderY + 2, 1, 3, rgba('#e43b44'));
  }

  // near arm
  const prosthetic = has('prosthetic');
  const hx = cx + 3 * swing;
  const hy = hipY + 1;
  const sy = shoulderY + 1.5;
  if (prosthetic) {
    limb(img, cx, sy, (cx + hx) / 2, (sy + hy) / 2, armR0, armR0 * 0.9, sleeve);
    limb(img, (cx + hx) / 2, (sy + hy) / 2, hx, hy - 1, 1, 0.9, m.metal, { fold: (x, y, u, t) => (t < 0.2 ? -1 : 0) });
    blob(img, hx, hy, 1.3, 1.3, m.metal, { shift: -1 });
  } else {
    if (s.sleeves === 'short') {
      limb(img, cx, sy, hx, hy - 1, armR0 * 0.9, armR1 * 0.95, m.skin);
      limb(img, cx, sy, (cx + hx) / 2, (sy + hy) / 2, armR0, armR0 * 0.95, sleeve);
    } else limb(img, cx, sy, hx, hy - 1, armR0, armR1, sleeve);
    blob(img, hx, hy, 1.4, 1.4, s.outfit === 'suit' || s.outfit === 'armor' ? m.dark : m.skin);
  }
  if (s.outfit === 'poncho') band(img, shoulderY - 1, hipY + 3, (y, t) => [cx - depth - 1 - t * 3, cx + depth + 1 + t * 3], m.top, { fold: (x, y) => ((y - shoulderY + 20) % 4 === 2 ? 1 : 0), skip: (x, y, u, v) => v > 0.9 && x % 2 === 0 });
  if (s.outfit === 'cloak') band(img, shoulderY - 1, shoulderY + 4, (y, t) => [cx - depth - 1 - t, cx + depth + 1.5 + t], m.top, { fold: (x, y, u, v) => (v > 0.75 ? -1 : 0) });
  if (has('scarf')) {
    band(img, shoulderY - 1, shoulderY + 1, () => [cx - 3, cx + 2.5], m.accent);
    band(img, shoulderY + 1, shoulderY + 5, () => [cx + 1, cx + 3.5], m.accent, { bias: -0.2 });
  }
  if (s.outfit === 'suit') band(img, shoulderY - 1, shoulderY + 1, () => [cx - 3.5, cx + 2.5], m.metal);
  drawHead(img, s, 'side', G);
}

// ---------- finishing ----------

/** Cool rim light on right-facing edges, then a selective outline from each edge's own colour. */
function finish(img) {
  const w = img.w;
  const h = img.h;
  const a = (x, y) => img.alpha(x, y) > 0;
  const src = new Img(w, h);
  src.data.set(img.data);
  for (let y = 0; y < h - 6; y++)
    for (let x = 0; x < w; x++) void x;
  const base = new Img(w, h);
  base.data.set(img.data);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (base.alpha(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (base.alpha(x + dx, y + dy) > 127) {
          img.put(x, y, mix(base.get(x + dx, y + dy), INK, 0.74));
          break;
        }
    }
  void a;
}

function frameImage(s, dir, f) {
  const fig = new Img(FRAME_W, FRAME_H);
  drawFigure(fig, s, dir === 2 ? 1 : dir, f);
  finish(fig);
  const out = new Img(FRAME_W, FRAME_H);
  out.ellipse(FEET.x, FEET.y - 1, 7, 2, fade(INK, 90));
  out.blit(fig, 0, 0, dir === 2);
  return out;
}

const BACKDROP = { farmer: '#3f5d45', miner: '#8a3a17', engineer: '#8f6a14', medic: '#6e1a26', scientist: '#18737c', merchant: '#5e2c8c', guard: '#22398e', official: '#414a62', worker: '#5e3a24', civilian: '#8a2a5a' };

function paintPortrait(s, front) {
  const p = new Img(PORTRAIT, PORTRAIT);
  const bg = ramp(BACKDROP[s.archetype]);
  for (let y = 0; y < PORTRAIT; y++)
    for (let x = 0; x < PORTRAIT; x++) {
      const t = y / PORTRAIT + (((x >> 2) * 7 + (y >> 2) * 3) % 4) / 50;
      p.put(x, y, bg[t < 0.4 ? 2 : t < 0.75 ? 1 : 0]);
    }
  const top = Math.max(0, FEET.y - s.H - 2);
  p.blit(front.crop(4, top, 24, 24).scaled(5), 4, 8);
  for (let i = 0; i < PORTRAIT; i++)
    for (let k = 0; k < 4; k++) {
      p.put(i, k, INK);
      p.put(i, PORTRAIT - 1 - k, INK);
      p.put(k, i, INK);
      p.put(PORTRAIT - 1 - k, i, INK);
    }
  p.frame(4, 4, PORTRAIT - 8, PORTRAIT - 8, bg[3]);
  return p;
}

/** The full atlas: one row per sprite in SPRITE_ARCHETYPES x variant order. */
export function paintCharacters() {
  used.clear();
  const rows = SPRITE_ARCHETYPES.length * SPRITE_VARIANTS;
  const atlas = new Img(FRAME_W * FRAMES * 4, FRAME_H * rows);
  const portraits = {};
  let row = 0;
  for (const archetype of SPRITE_ARCHETYPES)
    for (let v = 0; v < SPRITE_VARIANTS; v++) {
      const s = specFor(archetype, v);
      let front = null;
      for (let d = 0; d < 4; d++)
        for (let f = 0; f < FRAMES; f++) {
          const img = frameImage(s, d, f);
          if (d === 0 && f === 0) front = img;
          atlas.blit(img, (d * FRAMES + f) * FRAME_W, row * FRAME_H);
        }
      portraits[archetype + '_' + v] = paintPortrait(s, front);
      row++;
    }
  return { atlas, portraits };
}
