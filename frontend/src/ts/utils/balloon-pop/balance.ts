/**
 * Balloon Pop balance (idea G6, phase 1): every tunable in one file — the
 * engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** the arena: bubbles rise from 100 (bottom) toward the 6vh danger line */
  arenaBottomVh: 100,
  dangerLineVh: 6,
  /** the physics tick the speeds are scaled against */
  tickMs: 50,
  /** starting lives; the doc's v1 (the +lives heart variant is v2) */
  startLives: 3,
  /** combo streak tiers: the highest tier whose `n` <= the streak wins */
  comboTiers: [
    { n: 0, m: 1 },
    { n: 5, m: 1.5 },
    { n: 10, m: 2 },
    { n: 20, m: 3 },
  ],
  /** points per pop: payload length x 10 x combo mult (+ the stage bonus) */
  stageBonus: 25,
  /** cumulative score that promotes the next stage (stage x this) */
  stageClearScore: 1500,
  /** the inner-stage level: every this many points bumps the speed */
  levelStep: 500,
  /** rising speed per stage, vh/second, plus level x the step */
  stageBaseSpeed: [6, 8, 10, 12] as const,
  levelSpeedStep: 1,
  /** stage 2: the chance a spawn is a letter instead of a short word */
  stage2LetterChance: 0.5,
  /** stage 4: the chances a spawn carries punctuation / is a 4-digit number */
  stage4PunctChance: 0.25,
  stage4NumberChance: 0.25,
  stage4PunctChars: ["،", "؟", "«", "»"] as const,
  /** spawn cadence, ms between spawns, per stage (shrinks with level) */
  stageSpawnMs: [2200, 2000, 1800, 1600] as const,
  spawnLevelStepMs: 60,
  maxLives: 5,
} as const;

export type BalloonStage = 1 | 2 | 3 | 4;

/** the cumulative score a stage promotes at: stage x stageClearScore */
export function stageUpScore(stage: BalloonStage): number {
  return stage * BALANCE.stageClearScore;
}

/** the inner-stage level derived from the score (affects the speed) */
export function levelForScore(score: number): number {
  return Math.floor(score / BALANCE.levelStep) + 1;
}

/** combo streak tiers: the highest tier whose `n` <= the streak wins */
export function comboMult(combo: number): number {
  let mult = 1;
  for (const tier of BALANCE.comboTiers) {
    if (combo >= tier.n) mult = tier.m;
  }
  return mult;
}

/** the rising speed for a stage/level, vh per second (BALANCE-driven) */
export function stageBaseSpeedOf(stage: number): number {
  const index = Math.min(Math.max(stage, 1), 4) - 1;
  return BALANCE.stageBaseSpeed[index] ?? BALANCE.stageBaseSpeed[0];
}
