/**
 * The one palette every generator draws from. Colours come in ramps ordered dark to light, so
 * shading is "step down the ramp" rather than free blending. Documented in ../STYLE.md.
 */
import { rgba } from './image.mjs';

const ramp = (...hexes) => hexes.map((h) => rgba(h));

export const RAMPS = {
  /** Sunlit regolith, warm grey. */
  regolith: ramp('#101118', '#1a1b24', '#262630', '#34333d', '#44424b', '#56535a', '#6a666b', '#807a7c', '#999290', '#b5ada7', '#d3cbc2'),
  /** Regolith in shadow and the permanently shadowed crater: cold blue-black. */
  cold: ramp('#07080e', '#0d1019', '#141925', '#1c2333', '#252e42', '#303a51', '#3e4860', '#4d5871'),
  /** Water ice and frost glints. */
  ice: ramp('#2f5878', '#4f7fa6', '#7fb4d6', '#b8e2f2', '#effbff'),
  /** Hull plating, frames, machinery. */
  metal: ramp('#141722', '#1c2030', '#2c3246', '#414a62', '#5b6680', '#7a879e', '#9eabbd', '#c5cfdb', '#e8eef4'),
  /** Warm interior floors and sintered pads. */
  floor: ramp('#2a2529', '#3b3437', '#564b4b', '#75665f', '#968575', '#b9a58f', '#d8c8ae'),
  yellow: ramp('#5a3f0c', '#8f6a14', '#c8961f', '#f0c03a', '#ffe48a'),
  orange: ramp('#4e200e', '#8a3a17', '#c45a22', '#ee8a34', '#ffbe72'),
  red: ramp('#3a0f19', '#6e1a26', '#a8283a', '#da4848', '#f88a7a'),
  green: ramp('#0d2418', '#163d24', '#215f30', '#348a3c', '#5cb84c', '#a2e070'),
  teal: ramp('#0b2630', '#114654', '#18737c', '#22a8a8', '#5cdccc', '#b8fff0'),
  blue: ramp('#0b1030', '#15225a', '#22398e', '#3360c4', '#5a8ef0', '#a8c8ff'),
  purple: ramp('#200f34', '#3a1c5e', '#5e2c8c', '#8c44b8', '#c070dc', '#f2a8f0'),
  brown: ramp('#22150f', '#3c2519', '#5e3a24', '#875430', '#b07444', '#d8a46c'),
  pink: ramp('#4a1430', '#8a2a5a', '#d04a88', '#f48ab8', '#ffd0e4'),
};

export const INK = rgba('#0a0b12');
export const WHITE = rgba('#f4f6fa');
export const CLEAR = [0, 0, 0, 0];

/** A ramp colour by index, clamped to the ramp. */
export function tone(name, i) {
  const r = RAMPS[name];
  return r[Math.max(0, Math.min(r.length - 1, Math.round(i)))];
}

/** The same colour with a different alpha. */
export const fade = (c, a) => [c[0], c[1], c[2], a];
