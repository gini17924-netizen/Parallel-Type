import { describe, expect, it } from "vitest";

import { createRelayEngine } from "../../src/ts/utils/relay/relay-engine";

const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

describe("phase 83 — the word relay engine", () => {
  it("side 0 owns the even words, side 1 the odd ones", () => {
    const a = createRelayEngine(WORDS, 0);
    const b = createRelayEngine(WORDS, 1);
    //side 0's turn first (the global index starts at 0)
    expect(a.state().turn).toBe(0);
    //side 0 feeds the first word; the WIRE carries the cursor to side 1,
    //whose turn flips only once the cursor arrives
    expect(a.feedWord("alpha")).toBe(true);
    b.setTheirIndex(a.state().myIndex);
    expect(b.state().turn).toBe(1);
    //side 1 feeds the second; the cursor returns — back to 0
    expect(b.feedWord("beta")).toBe(true);
    a.setTheirIndex(b.state().myIndex);
    expect(a.state().turn).toBe(0);
  });

  it("a word is rejected when it is not your turn", () => {
    const a = createRelayEngine(WORDS, 0);
    const b = createRelayEngine(WORDS, 1);
    //side 1 tries to type first — not the turn owner
    expect(b.feedWord("beta")).toBe(false);
    expect(a.feedWord("alpha")).toBe(true);
    //the wire: the cursor reaches side 1 — now it is their word
    b.setTheirIndex(a.state().myIndex);
    expect(b.feedWord("beta")).toBe(true);
  });

  it("a wrong word is rejected and the cursor holds", () => {
    const a = createRelayEngine(WORDS, 0);
    expect(a.feedWord("wrong")).toBe(false);
    expect(a.state().myIndex).toBe(0);
    expect(a.feedWord("alpha")).toBe(true);
  });

  it("the partner's cursor arrives from the wire and drives the turn", () => {
    const a = createRelayEngine(WORDS, 0);
    const b = createRelayEngine(WORDS, 1);
    a.feedWord("alpha");
    //side 1 learns side 0's cursor from the relay-progress message
    b.setTheirIndex(1);
    expect(b.state().turn).toBe(1);
    b.feedWord("beta");
    //a rewind from the wire is ignored (never re-opens done words)
    b.setTheirIndex(0);
    expect(b.state().theirIndex).toBe(1);
  });

  it("the out-of-range partner cursor is clamped", () => {
    const a = createRelayEngine(WORDS, 0);
    a.setTheirIndex(99); //side 1 owns 3 words — 99 is impossible
    expect(a.state().theirIndex).toBe(0);
  });

  it("the co-op completes when the whole list is covered", () => {
    const a = createRelayEngine(WORDS, 0);
    const b = createRelayEngine(WORDS, 1);
    const wire = (from: "a" | "b"): void => {
      //each feedWord is followed by its cursor message on the wire
      if (from === "a") b.setTheirIndex(a.state().myIndex);
      else a.setTheirIndex(b.state().myIndex);
    };
    a.feedWord("alpha");
    wire("a");
    b.feedWord("beta");
    wire("b");
    a.feedWord("gamma");
    wire("a");
    b.feedWord("delta");
    wire("b");
    a.feedWord("epsilon");
    wire("a");
    expect(a.state().allDone).toBe(false);
    b.feedWord("zeta");
    wire("b");
    expect(a.state().allDone).toBe(true);
    expect(b.state().allDone).toBe(true);
  });

  it("a side that finished its words accepts nothing more", () => {
    //a two-word list: side 0 has exactly one word
    const a = createRelayEngine(["alpha", "beta"], 0);
    expect(a.feedWord("alpha")).toBe(true);
    expect(a.state().myDone).toBe(true);
    expect(a.feedWord("beta")).toBe(false); //beta belongs to side 1
  });
});
