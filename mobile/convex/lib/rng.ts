/**
 * Seeded, stateless pseudorandomness. Every roll is keyed by (world seed, tick, entity, salt) so a
 * world replays identically for the same seed and the same player commands.
 */

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix(h >>> 0);
}

export function hash32(...parts: (number | string)[]): number {
  let h = 0x9e3779b9;
  for (const part of parts) {
    const n = typeof part === 'number' ? Math.floor(part) >>> 0 : hashString(part);
    h = mix((h ^ n) + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2));
  }
  return h >>> 0;
}

/** Uniform in [0, 1). */
export function rand(seed: number, tick: number, entity: number | string, salt: number | string = 0): number {
  return hash32(seed, tick, entity, salt) / 4294967296;
}

/** Uniform in [lo, hi). */
export function randRange(r: number, lo: number, hi: number): number {
  return lo + (hi - lo) * r;
}

export function randInt(r: number, lo: number, hiInclusive: number): number {
  return lo + Math.floor(r * (hiInclusive - lo + 1));
}

export function pick<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))];
}

/** Rounds x to an integer, up with probability equal to its fractional part. */
export function roundRand(x: number, r: number): number {
  const base = Math.floor(x);
  return base + (r < x - base ? 1 : 0);
}

/** A small stateful generator for seeding, where a long deterministic sequence is convenient. */
export function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
