/**
 * Firefight balance (idea G16, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  cols: 12,
  rows: 9,
  /** the spread interval shrinks from 6s to 2.5s across the run */
  spreadStartMs: 6000,
  spreadMinMs: 2500,
  /** a burning cell turns to ashes after this long (unrecoverable) */
  burnDurationMs: 12000,
  /** survive this long with < the ash ratio to win (doc G16 §۰.۴) */
  surviveMs: 120_000,
  /** losing: this fraction of cells ashes (doc G16 §۰.۴: 35%) */
  ashLossRatio: 0.35,
  /** extinguishing: len x 15 (doc G16 §۰.۳) */
  scorePerChar: 15,
  /** the final-score penalty per ash cell (doc G16 §۰.۴) */
  ashPenalty: 20,
  /** the burning cells' word window (doc G16 §۱: filter 4..7) */
  minWordLen: 4,
  maxWordLen: 7,
} as const;
