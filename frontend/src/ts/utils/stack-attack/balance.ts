/**
 * Stack Attack balance (idea G12, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  cols: 10,
  rows: 14,
  /** word-block length window (doc G12 §۰.۱: 3-6 cells) */
  minWordLen: 3,
  maxWordLen: 6,
  /** the fall is cell-stepwise: one row per dropInterval (tetris-like) */
  dropIntervalStartMs: 900,
  dropIntervalMinMs: 350,
  dropIntervalStepMs: 50,
  /** level-up every 5 cleared rows (doc G12 §۰.۷) */
  rowsPerLevel: 5,
  /** scoring (doc G12 §۰.۶): lock len x 5; a row 100 x lines x lines; a
   * chain of locks without a wrong key pays x1.5 */
  lockScorePerChar: 5,
  chainLockMult: 1.5,
  rowScore: 100,
} as const;

/** the fall interval for a level (decreasing, doc G12 §۰.۲) */
export function dropIntervalMs(level: number): number {
  return Math.max(
    BALANCE.dropIntervalMinMs,
    BALANCE.dropIntervalStartMs -
      (Math.max(level, 1) - 1) * BALANCE.dropIntervalStepMs,
  );
}
