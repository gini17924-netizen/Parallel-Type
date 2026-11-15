import { describe, expect, it } from "vitest";

import {
  createRelay,
  currentWord,
  feedKey,
  nextWordOwner,
  splitWords,
} from "../../src/ts/utils/team-relay/engine";

const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
const P1 = "player-1";
const P2 = "player-2";

function typeWord(
  state: ReturnType<typeof createRelay>,
  playerId: string,
  word: string,
): ReturnType<typeof createRelay> {
  let next = state;
  for (const ch of word) next = feedKey(next, playerId, ch);
  return next;
}

describe("phase 110 — the team relay split", () => {
  it("the alternating split gives each player their slice", () => {
    const players = splitWords(WORDS, [P1, P2]);
    expect(players[0]?.words).toEqual(["alpha", "gamma", "epsilon"]);
    expect(players[1]?.words).toEqual(["beta", "delta", "zeta"]);
  });

  it("createRelay opens on the first player, ready", () => {
    const state = createRelay(WORDS, [P1, P2]);
    expect(state.phase).toBe("ready");
    expect(state.activePlayerId).toBe(P1);
    expect(currentWord(state)).toEqual({ playerId: P1, word: "alpha" });
  });
});

describe("phase 110 — the turn machine", () => {
  it("a wrong key is ignored; correct keys build the word", () => {
    let state = createRelay(WORDS, [P1, P2]);
    state = feedKey(state, P1, "x"); //wrong key
    expect(state.players[0]?.typed).toBe(0);
    state = feedKey(state, P1, "a");
    expect(state.players[0]?.typed).toBe(1);
  });

  it("another player's key while it is not their turn is ignored", () => {
    let state = createRelay(WORDS, [P1, P2]);
    state = feedKey(state, P2, "b"); //P1's word is alpha
    expect(state.players[1]?.typed).toBe(0);
    expect(state.cursor).toBe(0);
  });

  it("completing a word passes the turn to the next word's owner", () => {
    let state = createRelay(WORDS, [P1, P2]);
    state = typeWord(state, P1, "alpha");
    expect(state.cursor).toBe(1);
    expect(state.activePlayerId).toBe(P2);
    expect(currentWord(state)).toEqual({ playerId: P2, word: "beta" });
    expect(state.players[0]?.done).toBe(1);
  });

  it("the full relay completes after every word is typed in turn", () => {
    let state = createRelay(WORDS, [P1, P2]);
    //type in seat order until complete (the wrong-key rule makes any
    //other order impossible)
    let guard = 0;
    while (state.phase !== "complete" && guard < 200) {
      guard++;
      const current = currentWord(state);
      if (current === undefined) break;
      state = typeWord(state, current.playerId, current.word);
    }
    expect(state.phase).toBe("complete");
    expect(state.players[0]?.done).toBe(3);
    expect(state.players[1]?.done).toBe(3);
    expect(currentWord(state)).toBeUndefined();
  });

  it("nextWordOwner reads the seating rotation", () => {
    const state = createRelay(WORDS, [P1, P2]);
    expect(nextWordOwner(state)).toBe(P2); //after alpha comes P2's beta
  });

  it("a three-player relay rotates alpha/gamma -> beta/delta -> zeta-style", () => {
    const players = splitWords(WORDS, ["a", "b", "c"]);
    expect(players[0]?.words).toEqual(["alpha", "delta"]);
    expect(players[1]?.words).toEqual(["beta", "epsilon"]);
    expect(players[2]?.words).toEqual(["gamma", "zeta"]);
  });
});
