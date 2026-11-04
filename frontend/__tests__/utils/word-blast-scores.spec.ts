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
});
