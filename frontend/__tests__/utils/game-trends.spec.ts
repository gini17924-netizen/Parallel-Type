import { describe, expect, it } from "vitest";

import {
  directionOf,
  gameTrendSeries,
  trendPoints,
} from "../../src/ts/utils/game-trends";

describe("phase 114 — the per-game trend aggregation (pure)", () => {
  it("trendPoints sorts oldest→newest, keeps the last N, drops garbage", () => {
    const points = trendPoints(
      [
        { at: 300, value: 5 },
        { at: 100, value: 1 },
        { at: 0, value: 0 }, //dropped: zero timestamp
        { at: 200, value: 3 },
        { at: 400, value: 7 },
        { at: -50, value: 9 }, //dropped: negative
      ],
      3,
    );
    expect(points.map((p) => p.value)).toEqual([3, 5, 7]);
    expect(points[0]?.at).toBe(200);
  });

  it("the direction reads the last two points", () => {
    expect(directionOf([{ at: 1, value: 5 }])).toBe("flat");
    expect(
      directionOf([
        { at: 1, value: 5 },
        { at: 2, value: 7 },
      ]),
    ).toBe("up");
    expect(
      directionOf([
        { at: 1, value: 7 },
        { at: 2, value: 5 },
      ]),
    ).toBe("down");
    expect(
      directionOf([
        { at: 1, value: 5 },
        { at: 2, value: 5 },
      ]),
    ).toBe("flat");
  });

  it("the summarize fields: best, latest and the step", () => {
    //via gameTrendSeries: only word-blast has an injectable shape? no —
    //the series reads the real stores; the pure pieces are covered above.
    //here: the series shape sanity
    const series = gameTrendSeries();
    expect(series.length).toBeGreaterThanOrEqual(9);
    for (const trend of series) {
      expect(trend.points.length).toBeLessThanOrEqual(10);
      expect(trend.best).toBeGreaterThanOrEqual(trend.latest);
      expect(["up", "down", "flat"]).toContain(directionOf(trend.points));
    }
  });

  it("every registered game has a unique id and a non-empty label", () => {
    const series = gameTrendSeries();
    const ids = series.map((t) => t.gameId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const trend of series) {
      expect(trend.label.trim()).not.toBe("");
    }
  });
});
