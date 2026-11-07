import { describe, it, expect, beforeEach, vi } from "vitest";

//the module memoizes its storage wrapper (cache inside
//LocalStorageWithSchema), so every test gets a fresh module instance —
//same convention as custom-text.spec.ts
let Scores!: typeof import("../../src/ts/utils/word-blast-scores");

async function freshModule(): Promise<void> {
  vi.resetModules();
  Scores = await import("../../src/ts/utils/word-blast-scores");
}

describe("word-blast-scores (KI-21)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await freshModule();
  });

  it("treats the first game as a new record", () => {
    const result = Scores.recordWordBlastGame({
      difficulty: "normal",
      score: 300,
      wpm: 55,
    });
    expect(result.isNewRecord).toBe(true);
    expect(result.best?.score).toBe(300);
    expect(Scores.getWordBlastBest("normal")?.score).toBe(300);
    expect(Scores.getWordBlastBest("normal")?.wpm).toBe(55);
  });

  it("keeps the best score when a weaker game finishes", () => {
    Scores.recordWordBlastGame({ difficulty: "hard", score: 900, wpm: 80 });
    const weaker = Scores.recordWordBlastGame({
      difficulty: "hard",
      score: 250,
      wpm: 40,
    });
    expect(weaker.isNewRecord).toBe(false);
    expect(weaker.best?.score).toBe(900);
  });

  it("keeps bests per difficulty independently", () => {
    Scores.recordWordBlastGame({ difficulty: "easy", score: 100, wpm: 30 });
    Scores.recordWordBlastGame({ difficulty: "normal", score: 500, wpm: 60 });
    expect(Scores.getWordBlastBest("easy")?.score).toBe(100);
    expect(Scores.getWordBlastBest("normal")?.score).toBe(500);
    expect(Scores.getWordBlastBest("hard")).toBeUndefined();
  });

  it("keeps the recent history newest-first and trims it to 10", () => {
    for (let i = 1; i <= 12; i++) {
      Scores.recordWordBlastGame({
        difficulty: "normal",
        score: i * 10,
        wpm: 50,
      });
    }
    const history = Scores.getWordBlastHistory();
    expect(history).toHaveLength(10);
    expect(history[0]?.score).toBe(120); //most recent
    expect(history[1]?.score).toBe(110);
    //trim keeps the newest ones, the oldest two are gone
    expect(history[9]?.score).toBe(30);
    expect(Scores.getWordBlastHistory(3)).toHaveLength(3);
  });

  it("falls back to an empty store on a corrupted payload", async () => {
    window.localStorage.setItem(
      Scores.WORD_BLAST_SCORES_KEY,
      '{"best":{"hard":{"score":"NaN"}},"history":"nope"}',
    );
    await freshModule();
    expect(Scores.getWordBlastBest("hard")).toBeUndefined();
    expect(Scores.getWordBlastHistory()).toEqual([]);
    const result = Scores.recordWordBlastGame({
      difficulty: "hard",
      score: 400,
      wpm: 70,
    });
    expect(result.isNewRecord).toBe(true);
  });

  it("v2: records maxCombo/accuracy and tracks the all-time best combo", () => {
    Scores.recordWordBlastGame({
      difficulty: "normal",
      score: 300,
      wpm: 55,
      maxCombo: 12,
      accuracy: 96,
    });
    expect(Scores.getWordBlastHistory()[0]?.maxCombo).toBe(12);
    expect(Scores.getWordBlastHistory()[0]?.accuracy).toBe(96);
    expect(Scores.getWordBlastBestCombo()).toBe(12);
    //a bigger combo on a weaker game still raises the all-time best
    Scores.recordWordBlastGame({
      difficulty: "normal",
      score: 100,
      wpm: 40,
      maxCombo: 30,
      accuracy: 88,
    });
    expect(Scores.getWordBlastBestCombo()).toBe(30);
    //pre-v2 style call (no extras) keeps working and does not lower it
    Scores.recordWordBlastGame({ difficulty: "easy", score: 50, wpm: 25 });
    expect(Scores.getWordBlastBestCombo()).toBe(30);
  });

  it("v2 migration: a pre-v2 payload parses untouched and upgrades on write", async () => {
    window.localStorage.setItem(
      Scores.WORD_BLAST_SCORES_KEY,
      JSON.stringify({
        best: { hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 } },
        history: [{ at: 2, difficulty: "hard", score: 400, wpm: 70 }],
      }),
    );
    await freshModule();
    //old fields intact, new fields absent (not zeroed)
    expect(Scores.getWordBlastBest("hard")?.score).toBe(900);
    expect(Scores.getWordBlastBest("hard")?.maxCombo).toBeUndefined();
    expect(Scores.getWordBlastHistory()[0]?.maxCombo).toBeUndefined();
    expect(Scores.getWordBlastBestCombo()).toBe(0); //defaulted
    //a v2 game writes the new fields alongside the old ones
    const result = Scores.recordWordBlastGame({
      difficulty: "hard",
      score: 1000,
      wpm: 90,
      maxCombo: 21,
      accuracy: 97,
    });
    expect(result.isNewRecord).toBe(true);
    expect(Scores.getWordBlastBestCombo()).toBe(21);
    expect(Scores.getWordBlastHistory()[0]?.maxCombo).toBe(21);
    expect(Scores.getWordBlastHistory()[0]?.accuracy).toBe(97);
    expect(Scores.getWordBlastHistory()[1]?.maxCombo).toBeUndefined(); //old entry untouched
  });
});

describe("sanitizeImportedWordBlastScores (audit L4)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await freshModule();
  });

  it("keeps a valid payload as-is", () => {
    const payload = {
      best: { hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 } },
      history: [{ at: 2, difficulty: "hard", score: 400, wpm: 70 }],
    };
    expect(Scores.sanitizeImportedWordBlastScores(payload)).toEqual(payload);
  });

  it("trims an oversized history and drops garbage entries", () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      at: i,
      difficulty: "normal",
      score: 100 + i,
      wpm: 50,
    }));
    history[3] = "garbage" as never;
    const sanitized = Scores.sanitizeImportedWordBlastScores({
      best: {
        easy: "oops",
        hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 },
      },
      history,
    });
    expect(sanitized["history"]).toHaveLength(10);
    expect(sanitized["best"]).toEqual({
      hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 },
    });
  });

  it("returns a valid empty shape for a non-object payload", () => {
    expect(Scores.sanitizeImportedWordBlastScores("nope")).toEqual({
      best: {},
      history: [],
    });
  });

  it("v2: carries a numeric bestCombo through, drops anything else", () => {
    const payload = {
      best: { hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 } },
      history: [],
      bestCombo: 17,
    };
    expect(Scores.sanitizeImportedWordBlastScores(payload)).toEqual(payload);
    //a garbage bestCombo is dropped (the store schema defaults it to 0)
    expect(
      Scores.sanitizeImportedWordBlastScores({
        best: { hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 } },
        history: [],
        bestCombo: "x",
      }),
    ).toEqual({
      best: { hard: { at: 1, difficulty: "hard", score: 900, wpm: 80 } },
      history: [],
    });
  });

  it("integration: an oversized imported history survives the next store read", async () => {
    //write an out-of-schema payload the way importBackup would (audit L4:
    //without sanitizing, the next get() wiped EVERYTHING to the fallback)
    const history = Array.from({ length: 12 }, (_, i) => ({
      at: i,
      difficulty: "normal",
      score: 100 + i,
      wpm: 50,
    }));
    const sanitized = Scores.sanitizeImportedWordBlastScores({
      best: { normal: { at: 1, difficulty: "normal", score: 250, wpm: 60 } },
      history,
    });
    window.localStorage.setItem(
      Scores.WORD_BLAST_SCORES_KEY,
      JSON.stringify(sanitized),
    );
    await freshModule();
    expect(Scores.getWordBlastBest("normal")?.score).toBe(250);
    expect(Scores.getWordBlastHistory()).toHaveLength(10);
  });
});
