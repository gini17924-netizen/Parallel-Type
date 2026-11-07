/**
 * Endless Runner balance (idea G15, phase 1 — mode B): every tunable in
 * one file — the engine modules import from here; nothing else
 * hardcodes values. (The climber mode's tunables live in utils/climber.)
 */

export const BALANCE = {
  /** the run starts at this speed and grows with distance */
  speedStartPxPerS: 240,
  speedGainPer100m: 30,
  speedMaxPxPerS: 480,
  /** the gap between obstacles shrinks with progress but never below */
  gapStartPx: 460,
  gapDecayPxPerObstacle: 8,
  gapMinPx: 220,
  /** the word length window shrinks at speed (doc §۰.B.۲) */
  wordLenMaxStart: 6,
  wordLenMaxMin: 4,
  wordLenMin: 3,
  /** three lives; an uncleared obstacle passing costs one (§۰.B.۱) */
  lives: 3,
  /** px → meters (the score unit) */
  pxPerMeter: 50,
  /** obstacles interact from this distance ahead */
  spawnAheadPx: 640,
} as const;
