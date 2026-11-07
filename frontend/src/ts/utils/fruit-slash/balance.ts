/**
 * Fruit Slash balance (idea G10, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** the run is a fixed 90-second window (doc G10 §۰.۴ — final decision);
   * the only death is typing 3 bombs */
  durationMs: 90_000,
  maxTypedBombs: 3,
  /** launcher: fruits fly from the bottom in arcs (top-based vh) */
  launchYVh: 100,
  launchXMinVw: 30,
  launchXMaxVw: 70,
  /** upward launch speed (magnitude, vh per second) */
  launchVyMinVh: 55,
  launchVyMaxVh: 80,
  /** horizontal drift (vw per second, random sign) */
  launchVxMinVw: 6,
  launchVxMaxVw: 18,
  gravityVhPerSec2: 70,
  /** a fruit past this y has left the screen below (escaped) */
  floorYVh: 105,
  /** a fruit past this horizontal margin is gone without penalty */
  offScreenXVw: 12,
  /** the apex bonus: slashing within +-150ms of the arc's apex (+30) */
  apexWindowMs: 150,
  apexBonus: 30,
  /** simultaneous fruits cap + spawn cadence (interval decays with level) */
  maxInFlight: 3,
  spawnIntervalStartMs: 1400,
  spawnIntervalMinMs: 700,
  spawnIntervalDecayMs: 60,
  /** the inner level: one step per 5 slashes (word length rides along) */
  levelStep: 5,
  /** a bomb held half-typed for this long defuses itself (doc G10 §۵).
   * 1200ms, not the doc's sketch 2s: a fruit's useful airtime below the
   * launch line is only ~1.85s (gravity 70, floor 5vh below the launch),
   * so a 2s half-life could never fire — the unit test caught it */
  bombHalfLifeMs: 1200,
  /** the chance a launch is a bomb (the caller mixes them into the words) */
  bombChance: 0.18,
  scorePerChar: 10,
  /** the doc's v1 word window (4-6 letters; length rides the level) */
  minWordLen: 4,
  maxWordLen: 6,
  /** combo streak tiers — mirrors G1's tiers (doc G10 §۰.۶ says G1) */
  comboTiers: [
    { n: 0, m: 1 },
    { n: 5, m: 1.5 },
    { n: 10, m: 2 },
    { n: 20, m: 3 },
  ],
} as const;

/** the multiplier of the combo streak's active tier (same shape as G1) */
export function comboMult(combo: number): number {
  let mult = 1;
  for (const tier of BALANCE.comboTiers) {
    if (combo >= tier.n) mult = tier.m;
  }
  return mult;
}
