/**
 * Pair Keys balance (idea G18, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** the two v1 memory modes (doc §۰.۱) */
  modes: ["form-name", "letter"] as const,
  /** the grid is 4x4 = 8 pairs (6x6 = 18 pairs is v2) */
  pairs: 8,
  /** level 1 shows every card for 2s before the play; level 2 does not */
  previewMsByLevel: { 1: 2000, 2: 0 } as Record<number, number>,
  /** a mismatched pair flips back after this long (doc §۱.۱) */
  mismatchReturnMs: 700,
  /** scoring: each pair is worth 100 minus the extra moves made */
  pairBase: 100,
  extraMovePenalty: 10,
  pairFloor: 20,
  /** a perfect run (the minimum possible moves) doubles the score */
  perfectBonus: 2,
  /** non-joining letters render all four forms identically — they are
   * FORBIDDEN in form-name mode (doc §۶) */
  nonJoiningLetters: ["ا", "د", "ذ", "ر", "ز", "ژ", "و"] as const,
  /** the form a form-name card shows (isolated IS the base card) */
  formNames: ["initial", "medial", "final"] as const,
} as const;
