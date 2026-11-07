/**
 * Type Snake balance (idea G11, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  cols: 24,
  rows: 18,
  startLength: 4,
  /** movement interval: starts here, x1.1 speed (interval / 1.1) every 5
   * foods, floored at the min (doc G11 §۰.۱/§۰.۴) */
  startIntervalMs: 220,
  minIntervalMs: 110,
  speedUpEveryFoods: 5,
  speedUpFactor: 1.1,
  /** eating: len x 15 (doc G11 §۰.۴) */
  scorePerChar: 15,
  /** the food word length window (v1: 2-3 letters) */
  foodWordMinLen: 2,
  foodWordMaxLen: 3,
  /** the food spawns at least this far from the head */
  foodMinDistance: 3,
} as const;
