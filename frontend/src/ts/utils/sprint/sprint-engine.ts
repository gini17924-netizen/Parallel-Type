/**
 * Ten-Second Sprint engine (idea G5): a maximum-wpm burst inside exactly
 * durationMs, behind a reaction gate. Pure and clock-injected — every
 * mutation takes the absolute nowMs, so tests drive time directly.
 *
 * Phases: idle -> arming (GO lands after a random 800-3000ms) -> running
 * (exactly durationMs) -> done. A character key BEFORE GO is a false start:
 * the attempt is voided on the spot (the reaction skill the idea centers
 * on). Backspace only shrinks the buffer — the engine counts character
 * keystrokes only, so a corrected character counts again when re-typed
 * ("نویسه اصلاح‌شده = تایپ‌شده").
 */

export const BALANCE = {
  durationMs: 10000,
  armingMinMs: 800,
  armingMaxMs: 3000,
} as const;

export type SprintPhase = "idle" | "arming" | "running" | "done";

export type SprintResult = {
  /** all character keystrokes (correct + wrong, partial last word included) */
  chars: number;
  /** chars / 5 / (duration / 60000) — always on the full duration base */
  wpm: number;
  /** momentary-correct characters */
  raw: number;
  /** correct / attempts, percent (0-100) */
  accuracy: number;
  wordsComplete: number;
  /** the gaps between character keystrokes (the consistency ingredient) */
  keystrokeIntervals: number[];
};

export type SprintState = {
  phase: SprintPhase;
  goAt: number | undefined;
  startedAt: number | undefined;
  currentWord: string;
  typed: number;
  chars: number;
  wordsComplete: number;
  voided: boolean;
  result: SprintResult | undefined;
};

export type SprintKeyFeed = {
  accepted: boolean;
  falseStart?: boolean;
};

export type SprintEngine = {
  /** opens the arming window (GO lands 800-3000ms later, per the rng) */
  arm(nowMs: number): void;
  state(): SprintState;
  /**
   * Feeds one key: a pre-GO character is a false start (void), Backspace
   * shrinks the buffer, a character inside the window is scored, and the
   * window locks (the key is refused) once the duration has elapsed.
   */
  feedKey(nowMs: number, key: string): SprintKeyFeed;
  /** flips running -> done once the duration has fully elapsed */
  tick(nowMs: number): SprintState;
  /** voids the attempt (window blur) — no result is produced */
  voidRace(): void;
};

export function createSprintEngine(options: {
  /** supplies the next race word (an effectively endless stream) */
  next: () => string;
  durationMs?: number;
  /** injected randomness for the arming delay */
  rng: () => number;
}): SprintEngine {
  const durationMs = options.durationMs ?? BALANCE.durationMs;
  let phase: SprintPhase = "idle";
  let goAt: number | undefined;
  let startedAt: number | undefined;
  let currentWord = options.next();
  let typed = 0;
  let chars = 0;
  let correctChars = 0;
  let wordsComplete = 0;
  let voided = false;
  let result: SprintResult | undefined;
  let lastKeyAt: number | undefined;
  const intervals: number[] = [];

  function computeResult(): SprintResult {
    const wpm = Math.round(chars / 5 / (durationMs / 60000));
    return {
      chars,
      wpm,
      raw: correctChars,
      accuracy: chars === 0 ? 0 : Math.round((correctChars / chars) * 100),
      wordsComplete,
      keystrokeIntervals: [...intervals],
    };
  }

  function startRunning(atMs: number): void {
    phase = "running";
    startedAt = atMs;
  }

  function snapshot(): SprintState {
    return {
      phase,
      goAt,
      startedAt,
      currentWord,
      typed,
      chars,
      wordsComplete,
      voided,
      result,
    };
  }

  return {
    arm(nowMs) {
      if (phase !== "idle") return;
      phase = "arming";
      goAt =
        nowMs +
        BALANCE.armingMinMs +
        options.rng() * (BALANCE.armingMaxMs - BALANCE.armingMinMs);
    },
    state() {
      return snapshot();
    },
    feedKey(nowMs, key) {
      if (phase === "done" || phase === "idle") return { accepted: false };
      if (phase === "arming") {
        if (goAt !== undefined && nowMs >= goAt) {
          //the GO moment passed between timers: the race starts implicitly
          startRunning(goAt);
        } else if (key === "Backspace") {
          return { accepted: false }; //not a character: no false start
        } else {
          //a pre-GO character key: the attempt is void immediately
          voided = true;
          phase = "done";
          return { accepted: false, falseStart: true };
        }
      }
      //running here (possibly just auto-started at goAt)
      const at = nowMs - (startedAt ?? nowMs);
      if (at >= durationMs) {
        finish();
        return { accepted: false }; //the window has locked
      }
      if (key === "Backspace") {
        typed = Math.max(0, typed - 1);
        return { accepted: true }; //buffer only: no metric
      }
      if (key.length !== 1) return { accepted: false };
      if (lastKeyAt !== undefined) intervals.push(nowMs - lastKeyAt);
      lastKeyAt = nowMs;
      chars += 1;
      const expected = currentWord[typed]?.toLowerCase();
      if (expected === key.toLowerCase()) {
        correctChars += 1;
        typed += 1;
        if (typed >= currentWord.length) {
          wordsComplete += 1;
          typed = 0;
          currentWord = options.next();
        }
      }
      return { accepted: true };
    },
    tick(nowMs) {
      if (
        phase === "running" &&
        startedAt !== undefined &&
        nowMs - startedAt >= durationMs
      ) {
        finish();
      }
      return snapshot();
    },
    voidRace() {
      if (phase === "arming" || phase === "running") {
        voided = true;
        phase = "done";
      }
    },
  };

  function finish(): void {
    phase = "done";
    result = computeResult();
  }
}
