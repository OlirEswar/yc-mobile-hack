/**
 * Production and supply: hydroponics, depot, workshop and medbay.
 */
import { Building, INK, RAMPS, box, cylinder, fade, fill, glow, hash2, screen, spaceWindow, stool, tone, wallLamp } from './kit.mjs';
import { goods, panelFace } from './civic.mjs';

/** A grow rack: a white trough full of plants, with a grow-light strip on its front. */
function growRack(img, x, y, w, seed) {
  box(img, x, y, w, 12, 8, 'metal', 6, {
    frontFn: (i, j) => (j === 3 ? tone('purple', 4) : j === 4 ? tone('purple', 2) : null),
  });
  img.rect(x + 1, y + 1, w - 2, 10, tone('brown', 1));
  // two staggered rows of leafy heads, lit from the upper left; some stretches carry fruit
  for (const [row, dy] of [[0, 3], [1, 7]])
    for (let i = 4 + row * 4; i < w - 3; i += 8) {
      const cx = x + i;
      const cy = y + dy;
      const fruit = hash2(Math.floor(i / 24), row, seed) < 0.35;
      img.ellipse(cx, cy, 3.5, 2.5, (a, b2) => (a + b2 < -2 ? tone('green', 5) : a + b2 < 1 ? tone('green', 4) : tone('green', 3)));
      img.put(cx + 2, cy + 2, tone('green', 2));
      img.put(cx - 1, cy - 2, tone('green', 5));
      if (fruit) {
        img.put(cx + 1, cy, tone('red', 4));
        img.put(cx - 2, cy + 1, hash2(i, row, seed + 2) < 0.5 ? tone('orange', 4) : tone('red', 3));
      }
    }
}

export function paintHydroponics() {
  const b = new Building('hydroponics');
  const { base, overlay, w } = b;
  b.shell({
    top: ['metal', 6],
    face: (x, y, d) => {
      if (d >= 26) return tone('green', 0);
      if (d === 0) return tone('metal', 7);
      if (d === 5 || d === 6) return tone('teal', d === 5 ? 4 : 2);
      if (d === 14 || d === 15) return tone('blue', d === 14 ? 4 : 2);
      return x % 30 === 0 ? tone('metal', 4) : tone('metal', d < 12 ? 6 : 5);
    },
    floor: (x, y) => {
      if (x % 4 === 0 || y % 4 === 0) return tone('metal', 2);
      return (x + y) % 8 < 4 ? tone('metal', 3) : tone('teal', 1);
    },
  });
  b.paintDoors();
  // nutrient tanks and pipe valves on the back wall
  for (const tx of [40, 160, 280]) {
    cylinder(base, tx, 24, 9, 4, 20, 'teal', 4, { shadow: false });
    base.rect(tx - 3, 30, 6, 6, fade(RAMPS.teal[5], 120));
  }
  for (const vx of [90, 210, 330]) {
    base.rect(vx - 2, 34, 5, 5, tone('red', 3));
    base.put(vx, 36, tone('red', 4));
  }
  // grow racks in four rows, each split into two runs with a gap to pass through
  const rows = [52, 110, 164, 218];
  rows.forEach((ry, r) => {
    growRack(base, 18, ry, 160, r * 3 + 1);
    growRack(base, 196, ry, w - 196 - 18, r * 3 + 2);
    glow(base, 98, ry + 22, 80, 6, RAMPS.purple[4], 50);
    glow(base, 280, ry + 22, 80, 6, RAMPS.purple[4], 50);
  });
  // drain grates in the aisles
  for (const [ry] of rows.map((r) => [r])) for (let gx = 40; gx < w - 30; gx += 96) base.rect(gx, ry + 36, 8, 3, tone('metal', 1));
  // overlay: grow-light bars hovering over each rack, and the greenhouse roof ribs
  rows.forEach((ry) => {
    for (const [x0, x1] of [[22, 174], [200, w - 22]]) {
      overlay.rect(x0, ry - 16, x1 - x0, 3, tone('metal', 2));
      overlay.hline(x0, x1 - 1, ry - 14, tone('purple', 5));
      for (let k = 1; k < 6; k++) overlay.hline(x0 + k, x1 - 1 - k, ry - 14 + k, fade(RAMPS.purple[4], 36 - k * 6));
    }
  });
  for (let x = 48; x < w - 20; x += 64) for (let y = 22; y < 270; y++) overlay.set(x, y, fade(RAMPS.ice[3], y % 6 < 3 ? 34 : 18));
  return b;
}

export function paintDepot() {
  const b = new Building('depot');
  const { base, overlay, w, h } = b;
  b.shell({
    top: ['metal', 5],
    face: panelFace('metal', 4, 20),
    hull: ['metal', 3],
    floor: (x, y) => {
      if (x % 24 === 0 || y % 24 === 0) return tone('floor', 1);
      return hash2(x >> 2, y >> 2, 3) < 0.15 ? tone('floor', 2) : tone('floor', 3);
    },
  });
  b.paintDoors({ doorFloor: () => tone('floor', 2) });
  // hazard lanes marking the crossing aisles
  const cx = w / 2;
  for (let x = 16; x < w - 16; x++) {
    if (Math.abs(x - cx) < 12) continue;
    base.put(x, 82, Math.floor(x / 4) % 2 ? tone('yellow', 3) : INK);
    base.put(x, 110, Math.floor(x / 4) % 2 ? tone('yellow', 3) : INK);
  }
  for (let y = 54; y < h - 16; y++) {
    if (Math.abs(y - 96) < 16) continue;
    base.put(cx - 18, y, Math.floor(y / 4) % 2 ? tone('yellow', 3) : INK);
    base.put(cx + 18, y, Math.floor(y / 4) % 2 ? tone('yellow', 3) : INK);
  }
  // shelving on the back wall either side of the door
  for (const sx of [14, 136]) {
    for (let s = 0; s < 3; s++) {
      base.rect(sx, 27 + s * 8, 74, 2, tone('metal', 6));
      for (let i = 0; i < 9; i++) {
        const ramp = ['green', 'blue', 'orange', 'brown'][(i + s + sx) % 4];
        base.rect(sx + 2 + i * 8, 22 + s * 8, 6, 5, tone(ramp, 3));
        base.hline(sx + 2 + i * 8, sx + 7 + i * 8, 22 + s * 8, tone(ramp, 4));
      }
    }
  }
  // crate stacks: food (green), water (blue barrels), parts (orange), left and right of the lanes
  const crate = (x, y, ramp) =>
    box(base, x, y, 16, 6, 10, ramp, 3, {
      frontFn: (i, j) => (j === 4 || i === 7 ? tone(ramp, 1) : null),
      topFn: (i, j) => (i === 7 || j === 3 ? tone(ramp, 2) : null),
    });
  for (const [x, y, ramp] of [[14, 54, 'green'], [32, 54, 'green'], [14, 40, 'green'], [50, 58, 'brown'], [14, 114, 'orange'], [32, 114, 'orange'], [14, 132, 'orange'], [32, 132, 'brown'], [14, 150, 'green'], [176, 54, 'orange'], [194, 54, 'orange'], [176, 114, 'green'], [194, 114, 'green'], [194, 132, 'brown']])
    crate(x, y, ramp);
  for (const [x, y] of [[188, 140], [200, 158], [182, 166], [50, 156]]) cylinder(base, x, y, 6, 3, 10, 'blue', 3);
  // a parked loader bot
  box(base, 180, 156, 20, 10, 8, 'yellow', 3);
  base.rect(184, 151, 12, 6, tone('metal', 2));
  base.rect(186, 152, 8, 3, tone('teal', 4));
  base.rect(178, 170, 4, 3, INK);
  base.rect(198, 170, 4, 3, INK);
  // quartermaster's terminal
  box(base, 70, 58, 18, 6, 9, 'metal', 6);
  screen(base, 72, 54, 14, 5, 'teal', 7);
  // overhead lamps
  for (const [lx, ly] of [[60, 70], [164, 70], [60, 150], [164, 150]]) {
    overlay.rect(lx - 5, ly - 40, 10, 3, tone('metal', 2));
    overlay.hline(lx - 4, lx + 4, ly - 37, tone('yellow', 4));
    glow(overlay, lx, ly - 10, 16, 8, RAMPS.yellow[4], 26);
  }
  return b;
}

/** A 3D printer: a glass-fronted cabinet with a glowing build plate and a part in progress. */
function printer(img, x, y, ramp) {
  box(img, x, y, 34, 8, 24, 'metal', 6, {
    frontFn: (i, j) => {
      if (i >= 4 && i < 30 && j >= 3 && j < 18) {
        if (j >= 15) return tone(ramp, 4);
        if (i >= 13 && i < 21 && j >= 9) return tone('metal', 7 - ((j + i) % 2));
        if (j === 3 && i === 17) return tone(ramp, 5);
        return j % 4 === 0 ? tone('cold', 3) : tone('cold', 2);
      }
      if (j === 20 && i > 24 && i < 30) return tone('green', 5);
      return null;
    },
  });
  img.vline(x + 17, y + 11, y + 18, tone('metal', 5));
  glow(img, x + 17, y + 24, 14, 4, RAMPS[ramp][4], 60);
}

export function paintWorkshop() {
  const b = new Building('workshop');
  const { base, overlay, w } = b;
  b.shell({
    top: ['metal', 5],
    face: (x, y, d) => {
      if (d >= 26) return tone('metal', 1);
      if (d === 0) return tone('metal', 6);
      if ((x % 6 === 2 && d % 6 === 3) || d === 13) return tone('metal', 2);
      return tone('metal', d < 13 ? 4 : 3);
    },
    floor: (x, y) => {
      if (x % 32 === 0 || y % 32 === 0) return tone('metal', 1);
      if ((x % 32 === 3 || x % 32 === 28) && (y % 32 === 3 || y % 32 === 28)) return tone('metal', 5);
      return ((x >> 5) + (y >> 5)) % 2 ? tone('metal', 2) : tone('metal', 3);
    },
  });
  b.paintDoors({ doorFloor: () => tone('metal', 2) });
  // tool wall: hanging wrenches, hammers and a red fire box
  for (let i = 0; i < 12; i++) {
    const tx = 28 + i * 9;
    const len = 6 + (i % 3) * 2;
    base.vline(tx, 26, 26 + len, tone('metal', 7));
    base.rect(tx - 1, 26 + len, 3, 2, i % 4 === 0 ? tone('red', 3) : tone('metal', 6));
  }
  base.rect(140, 26, 10, 12, tone('red', 2));
  base.rect(141, 27, 8, 10, tone('red', 3));
  base.rect(143, 29, 4, 6, tone('red', 4));
  wallLamp(base, 160, 24, 10, 'orange');
  // the forge: a furnace in the north-east corner with molten metal
  box(base, 214, 26, 56, 14, 26, 'metal', 4, {
    frontFn: (i, j) => {
      if (i >= 16 && i < 40 && j >= 6 && j < 20) return j < 9 ? tone('orange', 3) : j < 14 ? tone('yellow', 4) : tone('orange', 4);
      if ((i === 4 || i === 51) && j > 2) return tone('metal', 1);
      return null;
    },
  });
  base.rect(232, 18, 20, 10, tone('metal', 2));
  base.rect(236, 12, 12, 8, tone('metal', 3));
  glow(base, 242, 76, 40, 12, RAMPS.orange[4], 90);
  glow(base, 242, 62, 18, 8, RAMPS.yellow[4], 110);
  // a crucible on a stand
  cylinder(base, 200, 70, 7, 3, 8, 'metal', 4);
  base.ellipse(200, 70, 5, 2, tone('orange', 4));
  // printers along the back wall
  printer(base, 18, 50, 'teal');
  printer(base, 64, 50, 'orange');
  printer(base, 110, 50, 'teal');
  printer(base, 156, 50, 'green');
  // workbenches with tools and a robot arm in the middle row
  for (const bx of [24, 156]) {
    box(base, bx, 140, 104, 12, 10, 'brown', 4, { frontFn: (i, j) => (i % 26 === 0 ? tone('brown', 1) : null) });
    goods(base, bx + 6, 145, 30, 'parts');
    base.rect(bx + 50, 144, 10, 3, tone('metal', 7));
    base.rect(bx + 70, 143, 6, 6, tone('red', 2));
  }
  // robot arm: base, two links and a gripper, on the left bench
  cylinder(base, 104, 144, 5, 2, 4, 'yellow', 3, { shadow: false });
  for (let t = 0; t < 14; t++) {
    base.rect(104 - Math.round(t * 0.4), 140 - t, 3, 2, tone('yellow', t < 2 ? 4 : 3));
  }
  for (let t = 0; t < 12; t++) base.rect(98 + t, 127 + Math.round(t * 0.3), 3, 2, tone('yellow', 3));
  base.rect(109, 130, 4, 5, tone('metal', 2));
  // parts bins by the south wall
  for (let i = 0; i < 4; i++) box(base, 240 + (i % 2) * 20, 186 + Math.floor(i / 2) * 22, 16, 6, 7, ['orange', 'blue', 'metal', 'green'][i], 3);
  // overlay: gantry crane beam with a hook, and forge sparks
  overlay.rect(16, 104, w - 32, 4, tone('yellow', 3));
  overlay.hline(16, w - 17, 104, tone('yellow', 4));
  overlay.hline(16, w - 17, 107, tone('yellow', 1));
  for (let x = 20; x < w - 20; x += 8) overlay.put(x, 105, INK);
  overlay.rect(150, 101, 14, 10, tone('metal', 3));
  overlay.vline(157, 111, 120, tone('metal', 6));
  overlay.rect(155, 120, 5, 3, tone('metal', 5));
  for (let k = 0; k < 14; k++) overlay.put(222 + ((k * 13) % 40), 34 + ((k * 7) % 22), k % 3 ? tone('yellow', 4) : tone('orange', 4));
  return b;
}

/** A clinic bed seen from the foot end: headboard against the wall, sheets, pillow, blanket. */
function bed(img, x, y, blanket) {
  img.rect(x + 2, y + 36, 18, 2, fade(INK, 90));
  box(img, x, y, 18, 4, 4, 'metal', 6, { shadow: false });
  img.rect(x, y + 8, 18, 26, tone('metal', 8));
  img.vline(x, y + 8, y + 33, tone('metal', 6));
  img.vline(x + 17, y + 8, y + 33, tone('metal', 5));
  img.rect(x + 3, y + 9, 12, 5, tone('ice', 4));
  img.hline(x + 3, x + 14, y + 13, tone('metal', 6));
  img.rect(x + 1, y + 18, 16, 15, tone(blanket, 3));
  img.hline(x + 1, x + 16, y + 18, tone(blanket, 4));
  img.hline(x + 1, x + 16, y + 32, tone(blanket, 1));
  img.rect(x, y + 34, 18, 3, tone('metal', 3));
  img.frame(x - 1, y - 1, 20, 39, tone('metal', 1));
}

export function paintMedbay() {
  const b = new Building('medbay');
  const { base, overlay, w } = b;
  b.shell({
    top: ['metal', 7],
    face: panelFace('metal', 7, 16),
    hull: ['metal', 4],
    floor: (x, y) => {
      if (x % 12 === 0 || y % 12 === 0) return tone('metal', 6);
      return tone('metal', 7);
    },
  });
  b.paintDoors({ doorFloor: () => tone('metal', 6) });
  // red cross set into the floor at the hub
  const cx = w / 2;
  const cy = 96;
  base.rect(cx - 18, cy - 18, 36, 36, fade(tone('metal', 8), 255));
  base.rect(cx - 6, cy - 15, 12, 30, tone('red', 3));
  base.rect(cx - 15, cy - 6, 30, 12, tone('red', 3));
  base.rect(cx - 5, cy - 14, 2, 28, tone('red', 4));
  base.rect(cx - 14, cy - 5, 28, 2, tone('red', 4));
  base.frame(cx - 18, cy - 18, 36, 36, tone('metal', 5));
  // back wall: cabinets, a heart monitor and the cross sign either side of the door
  for (const [sx, flip] of [[18, false], [140, true]]) {
    base.rect(sx, 24, 22, 20, tone('metal', 8));
    base.frame(sx, 24, 22, 20, tone('metal', 4));
    base.vline(sx + 11, 25, 42, tone('metal', 5));
    for (let i = 0; i < 4; i++) base.rect(sx + 2 + i * 5, 30, 3, 4, [tone('red', 3), tone('ice', 3), tone('green', 4), tone('yellow', 4)][i]);
    screen(base, sx + 28, 26, 20, 10, 'green', flip ? 3 : 2);
    base.rect(sx + 52, 26, 14, 14, tone('metal', 8));
    base.rect(sx + 57, 28, 4, 10, tone('red', 3));
    base.rect(sx + 54, 31, 10, 4, tone('red', 3));
  }
  // beds along the north wall with monitors and IV stands
  const blankets = ['blue', 'teal', 'blue', 'teal'];
  [14, 40, 148, 174].forEach((bx, i) => {
    bed(base, bx + 4, 50, blankets[i]);
    base.vline(bx + 25, 50, 64, tone('metal', 6));
    base.rect(bx + 23, 48, 5, 4, tone('ice', 3));
  });
  // a scanner pod on the floor near the west wall
  box(base, 16, 132, 30, 10, 8, 'metal', 7);
  base.rect(20, 134, 22, 6, tone('teal', 4));
  base.hline(20, 41, 134, tone('teal', 5));
  // overlay: surgical lamp over a bed and ceiling panels
  overlay.ellipse(28, 46, 9, 4, tone('metal', 6));
  overlay.ellipse(28, 46, 6, 2, tone('ice', 4));
  glow(overlay, 28, 66, 16, 10, RAMPS.ice[4], 40);
  for (const lx of [62, 162]) {
    overlay.rect(lx - 10, 104, 20, 3, tone('metal', 7));
    overlay.hline(lx - 9, lx + 9, 106, tone('ice', 4));
  }
  return b;
}
