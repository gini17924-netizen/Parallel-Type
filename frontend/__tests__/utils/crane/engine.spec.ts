import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/crane/balance";
import {
  createCraneEngine,
  type CraneEngine,
  type CraneState,
} from "../../../src/ts/utils/crane/engine";

function makeEngine(
  opts: {
    seq?: string[][];
    zoneCenter?: number;
  } = {},
): {
  engine: CraneEngine;
  state: () => CraneState;
} {
  let seqIdx = 0;
  const seqs = opts.seq ?? [["a", "s", "d", "f"]];
  const engine = createCraneEngine({
    seqFor: () => seqs[seqIdx++ % seqs.length] ?? ["a", "s", "d", "f"],
    rng: makeRng(7),
    zoneCenter: opts.zoneCenter ?? 50,
  });
  return { engine, state: () => engine.state() };
}

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("crane engine (idea G17 phase 1)", () => {
  it("spawns with the first sequence and the zone at the default center", () => {
    const { state } = makeEngine();
    const s = state();
    expect(s.sequence).toEqual(["a", "s", "d", "f"]);
    expect(s.typed).toBe(0);
    expect(s.zoneCenter).toBe(50);
    expect(s.height).toBe(0);
    expect(s.level).toBe(1);
  });

  it("the crane sweeps and bounces at the edges", () => {
    const { engine, state } = makeEngine();
    //tick long enough to bounce off the right edge
    for (let i = 0; i < 60; i++) engine.tick(50);
    const s = state();
    expect(s.craneX).toBeGreaterThanOrEqual(0);
    expect(s.craneX).toBeLessThanOrEqual(100);
  });

  it("typing the sequence at the zone center = Perfect (+300)", () => {
    const { engine, state } = makeEngine({ zoneCenter: 50 });
    //park the crane near the zone center
    engine._setCraneXForTests(50);
    for (const ch of "asdf") engine.feedKey(ch);
    const s = state();
    expect(s.height).toBe(1); //the box released
    expect(s.score).toBe(BALANCE.perfectScore);
    expect(s.perfectCount).toBe(1);
    expect(s.lastQuality).toBe("perfect");
  });

  it("releasing outside the poor window = a Miss; 3 Misses = done", () => {
    const { engine, state } = makeEngine({ zoneCenter: 50 });
    //park the crane far from the zone (at 0 — 50% away)
    engine._setCraneXForTests(0);
    for (const ch of "asdf") engine.feedKey(ch);
    let s = state();
    expect(s.lastQuality).toBe("miss");
    expect(s.misses).toBe(1);
    expect(s.height).toBe(0); //no box placed on a miss
    //two more misses
    engine._setCraneXForTests(100);
    for (const ch of "asdf") engine.feedKey(ch);
    engine._setCraneXForTests(0);
    for (const ch of "asdf") engine.feedKey(ch);
    s = state();
    expect(s.misses).toBe(3);
    expect(s.phase).toBe("done");
    expect(s.result).toBeDefined();
  });

  it("a wrong key resets the partial", () => {
    const { engine, state } = makeEngine();
    engine.feedKey("a");
    engine.feedKey("s");
    engine.feedKey("z"); //wrong
    expect(state().typed).toBe(0);
  });

  it("the zone shifts per level (10 floors)", () => {
    const { engine, state } = makeEngine({
      seq: [
        ["a", "s", "d", "f"],
        ["q", "w", "e", "r"],
        ["z", "x", "c", "v"],
      ],
      zoneCenter: 50,
    });
    const zoneBefore = state().zoneCenter;
    //release 10 boxes: level-up
    for (let i = 0; i < 10; i++) {
      engine._setCraneXForTests(state().zoneCenter);
      const seq = state().sequence;
      for (const ch of seq) engine.feedKey(ch);
    }
    const s = state();
    expect(s.height).toBe(10);
    expect(s.level).toBe(2); //1 + floor(10/10)
    expect(s.zoneCenter).not.toBe(zoneBefore); //the zone shifted
  });

  it("the snapshot hands out fresh sequence references (the KI-34 lesson)", () => {
    const { state } = makeEngine();
    const a = state().sequence;
    const b = state().sequence;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
