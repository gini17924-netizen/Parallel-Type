import { describe, expect, it } from "vitest";

import {
  curveGhostFromChartData,
  ghostFromLastResult,
  ghostFromPersonalBest,
} from "../../../src/ts/utils/ghost-gp/ghost-source";

describe("ghost-gp sources (idea G3 phase 1)", () => {
  describe("ghostFromLastResult", () => {
    it("rejects a missing result with a clear reason", () => {
      const result = ghostFromLastResult(undefined, "english");
      expect(result).toEqual({ ok: false, reason: "no-result" });
    });

    it("rejects a result from another language", () => {
      const result = ghostFromLastResult(
        { wpm: 90, language: "persian" },
        "english",
      );
      expect(result).toEqual({ ok: false, reason: "wrong-language" });
    });

    it("rejects a zero/nonsense wpm", () => {
      expect(
        ghostFromLastResult({ wpm: 0, language: "english" }, "english"),
      ).toEqual({ ok: false, reason: "invalid-wpm" });
      expect(
        ghostFromLastResult(
          { wpm: Number.NaN, language: "english" },
          "english",
        ),
      ).toEqual({ ok: false, reason: "invalid-wpm" });
    });

    it("builds a constant ghost from a matching result", () => {
      const result = ghostFromLastResult(
        { wpm: 92, language: "english" },
        "english",
      );
      expect(result).toEqual({
        ok: true,
        ghost: { kind: "constant", wpm: 92, label: "last run" },
      });
    });
  });

  describe("ghostFromPersonalBest", () => {
    it("rejects a missing PB", () => {
      expect(ghostFromPersonalBest(undefined, "english")).toEqual({
        ok: false,
        reason: "no-result",
      });
    });

    it("rejects a PB of another language (the identity match includes it)", () => {
      expect(
        ghostFromPersonalBest({ wpm: 120, language: "german" }, "english"),
      ).toEqual({ ok: false, reason: "wrong-language" });
    });

    it("builds a constant ghost from a matching PB", () => {
      const result = ghostFromPersonalBest(
        { wpm: 120, language: "english" },
        "english",
      );
      expect(result).toEqual({
        ok: true,
        ghost: { kind: "constant", wpm: 120, label: "personal best" },
      });
    });
  });
});

describe("curveGhostFromChartData (idea G3 phase 3)", () => {
  it("builds a curve ghost from a real burst", () => {
    const ghost = curveGhostFromChartData(
      { burst: [60, 120, 90] },
      90,
      "last run",
    );
    expect(ghost).toEqual({
      kind: "curve",
      perSecondWpm: [60, 120, 90],
      averageWpm: 90,
      label: "last run",
    });
  });

  it("falls back to a constant ghost on a toolong chartData", () => {
    expect(curveGhostFromChartData("toolong", 90, "last run")).toEqual({
      kind: "constant",
      wpm: 90,
      label: "last run",
    });
  });

  it("falls back to a constant ghost on a stripped row (no chartData)", () => {
    expect(curveGhostFromChartData(undefined, 90, "last run")).toEqual({
      kind: "constant",
      wpm: 90,
      label: "last run",
    });
  });

  it("falls back when the burst is too short to shape a curve", () => {
    expect(curveGhostFromChartData({ burst: [60] }, 60, "last run")).toEqual({
      kind: "constant",
      wpm: 60,
      label: "last run",
    });
    expect(curveGhostFromChartData({ burst: [] }, 60, "last run")).toEqual({
      kind: "constant",
      wpm: 60,
      label: "last run",
    });
  });

  it("filters non-positive burst entries before deciding", () => {
    //one valid entry after filtering -> still too short for a curve
    expect(
      curveGhostFromChartData({ burst: [0, 60, -1] }, 60, "last run"),
    ).toEqual({ kind: "constant", wpm: 60, label: "last run" });
  });
});
