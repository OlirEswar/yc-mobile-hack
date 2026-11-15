/**
 * The social heart of the colony: canteen, plaza and market.
 */
import { Building, INK, RAMPS, box, cylinder, fade, fill, glow, hash2, screen, spaceWindow, stool, tone, tree, wallLamp } from './kit.mjs';

/** Wall face with panels: ramp colours by depth, a seam every `seam` px and a dark skirting board. */
export function panelFace(ramp, k, seam = 24) {
  return (x, y, d) => {
    if (d >= 26) return tone(ramp, k - 3);
    if (d >= 24) return tone(ramp, k - 2);
    if (d === 0) return tone(ramp, k + 1);
    if (x % seam === 0) return tone(ramp, k - 1);
    if (d === 9) return tone(ramp, k - 1);
    if (d === 8) return tone(ramp, k + 1);
    return d < 8 ? tone(ramp, k) : tone(ramp, k - (d > 18 ? 1 : 0));
  };
}

export function paintCanteen() {
  const b = new Building('canteen');
  const { base, overlay } = b;
  b.shell({
    top: ['metal', 6],
    face: panelFace('teal', 2, 32),
    floor: (x, y) => {
      const cx = Math.floor(x / 8);
      const cy = Math.floor(y / 8);
      if (x % 8 === 0 || y % 8 === 0) return tone('floor', 2);
      return (cx + cy) % 2 ? tone('floor', 4) : tone('floor', 3);
    },
  });
  b.paintDoors();
  // back wall: windows, menu board, bottle shelves, kitchen tiles
  spaceWindow(base, 22, 26, 22, 14, 3);
  spaceWindow(base, 192, 26, 22, 14, 4);
  screen(base, 92, 26, 34, 12, 'orange', 2);
  for (let s = 0; s < 2; s++) {
    const sy = 40 + s * 0;
    base.rect(52, sy, 32, 2, tone('brown', 4));
    base.hline(52, 83, sy + 2, tone('brown', 1));
    for (let i = 0; i < 9; i++) {
      const bx = 53 + i * 3 + s;
      const col = [RAMPS.green[4], RAMPS.red[3], RAMPS.yellow[3], RAMPS.teal[4], RAMPS.purple[4]][(i * 7 + s) % 5];
      base.rect(bx, sy - 5, 2, 5, col);
      base.put(bx, sy - 6, tone('metal', 7));
      base.put(bx, sy - 4, fade(RAMPS.ice[4], 160));
    }
  }
  base.rect(134, 38, 30, 2, tone('brown', 4));
  for (let i = 0; i < 6; i++) cylinder(base, 137 + i * 5, 33, 1, 1, 4, 'metal', 7, { shadow: false });
  fill(base, 168, 22, 76, 28, (x, y, i, j) => (j >= 24 ? null : x % 6 === 0 || y % 6 === 4 ? tone('metal', 6) : tone('metal', 7)));
  // kitchen: fridge, stove with hood, prep counter
  box(base, 222, 30, 20, 4, 22, 'metal', 6);
  base.vline(237, 38, 52, tone('metal', 8));
  box(base, 178, 52, 40, 10, 10, 'metal', 5, {
    topFn: (i, j) => ((i === 9 || i === 29) && j > 2 && j < 8 ? tone('orange', 4) : (i % 20 > 5 && i % 20 < 14 && j > 2 && j < 8 ? tone('metal', 1) : null)),
  });
  glow(base, 187, 57, 6, 3, RAMPS.orange[4], 120);
  glow(base, 207, 57, 6, 3, RAMPS.orange[4], 120);
  box(base, 176, 26, 44, 6, 4, 'metal', 6, { shadow: false });
  // the bar: long wooden counter with taps and cups
  box(base, 16, 54, 140, 9, 12, 'brown', 4, {
    frontFn: (i, j) => (i % 20 === 10 && j > 1 && j < 10 ? tone('brown', 1) : null),
  });
  for (let i = 0; i < 6; i++) {
    const tx = 30 + i * 22;
    base.rect(tx, 50, 2, 6, tone('metal', 7));
    base.put(tx, 49, tone('yellow', 4));
    base.rect(tx + 8, 57, 3, 3, i % 2 ? tone('ice', 3) : tone('orange', 4));
    base.put(tx + 8, 57, RAMPS.ice[4]);
  }
  // tables in two rows with stools and food
  const foods = [RAMPS.green[4], RAMPS.orange[3], RAMPS.red[3], RAMPS.yellow[3]];
  for (const [row, ty] of [[0, 104], [1, 156]])
    for (let t = 0; t < 4; t++) {
      const tx = 40 + t * 58 + (row ? 14 : 0);
      if (tx > 230) continue;
      stool(base, tx - 18, ty + 6, 'red', 3);
      stool(base, tx + 18, ty + 6, 'red', 3);
      stool(base, tx, ty - 3, 'red', 3);
      cylinder(base, tx, ty + 4, 13, 6, 7, 'floor', 5);
      base.rect(tx - 1, ty + 11, 3, 6, tone('metal', 2));
      for (let f = 0; f < 3; f++) {
        const fx = tx - 7 + f * 7;
        base.ellipse(fx, ty + 4, 2, 1, tone('metal', 8));
        base.put(fx, ty + 4, foods[(t + f + row) % 4]);
      }
    }
  // pendant lamps over the tables (above the colonists)
  for (const [ty, off] of [[104, 0], [156, 14]])
    for (let t = 0; t < 4; t++) {
      const tx = 40 + t * 58 + off;
      if (tx > 230) continue;
      glow(overlay, tx, ty + 6, 18, 9, RAMPS.yellow[4], 38);
      overlay.rect(tx - 3, ty - 26, 7, 3, tone('red', 2));
      overlay.hline(tx - 3, tx + 3, ty - 26, tone('red', 4));
      overlay.hline(tx - 2, tx + 2, ty - 23, tone('yellow', 4));
    }
  wallLamp(base, 60, 23, 12);
  wallLamp(base, 120, 23, 12);
  // neon sign on the roof edge: a cup
  const neon = tone('pink', 3);
  overlay.rect(108, 2, 34, 13, fade(INK, 200));
  overlay.frame(108, 2, 34, 13, tone('metal', 5));
  overlay.frame(112, 5, 8, 6, neon);
  overlay.vline(121, 6, 8, neon);
  for (let i = 0; i < 3; i++) overlay.vline(114 + i * 2, 3, 4 - (i % 2), fade(neon, 160));
  overlay.hline(124, 138, 6, tone('teal', 4));
  overlay.hline(124, 134, 9, tone('teal', 4));
  return b;
}

export function paintPlaza() {
  const b = new Building('plaza');
  const { base, overlay, w, h } = b;
  const cx = w / 2;
  const cy = 144;
  b.shell({
    top: ['metal', 6],
    face: panelFace('metal', 5, 26),
    floor: (x, y) => {
      const r = Math.hypot((x + 0.5 - cx) / 1.15, y + 0.5 - cy);
      const ring = Math.floor(r / 14);
      const ang = Math.atan2(y + 0.5 - cy, (x + 0.5 - cx) / 1.15);
      const seg = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * (8 + ring * 4));
      if (r % 14 < 1) return tone('floor', 3);
      const lift = ring % 3 === 0 ? 1 : 0;
      return (seg + ring) % 2 ? tone('floor', 5 + lift) : tone('floor', 4 + lift);
    },
  });
  b.paintDoors({ doorFloor: () => tone('floor', 4) });
  // colony crest set into the floor at the hub
  base.ellipse(cx, cy, 22, 18, tone('metal', 2));
  base.ellipse(cx, cy, 20, 16, tone('blue', 2));
  base.ellipse(cx, cy, 15, 12, tone('blue', 1));
  base.ellipse(cx - 2, cy - 1, 10, 9, tone('yellow', 3));
  base.ellipse(cx + 2, cy - 3, 9, 8, tone('blue', 1));
  for (const [sx, sy] of [[9, -6], [12, 2], [5, 7]]) {
    base.put(cx + sx, cy + sy, tone('yellow', 4));
    base.put(cx + sx - 1, cy + sy, tone('yellow', 2));
  }
  // north wall: council banner in the middle, notice board to the right, windows
  spaceWindow(base, 40, 44, 24, 14, 5, { earth: true });
  spaceWindow(base, 256, 44, 24, 14, 6);
  // council banner
  const bx = cx - 14;
  base.rect(bx, 26, 28, 30, tone('blue', 2));
  base.frame(bx, 26, 28, 30, tone('yellow', 3));
  base.ellipse(cx, 38, 7, 7, tone('yellow', 3));
  base.ellipse(cx + 3, 36, 6, 6, tone('blue', 2));
  for (let i = 0; i < 4; i++) base.put(bx + 4 + i * 6, 56, tone('yellow', 3));
  // notice board with pinned notes
  base.rect(196, 28, 50, 26, tone('brown', 1));
  base.rect(197, 29, 48, 24, tone('brown', 4));
  for (let j = 0; j < 24; j++) for (let i = 0; i < 48; i++) if (hash2(i, j, 77) < 0.12) base.put(197 + i, 29 + j, tone('brown', 3));
  const notes = [[200, 31, 10, 8, 'ice', 4], [212, 30, 8, 10, 'yellow', 4], [222, 33, 11, 8, 'pink', 4], [235, 30, 8, 9, 'ice', 4], [202, 42, 9, 9, 'yellow', 4], [214, 43, 12, 8, 'ice', 4], [229, 43, 9, 9, 'teal', 5]];
  for (const [nx, ny, nw, nh, r, k] of notes) {
    base.rect(nx + 1, ny + 1, nw, nh, fade(INK, 90));
    base.rect(nx, ny, nw, nh, tone(r, k));
    for (let l = 2; l < nh - 1; l += 2) base.hline(nx + 2, nx + nw - 3 - (l % 4), ny + l, tone('metal', 4));
    base.put(nx + Math.floor(nw / 2), ny, tone('red', 3));
  }
  // council dais: raised platform with a curved desk and chairs facing the plaza
  fill(base, 92, 60, 136, 40, (x, y) => {
    const d = ((x + 0.5 - cx) / 68) ** 2 + ((y + 0.5 - 60) / 40) ** 2;
    if (d > 1) return null;
    if (d > 0.9) return tone('metal', 3);
    if (d > 0.84) return tone('metal', 6);
    return (x + y) % 6 === 0 ? tone('floor', 2) : tone('floor', 1);
  });
  fill(base, 92, 96, 136, 6, (x, y) => {
    const d = ((x + 0.5 - cx) / 68) ** 2 + ((y - 4 + 0.5 - 60) / 40) ** 2;
    const above = ((x + 0.5 - cx) / 68) ** 2 + ((y - 4 - 0.5 - 60) / 40) ** 2;
    return d <= 1 && above > 0.9 ? null : null;
  });
  for (let x = 92; x < 228; x++) {
    let bottom = -1;
    for (let y = 60; y < 101; y++) if (((x + 0.5 - cx) / 68) ** 2 + ((y + 0.5 - 60) / 40) ** 2 <= 1) bottom = y;
    if (bottom < 0) continue;
    for (let k = 1; k <= 4; k++) base.put(x, bottom + k, tone('metal', k === 4 ? 1 : 3));
  }
  for (let i = -2; i <= 2; i++) {
    const a = (i / 2) * 0.9;
    const dx = Math.round(Math.sin(a) * 46);
    const dy = Math.round(Math.cos(a) * 18);
    box(base, cx + dx - 9, 62 + dy, 18, 5, 5, 'brown', 4);
    stool(base, cx + dx, 62 + dy - 4, 'blue', 3);
  }
  box(base, cx - 5, 88, 10, 4, 8, 'metal', 6);
  base.rect(cx - 2, 89, 4, 2, tone('teal', 4));
  // planters with trees and benches around the edge
  for (const [px, py] of [[44, 136], [276, 136], [56, 220], [264, 220]]) {
    cylinder(base, px, py - 8, 16, 7, 8, 'metal', 6);
    base.ellipse(px, py - 8, 13, 5, tone('brown', 1));
    for (let k = 0; k < 30; k++) base.put(px - 12 + ((k * 7) % 25), py - 10 + ((k * 3) % 5), tone('green', 2 + (k % 3)));
    tree(base, px, py - 7, 10);
  }
  for (const [px, py] of [[34, 178], [286, 178]]) box(base, px - 4, py - 14, 8, 26, 3, 'brown', 4);
  // dome: glass rings and ribs above everyone, very light
  const rim = fade(RAMPS.metal[7], 150);
  const rib = fade(RAMPS.ice[3], 70);
  const ax = (w - 8) / 2;
  const ay = (h - 8 - 16) / 2;
  const ocx = w / 2;
  const ocy = 16 + ay;
  for (const lat of [0.42, 0.72]) {
    const rx = ax * Math.cos(lat * 1.2);
    const ry = ay * Math.cos(lat * 1.2);
    const lift = Math.sin(lat * 1.2) * 46;
    for (let t = 0; t < 720; t++) {
      const a = (t / 720) * Math.PI * 2;
      const s = Math.sin(a);
      const x = ocx + Math.cos(a) * rx;
      const y = ocy - lift + s * ry;
      overlay.set(x, y, s > 0 ? rib : fade(RAMPS.ice[3], 30));
    }
  }
  for (let m = 1; m < 8; m++) {
    const a = (m / 8) * Math.PI;
    for (let t = 0; t <= 100; t++) {
      const lat = (t / 100) * 1.25;
      const x = ocx + Math.cos(a) * ax * Math.cos(lat);
      const y = ocy + Math.sin(a) * ay * Math.cos(lat) - Math.sin(lat) * 46;
      overlay.set(x, y, rib);
    }
  }
  // glass sheen and the front rim
  for (let k = 0; k < 40; k++) overlay.line(40 + k, 120 - k * 2, 60 + k, 100 - k * 2, fade(RAMPS.ice[4], 3));
  for (let x = 0; x < w; x++) {
    const bt = b.bottom[x];
    if (bt < 0 || bt < h - 60) continue;
    overlay.set(x, bt - 2, rim);
  }
  return b;
}

/** Goods piled on a counter top: food, water, parts or medicine. */
export function goods(img, x, y, w, kind) {
  for (let i = 0; i < w; i += 6) {
    const gx = x + i;
    if (kind === 'food') {
      img.ellipse(gx + 2, y + 1, 2, 2, (a, b) => (a + b < 0 ? tone('green', 5) : tone('green', 3)));
      img.put(gx + 5, y + 2, tone('red', 3));
      img.put(gx + 4, y, tone('orange', 4));
    } else if (kind === 'water') {
      img.rect(gx + 1, y - 3, 3, 5, tone('blue', 4));
      img.vline(gx + 1, y - 3, y + 1, tone('ice', 4));
      img.put(gx + 2, y - 4, tone('metal', 7));
    } else if (kind === 'parts') {
      img.rect(gx, y - 1, 4, 3, tone('metal', 5));
      img.put(gx + 1, y, tone('metal', 1));
      img.put(gx + 4, y - 2, tone('orange', 4));
    } else {
      img.rect(gx, y - 2, 5, 4, tone('metal', 8));
      img.vline(gx + 2, y - 2, y + 1, tone('red', 3));
      img.hline(gx + 1, gx + 3, y - 1, tone('red', 3));
    }
  }
}

/** A striped awning seen from above-front, drawn over the colonists. */
export function awning(img, x, y, w, rampA, rampB) {
  for (let j = 0; j < 12; j++)
    for (let i = 0; i < w; i++) {
      const stripe = Math.floor(i / 6) % 2 ? tone(rampA, 4) : tone(rampB, 4);
      const c = j < 2 ? tone(rampA, 5) : j > 8 ? fade(stripe, 255) : stripe;
      img.put(x + i, y + j, j > 9 ? (Math.floor(i / 6) % 2 ? tone(rampA, 2) : tone(rampB, 2)) : c);
    }
  for (let i = 0; i < w; i += 6) {
    img.put(x + i + 2, y + 12, Math.floor(i / 6) % 2 ? tone(rampA, 2) : tone(rampB, 2));
    img.put(x + i + 3, y + 12, Math.floor(i / 6) % 2 ? tone(rampA, 2) : tone(rampB, 2));
  }
  img.hline(x - 1, x + w, y - 1, tone('metal', 1));
  img.vline(x - 1, y, y + 10, tone('metal', 1));
  img.vline(x + w, y, y + 10, tone('metal', 1));
}

export function paintMarket() {
  const b = new Building('market');
  const { base, overlay, w } = b;
  b.shell({
    top: ['metal', 6],
    face: panelFace('purple', 2, 36),
    floor: (x, y) => {
      if (y % 16 === 0 || x % 16 === 0) return tone('metal', 3);
      const lane = y >= 126 && y <= 158;
      return lane ? ((x + y) % 2 ? tone('metal', 5) : tone('metal', 4)) : (x + y) % 3 ? tone('metal', 4) : tone('metal', 5);
    },
  });
  b.paintDoors();
  // bunting along the top of the wall and price tickers
  for (let x = 14; x < w - 14; x++) {
    const sag = Math.round(Math.sin(((x - 14) / 40) * Math.PI) ** 2 * 3);
    base.put(x, 24 + Math.abs(sag), tone('metal', 7));
  }
  for (let i = 0; i < 26; i++) {
    const fx = 18 + i * 10;
    const sag = Math.round(Math.sin(((fx - 14) / 40) * Math.PI) ** 2 * 3);
    const col = ['yellow', 'teal', 'pink', 'orange'][i % 4];
    for (let j = 0; j < 4; j++) base.hline(fx - 2 + Math.floor(j / 2), fx + 2 - Math.floor(j / 2), 25 + sag + j, tone(col, 4 - (j > 2 ? 1 : 0)));
  }
  screen(base, 30, 32, 30, 10, 'green', 4);
  screen(base, 228, 32, 30, 10, 'red', 5);
  spaceWindow(base, 126, 31, 36, 12, 8);
  // four stalls along the back wall, one per traded resource
  const stalls = [['food', 'green', 'yellow'], ['water', 'blue', 'ice'], ['parts', 'orange', 'metal'], ['medicine', 'red', 'ice']];
  stalls.forEach(([kind, ra, rb], s) => {
    const sx = 18 + s * 64;
    box(base, sx, 62, 56, 9, 11, 'brown', 4, { frontFn: (i, j) => (j > 2 && j < 8 && i > 4 && i < 51 ? tone(ra, 3 - (j === 3 ? 0 : 1)) : null) });
    goods(base, sx + 4, 66, 48, kind);
    // crates behind the counter
    box(base, sx + 6, 50, 14, 5, 7, 'brown', 3, { shadow: false });
    box(base, sx + 36, 50, 14, 5, 7, ra === 'blue' ? 'blue' : 'brown', 3, { shadow: false });
    awning(overlay, sx - 2, 40, 60, ra, rb === 'metal' ? 'yellow' : rb === 'ice' ? 'metal' : rb);
  });
  // two island kiosks in the middle lane
  for (const [kx, kind, ramp] of [[56, 'food', 'teal'], [164, 'parts', 'yellow']]) {
    box(base, kx, 132, 68, 10, 10, 'metal', 6, { frontFn: (i, j) => (j > 2 && j < 7 && i % 12 < 8 ? tone(ramp, 3) : null) });
    goods(base, kx + 4, 137, 60, kind);
    box(base, kx + 30, 122, 8, 4, 10, 'metal', 5, { shadow: false });
    overlay.rect(kx + 22, 104, 24, 8, tone('metal', 1));
    overlay.rect(kx + 23, 105, 22, 6, tone(ramp, 2));
    overlay.hline(kx + 25, kx + 42, 107, tone(ramp, 5));
    overlay.vline(kx + 34, 112, 121, tone('metal', 2));
  }
  // barrels and sacks by the walls
  cylinder(base, 268, 158, 6, 3, 10, 'blue', 3);
  cylinder(base, 268, 176, 6, 3, 10, 'blue', 3);
  box(base, 14, 146, 12, 6, 8, 'brown', 4);
  return b;
}
