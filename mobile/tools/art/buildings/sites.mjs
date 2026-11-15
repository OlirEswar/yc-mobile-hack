/**
 * The exposed sites and the observatory: solar farm, landing pad, ice wells, quarry, observatory.
 * Sites have no walls; their base is mostly transparent so the regolith shows between the kit.
 */
import { Building, INK, RAMPS, box, cylinder, fade, fill, glow, hash2, screen, spaceWindow, stool, tone } from './kit.mjs';
import { goods, panelFace } from './civic.mjs';

/** Perimeter fence: posts every 24 px joined by a cable, with a gap for the gate. */
function fence(img, w, h, gate) {
  const posts = [];
  for (let x = 4; x < w - 4; x += 24) posts.push([x, 6], [x, h - 4]);
  for (let y = 30; y < h - 10; y += 24) posts.push([4, y], [w - 5, y]);
  const inGate = (x, y) => gate && Math.abs(x - gate.x) < 18 && Math.abs(y - gate.y) < 18;
  for (let x = 4; x < w - 4; x++) {
    if (!inGate(x, 2)) img.put(x, 2, tone('metal', 4));
    if (!inGate(x, h - 8)) img.put(x, h - 8, tone('metal', 4));
  }
  for (let y = 2; y < h - 8; y++) {
    img.put(4, y, tone('metal', 4));
    img.put(w - 5, y, tone('metal', 4));
  }
  for (const [x, y] of posts) {
    if (inGate(x, y)) continue;
    img.rect(x - 1, y - 6, 3, 7, tone('metal', 1));
    img.rect(x, y - 5, 1, 5, tone('metal', 7));
    img.put(x, y - 6, tone('yellow', 4));
  }
  if (gate)
    for (const gx of [gate.x - 18, gate.x + 17]) {
      for (let y = gate.y - 14; y < gate.y; y++) img.rect(gx - 1, y, 3, 1, Math.floor(y / 3) % 2 ? tone('yellow', 3) : INK);
      img.put(gx, gate.y - 15, tone('red', 4));
    }
}

/** One solar panel module tilted towards the low sun: cells, frame, legs and shadow. */
function panel(img, x, y, w) {
  img.rect(x + 3, y + 26, w, 6, fade(INK, 110));
  img.rect(x + 3, y + 22, 2, 6, tone('metal', 2));
  img.rect(x + w - 5, y + 22, 2, 6, tone('metal', 2));
  for (let j = 0; j < 22; j++)
    for (let i = 0; i < w; i++) {
      let c = tone('blue', j < 4 ? 3 : 2);
      if (i % 8 === 0 || j % 7 === 0) c = tone('blue', 1);
      if ((i + (22 - j)) % 26 < 2) c = tone('blue', 4);
      if (j === 0) c = tone('metal', 7);
      if (j === 21) c = tone('metal', 3);
      if (i === 0) c = tone('metal', 6);
      if (i === w - 1) c = tone('metal', 3);
      img.put(x + i, y + j, c);
    }
  img.rect(x, y + 22, w, 2, tone('metal', 4));
  img.hline(x, x + w - 1, y + 24, tone('metal', 1));
}

export function paintSolarFarm() {
  const b = new Building('solar_farm');
  const { base, overlay, w, h } = b;
  const gate = b.doors[0];
  fence(base, w, h, gate);
  // four rows of panels; colonists walk the aisles between them
  for (const top of [20, 74, 128, 182]) {
    for (let x = 16; x + 30 <= 304; x += 32) panel(base, x, top, 30);
    // a cable along each row into the inverter station
    for (let x = 16; x < 316; x++) base.put(x, top + 30, tone('metal', 1));
  }
  // inverter station: a hut with vents and a door, battery cabinets with status lights, a mast
  box(base, 316, 24, 52, 16, 34, 'metal', 6, {
    frontFn: (i, j) => {
      if (i >= 30 && i < 42 && j >= 10) return j === 10 ? tone('metal', 2) : tone('metal', 3);
      if (i > 4 && i < 24 && j > 6 && j < 18 && j % 3 === 0) return tone('metal', 2);
      if (i === 26 && j === 12) return tone('green', 5);
      return null;
    },
    topFn: (i, j) => (i > 6 && i < 16 && j > 4 && j < 11 ? tone('metal', (i + j) % 2 ? 3 : 4) : null),
  });
  base.rect(319, 18, 8, 6, tone('yellow', 3));
  for (const y of [94, 124, 154]) {
    box(base, 324, y, 36, 8, 18, 'teal', 2, {
      frontFn: (i, j) => (j === 6 && i % 6 === 2 ? tone('green', 5) : j === 12 && i % 6 === 2 ? tone('teal', 5) : null),
    });
  }
  base.rect(352, 6, 2, 22, tone('metal', 5));
  overlay.rect(348, 2, 10, 4, tone('metal', 6));
  overlay.put(352, 0, tone('red', 4));
  overlay.put(353, 0, tone('red', 3));
  glow(overlay, 353, 1, 4, 3, RAMPS.red[4], 120);
  return b;
}

export function paintLandingPad() {
  const b = new Building('landing_pad');
  const { base, overlay, w, h } = b;
  const cx = 160;
  const cy = 118;
  // the pad: sintered octagon with plate seams, engine scorch, yellow markings and lights
  fill(base, 0, 0, w, h, (x, y) => {
    const dx = Math.abs(x + 0.5 - cx) / 128;
    const dy = Math.abs(y + 0.5 - cy) / 104;
    if (Math.max(dx, dy, (dx + dy) * 0.74) > 1) return null;
    const edge = Math.max(dx, dy, (dx + dy) * 0.74) > 0.97;
    if (edge) return tone('metal', 3);
    const r = Math.hypot((x - cx) / 1.25, y - cy);
    if (Math.abs(r - 84) < 3) return Math.floor(Math.atan2(y - cy, x - cx) * 12) % 2 ? tone('yellow', 3) : tone('yellow', 2);
    if (Math.abs(r - 62) < 1) return tone('yellow', 3);
    if (x % 32 === 0 || y % 32 === 0) return tone('floor', 3);
    const scorch = Math.max(0, 1 - r / 60);
    const v = 5 - scorch * 3.5 + (hash2(x >> 1, y >> 1, 5) - 0.5) * 0.9;
    return tone('floor', Math.round(v));
  });
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const lx = Math.round(cx + Math.cos(ang) * 122);
    const ly = Math.round(cy + Math.sin(ang) * 98);
    base.rect(lx - 1, ly - 1, 3, 3, tone('metal', 2));
    base.put(lx, ly, a % 2 ? tone('teal', 5) : tone('ice', 4));
    glow(base, lx, ly, 6, 4, RAMPS.teal[4], 80);
  }
  // the shuttle: a lifting body nose-north on its gear, cargo bay open, engines aft
  const sx = cx;
  const top = 18;
  base.ellipse(sx + 8, top + 104, 64, 40, fade(INK, 70));
  // delta wings
  for (let j = 0; j < 56; j++) {
    const half = 18 + Math.round(j * 0.95);
    for (let i = -half; i <= half; i++) {
      const y = top + 76 + j;
      const lead = j < 3 || Math.abs(i) > half - 3;
      base.put(sx + i, y, lead ? tone('metal', 1) : Math.abs(i) > half - 8 ? tone('orange', 3) : tone('metal', i < 0 ? 7 : 6));
    }
  }
  // fuselage
  for (let y = top; y < top + 140; y++) {
    const t = (y - top) / 140;
    const half = Math.round(t < 0.18 ? 6 + t * 70 : t > 0.92 ? 16 : 18);
    for (let i = -half; i <= half; i++) {
      let c = i < -half / 2 ? tone('metal', 8) : i < half / 2 ? tone('metal', 7) : tone('metal', 5);
      if (Math.abs(i) === half) c = tone('metal', 2);
      if ((y - top) % 22 === 0 && Math.abs(i) < half) c = tone('metal', 5);
      base.put(sx + i, y, c);
    }
  }
  // cockpit glass and nose
  for (let j = 0; j < 9; j++) base.hline(sx - 4 - Math.floor(j / 2), sx + 4 + Math.floor(j / 2), top + 10 + j, j < 3 ? tone('teal', 5) : tone('teal', 3));
  base.hline(sx - 2, sx + 2, top + 1, tone('metal', 1));
  // open cargo bay with crates
  base.rect(sx - 13, top + 40, 26, 44, tone('metal', 2));
  base.rect(sx - 15, top + 40, 2, 44, tone('metal', 8));
  base.rect(sx + 13, top + 40, 2, 44, tone('metal', 4));
  for (let c = 0; c < 3; c++) box(base, sx - 10, top + 44 + c * 13, 20, 4, 6, ['orange', 'green', 'blue'][c], 3, { shadow: false });
  // orange livery stripes and engine block
  base.rect(sx - 18, top + 90, 36, 3, tone('orange', 4));
  box(base, sx - 22, top + 132, 44, 6, 8, 'metal', 4);
  for (const ex of [-14, 0, 14]) {
    base.ellipse(sx + ex, top + 142, 5, 3, tone('metal', 1));
    base.ellipse(sx + ex, top + 142, 3, 2, tone('orange', 2));
  }
  // boarding ramp down to the pad on the east side
  for (let k = 0; k < 18; k++) base.rect(sx + 18 + k, top + 64 + Math.round(k * 0.4), 2, 10, k % 4 === 0 ? tone('metal', 3) : tone('metal', 5));
  // cargo pallets, a fuel tank and a cargo rover around the pad
  for (const [px, py] of [[34, 40], [52, 40], [34, 56], [262, 196], [280, 196]]) box(base, px, py, 16, 6, 9, 'brown', 4);
  goods(base, 37, 45, 10, 'food');
  for (let k = 0; k < 3; k++) cylinder(base, 270 + k * 14, 34, 6, 3, 18, 'metal', 6);
  base.rect(266, 56, 40, 3, tone('red', 3));
  box(base, 36, 80, 30, 12, 8, 'yellow', 3);
  base.rect(42, 74, 12, 7, tone('metal', 2));
  base.rect(44, 75, 8, 3, tone('teal', 4));
  for (const wx of [38, 62]) for (const wy of [92, 78]) base.rect(wx - 2, wy, 4, 5, INK);
  // overlay: the tail fin standing up from the fuselage, with a beacon
  for (let j = 0; j < 30; j++) {
    const half = j < 4 ? 1 : 2;
    overlay.rect(sx - half, top + 96 + j, half * 2 + 1, 1, j < 2 ? tone('red', 3) : tone('metal', j % 9 === 0 ? 5 : 7));
    overlay.put(sx + half, top + 96 + j, tone('metal', 4));
  }
  overlay.put(sx, top + 95, tone('red', 4));
  glow(overlay, sx, top + 95, 5, 4, RAMPS.red[4], 120);
  return b;
}

/** A drill derrick: an A-frame lattice tower over a borehole, standing on a deck. */
function derrick(img, cx, deckY, seed) {
  // deck
  box(img, cx - 36, deckY - 8, 72, 16, 8, 'metal', 4, {
    topFn: (i, j) => (i % 8 === 0 || j % 8 === 0 ? tone('metal', 2) : null),
  });
  // borehole with ice glow
  img.ellipse(cx, deckY, 7, 3, tone('cold', 0));
  glow(img, cx, deckY, 9, 4, RAMPS.ice[3], 120);
  // lattice legs
  const topY = deckY - 82;
  for (const side of [-1, 1]) {
    for (let y = topY; y <= deckY - 4; y++) {
      const t = (y - topY) / (deckY - 4 - topY);
      const x = Math.round(cx + side * (5 + t * 26));
      img.rect(x - 1, y, 3, 1, tone('orange', side < 0 ? 4 : 3));
      img.put(x + (side < 0 ? 1 : -1), y, tone('orange', 2));
    }
  }
  // cross braces
  for (let k = 0; k < 6; k++) {
    const y0 = topY + 6 + k * 13;
    const y1 = y0 + 13;
    const half = (y) => 5 + ((y - topY) / (deckY - 4 - topY)) * 26;
    img.line(cx - half(y0), y0, cx + half(y1), y1, tone('orange', 2));
    img.line(cx + half(y0), y0, cx - half(y1), y1, tone('orange', 2));
    img.hline(Math.round(cx - half(y0)), Math.round(cx + half(y0)), y0, tone('orange', 3));
  }
  // crown block, drill string, winch
  img.rect(cx - 7, topY - 4, 14, 5, tone('yellow', 3));
  img.hline(cx - 7, cx + 6, topY - 4, tone('yellow', 4));
  img.rect(cx - 1, topY + 1, 2, deckY - topY - 1, tone('metal', 7));
  img.put(cx - 1, deckY - 30, tone('metal', 4));
  box(img, cx + 14, deckY - 18, 16, 6, 8, 'yellow', 3);
  // ice core samples racked on the deck
  for (let k = 0; k < 4; k++) {
    img.rect(cx - 30 + k * 4, deckY - 4, 3, 8, tone('ice', 3));
    img.put(cx - 30 + k * 4, deckY - 4, tone('ice', 4));
  }
  img.put(cx, topY - 6, tone('red', 4));
  return topY;
}

export function paintIceWells() {
  const b = new Building('ice_wells');
  const { base, overlay, w, h } = b;
  // floodlit work area on the dark crater floor
  glow(base, 176, 118, 170, 58, RAMPS.yellow[4], 60);
  glow(base, 70, 110, 70, 34, RAMPS.ice[4], 60);
  glow(base, 282, 110, 70, 34, RAMPS.ice[4], 60);
  // insulated pipeline from the wells to the tank and out to the colony
  for (const [x0, x1, y] of [[70, 176, 40], [176, 282, 40]]) {
    base.rect(Math.min(x0, x1), y, Math.abs(x1 - x0), 4, tone('metal', 7));
    base.hline(Math.min(x0, x1), Math.max(x0, x1), y + 3, tone('metal', 4));
    for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x += 12) base.rect(x, y - 1, 2, 6, tone('metal', 5));
  }
  for (let y = 0; y < 20; y++) base.rect(198, y, 4, 1, y % 12 === 0 ? tone('metal', 5) : tone('metal', 7));
  // water tank
  cylinder(base, 176, 8, 24, 8, 32, 'ice', 3);
  base.rect(152, 22, 49, 3, tone('blue', 3));
  base.rect(152, 30, 49, 2, tone('blue', 2));
  for (let k = 0; k < 4; k++) base.rect(156 + k * 12, 41, 2, 6, tone('metal', 3));
  // the rigs
  derrick(base, 70, 108, 1);
  derrick(base, 282, 108, 2);
  for (const x of [70, 282]) for (let y = 44; y < 92; y++) base.rect(x - 1, y, 3, 1, tone('metal', y % 8 === 0 ? 5 : 7));
  // stacked ice blocks
  for (const [ix, iy] of [[118, 130], [130, 130], [124, 122], [226, 132], [238, 132]]) {
    box(base, ix, iy, 11, 4, 7, 'ice', 3);
  }
  // floodlight masts with lamps over the colonists
  for (const [mx, my, dir] of [[14, 160, 1], [338, 160, -1]]) {
    base.rect(mx - 1, my - 64, 3, 64, tone('metal', 5));
    base.vline(mx - 1, my - 64, my - 1, tone('metal', 7));
    overlay.rect(mx - 6, my - 70, 12, 6, tone('metal', 3));
    overlay.rect(mx - 5 + (dir > 0 ? 3 : 0), my - 66, 7, 2, tone('yellow', 4));
    glow(overlay, mx + dir * 10, my - 60, 12, 6, RAMPS.yellow[4], 60);
  }
  // hazard posts along the drop on the south side
  for (let x = 30; x < w - 20; x += 36) {
    base.rect(x, h - 14, 2, 8, tone('yellow', 3));
    base.put(x, h - 14, tone('red', 4));
  }
  return b;
}

/** Excavator: tracked base, cab with glass, boom and bucket reaching left. */
function excavator(img, over, x, y) {
  img.rect(x - 4, y + 22, 52, 4, fade(INK, 100));
  for (const ty of [y + 14]) {
    img.rect(x - 2, ty, 48, 10, tone('metal', 1));
    for (let i = 0; i < 48; i += 3) img.vline(x - 2 + i, ty, ty + 9, tone('metal', 3));
    img.hline(x - 2, x + 45, ty, tone('metal', 4));
  }
  box(img, x + 4, y - 4, 38, 10, 10, 'yellow', 3);
  box(img, x + 24, y - 16, 16, 8, 14, 'yellow', 3, {
    frontFn: (i, j) => (i > 2 && i < 14 && j > 1 && j < 8 ? tone('teal', j < 4 ? 4 : 3) : null),
  });
  img.rect(x + 6, y - 8, 10, 4, tone('metal', 2));
  // boom up and out to the left, bucket in the dirt (boom top over the colonists)
  for (let t = 0; t < 26; t++) over.rect(x + 18 - t, y - 6 - Math.round(t * 0.9), 4, 4, tone('yellow', t < 3 ? 2 : 3));
  for (let t = 0; t < 20; t++) over.rect(x - 8 - Math.round(t * 0.5), y - 30 + t, 4, 3, tone('yellow', 2));
  over.rect(x - 24, y - 12, 12, 10, tone('metal', 3));
  over.hline(x - 24, x - 13, y - 12, tone('metal', 5));
  for (let i = 0; i < 4; i++) over.put(x - 23 + i * 3, y - 2, tone('metal', 6));
}

export function paintQuarry() {
  const b = new Building('quarry');
  const { base, overlay, w, h } = b;
  const cx = 176;
  const cy = 102;
  const terraces = [[166, 74], [138, 60], [110, 47], [82, 34]];
  const reg = RAMPS.regolith;
  // terraced pit: each step down shows its sunlit ledge and its south-facing riser
  const cold = RAMPS.cold;
  fill(base, 0, 0, w, h, (x, y) => {
    let level = 0;
    for (const [rx, ry] of terraces) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) level++;
    if (!level) return null;
    const [rx, ry] = terraces[level - 1];
    const dither = hash2(x, y, 3) < 0.2 ? -1 : 0;
    // the riser below each ledge on the far (north) side faces the viewer; west half catches the sun
    if (y < cy && ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy - 10) / ry) ** 2 > 1) {
      const lit = x < cx - rx * 0.2;
      const k = (lit ? 6 : 4) - level + dither;
      return k >= 2 ? reg[k] : cold[Math.max(1, k + 4)];
    }
    if (((x + 0.5 - cx) / (rx - 2)) ** 2 + ((y + 0.5 - cy) / (ry - 2)) ** 2 > 1) return reg[Math.max(2, 8 - level)];
    if (hash2(x >> 2, y >> 1, 9) < 0.06) return reg[Math.max(1, 5 - level)];
    const k = 7 - level * 1.4 + dither;
    return k >= 2 ? reg[Math.round(k)] : cold[Math.max(1, Math.round(k + 4))];
  });
  // haul road ramping down from the gate along the west wall
  for (let t = 0; t < 120; t++) {
    const px = Math.round(146 - t * 0.55 - Math.sin(t / 30) * 6);
    const py = Math.round(4 + t * 0.78);
    for (let k = -7; k <= 7; k++) {
      const c = Math.abs(k) > 5 ? reg[4] : (Math.abs(k) === 3 && t % 3 ? reg[3] : reg[6]);
      base.put(px + k, py, c);
    }
  }
  // spoil heaps and a conveyor out of the pit to the north-east
  for (const [mx, my, r] of [[318, 40, 20], [292, 26, 14], [30, 150, 16]]) {
    base.ellipse(mx + 4, my + 3, r, r * 0.45, fade(INK, 90));
    for (let j = -r; j <= 0; j++)
      for (let i = -r; i <= r; i++) {
        const d = (i / r) ** 2 + (j / (r * 0.75)) ** 2;
        if (d > 1) continue;
        const slope = i - j * 0.6;
        base.put(mx + i, my + j, slope < -r * 0.4 ? reg[8] : slope < r * 0.3 ? reg[6] : reg[4]);
        if (hash2(mx + i, my + j, 7) < 0.08) base.put(mx + i, my + j, reg[3]);
      }
  }
  for (let t = 0; t < 90; t++) {
    const px = Math.round(232 + t * 0.95);
    const py = Math.round(96 - t * 0.68);
    base.rect(px, py, 4, 7, tone('metal', 2));
    base.rect(px, py + 1, 4, 3, tone('metal', 4));
    if (t % 6 === 0) base.rect(px, py + 6, 2, 6, tone('metal', 3));
    if (t % 5 === 0) base.put(px + 1, py, reg[7]);
  }
  // excavator on the pit floor and a parked hauler on the rim
  excavator(base, overlay, 196, 84);
  box(base, 20, 30, 40, 14, 10, 'yellow', 3);
  base.rect(24, 24, 18, 8, reg[6]);
  base.ellipse(32, 26, 9, 4, reg[7]);
  box(base, 46, 26, 14, 8, 12, 'yellow', 3, { frontFn: (i, j) => (i > 2 && i < 12 && j > 1 && j < 6 ? tone('teal', 4) : null) });
  for (const wx of [24, 40, 54]) base.rect(wx, 52, 5, 4, INK);
  // floodlight mast
  base.rect(340, 70, 3, 70, tone('metal', 5));
  overlay.rect(334, 64, 12, 6, tone('metal', 3));
  overlay.rect(335, 68, 8, 2, tone('yellow', 4));
  glow(overlay, 330, 74, 12, 6, RAMPS.yellow[4], 60);
  return b;
}

export function paintObservatory() {
  const b = new Building('observatory');
  const { base, overlay, w, h } = b;
  const cx = w / 2;
  const cy = 122;
  b.shell({
    top: ['metal', 6],
    face: panelFace('blue', 2, 28),
    floor: (x, y) => {
      const r = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.2);
      if (Math.abs(r - 44) < 1.5) return tone('yellow', 2);
      if (x % 16 === 0 || y % 16 === 0) return tone('metal', 1);
      return (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? tone('metal', 2) : tone('metal', 3);
    },
  });
  b.paintDoors();
  // star chart on the back wall, with windows either side
  spaceWindow(base, 30, 46, 20, 12, 41);
  spaceWindow(base, 174, 46, 20, 12, 42, { earth: true });
  base.rect(cx - 26, 26, 52, 22, tone('metal', 1));
  base.rect(cx - 25, 27, 50, 20, tone('purple', 0));
  for (let k = 0; k < 40; k++) base.put(cx - 24 + ((k * 37) % 48), 28 + ((k * 13) % 18), k % 5 ? tone('purple', 4) : tone('ice', 4));
  base.ellipse(cx, 37, 8, 8, (i, j, d) => (d > 0.8 ? tone('teal', 4) : null));
  base.line(cx - 20, 30, cx - 6, 40, tone('teal', 3));
  base.line(cx + 6, 34, cx + 20, 44, tone('teal', 3));
  // research desks with screens and chairs along the wall
  for (const [dx, ramp] of [[26, 'purple'], [154, 'teal']]) {
    box(base, dx, 60, 44, 8, 8, 'metal', 5);
    screen(base, dx + 4, 54, 14, 7, ramp, dx);
    screen(base, dx + 24, 54, 14, 7, 'teal', dx + 1);
    stool(base, dx + 12, 82, 'blue', 3);
    stool(base, dx + 32, 82, 'blue', 3);
  }
  // telescope pier and fork mount; the tube itself rides above the colonists
  cylinder(base, cx, 104, 16, 7, 20, 'metal', 6);
  base.rect(cx - 12, 92, 4, 16, tone('yellow', 3));
  base.rect(cx + 8, 92, 4, 16, tone('yellow', 2));
  for (let t = 0; t < 70; t++) {
    const x = cx + 6 - t * 0.78;
    const y = 98 - t * 0.66;
    const r = t > 62 ? 11 : 9;
    for (let k = -r; k <= r; k++) {
      const px = Math.round(x + k * 0.66);
      const py = Math.round(y - k * 0.78 * 0.6 + k * 0.2);
      const c = k < -r + 3 ? tone('metal', 8) : k < 2 ? tone('metal', 7) : k < r - 2 ? tone('metal', 6) : tone('metal', 4);
      overlay.put(px, py, t > 62 && Math.abs(k) < r - 2 ? (t > 66 ? tone('cold', 2) : tone('metal', 3)) : c);
    }
  }
  overlay.ellipse(cx - 49, 52, 6, 5, tone('cold', 1));
  overlay.ellipse(cx - 50, 51, 3, 2, tone('blue', 3));
  // dome ribs and the open slit, light so the room stays readable
  const rib = fade(RAMPS.ice[3], 70);
  const ax = (w - 8) / 2;
  const ay = (h - 8 - 16) / 2;
  const ocy = 16 + ay;
  for (let m = 1; m < 6; m++) {
    const a = (m / 6) * Math.PI;
    for (let t = 0; t <= 100; t++) {
      const lat = (t / 100) * 1.25;
      overlay.set(cx + Math.cos(a) * ax * Math.cos(lat), ocy + Math.sin(a) * ay * Math.cos(lat) - Math.sin(lat) * 40, rib);
    }
  }
  for (let t = 0; t < 720; t++) {
    const a = (t / 720) * Math.PI * 2;
    const s = Math.sin(a);
    overlay.set(cx + Math.cos(a) * ax * 0.6, ocy - 32 + s * ay * 0.6, s > 0 ? rib : fade(RAMPS.ice[3], 30));
  }
  return b;
}
