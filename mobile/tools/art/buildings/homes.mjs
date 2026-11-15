/**
 * Where the colonists sleep: Habitat Ring A (older family quarters) and Ring B (newer bunks).
 */
import { Building, INK, RAMPS, box, fade, hash2, plant, screen, spaceWindow, stool, tone, wallLamp } from './kit.mjs';

/** A low partition wall running south from the back wall, seen from above with a short front face. */
function partition(img, x, y0, y1) {
  img.rect(x, y0, 4, y1 - y0, tone('metal', 6));
  img.vline(x, y0, y1 - 1, tone('metal', 7));
  img.vline(x + 3, y0, y1 - 1, tone('metal', 4));
  img.rect(x, y1, 4, 6, tone('metal', 3));
  img.hline(x, x + 3, y1 + 6, tone('metal', 1));
  img.rect(x + 4, y0, 2, y1 - y0 + 6, fade(INK, 70));
}

/** A bed lying along the back wall: headboard on the left, pillow, blanket in the family colour. */
function familyBed(img, x, y, w, blanket, double) {
  const d = double ? 22 : 14;
  img.rect(x + 2, y + d + 5, w, 2, fade(INK, 80));
  img.rect(x, y, w, d, tone('ice', 4));
  img.rect(x, y + d, w, 5, tone('brown', 2));
  img.rect(x - 3, y - 2, 4, d + 7, tone('brown', 3));
  img.vline(x - 3, y - 2, y + d + 4, tone('brown', 4));
  img.rect(x + 2, y + 2, 7, d - 4, tone('metal', 8));
  if (double) img.hline(x + 2, x + 8, y + d / 2, tone('metal', 6));
  img.rect(x + 11, y, w - 11, d, tone(blanket, 3));
  img.hline(x + 11, x + w - 1, y, tone(blanket, 4));
  for (let i = x + 13; i < x + w - 1; i += 4) img.vline(i, y + 2, y + d - 2, tone(blanket, 2));
  img.frame(x - 4, y - 3, w + 5, d + 9, tone('brown', 0));
}

export function paintHabitatA() {
  const b = new Building('habitat_a');
  const { base, overlay, w } = b;
  b.shell({
    top: ['metal', 5],
    face: (x, y, d) => {
      if (d >= 25) return tone('brown', 1);
      if (d === 0) return tone('floor', 6);
      const patch = hash2(Math.floor(x / 22), 0, 4) < 0.3 && d > 10 && d < 20;
      if (x % 22 === 0) return tone('floor', 3);
      return patch ? tone('orange', 2) : tone('floor', d < 12 ? 5 : 4);
    },
    floor: (x, y) => {
      const plank = Math.floor(y / 6);
      const seam = (x + plank * 17) % 40 === 0;
      if (y % 6 === 0 || seam) return tone('brown', 2);
      return hash2(x >> 3, plank, 2) < 0.4 ? tone('brown', 4) : tone('brown', 3);
    },
  });
  b.paintDoors({ doorFloor: () => tone('brown', 3) });
  // five family rooms along the back wall
  const blankets = ['red', 'teal', 'yellow', 'purple', 'green'];
  for (let r = 0; r < 5; r++) {
    const rx = 12 + r * 66;
    if (r > 0) partition(base, rx - 4, 50, 104);
    // poster or window on the back wall
    if (r % 2 === 0) spaceWindow(base, rx + 34, 26, 18, 12, 20 + r);
    else {
      base.rect(rx + 36, 25, 14, 18, tone(blankets[(r + 2) % 5], 2));
      base.rect(rx + 38, 27, 10, 9, tone(blankets[(r + 3) % 5], 4));
      base.hline(rx + 38, rx + 47, 39, tone('metal', 8));
    }
    base.rect(rx + 6, 30, 20, 2, tone('brown', 4));
    for (let i = 0; i < 4; i++) base.rect(rx + 8 + i * 4, 25, 3, 5, tone(blankets[(i + r) % 5], 3));
    familyBed(base, rx + 8, 58, 40, blankets[r], r % 2 === 0);
    if (r % 2 === 1) {
      // a child's cot
      base.rect(rx + 40, 86, 14, 10, tone('ice', 4));
      base.frame(rx + 39, 85, 16, 12, tone('brown', 3));
      base.rect(rx + 46, 87, 7, 8, tone(blankets[(r + 1) % 5], 4));
    } else plant(base, rx + 50, 96, 1);
  }
  // middle row: dining table with chairs, sofa and a low table, a kitchenette
  box(base, 30, 162, 100, 12, 8, 'brown', 4);
  for (let i = 0; i < 6; i++) {
    stool(base, 40 + i * 16, 158, 'brown', 3);
    base.ellipse(40 + i * 16, 167, 2, 1, tone('metal', 8));
  }
  box(base, 190, 158, 70, 8, 10, 'teal', 3, { frontFn: (i, j) => (i % 23 === 0 ? tone('teal', 1) : null) });
  box(base, 264, 158, 12, 18, 10, 'teal', 3);
  box(base, 206, 182, 30, 6, 4, 'brown', 4);
  box(base, 296, 152, 40, 8, 18, 'metal', 6, { topFn: (i, j) => (i > 26 && i < 34 && j > 2 && j < 6 ? tone('metal', 2) : null) });
  // a round rug in the common area and a few toys
  base.ellipse(176, 228, 56, 24, (i, j, d) => (d > 0.85 ? tone('red', 2) : d > 0.6 ? tone('orange', 3) : d > 0.35 ? tone('red', 3) : tone('yellow', 3)));
  for (const [tx, ty, ramp] of [[150, 220, 'blue'], [196, 234, 'yellow'], [88, 240, 'green']]) {
    base.rect(tx, ty, 4, 4, tone(ramp, 4));
    base.put(tx, ty, tone(ramp, 5));
  }
  wallLamp(base, 20, 23, 8);
  // overlay: a washing line across the corridor with clothes drying
  for (let x = 30; x < 320; x++) overlay.put(x, 112 + Math.round(Math.sin(((x - 30) / 290) * Math.PI) * 5), tone('metal', 6));
  const clothes = ['red', 'blue', 'yellow', 'teal', 'pink', 'green', 'purple'];
  for (let i = 0; i < 11; i++) {
    const cx = 44 + i * 25;
    const cy = 113 + Math.round(Math.sin(((cx - 30) / 290) * Math.PI) * 5);
    const ramp = clothes[i % clothes.length];
    overlay.rect(cx, cy, 8, i % 3 === 0 ? 10 : 7, tone(ramp, 3));
    overlay.hline(cx, cx + 7, cy, tone(ramp, 4));
    overlay.put(cx + 1, cy - 1, tone('metal', 7));
    overlay.put(cx + 6, cy - 1, tone('metal', 7));
  }
  return b;
}

/** A two-tier bunk bed against a wall: the upper bunk on the frame top, the lower on its front. */
function bunk(img, x, y, ramp) {
  // ladder up the right end
  for (let j = 0; j < 36; j++) img.put(x + 37, y + j, tone('metal', 7));
  for (let j = 3; j < 36; j += 5) img.hline(x + 36, x + 39, y + j, tone('metal', 6));
  for (let j = 0; j < 36; j++) img.put(x + 40, y + j, tone('metal', 4));
  box(img, x, y, 36, 10, 26, 'metal', 6, {
    topFn: (i, j) => (i > 1 && i < 34 && j > 1 && j < 9 ? (i < 9 ? tone('metal', 8) : tone(ramp, j === 2 ? 4 : 3)) : null),
    frontFn: (i, j) => {
      if (i > 1 && i < 34 && j > 4 && j < 22) {
        if (j < 7) return tone('metal', 1);
        if (i < 9) return tone('metal', 8);
        return tone(ramp, j === 7 ? 3 : 2);
      }
      if (i === 34 && j % 3 === 0) return tone('metal', 8);
      return null;
    },
  });
}

/** A tall locker with a vent and a status light. */
function locker(img, x, y, ramp) {
  box(img, x, y, 12, 4, 30, ramp, 3, {
    frontFn: (i, j) => (j > 3 && j < 7 && i > 2 && i < 9 && j % 2 === 0 ? tone(ramp, 1) : i === 9 && j === 15 ? tone('green', 5) : null),
  });
}

export function paintHabitatB() {
  const b = new Building('habitat_b');
  const { base, overlay, w } = b;
  b.shell({
    top: ['metal', 7],
    face: (x, y, d) => {
      if (d >= 26) return tone('teal', 1);
      if (d === 0) return tone('metal', 8);
      if (d === 16 || d === 17) return tone('teal', d === 16 ? 4 : 3);
      return x % 20 === 0 ? tone('metal', 6) : tone('metal', 7);
    },
    floor: (x, y) => {
      if (x % 16 === 0 || y % 16 === 0) return tone('metal', 4);
      return (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? tone('metal', 5) : tone('metal', 6);
    },
  });
  b.paintDoors({ doorFloor: () => tone('metal', 5) });
  // bunks and lockers along the back wall
  const ramps = ['blue', 'teal', 'purple', 'orange', 'green', 'red', 'blue'];
  let x = 14;
  for (let i = 0; i < 7; i++) {
    if (i % 2 === 1) {
      locker(base, x, 34, ['teal', 'blue', 'metal'][i % 3]);
      x += 16;
    }
    bunk(base, x, 52, ramps[i]);
    x += 40;
    if (x > w - 54) break;
  }
  // a free-standing row of bunks in the middle with a vending machine and lockers
  for (let i = 0; i < 4; i++) bunk(base, 40 + i * 44, 148, ramps[(i + 3) % 7]);
  box(base, 228, 140, 22, 8, 36, 'red', 3, {
    frontFn: (i, j) => (i > 2 && i < 15 && j > 3 && j < 22 ? (j % 5 === 0 ? tone('metal', 3) : tone('ice', (i + j) % 3 ? 3 : 4)) : i > 16 && i < 20 && j > 6 && j < 16 ? tone('metal', 1) : null),
  });
  locker(base, 256, 146, 'teal');
  locker(base, 270, 146, 'blue');
  locker(base, 284, 146, 'teal');
  // lounge: a rug and a screen on the side
  base.rect(70, 214, 200, 40, tone('blue', 2));
  base.frame(70, 214, 200, 40, tone('blue', 1));
  base.frame(73, 217, 194, 34, tone('teal', 3));
  for (let i = 80; i < 262; i += 10) {
    base.put(i, 234, tone('teal', 4));
    base.put(i + 1, 233, tone('teal', 3));
    base.put(i + 1, 235, tone('teal', 3));
  }
  spaceWindow(base, 300, 28, 24, 12, 31);
  screen(base, 24, 26, 20, 10, 'blue', 9);
  // overlay: ceiling light strips
  for (const ly of [118, 200]) {
    overlay.rect(40, ly, w - 80, 2, tone('metal', 7));
    for (let x2 = 44; x2 < w - 44; x2 += 4) overlay.put(x2, ly + 1, tone('teal', 5));
    for (let k = 1; k < 4; k++) overlay.hline(40, w - 41, ly + 1 + k, fade(RAMPS.teal[5], 22 - k * 6));
  }
  return b;
}
