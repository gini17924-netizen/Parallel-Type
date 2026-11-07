/**
 * Letter Strike balance (idea G8, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** ships die (a life) when their top reaches this vh */
  shipYLimitVh: 94,
  /** ships enter from above the arena */
  spawnYStartVh: -6,
  /** vertical stagger between the ships of one wave */
  shipSpacingVh: 9,
  lives: 3,
  /** the wave's ship count steps 4 -> 14 (doc G8 §۰.۴) */
  waveStartShips: 4,
  waveShipsStep: 1,
  waveMaxShips: 14,
  /** fall speed in vh per second, scaling with the wave */
  baseSpeedVhPerSec: 3,
  speedPerWaveVh: 0.35,
  speedJitterVh: 0.6,
  /** a Boss every 4th wave (doc G8 §۰.۴): long word, two full passages */
  bossEveryWaves: 4,
  bossArmor: 2,
  bossSpeedMult: 0.6,
  bossMinLen: 10,
  bossMaxLen: 14,
  /** EMP (Space): max 1 stored, recharges every 3 cleared waves */
  empRechargeEveryWaves: 3,
  scorePerChar: 10,
  /** regular ship words */
  minWordLen: 3,
  maxWordLen: 8,
  /** combo streak tiers — mirrors G1's tiers (doc G8 §۰.۶ says "پله‌های
   * G1"); copied, not imported, to keep the per-game BALANCE rule */
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

/** ships in a wave: start + step, capped (doc G8 §۰.۴) */
export function waveShipCount(wave: number): number {
  return Math.min(
    BALANCE.waveMaxShips,
    BALANCE.waveStartShips + (Math.max(wave, 1) - 1) * BALANCE.waveShipsStep,
  );
}
