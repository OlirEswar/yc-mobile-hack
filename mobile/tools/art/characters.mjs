/**
 * The colonists: 10 archetypes x 6 variants, each in 4 directions x 4 walk frames of 32x40, plus a
 * 64x64 portrait drawn from the same parts. Bodies are stamped from small templates whose letters
 * map to a per-colonist palette, then outlined; side views are drawn facing left and mirrored.
 */
import { Img } from './lib/image.mjs';
import { INK, RAMPS, fade, tone } from './lib/palette.mjs';
import { rgba } from './lib/image.mjs';
import { SPRITE_ARCHETYPES, SPRITE_VARIANTS } from './lib/layout.mjs';

export const FRAME_W = 32;
export const FRAME_H = 40;
export const FRAMES = 4;
/** The point between the feet, which sits on the colonist's world position. */
export const FEET = { x: 16, y: 37 };
export const PORTRAIT = 64;

const ramp3 = (...h) => h.map((c) => rgba(c));
const SKINS = [
  ramp3('#f7dcc4', '#e9b996', '#c98d6c'),
  ramp3('#f0c79e', '#d9a173', '#ab7350'),
  ramp3('#dba46c', '#bc8048', '#8c5a31'),
  ramp3('#b67d52', '#93603a', '#6b4227'),
  ramp3('#8d5a37', '#6e4127', '#4d2b19'),
  ramp3('#654030', '#4c2e21', '#331d14'),
];
const HAIRS = {
  black: ramp3('#4a4352', '#2e2934', '#18151d'),
  brown: ramp3('#9a6a42', '#6e4629', '#45291a'),
  blonde: ramp3('#f4dc94', '#d9b25a', '#a57f34'),
  red: ramp3('#de7a46', '#b04a2a', '#76281a'),
  grey: ramp3('#d2d2da', '#a0a0ae', '#6c6c7a'),
  blue: ramp3('#5a92cc', '#33609a', '#1e3a60'),
  white: ramp3('#f4f4f8', '#d6d6e0', '#a4a4b4'),
};
const r3 = (name, i) => [tone(name, i + 1), tone(name, i), tone(name, i - 1)];

// ---------- templates ----------
// Keys: K k q skin (light, mid, shade); H h j hair; S s z suit; a accent; T t belt; L l m pants;
// B b o boots and sole; g hands; e w eye dark and highlight; n mouth; c cheek.

const HEAD_FRONT = [
  '....kkkkkk....',
  '..kkKKKKKKkk..',
  '.kKKKKKKKKKKk.',
  '.kKKKKKKKKKKq.',
  'kKKKKKKKKKKKKq',
  'kKKKKKKKKKKKKq',
  'kKKweKKKKweKkq',
  'kKKeeKKKKeeKkq',
  'kKcKKKKKKKKckq',
  '.kKKKKKKKKKkq.',
  '.qkKKKnnKKkkq.',
  '..qqkkkkkkqq..',
  '....qqqqqq....',
];
const HEAD_SIDE = [
  '...kkkkkk...',
  '.kkKKKKKKkk.',
  'kKKKKKKKKKKk',
  'kKKKKKKKKKKq',
  'KKKKKKKKKKkq',
  'KKKKKKKKKKkq',
  'KweKKKKKKKkq',
  'KeeKKKKKKkkq',
  'KcKKKKKKKkkq',
  'KKKKKKKKKkq.',
  'nKKKKKKKkkq.',
  '.qkkkkkkkqq.',
  '...qqqqqq...',
];
const HEAD_BACK = HEAD_FRONT.map((r) => r.replace(/[ewnc]/g, 'K'));

/** Hair per style and view, origin (8, 2), 16 wide. '.' leaves the head showing. */
const HAIR = {
  short: {
    front: ['', '', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHhHHHHHhhj.', '.jhHhhHhhHHhhhj.', '.jhh.hh..hhh.hj.', '.jh..........hj.', '.jh..........jj.', '..j...........j.'],
    side: ['', '', '......jhhhhj....', '....jhHHHHHhhj..', '...jhHHHHHHHhhj.', '..jhHHHHHHHhhhj.', '..jhhHhHHHhhhhj.', '..jh.h.hhhhhhhj.', '..j......hhhhjj.', '.........hhhhj..', '.........jhhhj..', '..........jjj...'],
    back: ['', '', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHHHHHHhhj.', '.jhHHhHHHHhHhhj.', '.jhhHhhHHhhhhhj.', '.jhhhhhhhhhhhhj.', '.jhhhhhhhhhhhjj.', '.jjhhhhhhhhhjj..', '..jjhhhhhhhjj...', '....jjjjjjjj....'],
  },
  long: {
    front: ['', '', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHhHHHHhhj.', '.jhHHhhHhhHhhhj.', '.jhhh.h..hh.hhj.', 'jhhh........hhhj', 'jhh..........hhj', 'jhh..........hhj', 'jhh..........hhj', 'jhh..........hhj', 'jhj..........jhj', 'jhj..........jhj', 'jj............jj', 'j..............j'],
    side: ['', '', '......jhhhhj....', '....jhHHHHHhhj..', '...jhHHHHHHHhhj.', '..jhHHHHHHHhhhj.', '..jhhHhHHHhhhhj.', '..jh.h.hhhhhhhhj', '..j......hhhhhhj', '.........hhhhhhj', '.........hhhhhhj', '.........jhhhhhj', '.........jhhhhj.', '.........jhhhhj.', '..........jhhj..', '..........jjj...'],
    back: ['', '', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHHHHHHhhj.', '.jhHHhHHHHhHhhj.', '.jhhHhhHHhhhhhj.', 'jhhhhhhhhhhhhhhj', 'jhhhhhhhhhhhhhhj', 'jhhhhHhhhhHhhhhj', 'jhhhhhhhhhhhhhhj', 'jhhhhhhhhhhhhhhj', 'jhhhhhhhhhhhhhhj', '.jhhhhhhhhhhhhj.', '.jjhhhhhhhhhhjj.', '...jjjjjjjjjj...'],
  },
  curly: {
    front: ['', '....jhhjjhhj....', '..jhHHhHHhHHhj..', '.jhHHhHHHHhHHhj.', 'jhHhHHHhHHHhHhhj', 'jhHHhHHHHhHHhhhj', 'jhhHHhhHhhHhhhhj', 'jhhh.hh.hh.hhhhj', 'jhh..........hhj', '.jh..........hj.', '.jh..........hj.', '..j..........j..'],
    side: ['', '.....jhhjjhhj...', '...jhHHhHHhHHhj.', '..jhHHhHHHHhHHhj', '.jhHhHHHhHHHhHhj', '.jhHHhHHHHhHHhhj', '.jhhHhhHhhHhhhhj', '.jh.h.hhhhhhhhhj', '.j.......hhhhhhj', '.........hhhhhhj', '.........jhhhhj.', '..........jjjj..'],
    back: ['', '....jhhjjhhj....', '..jhHHhHHhHHhj..', '.jhHHhHHHHhHHhj.', 'jhHhHHHhHHHhHhhj', 'jhHHhHHHHhHHhhhj', 'jhhHHhhHhhHhhhhj', 'jhhhhhhhhhhhhhhj', 'jhhhHhhhhhHhhhhj', 'jhhhhhhhhhhhhhhj', '.jhhhhhhhhhhhhj.', '.jjhhhhhhhhhhjj.', '...jjjjjjjjjj...'],
  },
  bun: {
    front: ['......jhhj......', '.....jHHHhj.....', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHHHHHHhhj.', '.jhHhhhhhhhhhhj.', '.jhh........hhj.', '.jh..........hj.', '.jh..........jj.', '..j...........j.'],
    side: ['........jhhj....', '.......jHHHhj...', '.......jhhhhj...', '....jhHHHHHhhj..', '...jhHHHHHHHhhj.', '..jhHHHHHHHhhhj.', '..jhhhhhhhhhhhj.', '..jh.....hhhhhj.', '..j......hhhhjj.', '.........hhhhj..', '.........jhhhj..', '..........jjj...'],
    back: ['......jhhj......', '.....jHHHhj.....', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHHHHHHhhj.', '.jhHHhHHHHhHhhj.', '.jhhHhhHHhhhhhj.', '.jhhhhhhhhhhhhj.', '.jhhhhhhhhhhhjj.', '.jjhhhhhhhhhjj..', '..jjhhhhhhhjj...', '....jjjjjjjj....'],
  },
  buzz: {
    front: ['', '', '', '....jhhhhhhj....', '..jhhHhHhHhhhj..', '.jhhhhhhhhhhhhj.', '.jh..........hj.', '.j............j.'],
    side: ['', '', '', '.....jhhhhhhj...', '...jhhHhHhhhhhj.', '..jhhhhhhhhhhhj.', '..j.......hhhhj.', '..........hhhj..', '..........jjj...'],
    back: ['', '', '', '....jhhhhhhj....', '..jhhHhHhHhhhj..', '.jhhhhhhhhhhhhj.', '.jhhhhhhhhhhhhj.', '.jhhhhhhhhhhhhj.', '.jhhhhhhhhhhhhj.', '..jhhhhhhhhhhj..', '...jjjjjjjjjj...'],
  },
  bob: {
    front: ['', '', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHHHHHhhhj.', '.jhHHHHHHhhhhhj.', '.jhHHHHHhhhhhhj.', 'jhhh.......hhhhj', 'jhh.........hhhj', 'jhh..........hhj', 'jhh..........hhj', '.jj..........jj.'],
    side: ['', '', '......jhhhhj....', '....jhHHHHHhhj..', '...jhHHHHHHHhhj.', '..jhHHHHHHHhhhj.', '..jhHHHHhhhhhhj.', '..jhhh.hhhhhhhhj', '..jh.....hhhhhhj', '..j......hhhhhhj', '.........hhhhhhj', '.........jhhhhhj', '..........jjjjj.'],
    back: ['', '', '.....jhhhhj.....', '...jhhHHHHhhj...', '..jhHHHHHHHHhj..', '.jhHHHHHHHHHhhj.', '.jhHHhHHHHhHhhj.', '.jhhHhhHHhhhhhj.', 'jhhhhhhhhhhhhhhj', 'jhhhhhhhhhhhhhhj', 'jhhhhhhhhhhhhhhj', 'jhhhhhhhhhhhhhhj', '.jjhhhhhhhhhhjj.', '...jjjjjjjjjj...'],
  },
};

const TORSO_FRONT = [
  '...sSSaaSSsz..',
  '.sSSSSSaSSSssz',
  'sSSSSSSaSSSssz',
  'sSSSSSSaSSSssz',
  'sSSSSSSaSSSssz',
  'sSSSSSSaSSSssz',
  'sSSSSSSaSSsszz',
  'zsssssSassszzz',
  'TTTTTTTtTTTTTT',
  'lLLLLLLLLLLLlm',
  'lLLLLLLmLLLLlm',
];
const TORSO_BACK = TORSO_FRONT.map((r, i) => (i === 0 ? '...sSSSSSSsz..' : r.replace('a', i < 7 ? 'S' : 's').replace('t', 'T').replace('aa', 'SS')));
const TORSO_SIDE = ['...sSSSsz..', '..sSSSSSsz.', '.sSSSSSSSz.', '.sSSSSSSSz.', '.sSSSSSSSz.', '.sSSSSSSSz.', '.sSSSSSSzz.', '.ssssssszz.', '.TTTTTTTTT.', '.lLLLLLLLm.', '.lLLLLLLLm.'];
const ARM_FRONT = ['.sS', 'sSS', 'sSs', 'sSs', 'sSs', 'sSs', 'sSs', 'ssz', 'gGg', '.gg'];
const ARM_FRONT_R = ['Ss.', 'Ssz', 'ssz', 'ssz', 'ssz', 'ssz', 'ssz', 'szz', 'gGg', 'gg.'];
const ARM_BACK_L = ['.ss', 'sss', 'ssz', 'ssz', 'ssz', 'ssz', 'ssz', 'szz', 'ggg', '.gg'];
const ARM_SIDE = ['sSs', 'sSs', 'sSs', 'sSz', 'sSz', 'sSz', 'ssz', 'ssz', 'gGg', 'ggg'];

/** Front/back legs per frame, origin (10, 30). */
const LEGS_FRONT = [
  ['lLLLm..lLLLm', 'lLLLm..lLLLm', 'lLLLm..lLLLm', 'lLLLm..lLLLm', 'bBBBb..bBBBb', 'bBBBb..bBBBb', 'obbbo..obbbo'],
  ['', 'lLLLm..lLLLm', 'lLLLm..lLLLm', 'lLLLm..bBBBb', 'lLLLm..bBBBb', 'bBBBb..obbbo', 'bBBBb.......', 'obbbo.......'],
  ['lLLLm..lLLLm', 'lLLLm..lLLLm', 'lLLLm..lLLLm', 'lLLLm..lLLLm', 'bBBBb..bBBBb', 'bBBBb..bBBBb', 'obbbo..obbbo'],
  ['', 'lLLLm..lLLLm', 'lLLLm..lLLLm', 'bBBBb..lLLLm', 'bBBBb..lLLLm', 'obbbo..bBBBb', '.......bBBBb', '.......obbbo'],
];
const BODY_DY = [0, 1, 0, 1];

// ---------- costumes ----------

const ACCENTS = ['red', 'teal', 'yellow', 'purple', 'orange', 'pink', 'blue', 'green'];

/** Everything that varies per sprite: palette, hair, headgear and costume flags. */
function specFor(archetype, v) {
  const skin = SKINS[[0, 2, 4, 1, 5, 3][v]];
  const hairNames = ['black', 'brown', 'blonde', 'red', 'black', 'grey'];
  const styles = ['short', 'long', 'curly', 'bun', 'bob', 'buzz'];
  const hairName = hairNames[(v + archetype.length) % 6];
  const style = styles[(v * 5 + archetype.length * 2) % 6];
  const accent = ACCENTS[(v * 3 + archetype.length) % ACCENTS.length];
  const base = {
    skin,
    hair: HAIRS[hairName],
    style,
    hat: null,
    suit: r3('metal', 5),
    accent: tone(accent, 4),
    accentRamp: accent,
    pants: r3('metal', 3),
    belt: [tone('metal', 2), tone('metal', 6)],
    boots: [tone('metal', 3), tone('metal', 2), tone('metal', 0)],
    hands: null,
    extras: [],
  };
  const s = { ...base };
  switch (archetype) {
    case 'farmer':
      s.suit = r3('green', 3 + (v % 2));
      s.pants = r3('green', 2);
      s.accent = tone('yellow', 4);
      s.belt = [tone('brown', 2), tone('yellow', 3)];
      s.boots = [tone('brown', 3), tone('brown', 2), tone('brown', 0)];
      s.hands = [tone('brown', 4), tone('brown', 3)];
      s.hat = v % 3 === 2 ? null : { kind: 'sunhat', ramp: ['yellow', 'brown', 'green'][v % 3], band: tone(['red', 'green', 'teal'][v % 3], 3) };
      s.extras = ['pocketLeaf'];
      break;
    case 'miner':
      s.suit = r3('orange', 3);
      s.pants = r3('orange', 2);
      s.accent = tone('metal', 7);
      s.belt = [tone('metal', 2), tone('yellow', 4)];
      s.boots = [tone('metal', 3), tone('metal', 2), tone('metal', 0)];
      s.hands = [tone('metal', 4), tone('metal', 3)];
      s.hat = { kind: 'helmet', shell: v % 2 ? 'metal' : 'orange', visor: 'teal', lamp: true };
      s.extras = ['stripes', 'pack'];
      break;
    case 'engineer':
      s.suit = r3('yellow', 3);
      s.pants = r3('yellow', 2);
      s.accent = tone('metal', 7);
      s.belt = [tone('brown', 2), tone('metal', 6)];
      s.boots = [tone('brown', 2), tone('brown', 1), tone('brown', 0)];
      s.hands = [tone('metal', 3), tone('metal', 2)];
      s.hat = { kind: 'hardhat', ramp: ['metal', 'orange', 'blue', 'metal', 'red', 'orange'][v], k: [7, 3, 3, 7, 3, 4][v] };
      s.extras = ['toolbelt', 'stripes'];
      break;
    case 'medic':
      s.suit = r3('metal', 7);
      s.pants = r3('metal', 6);
      s.accent = tone('red', 3);
      s.belt = [tone('metal', 5), tone('red', 3)];
      s.boots = [tone('metal', 7), tone('metal', 5), tone('metal', 2)];
      s.hands = [tone('teal', 4), tone('teal', 3)];
      s.hat = v % 2 ? { kind: 'headband', ramp: 'red' } : null;
      s.extras = ['cross'];
      break;
    case 'scientist':
      s.suit = r3('metal', 7);
      s.pants = r3('metal', 2);
      s.accent = tone(['blue', 'purple', 'teal', 'blue', 'green', 'red'][v], 3);
      s.belt = [tone('metal', 6), tone('metal', 6)];
      s.boots = [tone('metal', 2), tone('metal', 1), tone('metal', 0)];
      s.extras = ['coat', v % 3 !== 1 ? 'glasses' : null, 'tablet'];
      break;
    case 'merchant':
      s.suit = r3('purple', 3);
      s.pants = r3('purple', 1);
      s.accent = tone('yellow', 4);
      s.belt = [tone('yellow', 2), tone('yellow', 4)];
      s.boots = [tone('brown', 3), tone('brown', 2), tone('brown', 0)];
      s.hat = v % 2 === 0 ? { kind: 'cap', ramp: ['purple', 'teal', 'red'][v % 3], k: 2 } : null;
      s.extras = ['trim', 'satchel'];
      break;
    case 'guard':
      s.suit = r3('blue', 2);
      s.pants = r3('blue', 1);
      s.accent = tone('teal', 5);
      s.belt = [tone('metal', 1), tone('metal', 6)];
      s.boots = [tone('metal', 1), tone('metal', 0), tone('cold', 0)];
      s.hands = [tone('metal', 2), tone('metal', 1)];
      s.hat = { kind: 'helmet', shell: 'blue', visor: ['teal', 'green', 'red', 'teal', 'yellow', 'pink'][v], stripe: tone(['yellow', 'metal', 'red', 'teal', 'metal', 'yellow'][v], ['yellow', 'metal', 'red', 'teal', 'metal', 'yellow'][v] === 'metal' ? 8 : 4), lamp: false, guard: true };
      s.extras = ['pads', 'baton'];
      break;
    case 'official':
      s.suit = r3('metal', 4);
      s.pants = r3('metal', 3);
      s.accent = tone('metal', 8);
      s.belt = [tone('metal', 2), tone('yellow', 4)];
      s.boots = [tone('metal', 1), tone('metal', 0), tone('cold', 0)];
      s.extras = ['sash', 'pin'];
      s.sash = tone(['red', 'yellow', 'blue', 'red', 'yellow', 'teal'][v], 3);
      s.sashDark = tone(['red', 'yellow', 'blue', 'red', 'yellow', 'teal'][v], 2);
      if (s.style === 'long' || s.style === 'curly') s.style = 'short';
      break;
    case 'worker':
      s.suit = r3('brown', 3);
      s.pants = r3('brown', 2);
      s.accent = tone('brown', 5);
      s.belt = [tone('brown', 1), tone('metal', 6)];
      s.boots = [tone('brown', 2), tone('brown', 1), tone('brown', 0)];
      s.hat = v % 3 === 1 ? null : { kind: 'beanie', ramp: ['red', 'teal', 'yellow', 'blue', 'orange', 'green'][v], k: 3 };
      s.extras = ['sleeves', v % 3 === 1 ? 'apron' : null];
      break;
    case 'civilian': {
      const top = ['teal', 'pink', 'yellow', 'red', 'blue', 'green'][v];
      s.suit = r3(top, top === 'yellow' ? 3 : 3);
      s.pants = r3('blue', 2);
      s.accent = tone(top, 5);
      s.belt = [tone('blue', 1), tone('blue', 1)];
      s.boots = [tone('metal', 8), tone('metal', 6), tone('metal', 3)];
      s.extras = ['tee'];
      break;
    }
  }
  s.extras = s.extras.filter(Boolean);
  return s;
}

function paletteOf(s) {
  const [K, k, q] = s.skin;
  const [H, h, j] = s.hair;
  const [S, sm, z] = s.suit;
  const [L, l, m] = s.pants;
  const hands = s.hands ?? [k, q];
  return {
    K, k, q, H, h, j, S, s: sm, z, L, l, m,
    a: s.accent,
    T: s.belt[0],
    t: s.belt[1],
    B: s.boots[0],
    b: s.boots[1],
    o: s.boots[2],
    g: hands[1],
    G: hands[0],
    e: tone('cold', 0),
    w: tone('metal', 8),
    n: q,
    c: fade(tone('red', 4), 140),
  };
}

function stamp(img, x, y, rows, pal) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]];
      if (c) img.put(x + i, y + j, c);
    }
  });
}

// ---------- drawing one frame, facing down, up or left ----------

function drawHeadgear(img, s, view, dy) {
  const hat = s.hat;
  if (!hat) return;
  const y0 = 2 + dy;
  if (hat.kind === 'helmet' && hat.guard) {
    const cx = 15.5;
    for (let y = y0 + 1; y < y0 + 14; y++)
      for (let x = 7; x < 25; x++) {
        const d = ((x + 0.5 - cx) / 8.5) ** 2 + ((y + 0.5 - (y0 + 10)) / 9) ** 2;
        if (d > 1 || y > y0 + 12) continue;
        let c = x + y < cx + y0 + 5 ? tone('blue', 4) : d > 0.75 ? tone('blue', 1) : tone('blue', 2);
        if (view === 'side' && x > 18 && y > y0 + 9) c = tone('blue', 1);
        img.put(x, y, c);
      }
    if (view !== 'back') {
      const [vx0, vx1] = view === 'front' ? [9, 22] : [7, 15];
      for (let x = vx0; x <= vx1; x++) {
        img.put(x, y0 + 9, tone('cold', 1));
        img.put(x, y0 + 10, x % 3 ? tone(hat.visor, 4) : tone(hat.visor, 3));
        img.put(x, y0 + 11, tone('cold', 1));
      }
    }
    img.hline(13, 18, y0 + 2, tone('blue', 5));
    for (let y = y0 + 2; y < y0 + 8; y++) img.put(view === 'side' ? 16 : 15, y, hat.stripe);
    return;
  }
  if (hat.kind === 'helmet') {
    // a bubble helmet: shell around the head, visor where the face is
    const shell = hat.shell;
    const cx = view === 'side' ? 15.5 : 15.5;
    for (let y = y0; y < y0 + 18; y++)
      for (let x = 6; x < 26; x++) {
        const d = ((x + 0.5 - cx) / 9.5) ** 2 + ((y + 0.5 - (y0 + 9.5)) / 9.5) ** 2;
        if (d > 1) continue;
        const k = shell === 'metal' ? 6 : 3;
        let c = d > 0.8 ? tone(shell, k - 1) : x + y < cx + y0 + 4 ? tone(shell, k + 1) : tone(shell, k);
        const inVisor = view === 'front' ? x >= 9 && x <= 22 && y >= y0 + 7 && y <= y0 + 14 : view === 'side' ? x >= 7 && x <= 15 && y >= y0 + 7 && y <= y0 + 14 : false;
        if (inVisor) {
          const face = img.get(x, y);
          c = face[3] && (x + y) % 5 !== 0 ? mix(face, tone('teal', 2), 0.35) : tone('teal', 1);
          if (x + (y - y0) === 18) c = tone('ice', 4);
        }
        img.put(x, y, c);
      }
    if (hat.lamp) {
      const lx = view === 'side' ? 9 : 14;
      if (view !== 'back') {
        img.rect(lx, y0 + 1, 4, 3, tone('metal', 2));
        img.rect(lx + 1, y0 + 1, 2, 2, tone('yellow', 4));
        img.put(lx + 1, y0, fade(tone('yellow', 4), 160));
      } else img.rect(14, y0 + 1, 4, 2, tone('metal', 3));
    }
    return;
  }
  if (hat.kind === 'hardhat') {
    for (let y = y0 + 1; y < y0 + 8; y++)
      for (let x = 8; x < 24; x++) {
        const d = ((x + 0.5 - 15.5) / 8) ** 2 + ((y + 0.5 - (y0 + 8)) / 6.5) ** 2;
        if (d <= 1) img.put(x, y, x < 13 && y < y0 + 5 ? tone(hat.ramp, hat.k + 1) : x > 19 ? tone(hat.ramp, hat.k - 1) : tone(hat.ramp, hat.k));
      }
    const brimY = y0 + 7;
    const [bx0, bx1] = view === 'side' ? [5, 22] : [7, 24];
    for (let x = bx0; x <= bx1; x++) img.put(x, brimY, tone(hat.ramp, hat.k - 1));
    img.put(15, y0 + 2, tone(hat.ramp, hat.k + 1));
    img.put(16, y0 + 2, tone(hat.ramp, hat.k + 1));
    if (view === 'front') {
      img.rect(10, brimY + 1, 12, 2, tone('metal', 2));
      img.rect(11, brimY + 1, 3, 2, tone('teal', 4));
      img.rect(18, brimY + 1, 3, 2, tone('teal', 4));
    }
    return;
  }
  if (hat.kind === 'sunhat') {
    const brimY = y0 + 7;
    for (let x = 4; x < 28; x++) {
      const t = Math.abs(x + 0.5 - 16) / 12;
      if (t > 1) continue;
      img.put(x, brimY, tone(hat.ramp, 3));
      if (t < 0.92) img.put(x, brimY + 1, tone(hat.ramp, 2));
    }
    for (let y = y0 + 1; y < brimY; y++)
      for (let x = 9; x < 23; x++) {
        const d = ((x + 0.5 - 16) / 7) ** 2 + ((y + 0.5 - brimY) / 6.5) ** 2;
        if (d <= 1) img.put(x, y, y === brimY - 2 ? hat.band : x < 14 ? tone(hat.ramp, 4) : tone(hat.ramp, 3));
      }
    return;
  }
  if (hat.kind === 'cap' || hat.kind === 'beanie') {
    const ry = hat.kind === 'beanie' ? 7 : 6;
    for (let y = y0 + 1; y < y0 + 9; y++)
      for (let x = 7; x < 25; x++) {
        const d = ((x + 0.5 - 16) / 8.5) ** 2 + ((y + 0.5 - (y0 + 9)) / ry) ** 2;
        if (d <= 1) img.put(x, y, x < 13 && y < y0 + 5 ? tone(hat.ramp, hat.k + 1) : x > 20 ? tone(hat.ramp, hat.k - 1) : tone(hat.ramp, hat.k));
      }
    if (hat.kind === 'beanie') {
      img.hline(8, 23, y0 + 8, tone(hat.ramp, hat.k - 1));
      img.hline(8, 23, y0 + 7, tone(hat.ramp, hat.k + 1));
      for (let x = 9; x < 23; x += 2) img.put(x, y0 + 4, tone(hat.ramp, hat.k - 1));
    } else if (view === 'front') img.hline(9, 22, y0 + 8, tone(hat.ramp, hat.k - 1));
    else if (view === 'side') for (let x = 5; x < 12; x++) img.put(x, y0 + 8, tone(hat.ramp, hat.k - 1));
    if (hat.kind === 'cap') img.put(16, y0 + 1, tone('yellow', 4));
    return;
  }
  if (hat.kind === 'headband') {
    const y = y0 + 6;
    const [x0, x1] = view === 'side' ? [10, 21] : [9, 22];
    img.hline(x0, x1, y, tone(hat.ramp, 3));
    img.hline(x0, x1, y + 1, tone(hat.ramp, 2));
  }
}

const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), 255];

function legLine(img, hx, hy, fx, fy, pal, dark) {
  const len = Math.max(1, Math.hypot(fx - hx, fy - hy));
  for (let t = 0; t <= len; t++) {
    const x = Math.round(hx + ((fx - hx) * t) / len);
    const y = Math.round(hy + ((fy - hy) * t) / len);
    img.put(x - 2, y, dark ? pal.m : pal.l);
    img.put(x - 1, y, dark ? pal.l : pal.L);
    img.put(x, y, dark ? pal.l : pal.L);
    img.put(x + 1, y, pal.m);
  }
  // boot, toe pointing left
  img.rect(fx - 4, fy - 1, 6, 2, dark ? pal.b : pal.B);
  img.hline(fx - 4, fx + 1, fy + 1, pal.o);
  img.put(fx - 4, fy - 1, pal.b);
}

function drawFrame(img, s, dir, frame) {
  const pal = paletteOf(s);
  const dy = BODY_DY[frame];
  const view = dir === 0 ? 'front' : dir === 3 ? 'back' : 'side';
  const coat = s.extras.includes('coat');
  const coatPal = coat ? { ...pal, S: tone('metal', 8), s: tone('metal', 7), z: tone('metal', 5), a: s.accent } : pal;
  if (view !== 'side') {
    // legs, then arms behind (back view), torso, arms in front, head, hair, headgear
    stamp(img, 10, 30, LEGS_FRONT[frame], pal);
    const swing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    const torso = view === 'front' ? TORSO_FRONT : TORSO_BACK;
    stamp(img, 9, 19 + dy, torso, coatPal);
    const armPal = s.extras.includes('sleeves') ? { ...pal, s: pal.k, S: pal.K, z: pal.q } : coatPal;
    const armRows = (rows) => (s.extras.includes('sleeves') ? rows.map((r, i) => (i < 4 ? r.replace(/[sSz]/g, (c) => ({ s: 's', S: 'S', z: 'z' })[c]) : r)) : rows);
    if (view === 'front') {
      stamp(img, 6, 20 + dy + swing, armRows(ARM_FRONT), armPal);
      stamp(img, 23, 20 + dy - swing, armRows(ARM_FRONT_R), armPal);
    } else {
      stamp(img, 6, 20 + dy - swing, ARM_BACK_L, coatPal);
      stamp(img, 23, 20 + dy + swing, ARM_FRONT_R, coatPal);
    }
    if (coat) {
      // coat tails over the thighs, shirt showing at the neck
      for (let y = 29 + dy; y < 33 + dy; y++) for (let x = 9; x < 23; x++) if (!(view === 'front' && x >= 15 && x <= 16 && y > 29 + dy)) img.put(x, y, x < 11 ? coatPal.S : x > 20 ? coatPal.z : coatPal.s);
      if (view === 'front') {
        img.rect(14, 19 + dy, 4, 6, s.accent);
        img.vline(15, 25 + dy, 32 + dy, tone('metal', 5));
        img.put(13, 19 + dy, coatPal.S);
        img.put(18, 19 + dy, coatPal.S);
      }
    }
    costumeFront(img, s, pal, view, dy);
    stamp(img, 9, 6 + dy, view === 'front' ? HEAD_FRONT : HEAD_BACK, pal);
    if (view === 'front' && s.extras.includes('glasses')) {
      img.rect(11, 11 + dy, 4, 3, tone('metal', 1));
      img.rect(17, 11 + dy, 4, 3, tone('metal', 1));
      img.rect(12, 12 + dy, 2, 1, tone('ice', 3));
      img.rect(18, 12 + dy, 2, 1, tone('ice', 3));
      img.hline(15, 16, 11 + dy, tone('metal', 1));
    }
    if (!s.hat || s.hat.kind !== 'helmet') stamp(img, 8, 2 + dy, HAIR[s.style][view], pal);
    drawHeadgear(img, s, view, dy);
    if (view === 'front' && s.extras.includes('tablet')) {
      img.rect(21, 25 + dy, 6, 5, tone('metal', 1));
      img.rect(22, 26 + dy, 4, 3, tone('teal', 4));
    }
    if (view === 'back' && s.extras.includes('pack')) {
      img.rect(10, 20 + dy, 12, 9, tone('metal', 5));
      img.rect(10, 20 + dy, 12, 1, tone('metal', 7));
      img.rect(11, 22 + dy, 4, 5, tone('metal', 3));
      img.rect(17, 22 + dy, 4, 5, tone('metal', 3));
      img.put(20, 21 + dy, tone('green', 5));
    }
    if (view === 'back' && s.extras.includes('cross')) {
      img.rect(14, 21 + dy, 4, 6, tone('red', 3));
      img.rect(13, 22 + dy, 6, 3, tone('red', 3));
    }
    return;
  }
  // side view, facing left
  const swing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const hip = { x: 16, y: 30 + dy };
  // far leg and far arm first, darker
  legLine(img, hip.x + 1, hip.y, hip.x + 1 + swing * 4, 36 - (swing > 0 ? 1 : 0), pal, true);
  stamp(img, 15 - swing * 3, 20 + dy, ARM_SIDE.map((r) => r.replace(/S/g, 's').replace(/s/g, 'z')), coatPal);
  legLine(img, hip.x - 1, hip.y, hip.x - 1 - swing * 4, 36 - (swing < 0 ? 1 : 0), pal, false);
  stamp(img, 11, 19 + dy, TORSO_SIDE, coatPal);
  if (coat) for (let y = 29 + dy; y < 33 + dy; y++) for (let x = 12; x < 22; x++) img.put(x, y, x < 14 ? coatPal.S : x > 19 ? coatPal.z : coatPal.s);
  costumeSide(img, s, pal, dy);
  stamp(img, 14 + swing * 3, 20 + dy, ARM_SIDE, s.extras.includes('sleeves') ? { ...coatPal } : coatPal);
  stamp(img, 10, 6 + dy, HEAD_SIDE, pal);
  img.put(9, 14 + dy, pal.k);
  img.put(9, 13 + dy, pal.K);
  if (s.extras.includes('glasses')) {
    img.rect(9, 11 + dy, 4, 3, tone('metal', 1));
    img.rect(10, 12 + dy, 2, 1, tone('ice', 3));
    img.hline(13, 16, 11 + dy, tone('metal', 1));
  }
  if (!s.hat || s.hat.kind !== 'helmet') stamp(img, 8, 2 + dy, HAIR[s.style].side, pal);
  drawHeadgear(img, s, 'side', dy);
  if (s.extras.includes('pack')) {
    img.rect(20, 20 + dy, 4, 9, tone('metal', 4));
    img.vline(20, 20 + dy, 28 + dy, tone('metal', 6));
  }
}

function costumeFront(img, s, pal, view, dy) {
  const ex = s.extras;
  if (ex.includes('stripes')) {
    for (const x of [6, 7, 8, 23, 24, 25]) if (img.alpha(x, 25 + dy)) img.put(x, 25 + dy, tone('metal', 7));
    for (const x of [10, 11, 12, 13, 14, 17, 18, 19, 20, 21]) if (img.alpha(x, 32)) img.put(x, 32, tone('metal', 7));
  }
  if (ex.includes('toolbelt')) {
    img.rect(9, 27 + dy, 3, 3, tone('brown', 3));
    img.rect(20, 27 + dy, 3, 3, tone('brown', 3));
    img.put(10, 27 + dy, tone('metal', 7));
  }
  if (ex.includes('pocketLeaf') && view === 'front') {
    img.rect(18, 21 + dy, 3, 3, tone('green', 2));
    img.put(19, 20 + dy, tone('green', 5));
    img.put(18, 19 + dy, tone('green', 4));
  }
  if (ex.includes('cross') && view === 'front') {
    img.rect(18, 21 + dy, 3, 1, tone('red', 3));
    img.rect(19, 20 + dy, 1, 3, tone('red', 3));
    for (const x of [6, 7, 8]) img.put(x, 22 + dy, tone('red', 3));
  }
  if (ex.includes('trim')) {
    if (view === 'front') {
      img.vline(15, 20 + dy, 27 + dy, s.accent);
      img.vline(16, 20 + dy, 27 + dy, tone('yellow', 2));
    }
    img.hline(9, 22, 26 + dy, tone('yellow', 3));
  }
  if (ex.includes('satchel')) {
    for (let k = 0; k < 9; k++) img.put(view === 'front' ? 11 + k : 20 - k, 19 + dy + k, tone('brown', 2));
    img.rect(view === 'front' ? 18 : 8, 27 + dy, 6, 5, tone('brown', 3));
    img.hline(view === 'front' ? 18 : 8, view === 'front' ? 23 : 13, 27 + dy, tone('brown', 4));
  }
  if (ex.includes('pads')) {
    for (const [x0, x1] of [[5, 10], [21, 26]]) {
      img.rect(x0, 19 + dy, x1 - x0, 4, tone('blue', 3));
      img.hline(x0, x1 - 1, 19 + dy, tone('blue', 4));
      img.hline(x0, x1 - 1, 22 + dy, tone('blue', 1));
    }
    if (view === 'front') {
      img.rect(12, 21 + dy, 8, 4, tone('blue', 3));
      img.hline(12, 19, 21 + dy, tone('blue', 4));
      img.put(13, 22 + dy, s.accent);
    }
  }
  if (ex.includes('baton')) img.rect(view === 'front' ? 21 : 9, 26 + dy, 2, 6, tone('metal', 1));
  if (ex.includes('sash')) {
    for (let k = 0; k < 10; k++) {
      const x = view === 'front' ? 10 + k : 21 - k;
      img.put(x, 19 + dy + k, s.sash);
      img.put(x + 1, 19 + dy + k, s.sash);
      img.put(x + 2, 19 + dy + k, s.sashDark);
    }
  }
  if (ex.includes('pin') && view === 'front') {
    img.put(12, 21 + dy, tone('yellow', 4));
    img.rect(14, 19 + dy, 4, 2, tone('metal', 8));
  }
  if (ex.includes('apron') && view === 'front') {
    img.rect(11, 22 + dy, 10, 10, tone('metal', 8));
    img.hline(11, 20, 22 + dy, tone('metal', 7));
    img.vline(20, 22 + dy, 31 + dy, tone('metal', 6));
  }
  if (ex.includes('tee') && view === 'front') {
    img.hline(13, 18, 19 + dy, pal.k);
    img.hline(14, 17, 20 + dy, pal.q);
    img.rect(13, 23 + dy, 6, 3, s.accent);
  }
}

function costumeSide(img, s, pal, dy) {
  const ex = s.extras;
  if (ex.includes('stripes')) img.hline(12, 19, 32, tone('metal', 7));
  if (ex.includes('toolbelt')) img.rect(17, 27 + dy, 4, 3, tone('brown', 3));
  if (ex.includes('cross')) img.rect(14, 22 + dy, 3, 3, tone('red', 3));
  if (ex.includes('trim')) img.hline(12, 19, 26 + dy, tone('yellow', 3));
  if (ex.includes('satchel')) {
    img.rect(17, 25 + dy, 5, 5, tone('brown', 3));
    img.hline(17, 21, 25 + dy, tone('brown', 4));
  }
  if (ex.includes('pads')) {
    img.rect(13, 19 + dy, 6, 4, tone('blue', 3));
    img.hline(13, 18, 19 + dy, tone('blue', 4));
  }
  if (ex.includes('baton')) img.rect(18, 26 + dy, 2, 6, tone('metal', 1));
  if (ex.includes('sash')) for (let k = 0; k < 9; k++) img.put(13 + Math.round(k * 0.6), 19 + dy + k, s.sash);
  if (ex.includes('apron')) img.rect(11, 22 + dy, 3, 10, tone('metal', 8));
}

/** One finished frame: drawn, outlined and given a ground shadow. */
function frameImage(archetype, v, dir, frame) {
  const s = specFor(archetype, v);
  const img = new Img(FRAME_W, FRAME_H);
  drawFrame(img, s, dir === 2 ? 1 : dir, frame);
  img.outline((x, y, inner) => mix(inner, INK, 0.8));
  const out = new Img(FRAME_W, FRAME_H);
  out.ellipse(FEET.x, FEET.y - 1, 8, 2, fade(INK, 90));
  out.blit(img, 0, 0, dir === 2);
  return out;
}

/** The full atlas: one row per sprite in SPRITE_ARCHETYPES x variant order. */
export function paintCharacters() {
  const rows = SPRITE_ARCHETYPES.length * SPRITE_VARIANTS;
  const atlas = new Img(FRAME_W * FRAMES * 4, FRAME_H * rows);
  const portraits = {};
  let row = 0;
  for (const archetype of SPRITE_ARCHETYPES)
    for (let v = 0; v < SPRITE_VARIANTS; v++) {
      for (let d = 0; d < 4; d++) for (let f = 0; f < FRAMES; f++) atlas.blit(frameImage(archetype, v, d, f), (d * FRAMES + f) * FRAME_W, row * FRAME_H);
      portraits[archetype + '_' + v] = paintPortrait(archetype, v);
      row++;
    }
  return { atlas, portraits };
}

const BACKDROP = { farmer: 'green', miner: 'orange', engineer: 'yellow', medic: 'red', scientist: 'teal', merchant: 'purple', guard: 'blue', official: 'metal', worker: 'brown', civilian: 'pink' };

/** Head and shoulders at 2x from the standing front frame, on a tinted backdrop with a frame. */
export function paintPortrait(archetype, v) {
  const s = specFor(archetype, v);
  const body = new Img(FRAME_W, FRAME_H);
  drawFrame(body, s, 0, 0);
  body.outline((x, y, inner) => mix(inner, INK, 0.8));
  const p = new Img(PORTRAIT, PORTRAIT);
  const ramp = BACKDROP[archetype];
  const top = ramp === 'metal' ? 3 : 2;
  for (let y = 0; y < PORTRAIT; y++)
    for (let x = 0; x < PORTRAIT; x++) {
      const t = y / PORTRAIT + ((x * 7 + y * 3) % 4) / 40;
      p.put(x, y, t < 0.45 ? tone(ramp, top) : t < 0.8 ? tone(ramp, top - 1) : tone(ramp, Math.max(0, top - 2)));
    }
  for (let k = 0; k < 40; k++) p.put((k * 37) % PORTRAIT, (k * 17) % 30, fade(tone('ice', 4), 70));
  const crop = body.crop(4, 0, 24, 31);
  p.blit(crop.scaled(2), 8, 4);
  for (let x = 0; x < PORTRAIT; x++) for (let y = 0; y < 2; y++) {
    p.put(x, y, INK);
    p.put(x, PORTRAIT - 1 - y, INK);
    p.put(y, x, INK);
    p.put(PORTRAIT - 1 - y, x, INK);
  }
  p.frame(2, 2, PORTRAIT - 4, PORTRAIT - 4, tone(ramp, Math.min(top + 2, 5)));
  return p;
}
