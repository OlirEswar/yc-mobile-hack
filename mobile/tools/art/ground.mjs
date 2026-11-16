/**
 * The terrain: one 1280x1920 image of lunar regolith. Built as a heightfield (rolling ground,
 * craters, boulders, the permanently shadowed crater) lit by a low sun from the upper left with
 * ray-marched cast shadows, quantised onto the regolith and cold ramps with ordered dithering.
 * Rover tracks are carved in before lighting; pressurised tubes and track beacons are painted on
 * top. Building and tube shadows fall on the ground here, so the building art casts none itself.
 */
import { Img } from './lib/image.mjs';
import { RAMPS, tone } from './lib/palette.mjs';
import { bayer, fbm, hash2, rng } from './lib/noise.mjs';
import { ART_SCALE as S, BUILDING_KIND, LOCATION_IDS, LOCATION_LAYOUT, MAP_HEIGHT as H, MAP_WIDTH as W, ROUTE_LINES, buildingAt, insideBuilding } from './lib/layout.mjs';

/** Unit vector along the ground towards the sun, and the sun's elevation slope for shadows. */
const SUN = { x: -0.8, y: -0.6 };
const SUN_SLOPE = 0.3;
/** Light vector for slope shading (higher than the shadow sun, so slopes read without going black). */
const LIGHT = (() => {
  const v = [-0.7, -0.52, 0.48];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

/** The permanently shadowed crater that holds the ice wells. */
export const DARK_CRATER = { x: 330, y: 1860, rx: 320, ry: 250, depth: 70 };

const smoothstep = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Distance from p to segment ab, the signed perpendicular offset and the clamped parameter. */
function segment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  const cx = a.x + dx * t;
  const cy = a.y + dy * t;
  const len = Math.sqrt(len2);
  return { d: Math.hypot(px - cx, py - cy), side: ((px - a.x) * dy - (py - a.y) * dx) / len, t, len };
}

/** Calls fn(x, y, hit) for every pixel within reach of a polyline, with the nearest segment hit. */
function aroundLine(pts, reach, fn) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - reach));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs) + reach));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - reach));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys) + reach));
  // cumulative length so "along" runs continuously over the whole line
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let best = null;
      for (let s = 0; s < pts.length - 1; s++) {
        const hit = segment(x + 0.5, y + 0.5, pts[s], pts[s + 1]);
        if (!best || hit.d < best.d) best = { ...hit, seg: s, along: cum[s] + hit.t * hit.len, a: pts[s], b: pts[s + 1] };
      }
      if (best.d <= reach) fn(x, y, best);
    }
}

/** Box blur via a summed-area table. */
function blur(src, r) {
  const sat = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += src[y * W + x];
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(W, x + r + 1);
      const ya = Math.max(0, y - r);
      const yb = Math.min(H, y + r + 1);
      const sum = sat[yb * (W + 1) + xb] - sat[ya * (W + 1) + xb] - sat[yb * (W + 1) + xa] + sat[ya * (W + 1) + xa];
      out[y * W + x] = sum / ((xb - xa) * (yb - ya));
    }
  return out;
}

/** Height of a crater of radius r and depth d at normalised distance t (1 = rim). */
function craterProfile(t, depth, rim, flat) {
  if (t < 1) return -depth + (depth + rim) * Math.pow(t, flat);
  if (t < 2.6) return rim * Math.exp(-(t - 1) * 3.4);
  return 0;
}

const SURFACE_LINES = ROUTE_LINES.filter((l) => l.surface);
const TUBE_LINES = ROUTE_LINES.filter((l) => !l.surface);

/** Height that buildings, tubes and posts add for casting shadows (not for slope shading). */
function structureHeights() {
  const s = new Float32Array(W * H);
  for (const id of LOCATION_IDS) {
    const f = LOCATION_LAYOUT[id].footprint;
    const kind = BUILDING_KIND[id];
    if (kind === 'site') continue;
    for (let y = f.y; y < f.y + f.h; y++)
      for (let x = f.x; x < f.x + f.w; x++) {
        if (!insideBuilding(id, x, y)) continue;
        let hgt = 9;
        if (kind === 'dome') {
          const dx = (x - (f.x + f.w / 2)) / (f.w / 2);
          const dy = (y - (f.y + f.h / 2 + 8)) / (f.h / 2);
          hgt += 8 * Math.max(0, 1 - dx * dx - dy * dy);
        }
        s[y * W + x] = hgt;
      }
  }
  for (const line of TUBE_LINES)
    aroundLine(line.pts, 15, (x, y) => {
      s[y * W + x] = Math.max(s[y * W + x], 4);
    });
  return s;
}

/** Beacon posts along the rover tracks: world positions, one every ~110 px, alternating sides. */
function beaconPosts() {
  const posts = [];
  for (const line of SURFACE_LINES) {
    let carry = 40;
    let side = 1;
    for (let i = 0; i < line.pts.length - 1; i++) {
      const a = line.pts[i];
      const b = line.pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (let t = carry; t < len; t += 110) {
        const x = Math.round(a.x + ((b.x - a.x) * t) / len + nx * 17 * side);
        const y = Math.round(a.y + ((b.y - a.y) * t) / len + ny * 17 * side);
        if (!buildingAt(x, y) && !nearBuilding(x, y, 20)) posts.push({ x, y });
        side = -side;
        carry = t + 110 - len;
      }
    }
  }
  return posts;
}

function nearBuilding(x, y, margin) {
  return LOCATION_IDS.some((id) => {
    const f = LOCATION_LAYOUT[id].footprint;
    return x > f.x - margin && x < f.x + f.w + margin && y > f.y - margin && y < f.y + f.h + margin;
  });
}

/**
 * How much each pixel belongs to the graded colony core (1 = levelled by the builders): around
 * every footprint and along every tube and rover track. Craters and boulders stay out of it.
 */
function gradedZone() {
  const grade = new Float32Array(W * H);
  for (const id of LOCATION_IDS) {
    const f = LOCATION_LAYOUT[id].footprint;
    const m = 34;
    for (let y = Math.max(0, f.y - m); y < Math.min(H, f.y + f.h + m); y++)
      for (let x = Math.max(0, f.x - m); x < Math.min(W, f.x + f.w + m); x++) {
        const dx = Math.max(f.x - x, 0, x - (f.x + f.w));
        const dy = Math.max(f.y - y, 0, y - (f.y + f.h));
        const g = 1 - smoothstep(6, m, Math.hypot(dx, dy));
        if (g > grade[y * W + x]) grade[y * W + x] = g;
      }
  }
  for (const line of ROUTE_LINES)
    aroundLine(line.pts, 30, (x, y, hit) => {
      const g = 1 - smoothstep(line.surface ? 12 : 16, 30, hit.d);
      if (g > grade[y * W + x]) grade[y * W + x] = g;
    });
  return grade;
}

export function paintGround() {
  const r = rng(7);
  const height = new Float32Array(W * H);
  const albedo = new Float32Array(W * H);
  const fresh = new Float32Array(W * H);
  const grade = gradedZone();

  // rolling ground and a raised rim along the top (the solar farm sits on Shackleton's rim)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      height[i] = fbm(x, y, 320, 4, 11) * 12 + 10 * Math.exp(-(((y - 150) / 170) ** 2)) * (1 - x / (W * 1.6));
      albedo[i] = fbm(x, y, 360, 4, 31) * 2.2 + fbm(x, y, 22, 2, 37) * 0.6 + fbm(x, y, 6, 1, 39) * 0.2;
    }

  // the permanently shadowed crater, part of the base relief the builders graded around
  {
    const c = DARK_CRATER;
    for (let y = Math.floor(c.y - c.ry * 2.4); y < H; y++)
      for (let x = Math.max(0, Math.floor(c.x - c.rx * 2.4)); x < Math.min(W, c.x + c.rx * 2.4); x++) {
        if (y < 0) continue;
        const t = Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry) * (1 + fbm(x, y, 60, 2, 41) * 0.12);
        if (t >= 2.6) continue;
        const i = y * W + x;
        if (t < 1) height[i] *= 0.2 + 0.8 * t;
        height[i] += craterProfile(t, c.depth, 16, 4);
      }
  }
  const base = new Float32Array(height);
  for (let i = 0; i < W * H; i++) height[i] += fbm(i % W, (i / W) | 0, 40, 3, 23) * 2.5 * (1 - grade[i]);

  // craters outside the core, many small and few large; big ones are older and softer
  const craters = [];
  while (craters.length < 170) {
    const rad = 2.5 + 85 * r() ** 4.2;
    const x = r() * W;
    const y = r() * H;
    const age = 0.45 + r() * 0.55;
    const fr = rad < 30 && r() < 0.14;
    const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    if (grade[yi * W + xi] > (rad > 12 ? 0.02 : 0.6)) continue;
    craters.push({ x, y, rad, age, fresh: fr });
  }
  craters.sort((a, b) => b.rad - a.rad);
  for (const c of craters) {
    const depth = c.rad * (c.rad > 30 ? 0.22 : 0.34) * c.age;
    const rim = depth * 0.4;
    const flat = c.rad > 40 ? 3.2 : 2;
    const reach = c.rad * 2.6;
    for (let y = Math.max(0, Math.floor(c.y - reach)); y < Math.min(H, c.y + reach); y++)
      for (let x = Math.max(0, Math.floor(c.x - reach)); x < Math.min(W, c.x + reach); x++) {
        const t = Math.hypot(x - c.x, y - c.y) / c.rad;
        if (t >= 2.6) continue;
        const i = y * W + x;
        if (t < 1) height[i] = base[i] + (height[i] - base[i]) * (0.4 + 0.6 * t);
        height[i] += craterProfile(t, depth, rim, flat);
        if (c.fresh && t > 0.9 && t < 2.4) {
          const ray = hash2(Math.round(Math.atan2(y - c.y, x - c.x) * 9), 0, Math.round(c.x)) * 0.8 + 0.4;
          fresh[i] = Math.max(fresh[i], (1 - (t - 0.9) / 1.5) * ray * 0.8);
        }
      }
  }

  // boulders: small sharp bumps that throw long shadows
  for (let n = 0; n < 520; n++) {
    const x = r() * W;
    const y = r() * H;
    const rad = 1.2 + r() ** 2.5 * 6;
    const hgt = rad * (1.1 + r() * 0.8);
    if (grade[Math.min(H - 1, Math.round(y)) * W + Math.min(W - 1, Math.round(x))] > 0.3) continue;
    for (let j = -Math.ceil(rad); j <= Math.ceil(rad); j++)
      for (let i = -Math.ceil(rad); i <= Math.ceil(rad); i++) {
        const px = Math.round(x + i);
        const py = Math.round(y + j);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const t = (i * i + j * j * 1.4) / (rad * rad);
        if (t < 1) height[py * W + px] += hgt * Math.sqrt(1 - t);
      }
  }

  // grade the core: level it to the base relief, with a low berm of pushed regolith at its edge
  for (let i = 0; i < W * H; i++) {
    const g = grade[i];
    if (g <= 0) continue;
    height[i] += (base[i] - height[i]) * smoothstep(0.15, 0.7, g);
    height[i] += 0.8 * Math.max(0, 1 - Math.abs(g - 0.3) / 0.22);
    fresh[i] *= 1 - g;
    albedo[i] = albedo[i] * (1 - g * 0.5) - 0.35 * g;
  }

  // rover tracks: compacted, two tyre ruts with tread marks, low berms
  for (const line of ROUTE_LINES) {
    if (!line.surface) continue;
    aroundLine(line.pts, 16, (x, y, hit) => {
      const i = y * W + x;
      const off = hit.d;
      if (off < 12) {
        albedo[i] = Math.min(albedo[i], 0.3) * 0.4 - 1;
        const rut = Math.abs(off - 6);
        if (rut < 1.6) albedo[i] -= Math.floor(hit.along / 3) % 2 ? 1.2 : 2;
        else if (hash2(x, y, 5) < 0.08) albedo[i] -= 0.8;
      } else if (off < 15) {
        height[i] += 1.4 * (1 - Math.abs(off - 13) / 2);
        albedo[i] += 0.5;
      }
    });
  }

  // structures add height for shadows only
  const struct = structureHeights();
  const posts = beaconPosts();
  for (const p of posts)
    for (let j = -1; j <= 0; j++)
      for (let i = -1; i <= 0; i++) struct[(p.y + j) * W + p.x + i] = Math.max(struct[(p.y + j) * W + p.x + i], 9);

  // ambient occlusion: the ground darkens where it meets building walls and tube sides
  const walls = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) walls[i] = struct[i] > 0 ? 1 : 0;
  const near = blur(walls, 5);
  const ao = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) ao[i] = walls[i] ? 0 : near[i];

  // lighting, evaluated at ART_SCALE pixels per world pixel from the bilinearly sampled fields
  const W2 = W * S;
  const H2 = H * S;
  const up = (src) => {
    const out = new Float32Array(W2 * H2);
    for (let y = 0; y < H2; y++) {
      const fy = Math.max(0, Math.min(H - 1, (y + 0.5) / S - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(H - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < W2; x++) {
        const fx = Math.max(0, Math.min(W - 1, (x + 0.5) / S - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(W - 1, x0 + 1);
        const tx = fx - x0;
        const a = src[y0 * W + x0] + (src[y0 * W + x1] - src[y0 * W + x0]) * tx;
        const b = src[y1 * W + x0] + (src[y1 * W + x1] - src[y1 * W + x0]) * tx;
        out[y * W2 + x] = a + (b - a) * ty;
      }
    }
    return out;
  };
  const height2 = up(height);
  const albedo2 = up(albedo);
  const fresh2 = up(fresh);
  const ao2 = up(ao);
  const occ = up(struct);
  let maxOcc = -Infinity;
  for (let i = 0; i < W2 * H2; i++) {
    occ[i] += height2[i];
    if (occ[i] > maxOcc) maxOcc = occ[i];
  }
  const slope = SUN_SLOPE / S;
  const img = new Img(W2, H2);
  const reg = RAMPS.regolith;
  const cold = RAMPS.cold;
  const ice = RAMPS.ice;
  const dc = DARK_CRATER;
  for (let y = 0; y < H2; y++)
    for (let x = 0; x < W2; x++) {
      const i = y * W2 + x;
      const wx = (x + 0.5) / S;
      const wy = (y + 0.5) / S;
      const hx = ((height2[y * W2 + Math.min(W2 - 1, x + 1)] - height2[y * W2 + Math.max(0, x - 1)]) / 2) * S;
      const hy = ((height2[Math.min(H2 - 1, y + 1) * W2 + x] - height2[Math.max(0, y - 1) * W2 + x]) / 2) * S;
      const nl = Math.hypot(hx, hy, 1);
      const shade = (-hx * LIGHT[0] - hy * LIGHT[1] + LIGHT[2]) / nl - LIGHT[2];
      // ray-march towards the sun
      const o = occ[i];
      const tMax = Math.min(420 * S, (maxOcc - o) / slope);
      let lit = true;
      for (let t = 2; t < tMax; t += t < 40 * S ? 1 : 2) {
        const sx = Math.round(x + SUN.x * t);
        const sy = Math.round(y + SUN.y * t);
        if (sx < 0 || sy < 0 || sx >= W2 || sy >= H2) break;
        if (occ[sy * W2 + sx] > o + t * slope) {
          lit = false;
          break;
        }
      }
      const edge = Math.min(wx, wy, W - wx, H - wy);
      const vignette = 1.6 * (1 - smoothstep(0, 90, edge));
      const td = Math.hypot((wx - dc.x) / dc.rx, (wy - dc.y) / dc.ry);
      const inDark = td < 0.86 || (td < 1 && !lit);
      const dither = bayer(x, y) - 0.5;
      const occl = ao2[i] * 2.2;
      let c;
      if (inDark) {
        // permanently shadowed: cold floor with frost patches and ice glints
        const frost = fbm(wx, wy, 70, 3, 53) + (1 - td) * 0.35;
        const v = 2.7 + shade * 4 + albedo2[i] * 0.4 + frost * 2.6 - vignette * 0.6 - occl * 0.5;
        c = cold[Math.max(0, Math.min(cold.length - 1, Math.floor(v + 0.5 + dither * 0.6)))];
        if (frost > 0.3 && hash2(x, y, 61) < 0.0006) c = ice[3];
      } else if (lit) {
        const v = 6.1 + shade * 6 + albedo2[i] + fresh2[i] - vignette - occl;
        c = reg[Math.max(1, Math.min(reg.length - 1, Math.floor(v + 0.5 + dither * 0.6)))];
      } else {
        const v = 3.6 + shade * 3 + albedo2[i] * 0.5 + fresh2[i] * 0.4 - vignette * 0.7 - occl * 0.6;
        c = cold[Math.max(0, Math.min(cold.length - 1, Math.floor(v + 0.5 + dither * 0.6)))];
      }
      img.put(x, y, c);
    }

  // tubes and beacons are painted in world pixels and scaled up on top
  const top = new Img(W, H);
  paintTubes(top);
  for (const p of posts) paintPost(top, p.x, p.y);
  img.blit(S === 1 ? top : top.upscale2x(), 0, 0);
  return img;
}

/**
 * Pressurised tubes, open-top like the buildings: a grated walkway between two walls. Horizontal
 * runs show the inside face of their north wall and the outside face of their south wall.
 */
function paintTubes(img) {
  const best = new Map();
  for (const line of TUBE_LINES)
    aroundLine(line.pts, 17, (x, y, hit) => {
      const k = y * W + x;
      const prev = best.get(k);
      if (!prev || hit.d < prev.d) best.set(k, hit);
    });
  const m = RAMPS.metal;
  const teal = RAMPS.teal;
  for (const [k, hit] of best) {
    const x = k % W;
    const y = (k - x) / W;
    if (buildingAt(x, y)) continue;
    const horizontal = Math.abs(hit.b.x - hit.a.x) >= Math.abs(hit.b.y - hit.a.y);
    // signed offset across the tube: negative = north (horizontal) or west (vertical)
    const v = horizontal ? y + 0.5 - hit.a.y : x + 0.5 - hit.a.x;
    const d = hit.d;
    const along = horizontal ? x : y;
    const rib = ((along % 32) + 32) % 32;
    let c = null;
    if (horizontal) {
      if (v < 0) {
        if (d < 9) c = floorPixel(x, y, along);
        else if (d < 10) c = m[1];
        else if (d < 15) c = rib < 3 ? m[rib === 1 ? 6 : 5] : wallFace(along, d - 10, teal, m);
        else if (d < 17) c = rib < 3 ? m[8] : m[d < 16 ? 7 : 6];
        else if (d < 18) c = m[0];
      } else {
        if (d < 9) c = floorPixel(x, y, along);
        else if (d < 12) c = rib < 3 ? m[7] : m[d < 10 ? 6 : 5];
        else if (d < 13) c = m[1];
        else if (d < 16) c = rib < 3 ? m[4] : m[d < 14 ? 3 : 2];
        else if (d < 17) c = m[0];
      }
    } else {
      if (d < 9) c = floorPixel(x, y, along);
      else if (d < 13) c = rib < 3 ? m[v < 0 ? 8 : 6] : v < 0 ? m[d < 10 ? 6 : 7] : m[d < 10 ? 4 : 5];
      else if (d < 14) c = m[0];
    }
    if (c) img.put(x, y, c);
  }
}

function floorPixel(x, y, along) {
  const m = RAMPS.metal;
  const plate = ((along % 32) + 32) % 32;
  if (plate === 0) return m[1];
  if ((x + y) % 4 === 0) return m[2];
  return (x % 2 === 0) !== (y % 2 === 0) ? m[3] : m[3];
}

/** Inside face of a horizontal tube's north wall: darker at the bottom, a lamp every 96 px. */
function wallFace(along, depth, teal, m) {
  const lamp = ((along % 96) + 96) % 96;
  if (lamp >= 46 && lamp < 50 && depth >= 1 && depth < 3) return teal[lamp === 46 || lamp === 49 ? 3 : 5];
  if (lamp >= 44 && lamp < 52 && depth >= 0 && depth < 4) return teal[2];
  return m[depth < 1 ? 5 : depth < 3 ? 4 : 3];
}

/** A small beacon post with a red light, beside the rover tracks. */
function paintPost(img, x, y) {
  const m = RAMPS.metal;
  const red = RAMPS.red;
  img.rect(x - 1, y - 7, 2, 7, m[5]);
  img.vline(x, y - 7, y - 1, m[3]);
  img.put(x - 1, y - 9, red[4]);
  img.put(x, y - 9, red[3]);
  img.put(x - 1, y - 8, red[2]);
  img.put(x, y - 8, red[2]);
  img.set(x - 2, y - 9, [248, 138, 122, 90]);
  img.set(x + 1, y - 9, [248, 138, 122, 90]);
  img.set(x - 1, y - 10, [248, 138, 122, 90]);
  img.set(x, y - 10, [248, 138, 122, 90]);
  img.put(x - 2, y, m[1]);
  img.put(x + 1, y, m[1]);
}
