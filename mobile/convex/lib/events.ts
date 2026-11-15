/** Salience tiers. The feed reads whole tiers through an index instead of scanning every event. */
export function tierOf(salience: number): number {
  return salience >= 0.75 ? 3 : salience >= 0.5 ? 2 : salience >= 0.25 ? 1 : 0;
}

export function tierFloor(tier: number): number {
  return [0, 0.25, 0.5, 0.75, 1.01][Math.max(0, Math.min(4, tier))];
}
