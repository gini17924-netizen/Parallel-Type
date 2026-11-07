import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/pair-keys/balance";
import { createBoard } from "../../../src/ts/utils/pair-keys/board";

const LETTERS = "بپتثجچحخسشصضطظعغفقکگلمنهی".split("");

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("pair-keys board (idea G18 phase 1)", () => {
  it("8 pairs = 16 cards, every baseLetter appears exactly twice", () => {
    const board = createBoard({
      mode: "letter",
      letters: LETTERS,
      rng: makeRng(7),
    });
    expect(board.cards).toHaveLength(16);
    const counts = new Map<string, number>();
    for (const card of board.cards) {
      counts.set(card.baseLetter, (counts.get(card.baseLetter) ?? 0) + 1);
    }
    expect(counts.size).toBe(8); //8 distinct letters
    for (const count of counts.values()) expect(count).toBe(2);
  });

  it("the same seed produces the same grid (deterministic shuffle)", () => {
    const a = createBoard({
      mode: "letter",
      letters: LETTERS,
      rng: makeRng(42),
    });
    const b = createBoard({
      mode: "letter",
      letters: LETTERS,
      rng: makeRng(42),
    });
    expect(a.cards.map((c) => c.baseLetter)).toEqual(
      b.cards.map((c) => c.baseLetter),
    );
  });

  it("form-name mode: one form card + one letter card per pair, joiners only", () => {
    const board = createBoard({
      mode: "form-name",
      letters: [...LETTERS, ...BALANCE.nonJoiningLetters],
      rng: makeRng(11),
    });
    expect(board.cards).toHaveLength(16);
    const byLetter = new Map<string, { form: number; letter: number }>();
    for (const card of board.cards) {
      const entry = byLetter.get(card.baseLetter) ?? { form: 0, letter: 0 };
      if (card.kind === "form") {
        entry.form += 1;
        expect(card.form).toBeDefined();
        expect(card.display).not.toBe(card.baseLetter); //a joined glyph
      } else {
        entry.letter += 1;
        expect(card.display).toBe(card.baseLetter);
      }
      byLetter.set(card.baseLetter, entry);
    }
    for (const entry of byLetter.values()) {
      expect(entry).toEqual({ form: 1, letter: 1 });
    }
    //no non-joiner leaked into the grid
    for (const card of board.cards) {
      expect(BALANCE.nonJoiningLetters).not.toContain(card.baseLetter);
    }
  });

  it("ids are the grid indexes 0..2·pairs-1 after shuffling", () => {
    const board = createBoard({
      mode: "letter",
      letters: LETTERS,
      rng: makeRng(3),
    });
    board.cards.forEach((card, id) => expect(card.id).toBe(id));
  });
});
