/**
 * Maze Runner balance (idea G14, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** the maze dimensions per level [cols, rows] (doc §۰.۶) */
  dimsByLevel: { 1: [15, 11], 2: [17, 13], 3: [19, 13] } as Record<
    number,
    [number, number]
  >,
  /** the max level (the page clamps) */
  maxLevel: 3,
  /** a gate every k path cells (doc §۰.۳) */
  gateEvery: 4,
  /** the gate word length range per level (doc §۰.۶: longer words) */
  gateLenByLevel: { 1: [3, 5], 2: [4, 6], 3: [5, 7] } as Record<
    number,
    [number, number]
  >,
  /** a wrong key costs this much time (doc §۰.۵ — no death) */
  errorPenaltyMs: 200,
  /** the par budget per gate word character (doc §۰.۴) */
  parMsPerChar: 400,
  /** the score bonus for an error-free run (doc §۰.۴) */
  noErrorBonus: 1500,
  /** the auto-walk speed between cells (the page animates) */
  walkMsPerCell: 90,
  /** the braid chance: a dead-end opens an extra wall (loops) */
  braidChance: 0.25,
  /** the regenerate cap until the BFS path twists enough (doc §۵) */
  minTurns: 6,
  maxRegenerates: 20,
} as const;
