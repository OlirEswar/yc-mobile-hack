/**
 * Composites the generated art into preview images: the whole map with every building, a crowd
 * of colonists at their stand areas and the overlays on top, plus zoomed crops.
 * Run from the repo root or mobile/: node mobile/tools/art/preview.mjs  (after generate.mjs)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Img, decodePng, encodePng } from './lib/image.mjs';
import { rng } from './lib/noise.mjs';
import { ART_SCALE as S, LOCATION_IDS, LOCATION_LAYOUT, MAP_HEIGHT, MAP_WIDTH, SPRITE_ARCHETYPES, SPRITE_VARIANTS } from './lib/layout.mjs';
import { FEET, FRAMES, FRAME_H, FRAME_W } from './characters.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '../../assets/game');
const OUT = process.argv[2] ?? join(HERE, 'previews');
const load = (name) => decodePng(readFileSync(join(ASSETS, name)));

const scene = new Img(MAP_WIDTH * S, MAP_HEIGHT * S);
scene.blit(load('ground.png'), 0, 0);
for (const id of LOCATION_IDS) {
  const f = LOCATION_LAYOUT[id].footprint;
  scene.blit(load('buildings/' + id + '_base.png'), f.x * S, f.y * S);
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
    scene.blit(cell, p.x * S - meta.feet.x, p.y * S - meta.feet.y);
  }
}
for (const id of LOCATION_IDS) {
  const f = LOCATION_LAYOUT[id].footprint;
  const file = 'buildings/' + id + '_overlay.png';
  if (existsSync(join(ASSETS, file))) scene.blit(load(file), f.x * S, f.y * S);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'map.png'), encodePng(halve(scene)));
writeFileSync(join(OUT, 'map_half.png'), encodePng(halve(halve(scene))));
const crops = {
  core: [400, 520, 480, 400],
  north: [60, 60, 620, 420],
  port: [780, 60, 440, 420],
  east: [780, 560, 440, 400],
  farm: [40, 900, 500, 340],
  works: [700, 900, 520, 420],
  homes: [60, 1260, 600, 340],
  bunks: [640, 1260, 600, 340],
  south: [60, 1560, 620, 360],
  quarry: [740, 1600, 500, 320],
};
for (const [name, [x, y, w, h]] of Object.entries(crops)) writeFileSync(join(OUT, 'crop_' + name + '.png'), encodePng(scene.crop(x * S, y * S, w * S, h * S)));
if (process.argv[3]) {
  const [x, y, w, h, k] = process.argv[3].split(',').map(Number);
  writeFileSync(join(OUT, 'crop_custom.png'), encodePng(scene.crop(x * S, y * S, w * S, h * S).scaled(k || 1)));
}

// characters: the four standing directions of every sprite, then one full walk cycle per archetype
{
  const atlas = load('characters.png');
  const sheet = new Img(FRAME_W * 24, FRAME_H * 10);
  sheet.rect(0, 0, sheet.w, sheet.h, [106, 102, 107, 255]);
  for (let a = 0; a < SPRITE_ARCHETYPES.length; a++)
    for (let v = 0; v < SPRITE_VARIANTS; v++)
      for (let d = 0; d < 4; d++) sheet.blitRect(atlas, d * FRAMES * FRAME_W, (a * SPRITE_VARIANTS + v) * FRAME_H, FRAME_W, FRAME_H, (v * 4 + d) * FRAME_W, a * FRAME_H);
  writeFileSync(join(OUT, 'characters.png'), encodePng(sheet));
  const walk = new Img(FRAME_W * 16, FRAME_H * 10);
  walk.rect(0, 0, walk.w, walk.h, [106, 102, 107, 255]);
  for (let a = 0; a < SPRITE_ARCHETYPES.length; a++) walk.blitRect(atlas, 0, (a * SPRITE_VARIANTS + (a % SPRITE_VARIANTS)) * FRAME_H, FRAME_W * 16, FRAME_H, 0, a * FRAME_H);
  writeFileSync(join(OUT, 'walk_cycles.png'), encodePng(walk));
}
// portraits, icons and fx
{
  const sheet = new Img(128 * 10, 128 * 6 + 120);
  sheet.rect(0, 0, sheet.w, sheet.h, [24, 26, 38, 255]);
  SPRITE_ARCHETYPES.forEach((a, i) => {
    for (let v = 0; v < SPRITE_VARIANTS; v++) sheet.blit(load('portraits/' + a + '_' + v + '.png'), i * 128, v * 128);
  });
  const y = 128 * 6 + 8;
  const icons = ['drought', 'storm', 'grant', 'kill', 'whisper', 'rumor', 'create_character'].map((p) => 'icons/power_' + p + '.png');
  icons.forEach((f, i) => sheet.blit(load(f), 8 + i * 40, y));
  ['food', 'water', 'parts', 'medicine', 'credits'].forEach((r, i) => sheet.blit(load('icons/res_' + r + '.png'), 300 + i * 32, y + 4));
  sheet.blit(load('fx/grave.png'), 470, y);
  sheet.blit(load('fx/selection.png'), 500, y + 6);
  sheet.rect(8, y + 44, 128 * 2 + 8, 66, [106, 102, 107, 255]);
  sheet.blit(load('fx/storm_overlay.png').crop(0, 0, 128, 64), 8, y + 46);
  sheet.blit(load('fx/drought_overlay.png').crop(0, 0, 128, 64), 144, y + 46);
  writeFileSync(join(OUT, 'portraits_icons_fx.png'), encodePng(sheet));
}
// every building with its damaged layer at full strength
{
  const hurt = new Img(MAP_WIDTH * S, MAP_HEIGHT * S);
  hurt.blit(load('ground.png'), 0, 0);
  for (const id of LOCATION_IDS) {
    const f = LOCATION_LAYOUT[id].footprint;
    hurt.blit(load('buildings/' + id + '_base.png'), f.x * S, f.y * S);
    hurt.blit(load('buildings/' + id + '_damaged.png'), f.x * S, f.y * S);
    hurt.blit(load('buildings/' + id + '_overlay.png'), f.x * S, f.y * S);
  }
  writeFileSync(join(OUT, 'damaged.png'), encodePng(halve(halve(hurt))));
  writeFileSync(join(OUT, 'damaged_crop.png'), encodePng(hurt.crop(100 * S, 520 * S, 760 * S, 520 * S)));
}

/** Half-size copy by picking one pixel of each 2x2 block, so it stays crisp pixel art. */
function halve(img) {
  const out = new Img(img.w / 2, img.h / 2);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.put(x, y, img.get(x * 2, y * 2));
  return out;
}
console.log('previews written to', OUT);
