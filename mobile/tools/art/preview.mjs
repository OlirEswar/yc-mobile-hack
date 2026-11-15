/**
 * Composites the generated art into preview images: the whole map with every building, a crowd
 * of colonists at their stand areas and the overlays on top, plus zoomed crops.
 * Run from the repo root or mobile/: node mobile/tools/art/preview.mjs  (after generate.mjs)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Img, decodePng, encodePng } from './lib/image.mjs';
import { rng } from './lib/noise.mjs';
import { LOCATION_IDS, LOCATION_LAYOUT, MAP_HEIGHT, MAP_WIDTH, SPRITE_ARCHETYPES, SPRITE_VARIANTS } from './lib/layout.mjs';
import { FEET, FRAMES, FRAME_H, FRAME_W } from './characters.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '../../assets/game');
const OUT = process.argv[2] ?? join(HERE, 'previews');
const load = (name) => decodePng(readFileSync(join(ASSETS, name)));

const scene = new Img(MAP_WIDTH, MAP_HEIGHT);
scene.blit(load('ground.png'), 0, 0);
for (const id of LOCATION_IDS) {
  const f = LOCATION_LAYOUT[id].footprint;
  scene.blit(load('buildings/' + id + '_base.png'), f.x, f.y);
}
const meta = { frameWidth: FRAME_W, frameHeight: FRAME_H, framesPerDirection: FRAMES, feet: FEET, rows: SPRITE_ARCHETYPES.length * SPRITE_VARIANTS };
{
  const atlas = load('characters.png');
  const r = rng(5);
  const people = [];
  for (const id of LOCATION_IDS)
    for (const a of LOCATION_LAYOUT[id].standAreas) {
      const n = Math.max(1, Math.round((a.w * a.h) / 2600));
      for (let k = 0; k < n; k++) people.push({ x: Math.round(a.x + 6 + r() * (a.w - 12)), y: Math.round(a.y + 6 + r() * (a.h - 12)), row: Math.floor(r() * meta.rows), dir: Math.floor(r() * 4), frame: Math.floor(r() * meta.framesPerDirection) });
    }
  people.sort((p, q) => p.y - q.y);
  for (const p of people) {
    const col = p.dir * meta.framesPerDirection + p.frame;
    const cell = atlas.crop(col * meta.frameWidth, p.row * meta.frameHeight, meta.frameWidth, meta.frameHeight);
    scene.blit(cell, p.x - meta.feet.x, p.y - meta.feet.y);
  }
}
for (const id of LOCATION_IDS) {
  const f = LOCATION_LAYOUT[id].footprint;
  const file = 'buildings/' + id + '_overlay.png';
  if (existsSync(join(ASSETS, file))) scene.blit(load(file), f.x, f.y);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'map.png'), encodePng(scene));
const crops = {
  core: [400, 520, 480, 400],
  north: [60, 60, 620, 420],
  south: [60, 1560, 620, 360],
  works: [700, 900, 520, 420],
  homes: [60, 1260, 600, 340],
};
for (const [name, [x, y, w, h]] of Object.entries(crops)) writeFileSync(join(OUT, 'crop_' + name + '.png'), encodePng(scene.crop(x, y, w, h).scaled(2)));
if (process.argv[3]) {
  const [x, y, w, h, k] = process.argv[3].split(',').map(Number);
  writeFileSync(join(OUT, 'crop_custom.png'), encodePng(scene.crop(x, y, w, h).scaled(k || 2)));
}
console.log('previews written to', OUT);
