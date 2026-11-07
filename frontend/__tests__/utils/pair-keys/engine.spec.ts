import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/pair-keys/balance";
import {
  createPairKeysEngine,
  type PairKeysEngine,
} from "../../../src/ts/utils/pair-keys/engine";

const LETTERS = "بپتثجچحخسشصضطظعغفقکگلمنهی".split("");

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function makeEngine(
  opts: {
    mode?: "form-name" | "letter";
    previewMs?: number;
    seed?: number;
  } = {},
): {
  engine: PairKeysEngine;
  nowMs: () => number;
  setNow: (ms: number) => void;
} {
  let t = 1000;
  const engine = createPairKeysEngine({
    mode: opts.mode ?? "letter",
    letters: LETTERS,
    previewMs: opts.previewMs,
    rng: makeRng(opts.seed ?? 7),
    now: () => t,
  });
  return { engine, nowMs: () => t, setNow: (ms: number) => (t = ms) };
}

/** finds the twin of a face-down card by baseLetter (test helper) */
function twinIndex(engine: PairKeysEngine, index: number): number {
  const base = engine.board().cards[index]?.baseLetter;
  const found = engine
    .board()
    .cards.findIndex((card) => card.id !== index && card.baseLetter === base);
  return found;
}

function playPerfect(engine: PairKeysEngine): void {
  let guard = 0;
  while (engine.state().matched < BALANCE.pairs && guard++ < 64) {
    const faces = engine.state().faces;
    const next = faces.findIndex((face) => face === "down");
    if (next === -1) break;
    engine.flip(next);
    engine.flip(twinIndex(engine, next));
  }
}

describe("pair-keys engine (idea G18 phase 1)", () => {
  it("letter mode: a correct second flip matches in place", () => {
    const { engine } = makeEngine();
    const first = engine.state().faces.findIndex((face) => face === "down");
    engine.flip(first);
    engine.flip(twinIndex(engine, first));
    const state = engine.state();
    expect(state.matched).toBe(1);
    expect(state.moves).toBe(1);
    expect(state.open).toHaveLength(0); //matched pairs stay open
    expect(state.faces[first]).toBe("matched");
  });

  it("a mismatch pends until resolve() flips both back", () => {
    const { engine } = makeEngine();
    const faces = engine.state().faces;
    const a = faces.findIndex((face) => face === "down");
    //find two cards with DIFFERENT letters
    let b = -1;
    for (let i = 0; i < faces.length; i++) {
      const cardA = engine.board().cards[a];
      const cardB = engine.board().cards[i];
      if (i !== a && cardA?.baseLetter !== cardB?.baseLetter) {
        b = i;
        break;
      }
    }
    engine.flip(a);
    engine.flip(b);
    let state = engine.state();
    expect(state.moves).toBe(1);
    expect(state.matched).toBe(0);
    expect(state.open).toHaveLength(2); //pending
    engine.flip(0); //ignored while pending
    expect(engine.state().open).toHaveLength(2);
    state = engine.resolve();
    expect(state.open).toHaveLength(0);
    expect(state.faces[a]).toBe("down");
    expect(state.faces[b]).toBe("down");
  });

  it("form-name mode matches only form↔letter of the same base", () => {
    const { engine } = makeEngine({ mode: "form-name" });
    const cards = engine.board().cards;
    //every pair is one form card + one letter card sharing a baseLetter
    const first = engine.state().faces.findIndex((face) => face === "down");
    engine.flip(first);
    engine.flip(twinIndex(engine, first));
    expect(engine.state().matched).toBe(1);
    expect(cards[first]?.baseLetter).toBeDefined();
  });

  it("a perfect run (8 moves) doubles the score", () => {
    const { engine } = makeEngine();
    playPerfect(engine);
    const state = engine.state();
    expect(state.matched).toBe(8);
    expect(state.moves).toBe(8);
    expect(state.perfect).toBe(true);
    expect(state.phase).toBe("done");
    expect(state.result?.perfect).toBe(true);
    //8 clean pairs × 100, doubled
    expect(state.result?.score).toBe(
      8 * BALANCE.pairBase * BALANCE.perfectBonus,
    );
  });

  it("sloppy runs lose 10 per extra move (floor 20)", () => {
    const { engine } = makeEngine();
    //burn one mismatch move first: two cards with different letters
    const faces = engine.state().faces;
    const a = faces.findIndex((face) => face === "down");
    let b = -1;
    for (let i = 0; i < faces.length; i++) {
      const cardA = engine.board().cards[a];
      const cardB = engine.board().cards[i];
      if (i !== a && cardA?.baseLetter !== cardB?.baseLetter) {
        b = i;
        break;
      }
    }
    engine.flip(a);
    engine.flip(b);
    engine.resolve();
    expect(engine.state().moves).toBe(1);
    //then play the rest perfectly
    playPerfect(engine);
    const state = engine.state();
    expect(state.matched).toBe(8);
    expect(state.moves).toBe(9); //1 mismatch move + 8 pair moves
    expect(state.perfect).toBe(false);
    //every pair after the extra move loses 10 (no perfect doubling)
    expect(state.result?.score).toBe(
      8 * (BALANCE.pairBase - BALANCE.extraMovePenalty),
    );
  });

  it("the elapsed clock starts at the first flip", () => {
    const { engine, setNow } = makeEngine();
    setNow(5000);
    engine.flip(0);
    setNow(6500);
    expect(engine.state().elapsedMs).toBe(1500);
  });

  it("level 1 previews the whole grid, then hides it lazily", () => {
    const { engine, setNow } = makeEngine({ previewMs: 2000 });
    expect(engine.state().phase).toBe("preview");
    expect(engine.state().faces.every((face) => face === "up")).toBe(true);
    const before = engine.flip(0); //ignored during the preview
    expect(before.faces[0]).toBe("up");
    setNow(1000 + 2000 + 1); //past the preview window
    const after = engine.state();
    expect(after.phase).toBe("playing");
    expect(after.faces.every((face) => face === "down")).toBe(true);
  });

  it("the snapshot hands out fresh arrays (the KI-34 lesson)", () => {
    const { engine } = makeEngine();
    const a = engine.state().faces;
    const b = engine.state().faces;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
