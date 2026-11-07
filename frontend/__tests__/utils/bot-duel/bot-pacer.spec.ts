import { describe, expect, it } from "vitest";

import { createBotPacer } from "../../../src/ts/utils/bot-duel/bot-pacer";

//words 3, 2 and 5 chars: cumEnd 3, 6, 12 chars (two separating spaces)
const WORDS = ["abc", "de", "fight"];

describe("bot-duel pacer (idea G2)", () => {
  it("progresses at the constant rate: wpm 60 -> 5 chars per second", () => {
    const pacer = createBotPacer({ wpm: 60, words: WORDS });
    expect(pacer.progressChars(0)).toBe(0);
    expect(pacer.progressChars(1000)).toBe(5);
    expect(pacer.progressChars(60000)).toBe(300);
  });

  it("crosses word boundaries counting the separating space", () => {
    const pacer = createBotPacer({ wpm: 60, words: WORDS });
    expect(pacer.totalChars).toBe(12);
    expect(pacer.wordIndex(599)).toBe(0); //2.995 chars: inside word 0
    expect(pacer.wordIndex(600)).toBe(1); //3 chars: word 0 complete
    expect(pacer.wordIndex(1199)).toBe(1);
    expect(pacer.wordIndex(1200)).toBe(2); //6 chars: word 1 complete
    expect(pacer.wordIndex(2399)).toBe(2);
    expect(pacer.wordIndex(2400)).toBe(3); //12 chars: everything typed
    expect(pacer.finished(2399)).toBe(false);
    expect(pacer.finished(2400)).toBe(true);
    expect(pacer.finishMs).toBe(2400);
  });

  it("doubles the rate at wpm 120", () => {
    const pacer = createBotPacer({ wpm: 120, words: WORDS });
    expect(pacer.progressChars(1000)).toBe(10);
    expect(pacer.finishMs).toBe(1200);
  });

  it("rejects a non-positive wpm", () => {
    expect(() => createBotPacer({ wpm: 0, words: WORDS })).toThrow();
    expect(() => createBotPacer({ wpm: -5, words: WORDS })).toThrow();
  });
});
