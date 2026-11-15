import { describe, expect, it } from "vitest";

import {
  buildResultsHtmlReport,
  dedupeAgainst,
  parseWebResults,
} from "../../src/ts/utils/web-results-import";

const GOOD_ROW = {
  timestamp: Date.parse("2026-11-01T12:00:00"),
  mode: "time",
  mode2: "60",
  wpm: 72.5,
  acc: 96.2,
  rawWpm: 80,
  consistency: 82,
};

describe("phase 109 — the web results import (pure parse)", () => {
  it("parses a valid array into local-ready rows", () => {
    const { rows, skipped } = parseWebResults([GOOD_ROW, GOOD_ROW]);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(rows[0]?.timestamp).toBe(GOOD_ROW.timestamp);
    expect(rows[0]?.wpm).toBe(72.5);
    expect(rows[0]?.mode).toBe("time");
    expect(rows[0]?.mode2).toBe("60");
    expect(rows[0]?.rawWpm).toBe(80);
  });

  it("a non-array payload counts as one skip", () => {
    expect(parseWebResults("garbage").skipped).toBe(1);
    expect(parseWebResults(null).skipped).toBe(1);
    expect(parseWebResults({ timestamp: 1 }).skipped).toBe(1);
  });

  it("hostile rows are skipped and counted, not thrown", () => {
    const { rows, skipped } = parseWebResults([
      GOOD_ROW,
      { timestamp: "yesterday", wpm: 50, acc: 90, mode: "time", mode2: "60" },
      { timestamp: -3, wpm: 50, acc: 90, mode: "time", mode2: "60" },
      { timestamp: 1, wpm: "fast", acc: 90, mode: "time", mode2: "60" },
      null,
      42,
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(5);
  });
});

describe("phase 109 — the dedupe against imported timestamps", () => {
  it("a re-shared export does not double-import", () => {
    const row2 = { ...GOOD_ROW, timestamp: Date.parse("2026-11-02T12:00:00") };
    const { rows } = parseWebResults([GOOD_ROW, row2]);
    const first = dedupeAgainst(rows, []);
    expect(first.rows).toHaveLength(2);
    expect(first.duplicates).toBe(0);
    const second = dedupeAgainst(rows, [GOOD_ROW.timestamp]);
    expect(second.rows).toHaveLength(1); //only row2 is new
    expect(second.duplicates).toBe(1);
  });
});

describe("phase 109 — the self-contained HTML report", () => {
  it("builds a no-server report with the bests and the table", () => {
    const { rows } = parseWebResults([GOOD_ROW]);
    const html = buildResultsHtmlReport(rows);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("no server involved");
    expect(html).toContain("72.5");
    expect(html).toContain("96.2%");
    expect(html).toContain("<table>");
  });

  it("escapes hostile markup in the mode fields", () => {
    const { rows } = parseWebResults([
      {
        ...GOOD_ROW,
        mode: "time<script>alert(1)</script>",
        mode2: "60<b>",
      },
    ]);
    const html = buildResultsHtmlReport(rows);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
