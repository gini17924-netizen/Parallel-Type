import { BALANCE } from "./balance";
import { makePlatform, stageOf, timerFor, type Platform } from "./gen";

/**
 * Sky Climber engine (idea G15, phase 1 — mode A): the vertical
 * pressure climb (doc §۰.A). Typing the active word jumps one platform
 * up (+10 × stage); the active platform's timer shrinks with height —
 * at zero the runner falls ONE floor per tick (the word and the partial
 * survive the fall, doc §۰.A.۲); a wrong key only resets the partial
 * (§۰.A.۳). Two consecutive falls from the same platform — or the
 * ground — end the run. PURE: the word source is injected.
 */

export type ClimberPhase = "running" | "done";

export type ClimberResult = {
  height: number;
  score: number;
  falls: number;
};

export type ClimberState = {
  phase: ClimberPhase;
  /** the current height index (the page slides the runner) */
  platformIndex: number;
  /** the visible platform window around the runner */
  platforms: Platform[];
  /** the active word obligation (STAYS the same across a fall) */
  word: string;
  typed: number;
  /** the active platform's remaining pressure ms */
  timerRemainingMs: number;
  /** the full timer of the active platform (for the ring UI) */
  timerFullMs: number;
  score: number;
  stage: number;
  consecutiveFalls: number;
  totalFalls: number;
  result: ClimberResult | undefined;
};

export type ClimberEngine = {
  state(): ClimberState;
  /** the pressure countdown + at most ONE fall per tick (doc §۵) */
  tick(dtMs: number): ClimberState;
  /** one bare character against the active word */
  feedKey(ch: string): ClimberState;
};

export function createClimberEngine(options: {
  /** the word for a platform index (page-blended pools, read-only) */
  wordFor: (index: number) => string;
  /** how many platforms render in the starting window */
  visiblePlatforms?: number;
}): ClimberEngine {
  const visible = options.visiblePlatforms ?? 8;
  let phase: ClimberPhase = "running";
  let platformIndex = 0;
  const platforms = new Map<number, Platform>();
  const platform = (index: number): Platform => {
    const existing = platforms.get(index);
    if (existing !== undefined) return existing;
    const made = makePlatform(index, options.wordFor);
    platforms.set(index, made);
    return made;
  };
  for (let i = 0; i < visible; i++) platform(i);

  let word = platform(0).word;
  let typed = 0;
  let timerRemainingMs = timerFor(0);
  let score = 0;
  let consecutiveFalls = 0;
  let totalFalls = 0;
  let maxHeight = 0;

  function windowPlatforms(): Platform[] {
    const out: Platform[] = [];
    for (
      let i = Math.max(0, platformIndex - 1);
      i <= platformIndex + visible - 2;
      i++
    ) {
      out.push(platform(i));
    }
    return out;
  }

  function die(): void {
    phase = "done";
  }

  function snapshot(): ClimberState {
    const done = phase === "done";
    return {
      phase,
      platformIndex,
      platforms: windowPlatforms(),
      word,
      typed,
      timerRemainingMs: done ? 0 : timerRemainingMs,
      timerFullMs: timerFor(platformIndex),
      score,
      stage: stageOf(platformIndex),
      consecutiveFalls,
      totalFalls,
      result: done
        ? { height: maxHeight, score, falls: totalFalls }
        : undefined,
    };
  }

  function fall(): void {
    consecutiveFalls += 1;
    totalFalls += 1;
    if (
      platformIndex === 0 ||
      consecutiveFalls >= BALANCE.maxConsecutiveFalls
    ) {
      die(); //the ground floor is death (doc §۰.A.۲)
      return;
    }
    platformIndex -= 1;
    //the word and the partial survive; the pressure restarts on the
    //lower platform (a grace, doc §۰.A.۲ «کلمه همان می‌ماند، partial حفظ»)
    timerRemainingMs = timerFor(platformIndex);
  }

  function tick(dtMs: number): ClimberState {
    if (phase !== "running") return snapshot();
    const active = platform(platformIndex);
    void active;
    timerRemainingMs -= Math.max(0, dtMs);
    if (timerRemainingMs <= 0) {
      //ONE fall per tick, however negative the timer went (doc §۵ rule)
      timerRemainingMs = 0;
      fall();
    }
    return snapshot();
  }

  function feedKey(ch: string): ClimberState {
    if (phase !== "running") return snapshot();
    if (ch.length !== 1) return snapshot();
    const expected = word[typed]?.toLowerCase();
    if (expected !== ch.toLowerCase()) {
      typed = 0; //a wrong key resets the partial — no fall (§۰.A.۳)
      return snapshot();
    }
    typed += 1;
    if (typed >= word.length) {
      //the jump: up one platform, a fresh word, the fall chain breaks
      platformIndex += 1;
      maxHeight = Math.max(maxHeight, platformIndex);
      score += BALANCE.scorePerPlatform * stageOf(platformIndex);
      consecutiveFalls = 0;
      typed = 0;
      word = platform(platformIndex).word;
      timerRemainingMs = timerFor(platformIndex);
    }
    return snapshot();
  }

  return {
    state: () => snapshot(),
    tick,
    feedKey,
  };
}
