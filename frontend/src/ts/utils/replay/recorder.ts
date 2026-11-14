/**
 * The match replay (phase 81): the input timeline of a stack-attack run —
 * the run seed plus every keystroke and steering stamped with the ENGINE
 * tick it happened in. Recording ticks (not wall-clock ms) is what makes
 * the replay EXACT: the real-time jitter between ticks cannot change the
 * outcome, because the replay feeds the same inputs between the same
 * ticks into the same seeded engine.
 *
 * The file shape is versioned and self-sufficient: seed + words-picker
 * contract + events + the final state (a quick integrity check for the
 * viewer).
 */

export type ReplayEvent = {
  /** the engine tick the input belongs to (the key applied BEFORE this
   * tick's advance) */
  tick: number;
  kind: "key" | "left" | "right";
  /** the letter, for kind "key" */
  k?: string;
};

export type ReplayFile = {
  version: 1;
  gameId: "stack-attack";
  seed: number;
  /** the recorded run's word list — the seeded spawn picker needs it to
   * rebuild the same block sequence */
  words: string[];
  durationTicks: number;
  events: ReplayEvent[];
  final: { rows: number; score: number };
};

export type ReplayRecorder = {
  /** stamps the input at the current tick */
  record(event: Omit<ReplayEvent, "tick">): void;
  /** advances the tick counter (the page calls it once per tick loop) */
  tickDone(): void;
  /** closes the recording: returns the versioned file (the tick counter
   * is internal — the page calls tickDone once per loop pass) */
  finish(final: { rows: number; score: number }): ReplayFile;
};

export function createReplayRecorder(
  seed: number,
  words: string[],
): ReplayRecorder {
  const events: ReplayEvent[] = [];
  let tick = 0;
  return {
    record(event: Omit<ReplayEvent, "tick">): void {
      events.push({ ...event, tick });
    },
    tickDone(): void {
      tick += 1;
    },
    finish(final: { rows: number; score: number }): ReplayFile {
      return {
        version: 1,
        gameId: "stack-attack",
        seed,
        words: [...words],
        durationTicks: tick,
        events,
        final,
      };
    },
  };
}

/**
 * The seeded spawn picker shared by a recorded run and its replay: the
 * same seed + the same word list + the same length bounds produce the
 * same block sequence — the deterministic half of the replay contract
 * (the keystrokes are the other half). The level window mirrors the
 * page's picker (the block grows with the level, capped).
 */
export function seededSpawnWord(
  seed: number,
  pickable: string[],
  bounds: { minWordLen: number; maxWordLen: number },
): (level: number) => string {
  let state = (Math.abs(Math.floor(seed)) % 2_147_483_647) + 1;
  const rng = (): number => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
  return (level: number) => {
    if (pickable.length === 0) return "cat";
    const maxLen = Math.min(bounds.maxWordLen, bounds.minWordLen + level - 1);
    const window_ = pickable.filter(
      (word) => word.length >= bounds.minWordLen && word.length <= maxLen,
    );
    const source = window_.length > 0 ? window_ : pickable;
    const index = Math.floor(rng() * source.length);
    return source[index] ?? "cat";
  };
}
