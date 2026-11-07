import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/beat-keys/balance";
import {
  createBeatKeysEngine,
  type BeatKeysEngine,
} from "../../../src/ts/utils/beat-keys/engine";
import type { BeatChart } from "../../../src/ts/utils/beat-keys/chart";

/** a hand-built 3-note chart on distinct lanes (deterministic judging) */
function makeChart(): BeatChart {
  return {
    bpm: 100,
    beatMs: 600,
    durationBeats: 8,
    notes: [
      { tMs: 1000, lane: 0, key: "d" },
      { tMs: 1600, lane: 1, key: "f" },
      { tMs: 2200, lane: 2, key: "j" },
    ],
  };
}

function makeEngine(
  opts: {
    chart?: BeatChart;
    offsetMs?: number;
  } = {},
): {
  engine: BeatKeysEngine;
  nowMs: () => number;
  setNow: (ms: number) => void;
} {
  let t = 0;
  const engine = createBeatKeysEngine({
    chart: opts.chart ?? makeChart(),
    now: () => t,
    offsetMs: opts.offsetMs,
  });
  return { engine, nowMs: () => t, setNow: (ms: number) => (t = ms) };
}

describe("beat-keys engine (idea G21 phase 1)", () => {
  it("the ±80ms boundary is Perfect on both sides", () => {
    const { engine, setNow } = makeEngine();
    setNow(1000 - BALANCE.windowPerfectMs); //dt = -80
    expect(engine.judge("d").lastGrade).toBe("perfect");
    setNow(1600 + BALANCE.windowPerfectMs); //dt = +80
    expect(engine.judge("f").lastGrade).toBe("perfect");
  });

  it("the 160/300 boundaries grade Good and Poor", () => {
    const { engine, setNow } = makeEngine();
    setNow(1600 + BALANCE.windowGoodMs); //dt = +160 → Good
    expect(engine.judge("f").lastGrade).toBe("good");
    setNow(2200 + BALANCE.windowPoorMs); //dt = +300 → Poor
    expect(engine.judge("j").lastGrade).toBe("poor");
  });

  it("a tap with no note in the window is a no-op (doc §۰.۷)", () => {
    const { engine, setNow } = makeEngine();
    setNow(1000 - BALANCE.windowPoorMs - 1); //301ms early
    const before = engine.state();
    const after = engine.judge("d");
    expect(after.grades).toEqual(before.grades);
    expect(after.score).toBe(before.score);
    expect(after.lastGrade).toBeUndefined();
  });

  it("a wrong key is a no-op", () => {
    const { engine, setNow } = makeEngine();
    setNow(1000); //right on the note
    const after = engine.judge("z");
    expect(after.lastGrade).toBeUndefined();
    expect(after.judgedCount).toBe(0);
  });

  it("an expired note auto-misses and breaks the combo", () => {
    const { engine, setNow } = makeEngine();
    setNow(1000);
    engine.judge("d"); //perfect, combo 1
    setNow(1600);
    engine.judge("f"); //perfect, combo 2
    expect(engine.state().combo).toBe(2);
    //the last note expires at 2200 + 300
    setNow(2200 + BALANCE.windowPoorMs + 50);
    const state = engine.state();
    expect(state.grades.miss).toBe(1);
    expect(state.combo).toBe(0);
    expect(state.phase).toBe("done"); //all 3 judged
    expect(state.result?.rank).toBeDefined();
  });

  it("the calibration offset shifts the judged timeline", () => {
    //a user who taps 120ms late: offsetMs = 120 → a tap at note.t + 120
    //is judged as dt = 0 (Perfect), while without the offset it is Good
    const without = makeEngine();
    without.setNow(1000 + 120);
    expect(without.engine.judge("d").lastGrade).toBe("good");
    const withOffset = makeEngine({ offsetMs: 120 });
    withOffset.setNow(1000 + 120);
    expect(withOffset.engine.judge("d").lastGrade).toBe("perfect");
  });

  it("all perfects → rank S; misses drag the rank down", () => {
    const perfect = makeEngine();
    perfect.setNow(1000);
    perfect.engine.judge("d");
    perfect.setNow(1600);
    perfect.engine.judge("f");
    perfect.setNow(2200);
    perfect.engine.judge("j");
    const s = perfect.engine.state();
    expect(s.result?.rank).toBe("S");
    expect(s.result?.acc).toBe(100);

    const sloppy = makeEngine();
    sloppy.setNow(0); //every note expires unjudged
    sloppy.setNow(3000);
    const c = sloppy.engine.state();
    expect(c.result?.misses).toBe(3);
    expect(c.result?.rank).toBe("C");
  });

  it("visibleNotes only exposes the near-future notes (doc §۵)", () => {
    const { engine, setNow } = makeEngine();
    setNow(500); //note 1 at 1000 (+500), note 2 at 1600 (+1100), note 3 at 2200 (+1700)
    const visible = engine.visibleNotes(1200);
    expect(visible.map((n) => n.key)).toEqual(["d", "f"]); //the third is beyond the lead
    expect(visible[0]?.timeUntilHitMs).toBe(500);
  });

  it("the snapshot hands out fresh grade copies (the KI-34 lesson)", () => {
    const { engine } = makeEngine();
    const a = engine.state().grades;
    const b = engine.state().grades;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
