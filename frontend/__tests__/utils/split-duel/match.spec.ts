import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/split-duel/balance";
import {
  createSplitDuelMatch,
  type SplitDuelMatch,
} from "../../../src/ts/utils/split-duel/match";

const WORDS = ["cat", "sun", "map", "fox", "day"];

/** types the whole shared stream into the match, char by char */
function typeAll(
  match: SplitDuelMatch,
  code: string,
  t: { v: number },
  step = 40,
): void {
  for (const word of WORDS) {
    for (const c of word) {
      t.v += step;
      match.feedKey(c, code, t.v);
    }
  }
}

describe("split-duel match (idea G19 phase 1)", () => {
  it("the countdown gates the begin", () => {
    const match = createSplitDuelMatch({ mode: "turn", words: WORDS });
    match.startCountdown(1000);
    expect(match.state().phase).toBe("countdown");
    const early = match.begin(1000 + BALANCE.countdownMs - 1);
    expect(early.phase).toBe("countdown");
    const begun = match.begin(1000 + BALANCE.countdownMs);
    expect(begun.phase).toBe("running");
    expect(begun.activeSlot).toBe(1);
  });

  it("turn mode: P1's finish parks in turn-swap; swapTo runs P2", () => {
    const match = createSplitDuelMatch({ mode: "turn", words: WORDS });
    match.startCountdown(0);
    match.begin(BALANCE.countdownMs);
    const t = { v: BALANCE.countdownMs };
    typeAll(match, "KeyA", t);
    let state = match.state();
    expect(state.players[1].phase).toBe("done");
    expect(state.phase).toBe("turn-swap");
    //a feed during the swap is a no-op
    state = match.feedKey("c", "KeyA", t.v + 100);
    expect(state.phase).toBe("turn-swap");
    match.swapTo(2, t.v + 200);
    state = match.state();
    expect(state.phase).toBe("running");
    expect(state.activeSlot).toBe(2);
    //P2 types the SAME sequence slower
    typeAll(match, "KeyA", t, 60);
    state = match.state();
    expect(state.phase).toBe("result");
    expect(state.result?.p2Ms).toBeGreaterThan(state.result?.p1Ms ?? 0);
    expect(state.result?.winnerSlot).toBe(1);
  });

  it("simultaneous mode: keys route per side", () => {
    const match = createSplitDuelMatch({ mode: "simultaneous", words: WORDS });
    match.startCountdown(0);
    match.begin(BALANCE.countdownMs);
    //P1 (left half) types 2 words, P2 (right half) 1 word
    const t = { v: BALANCE.countdownMs };
    for (const c of "catsun") {
      t.v += 40;
      match.feedKey(c, "KeyD", t.v); //left side → player 1
    }
    for (const c of "cat") {
      t.v += 40;
      match.feedKey(c, "KeyJ", t.v); //right side → player 2
    }
    const state = match.state();
    expect(state.players[1].wordIndex).toBe(2);
    expect(state.players[2].wordIndex).toBe(1);
    //a sideless code feeds nobody
    match.feedKey("c", "F13", t.v + 40);
    expect(match.state().players[1].wordIndex).toBe(2);
  });

  it("simultaneous mode: the earlier finisher wins with the margin", () => {
    const match = createSplitDuelMatch({ mode: "simultaneous", words: WORDS });
    match.startCountdown(0);
    match.begin(BALANCE.countdownMs);
    const t = { v: BALANCE.countdownMs };
    //P2 finishes first: type P2's stream fast, P1's slow
    for (const c of WORDS.join("")) {
      t.v += 20;
      match.feedKey(c, "KeyJ", t.v);
    }
    for (const c of WORDS.join("")) {
      t.v += 50;
      match.feedKey(c, "KeyD", t.v);
    }
    const state = match.state();
    expect(state.phase).toBe("result");
    expect(state.result?.winnerSlot).toBe(2);
    expect(state.result?.marginMs).toBeGreaterThan(0);
  });

  it("the wrong key resets the partial and dents the accuracy", () => {
    const match = createSplitDuelMatch({ mode: "turn", words: WORDS });
    match.startCountdown(0);
    match.begin(BALANCE.countdownMs);
    match.feedKey("c", "KeyA", BALANCE.countdownMs + 10);
    match.feedKey("x", "KeyA", BALANCE.countdownMs + 20); //wrong
    match.feedKey("a", "KeyA", BALANCE.countdownMs + 30); //wrong
    const state = match.state();
    expect(state.players[1].typed).toBe(0);
    expect(state.players[1].wrongChars).toBe(2);
    expect(state.players[1].acc).toBeCloseTo(100 / 3, 1); //1 correct of 3 keys
  });

  it("an exact tie breaks on accuracy", () => {
    const match = createSplitDuelMatch({ mode: "turn", words: WORDS });
    match.startCountdown(0);
    match.begin(BALANCE.countdownMs);
    const t = { v: BALANCE.countdownMs };
    //P1 clean, P2 with one wrong key — same elapsed
    typeAll(match, "KeyA", t, 40);
    match.swapTo(2, t.v);
    //P2: same timing but burn a wrong key first, then catch up cleanly
    match.feedKey("z", "KeyA", t.v); //wrong (resets partial)
    for (const word of WORDS) {
      for (const c of word) {
        t.v += 40;
        match.feedKey(c, "KeyA", t.v);
      }
    }
    const state = match.state();
    expect(state.result?.p1Ms).toBe(state.result?.p2Ms);
    expect(state.result?.p1Acc).toBe(100);
    expect(state.result?.p1Acc).toBeGreaterThan(state.result?.p2Acc ?? 0);
    expect(state.result?.winnerSlot).toBe(1);
  });
});
