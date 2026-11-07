/**
 * Lane Defense balance (idea G9, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** 5 horizontal lanes; enemies walk right -> left toward the wall */
  lanes: 5,
  /** the defense line (wall) sits this far from the left edge */
  wallXVw: 6,
  /** enemies enter from the right edge (staggered off-screen) */
  enemyStartXVw: 96,
  /** horizontal stagger between a wave's enemies */
  enemySpacingVw: 10,
  wallStartHp: 10,
  /** the wall repairs +2 when a wave is cleared, capped at the start hp */
  wallRepairPerWave: 2,
  /** wave enemy count steps 5 -> 12 (doc G9 §۰.۴) */
  waveStartEnemies: 5,
  waveEnemiesStep: 1,
  waveMaxEnemies: 12,
  /** walk speed in vw per second, scaling with the wave */
  baseSpeedVwPerSec: 3,
  speedPerWaveVw: 0.3,
  speedJitterVw: 0.5,
  /** a tank every 3rd wave (doc G9 §۰.۴): long word, slow, 3x score */
  tankEveryWaves: 3,
  tankMinLen: 8,
  tankMaxLen: 12,
  tankScoreMult: 3,
  tankSpeedMult: 0.6,
  /** regular enemy words */
  minWordLen: 3,
  maxWordLen: 8,
  /** below this many zone words the spawner synthesizes pseudo-words from
   * the zone letters (a tiny group like "fj" has no real words) */
  zonePoolMin: 5,
  pseudoMinLen: 3,
  pseudoMaxLen: 5,
  scorePerChar: 10,
  /** combo streak tiers — mirrors G1's tiers (doc G9 §۰.۶ says G1) */
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

/** enemies in a wave: start + step, capped (doc G9 §۰.۴) */
export function waveEnemyCount(wave: number): number {
  return Math.min(
    BALANCE.waveMaxEnemies,
    BALANCE.waveStartEnemies +
      (Math.max(wave, 1) - 1) * BALANCE.waveEnemiesStep,
  );
}
