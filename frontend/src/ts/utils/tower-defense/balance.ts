/**
 * Tower Defense balance (phase 85): every tunable in one file — the
 * engine modules import from here; nothing else hardcodes values. The
 * game is the vertical sibling of Lane Defense (idea G9): enemies spawn
 * ABOVE the field carrying words and march DOWN toward the tower; typing
 * the full word destroys them.
 */

export const BALANCE = {
  /** 5 vertical columns; enemies walk top -> bottom toward the tower */
  lanes: 5,
  /** enemies enter staggered above the screen (negative y) */
  enemyStartYVw: -12,
  /** vertical stagger between a wave's enemies */
  enemySpacingYVw: 12,
  /** the tower line sits this far down the field (vh) */
  towerYVh: 86,
  towerStartHp: 10,
  /** the tower repairs +2 when a wave is cleared, capped at the start hp */
  towerRepairPerWave: 2,
  /** wave enemy count steps 5 -> 12 */
  waveStartEnemies: 5,
  waveEnemiesStep: 1,
  waveMaxEnemies: 12,
  /** walk speed in vh per second, scaling with the wave */
  baseSpeedVhPerSec: 3,
  speedPerWaveVh: 0.3,
  speedJitterVh: 0.5,
  /** a tank every 3rd wave: long word, slow, 3x score */
  tankEveryWaves: 3,
  tankMinLen: 8,
  tankMaxLen: 12,
  tankScoreMult: 3,
  tankSpeedMult: 0.6,
  /** regular enemy words */
  minWordLen: 3,
  maxWordLen: 8,
  scorePerChar: 10,
  /** combo streak tiers — mirrors the G-wave tiers */
  comboTiers: [
    { n: 0, m: 1 },
    { n: 5, m: 1.5 },
    { n: 10, m: 2 },
    { n: 20, m: 3 },
  ],
} as const;

/** the multiplier of the combo streak's active tier */
export function comboMult(combo: number): number {
  let mult = 1;
  for (const tier of BALANCE.comboTiers) {
    if (combo >= tier.n) mult = tier.m;
  }
  return mult;
}

/** enemies in a wave: start + step, capped */
export function waveEnemyCount(wave: number): number {
  return Math.min(
    BALANCE.waveMaxEnemies,
    BALANCE.waveStartEnemies +
      (Math.max(wave, 1) - 1) * BALANCE.waveEnemiesStep,
  );
}
