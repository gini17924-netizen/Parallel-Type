/**
 * Sky Climber balance (idea G15, phase 1 — mode A): every tunable in
 * one file — the engine modules import from here; nothing else
 * hardcodes values. (The runner mode's tunables live in utils/runner.)
 */

export const BALANCE = {
  /** the platform timer shrinks with height: 8s → 4s (doc §۰.A.۲) */
  timerStartMs: 8000,
  timerMinMs: 4000,
  timerDecayMsPerPlatform: 100,
  /** two consecutive falls from the same platform = game over (§۰.A.۲) */
  maxConsecutiveFalls: 2,
  /** score per platform climbed: +10 × stage (§۰.A.۴) */
  scorePerPlatform: 10,
  /** a new stage every 15 platforms (longer words, tighter timers) */
  stageEvery: 15,
} as const;
