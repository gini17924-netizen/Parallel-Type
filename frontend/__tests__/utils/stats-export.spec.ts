import { describe, expect, it } from "vitest";

import {
  buildStatsExportHtml,
  buildTrendChart,
  escapeHtml,
  formatDate,
  formatDuration,
  type StatsExportData,
} from "../../src/ts/utils/stats-export";

function makeData(
  overrides: Partial<StatsExportData> = {},
): StatsExportData {
  return {
    name: "tester",
    generatedAt: 1700000000000,
    typingStats: { timeTyping: 12_345, startedTests: 120, completedTests: 100 },
    xp: 4210,
    streak: 3,
    maxStreak: 7,
    personalBests: {
      words: {
        "10": [
          { wpm: 80, acc: 96, raw: 85, timestamp: 1699999999000, language: "english" },
        ],
        "25": [
          { wpm: 70, acc: 95, raw: 76, timestamp: 1699999998000, language: "persian" },
        ],
      },
      quote: {
        "21": [{ wpm: 65, acc: 98, timestamp: 1699999997000, language: "persian" }],
      },
    },
    results: [
      { wpm: 60, acc: 95, mode: "words", mode2: "10", language: "english", timestamp: 1699999990000 },
      { wpm: 75, acc: 97, mode: "words", mode2: "10", language: "english", timestamp: 1699999995000 },
    ],
    ...overrides,
  };
}

describe("phase 72 — the stats html export", () => {
  it("escapes the dangerous characters", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("formats durations and dates", () => {
    expect(formatDuration(12_345)).toBe("3h 25m");
    expect(formatDuration(0)).toBe("0h 0m");
    expect(formatDate(1700000000000)).toBe("2023-11-14");
  });

  it("the trend chart needs at least two points", () => {
    expect(buildTrendChart([])).toBeUndefined();
    expect(
      buildTrendChart([
        { wpm: 60, acc: 95, mode: "words", mode2: "10", language: "english", timestamp: 1 },
      ]),
    ).toBeUndefined();
    const chart = buildTrendChart(makeData().results);
    expect(chart).toBeDefined();
    expect(chart).toContain("polyline");
  });

  it("renders the report with summary, pbs, chart and recent results", () => {
    const html = buildStatsExportHtml(makeData());
    //summary cards
    expect(html).toContain("3h 25m");
    expect(html).toContain(">4210<");
    expect(html).toContain("3 / 7");
    //both pb rows are present (strongest first)
    expect(html.indexOf("<td>80</td>")).toBeLessThan(
      html.indexOf("<td>70</td>"),
    );
    expect(html).toContain("persian");
    //the chart and the recent table
    expect(html).toContain("<svg");
    expect(html).toContain("recent results (2)");
  });

  it("escapes the user-controlled values (name, language)", () => {
    const html = buildStatsExportHtml(
      makeData({
        name: '<img src=x onerror="alert(1)">',
        personalBests: {
          words: {
            "10": [
              {
                wpm: 80,
                acc: 96,
                timestamp: 1,
                language: '</td><td>evil',
              },
            ],
          },
        },
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;/td&gt;&lt;td&gt;evil");
  });

  it("is fully self-contained: no scripts, no external urls", () => {
    const html = buildStatsExportHtml(makeData());
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toMatch(/src=/);
    expect(html).toContain("<!doctype html>");
  });

  it("handles the empty account gracefully", () => {
    const html = buildStatsExportHtml(
      makeData({ name: "", personalBests: {}, results: [] }),
    );
    expect(html).toContain("offline user");
    expect(html).toContain("not enough results to draw a trend yet");
    expect(html).toContain("personal bests (0)");
  });
});
