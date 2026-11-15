/**
 * UI icons for every god power and resource, and the world fx: grave marker, selection pointer
 * and the two tiling weather overlays. Icons are drawn large-shaped with a dark outline and a
 * drop shadow so they read on any panel colour.
 */
import { Img } from './lib/image.mjs';
import { INK, RAMPS, fade, tone } from './lib/palette.mjs';
import { hash2, rng } from './lib/noise.mjs';

/** Finishes an icon: outline in ink and a soft 1px drop shadow down-right. */
function finish(img) {
  img.outline(() => INK, false);
  const out = new Img(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) if (img.alpha(x, y) > 127 && !img.alpha(x + 1, y + 1)) out.put(x + 1, y + 1, fade(INK, 110));
  out.blit(img, 0, 0);
  return out;
}

/** A disc shaded from the upper left across ramp indices [lo..hi]. */
function ball(img, cx, cy, r, ramp, lo, hi) {
  img.ellipse(cx, cy, r, r, (i, j, d) => {
    const t = (i + j) / (2 * r) + d * 0.35;
    const k = Math.round(hi - (t + 0.6) * ((hi - lo) / 1.6));
    return tone(ramp, Math.max(lo, Math.min(hi, k)));
  });
}

function drought() {
  const img = new Img(32, 32);
  // cracked dry ground
  for (let y = 21; y < 29; y++) for (let x = 3; x < 29; x++) img.put(x, y, y === 21 ? tone('orange', 4) : (x * 3 + y) % 9 ? tone('orange', 3) : tone('orange', 2));
  for (const [x0, y0, x1, y1] of [[7, 22, 10, 28], [10, 25, 15, 24], [18, 22, 16, 28], [22, 24, 26, 27]]) img.line(x0, y0, x1, y1, tone('brown', 1));
  // the sun with rays
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    img.line(16 + Math.cos(ang) * 8, 12 + Math.sin(ang) * 8, 16 + Math.cos(ang) * 12, 12 + Math.sin(ang) * 11, tone('yellow', 3));
  }
  ball(img, 16, 12, 6, 'yellow', 2, 4);
  img.put(14, 9, tone('metal', 8));
  img.put(13, 10, tone('metal', 8));
  return finish(img);
}

function storm() {
  const img = new Img(32, 32);
  for (const [x, y, len] of [[20, 6, 13], [27, 13, 9], [12, 14, 8]]) {
    for (let t = 0; t < len; t++) {
      const k = t / len;
      const c = k < 0.3 ? tone('red', 3) : k < 0.6 ? tone('orange', 4) : tone('yellow', 4);
      img.put(x + t, y - t, c);
      img.put(x + t, y - t + 1, k < 0.5 ? tone('orange', 3) : tone('yellow', 3));
    }
    ball(img, x, y + 1, 2, 'orange', 2, 4);
  }
  // impact flash on the ground
  img.ellipse(10, 25, 9, 3, tone('metal', 4));
  img.ellipse(10, 25, 6, 2, tone('metal', 2));
  for (let a = 0; a < 6; a++) img.line(10, 22, 10 + Math.cos(a * 1.05 - 2.6) * 6, 22 + Math.sin(a * 1.05 - 2.6) * 6, tone('yellow', 4));
  ball(img, 10, 21, 3, 'yellow', 3, 4);
  return finish(img);
}

function grant() {
  const img = new Img(32, 32);
  // a supply crate with a gold band and a sparkle
  for (let y = 12; y < 28; y++)
    for (let x = 6; x < 26; x++) {
      let c = y < 16 ? tone('brown', 5) : x < 9 ? tone('brown', 4) : tone('brown', 3);
      if (x === 6 || y === 16 || x === 25) c = tone('brown', 2);
      if (x >= 14 && x <= 17) c = y < 16 ? tone('yellow', 4) : tone('yellow', 3);
      img.put(x, y, c);
    }
  img.hline(6, 25, 27, tone('brown', 1));
  for (const [dx, dy] of [[-4, -3], [3, -3]]) img.ellipse(16 + dx, 9 + dy, 3, 2, tone('yellow', 4));
  img.rect(14, 9, 4, 3, tone('yellow', 3));
  for (const [x, y, s] of [[26, 6, 3], [5, 8, 2]]) {
    img.hline(x - s, x + s, y, tone('metal', 8));
    img.vline(x, y - s, y + s, tone('metal', 8));
  }
  return finish(img);
}

function kill() {
  const img = new Img(32, 32);
  ball(img, 16, 13, 10, 'metal', 6, 8);
  img.rect(10, 19, 12, 7, tone('metal', 7));
  img.hline(10, 21, 25, tone('metal', 5));
  for (const x of [12, 15, 18]) img.vline(x, 21, 25, tone('metal', 4));
  for (const cx of [12, 20]) {
    img.ellipse(cx, 14, 3, 3, tone('cold', 0));
    img.put(cx, 14, tone('red', 4));
  }
  img.rect(15, 18, 2, 2, tone('cold', 1));
  return finish(img);
}

function bubble(img, x, y, w, h, ramp, tailLeft) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
      if (!corner) img.put(x + i, y + j, j < 2 ? tone(ramp, 4) : tone(ramp, 3));
    }
  const tx = tailLeft ? x + 3 : x + w - 6;
  for (let k = 0; k < 4; k++) img.hline(tx + (tailLeft ? 0 : k), tx + 3 - (tailLeft ? k : 0), y + h + k, tone(ramp, 3));
}

function whisper() {
  const img = new Img(32, 32);
  bubble(img, 8, 5, 20, 13, 'purple', true);
  for (const x of [12, 17, 22]) img.rect(x, 10, 3, 3, tone('metal', 8));
  // an ear-like spiral of sound waves on the left
  for (const r of [3, 6]) for (let a = -0.9; a <= 0.9; a += 0.08) img.put(Math.round(6 - Math.cos(a) * r + r), Math.round(24 + Math.sin(a) * r), tone('purple', 5));
  return finish(img);
}

function rumor() {
  const img = new Img(32, 32);
  bubble(img, 3, 3, 17, 11, 'pink', true);
  bubble(img, 12, 14, 17, 11, 'pink', false);
  img.rect(10, 5, 3, 5, tone('metal', 8));
  img.rect(10, 11, 3, 2, tone('metal', 8));
  for (const x of [16, 20, 24]) img.rect(x, 19, 2, 2, tone('red', 1));
  return finish(img);
}

function createCharacter() {
  const img = new Img(32, 32);
  ball(img, 13, 9, 6, 'teal', 2, 5);
  for (let y = 16; y < 29; y++) {
    const half = Math.min(9, 4 + (y - 16));
    for (let x = 13 - half; x <= 13 + half; x++) img.put(x, y, x < 10 ? tone('teal', 4) : tone('teal', 3));
  }
  img.rect(20, 18, 10, 10, tone('green', 4));
  img.rect(23, 19, 4, 8, tone('metal', 8));
  img.rect(21, 21, 8, 4, tone('metal', 8));
  return finish(img);
}

/** Power icons, 32x32, keyed by PowerType. */
export function paintPowerIcons() {
  return { drought: drought(), storm: storm(), grant: grant(), kill: kill(), whisper: whisper(), rumor: rumor(), create_character: createCharacter() };
}

/** Resource icons, 24x24, keyed by ResourceId. */
export function paintResourceIcons() {
  const food = new Img(24, 24);
  ball(food, 12, 14, 8, 'red', 2, 4);
  food.put(8, 10, tone('metal', 8));
  food.put(9, 9, tone('metal', 8));
  for (const [dx, dy] of [[-3, -1], [0, -2], [3, -1]]) food.ellipse(12 + dx, 6 + dy, 2, 1, tone('green', 4));
  food.vline(12, 3, 6, tone('green', 2));
  const water = new Img(24, 24);
  for (let y = 2; y < 22; y++) {
    const t = (y - 2) / 20;
    const half = t < 0.55 ? Math.round(t * 13) : Math.round(Math.sqrt(1 - ((t - 0.72) / 0.28) ** 2) * 8);
    for (let x = 12 - half; x <= 12 + half; x++) water.put(x, y, x < 10 && y > 10 ? tone('blue', 5) : x > 14 ? tone('blue', 3) : tone('blue', 4));
  }
  water.vline(8, 12, 16, tone('ice', 4));
  water.put(9, 11, tone('ice', 4));
  const parts = new Img(24, 24);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    parts.rect(Math.round(12 + Math.cos(ang) * 8) - 2, Math.round(12 + Math.sin(ang) * 8) - 2, 4, 4, tone('metal', 5));
  }
  ball(parts, 12, 12, 8, 'metal', 4, 7);
  parts.ellipse(12, 12, 3, 3, tone('metal', 2));
  parts.ellipse(12, 12, 1, 1, tone('orange', 4));
  const medicine = new Img(24, 24);
  for (let y = 5; y < 21; y++) for (let x = 3; x < 21; x++) medicine.put(x, y, y < 8 ? tone('metal', 8) : x < 6 ? tone('metal', 8) : tone('metal', 7));
  medicine.rect(9, 3, 6, 3, tone('metal', 5));
  medicine.rect(10, 8, 4, 10, tone('red', 3));
  medicine.rect(7, 11, 10, 4, tone('red', 3));
  medicine.vline(10, 8, 17, tone('red', 4));
  const credits = new Img(24, 24);
  ball(credits, 12, 12, 9, 'yellow', 2, 4);
  credits.ellipse(12, 12, 6, 6, (i, j, d) => (d > 0.75 ? tone('yellow', 2) : null));
  credits.vline(12, 8, 16, tone('yellow', 1));
  credits.hline(10, 14, 9, tone('yellow', 1));
  credits.hline(10, 14, 15, tone('yellow', 1));
  credits.put(9, 7, tone('metal', 8));
  return { food: finish(food), water: finish(water), parts: finish(parts), medicine: finish(medicine), credits: finish(credits) };
}

/** A memorial marker on a small mound, with a little blue light. */
export function paintGrave() {
  const img = new Img(24, 28);
  img.ellipse(12, 24, 10, 3, tone('regolith', 6));
  img.ellipse(12, 24, 8, 2, tone('regolith', 7));
  for (let y = 5; y < 23; y++)
    for (let x = 7; x < 17; x++) {
      const round = y < 8 && (x - 12 + 0.5) ** 2 + (y - 8) ** 2 * 1.6 > 26;
      if (round) continue;
      img.put(x, y, x < 9 ? tone('metal', 7) : x > 14 ? tone('metal', 4) : tone('metal', 6));
    }
  img.rect(10, 11, 4, 2, tone('metal', 3));
  img.rect(11, 9, 2, 7, tone('metal', 3));
  img.rect(9, 18, 6, 1, tone('metal', 4));
  img.rect(18, 20, 2, 3, tone('metal', 5));
  img.put(18, 19, tone('teal', 5));
  img.outline(() => INK, false);
  const out = new Img(24, 28);
  out.ellipse(14, 25, 10, 2, fade(INK, 90));
  out.blit(img, 0, 0);
  out.set(18, 18, fade(tone('teal', 5), 120));
  out.set(19, 19, fade(tone('teal', 5), 80));
  return out;
}

/** The pointer over the selected colonist: a chunky down chevron. */
export function paintSelection() {
  const img = new Img(16, 14);
  const rows = ['.yyyyyyyyyyyy.', '.YYYYYYYYYYYy.', '..YYYYYYYYYy..', '...YYYYYYYy...', '....YYYYYy....', '.....YYYy.....', '......Yy......'];
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === 'Y') img.put(i + 1, j + 3, tone('yellow', 4));
    if (ch === 'y') img.put(i + 1, j + 3, tone('yellow', 2));
  }));
  img.hline(3, 12, 4, tone('metal', 8));
  img.outline(() => INK, true);
  return img;
}

/** Seamless 128x128 storm streaks travelling down-left, bright heads and fading tails. */
export function paintStormOverlay() {
  const img = new Img(128, 128);
  const r = rng(21);
  for (let n = 0; n < 34; n++) {
    const x = Math.floor(r() * 128);
    const y = Math.floor(r() * 128);
    const len = 8 + Math.floor(r() * 16);
    const hot = r() < 0.35;
    for (let t = 0; t < len; t++) {
      const k = 1 - t / len;
      const c = hot ? (t < 2 ? tone('yellow', 4) : tone('orange', 4)) : t < 2 ? tone('metal', 8) : tone('ice', 3);
      const px = (((x + t) % 128) + 128) % 128;
      const py = (((y - t) % 128) + 128) % 128;
      img.set(px, py, fade(c, Math.round((hot ? 230 : 170) * k)));
      if (t < len / 2) img.set(px, (py + 1) % 128, fade(c, Math.round(80 * k)));
    }
  }
  for (let n = 0; n < 60; n++) img.set(Math.floor(r() * 128), Math.floor(r() * 128), fade(tone('metal', 7), 90));
  return img;
}

/** Seamless 128x128 dry haze: drifting warm dust wisps and specks, all faint. */
export function paintDroughtOverlay() {
  const img = new Img(128, 128);
  const r = rng(33);
  for (let n = 0; n < 26; n++) {
    const x = Math.floor(r() * 128);
    const y = Math.floor(r() * 128);
    const len = 10 + Math.floor(r() * 26);
    for (let t = 0; t < len; t++) {
      const a = Math.round(42 * Math.sin((t / len) * Math.PI));
      img.set((x + t) % 128, (y + Math.round(Math.sin(t / 5) * 1.5) + 128) % 128, fade(tone('orange', 4), a));
    }
  }
  for (let n = 0; n < 140; n++) {
    const x = Math.floor(r() * 128);
    const y = Math.floor(r() * 128);
    img.set(x, y, fade(hash2(x, y, 2) < 0.5 ? tone('yellow', 4) : tone('orange', 3), 60 + Math.floor(r() * 70)));
  }
  return img;
}
