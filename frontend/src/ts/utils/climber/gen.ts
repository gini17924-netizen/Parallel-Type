import { BALANCE } from "./balance";

/**
 * Sky Climber platform generator (idea G15, phase 1 — mode A): the
 * seeded vertical stack. The WORD SOURCE is injected per platform index
 * (the page blends the language pool with the weak letters at stage ≥ 2
 * with 30% chance — read-only, the G9 pattern). PURE: rng injected.
 */

export type Platform = {
  /** the height index (0 = the ground floor) */
  index: number;
  word: string;
  /** this platform's pressure timer at full (shrinks with height) */
  timerMs: number;
};

/** the platform's full timer at height index (8s → 4s, doc §۰.A.۲) */
export function timerFor(index: number): number {
  return Math.max(
    BALANCE.timerMinMs,
    BALANCE.timerStartMs - index * BALANCE.timerDecayMsPerPlatform,
  );
}

export function makePlatform(
  index: number,
  wordFor: (index: number) => string,
): Platform {
  return { index, word: wordFor(index), timerMs: timerFor(index) };
}

/** the visible starting stack: indices 0..count-1 (deterministic under
 * the injected word source) */
export function generateStack(
  count: number,
  wordFor: (index: number) => string,
): Platform[] {
  const stack: Platform[] = [];
  for (let i = 0; i < count; i++) stack.push(makePlatform(i, wordFor));
  return stack;
}

/** the stage of a height index: stage 1 + floor(index / 15) */
export function stageOf(index: number): number {
  return 1 + Math.floor(index / BALANCE.stageEvery);
}
