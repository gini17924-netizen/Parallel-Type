import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/firefight/balance";
import {
  createFirefightEngine,
  type FirefightEngine,
  type FirefightState,
} from "../../../src/ts/utils/firefight/engine";

function makeEngine(opts: { surviveMs?: number } = {}): {
  engine: FirefightEngine;
  state: () => FirefightState;
} {
  const engine = createFirefightEngine({
    wordFor: () => "blaze",
    rng: (() => {
      let s = 7;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    })(),
    surviveMs: opts.surviveMs,
  });
  return { engine, state: () => engine.state() };
}

describe("firefight engine (idea G16 phase 1)", () => {
  it("exactly one cell ignites at the start and becomes the active", () => {
    const { state } = makeEngine();
    const s = state();
    expect(s.activeIndex).not.toBeUndefined();
    expect(s.activeWord).toBe("blaze");
    expect(s.activeTyped).toBe(0);
    //exactly one burning cell: the sim started with one ignition
    const burning = s.cells.filter((c) => c.state === "burning");
    expect(burning).toHaveLength(1);
  });

  it("typing the active word extinguishes it (len x 15, combo 1)", () => {
    const { engine, state } = makeEngine();
    for (const ch of "blaze") engine.feedKey(ch);
    const s = state();
    expect(s.extinguished).toBe(1);
    expect(s.score).toBe(5 * BALANCE.scorePerChar);
    expect(s.combo).toBe(1);
    //the only fire is out: the hose idles (activeWord undefined) until
    //the sim's spread ignites something new
    expect(s.activeWord).toBeUndefined();
  });

  it("a wrong key breaks the combo but keeps the typed progress", () => {
    const { engine, state } = makeEngine();
    engine.feedKey("b");
    engine.feedKey("l");
    engine.feedKey("z"); //wrong
    const s = state();
    expect(s.combo).toBe(0);
    expect(s.activeTyped).toBe(2);
  });

  it("the active cell is the MOST CRITICAL burning cell", () => {
    const { engine, state } = makeEngine();
    //let the fire spread FIRST (multiple burning cells), then verify the
    //hose targets the cell with the most intact neighbors
    for (let i = 0; i < 130; i++) engine.tick(50);
    const s = state();
    expect(s.activeIndex).not.toBeUndefined();
    //the active cell's criticality is the max among the burning cells:
    const cells = s.cells;
    const burning = cells
      .map((c, idx) => (c.state === "burning" ? idx : -1))
      .filter((i) => i >= 0);
    const count = (idx: number): number => {
      //neighbors of idx within a 3x3 grid
      const x = idx % 3;
      const y = Math.floor(idx / 3);
      const out: number[] = [];
      if (y > 0) out.push(idx - 3);
      if (y < 2) out.push(idx + 3);
      if (x > 0) out.push(idx - 1);
      if (x < 2) out.push(idx + 1);
      return out.filter((n) => cells[n]?.state === "intact").length;
    };
    const activeCount = count(s.activeIndex ?? 0);
    for (const idx of burning) {
      expect(count(idx)).toBeLessThanOrEqual(activeCount);
    }
  });

  it("the run is lost when the ash ratio hits the threshold", () => {
    const { engine, state } = makeEngine();
    //idle: the fire spreads and burns unchecked until 35% of the 108
    //cells are ashes (38 cells — the front needs time)
    let guard = 0;
    while (state().phase === "running" && guard++ < 2500) {
      engine.tick(100);
    }
    const s = state();
    expect(s.phase).toBe("lost");
    expect(s.result).toBeDefined();
    expect(s.result?.won).toBe(false);
    expect(s.ashRatio).toBeGreaterThanOrEqual(BALANCE.ashLossRatio);
  });

  it("the run is won by surviving the full window", () => {
    const { engine, state } = makeEngine({ surviveMs: 3000 });
    //a short window: extinguish whatever ignites — with the fires out
    //the ashes never reach the threshold, so the window expires = won
    let guard = 0;
    while (state().phase === "running" && guard++ < 300) {
      engine.tick(50);
      const word = state().activeWord ?? "";
      for (const ch of word) engine.feedKey(ch);
    }
    const s = state();
    expect(s.phase).toBe("won");
    expect(s.result?.won).toBe(true);
    expect(s.result?.elapsedMs).toBeGreaterThanOrEqual(3000);
  });

  it("the final score pays the ash penalty, floored at 0", () => {
    const { engine, state } = makeEngine();
    //idle to a loss: raw score 0, ashes > 0 -> the final score floors at 0
    let guard = 0;
    while (state().phase === "running" && guard++ < 2500) {
      engine.tick(100);
    }
    const s = state();
    expect(s.result?.score).toBe(0);
    expect(s.result?.ashes).toBeGreaterThan(0);
  });

  it("the snapshot hands out fresh cell references (the KI-34 lesson)", () => {
    const { state } = makeEngine();
    const a = state().cells[0];
    const b = state().cells[0];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
