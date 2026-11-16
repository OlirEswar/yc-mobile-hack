/**
 * The damaged layer of a building: cracks, scorch, debris, broken glass and small fires, drawn
 * only where the building has floor or walls (or kit, for exposed sites). The renderer fades it in
 * over the base with the damage amount.
 */
import { INK, RAMPS, fade, tone } from '../lib/palette.mjs';
import { rng } from '../lib/noise.mjs';

export function paintDamage(b, seed) {
  const { damaged: img, base, w, h } = b;
  const r = rng(seed);
  const solid = (x, y) => (b.kind === 'site' ? base.alpha(x, y) > 0 : b.at(x, y) > 0);
  const pick = () => {
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(16 + r() * (w - 32));
      const y = Math.floor(24 + r() * (h - 40));
      if (solid(x, y)) return [x, y];
    }
    return [w / 2, h / 2];
  };
  // scorch marks: dark dithered blotches
  for (let n = 0; n < 3; n++) {
    const [cx, cy] = pick();
    const rad = 12 + r() * 14;
    for (let y = Math.floor(cy - rad); y < cy + rad; y++)
      for (let x = Math.floor(cx - rad * 1.3); x < cx + rad * 1.3; x++) {
        const d = Math.hypot((x - cx) / 1.3, y - cy) / rad;
        if (d > 1 || !solid(x, y)) continue;
        if (d < 0.55 || (d < 0.85 && (x + y) % 2 === 0) || (d < 1 && (x * 3 + y) % 5 === 0)) img.set(x, y, fade(INK, d < 0.4 ? 200 : 150));
      }
  }
  // cracks: branching random walks with a light lip
  for (let n = 0; n < 10; n++) {
    let [x, y] = pick();
    let ang = r() * Math.PI * 2;
    const len = 18 + r() * 34;
    for (let t = 0; t < len; t++) {
      ang += (r() - 0.5) * 0.9;
      x += Math.cos(ang);
      y += Math.sin(ang) * 0.8;
      const px = Math.round(x);
      const py = Math.round(y);
      if (!solid(px, py)) break;
      img.put(px, py, tone('cold', 0));
      img.put(px + 1, py, tone('cold', 1));
      img.set(px, py + 1, fade(tone('metal', 8), 110));
      if (r() < 0.08) {
        const bx = px + Math.round((r() - 0.5) * 8);
        const by = py + Math.round((r() - 0.5) * 6);
        img.line(px, py, bx, by, tone('cold', 0));
      }
    }
  }
  // debris: bent panels and chunks, glass shards near domes and sites
  for (let n = 0; n < 26; n++) {
    const [x, y] = pick();
    const pw = 3 + Math.floor(r() * 6);
    const ph = 2 + Math.floor(r() * 4);
    img.rect(x + 1, y + 1, pw, ph, fade(INK, 120));
    img.rect(x, y, pw, ph, tone('metal', 3 + Math.floor(r() * 3)));
    img.hline(x, x + pw - 1, y, tone('metal', 7));
    if (b.kind !== 'room' && r() < 0.6) {
      img.put(x + pw + 2, y - 1, tone('ice', 4));
      img.put(x + pw + 3, y, tone('ice', 3));
    }
  }
  // small fires with embers
  for (let n = 0; n < 3; n++) {
    const [x, y] = pick();
    img.ellipse(x, y + 1, 5, 2, fade(INK, 160));
    const flame = ['..r..', '.ror.', '.oyo.', 'roYor', 'royyr', '.ryr.'];
    flame.forEach((row, j) => [...row].forEach((ch, i) => {
      const c = { r: tone('red', 3), o: tone('orange', 4), y: tone('yellow', 4), Y: tone('metal', 8) }[ch];
      if (c) img.put(x - 2 + i, y - 6 + j, c);
    }));
    for (let k = 0; k < 4; k++) img.put(x - 3 + Math.floor(r() * 7), y - 8 - Math.floor(r() * 6), tone('orange', 4));
    img.ellipse(x, y - 3, 9, 6, (i, j, dd) => fade(RAMPS.orange[4], Math.round(70 * (1 - dd))));
  }
}
