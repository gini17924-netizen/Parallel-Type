/**
 * Nitro Run balance (idea G23, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** the AI field (the player makes N+1) */
  aiCount: 4,
  /** the AI speed spread in wpm (fixed per racer, doc G23 §۰.۱) */
  aiWpms: [45, 60, 75, 90],
  /** the standard word length for the AI pacer conversion */
  aiWordChars: 5,
  /** checkpoints every 500m: the AI speeds x1.05 (doc G23 §۰.۵) */
  checkpointEveryM: 500,
  checkpointSpeedMult: 1.05,
  /** the player's progress is TYPING-driven: a completed word adds
   * len x progressPerChar meters (doc G23 §۰.۱/§۲ player.ts) */
  progressPerCharM: 10,
  /** a wrong key: a 0.5s spin-out (typing inert) + the combo breaks */
  spinOutMs: 500,
  /** nitro: a 5-correct-word streak = 1 charge, cap 3, Enter burns one
   * for 3 seconds of x2 progress (doc G23 §۰.۲/§۰.۳) */
  nitroStreakWords: 5,
  nitroChargesMax: 3,
  nitroDurationMs: 3000,
  nitroProgressMult: 2,
  /** the loss: the player falls this far behind the NEAREST AI */
  gapLossM: 300,
  /** the rank score (doc G23 §۰.۴): (N - place + 1) x 100 + distance x
   * 0.1 + perfect words x 5 */
  rankPlaceScore: 100,
  rankDistanceMult: 0.1,
  rankPerfectScore: 5,
} as const;

/** the AI speed in meters per second for a wpm (5-char words) */
export function aiSpeedMps(wpmBase: number): number {
  return (wpmBase * BALANCE.aiWordChars * BALANCE.progressPerCharM) / 60;
}

/** the AI speed multiplier after N checkpoints (doc G23 §۰.۵) */
export function checkpointMult(checkpoints: number): number {
  return Math.pow(BALANCE.checkpointSpeedMult, checkpoints);
}
