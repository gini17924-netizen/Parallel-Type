/**
 * Split-Key Showdown stream engine (idea G19, phase 1): one player's
 * typing stream — the G2 word-stream pattern distilled (doc §۰.B.۲):
 * the current word in full, a wrong key resets the partial, completing
 * the last word finishes the run. Two INDEPENDENT instances run in
 * parallel (one per player/side). PURE: the clock is injected per call.
 */

export type StreamPhase = "ready" | "running" | "done";

export type StreamState = {
  phase: StreamPhase;
  wordIndex: number;
  currentWord: string;
  /** the typed prefix length on the current word */
  typed: number;
  wordCount: number;
  correctChars: number;
  wrongChars: number;
  /** 0..100 keystroke accuracy */
  acc: number;
  /** elapsed running ms; frozen at the finish */
  elapsedMs: number;
};

export type StreamEngine = {
  state(): StreamState;
  /** anchors t0 (leaves the ready phase) */
  start(nowMs: number): void;
  /** one bare character against the stream */
  feedKey(ch: string, nowMs: number): StreamState;
};

export function createStreamEngine(options: { words: string[] }): StreamEngine {
  if (options.words.length === 0) throw new Error("stream needs words");
  const words = options.words;
  let phase: StreamPhase = "ready";
  let wordIndex = 0;
  let typed = 0;
  let correctChars = 0;
  let wrongChars = 0;
  let startedAt = 0;
  let finishedAtMs: number | undefined;
  /** the last clock reading the caller injected (state() is pure) */
  let clockNow = 0;

  const currentWord = (): string =>
    words[Math.min(wordIndex, words.length - 1)] ?? "";

  function snapshot(): StreamState {
    const elapsed =
      phase === "ready" ? 0 : (finishedAtMs ?? clockNow) - startedAt;
    const total = correctChars + wrongChars;
    return {
      phase,
      wordIndex,
      currentWord: currentWord(),
      typed,
      wordCount: words.length,
      correctChars,
      wrongChars,
      acc: total === 0 ? 100 : (correctChars / total) * 100,
      elapsedMs: Math.max(0, elapsed),
    };
  }

  return {
    state() {
      return snapshot();
    },
    start(nowMs: number) {
      clockNow = nowMs;
      if (phase !== "ready") return;
      phase = "running";
      startedAt = nowMs;
    },
    feedKey(ch: string, nowMs: number) {
      clockNow = nowMs;
      if (phase !== "running") return snapshot();
      if (ch.length !== 1) return snapshot();
      const word = currentWord();
      const expected = word[typed];
      if (expected !== ch) {
        wrongChars += 1;
        typed = 0; //the doc's partial reset (§۰.B.۲)
        return snapshot();
      }
      correctChars += 1;
      typed += 1;
      if (typed >= word.length) {
        wordIndex += 1;
        typed = 0;
        if (wordIndex >= words.length) {
          phase = "done";
          finishedAtMs = nowMs;
        }
      }
      return snapshot();
    },
  };
}
