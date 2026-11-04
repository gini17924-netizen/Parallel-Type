import { describe, expect, it } from "vitest";

import { Language, Layout } from "@keybr/keyboard";

import { storedRowsToResults } from "../../src/ts/keybr/stored-results";

/** a fully well-formed stored row (the shape session.ts writes) */
function makeRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    timeStamp: 1700000000000,
    length: 120,
    time: 30,
    errors: 2,
    histogram: [
      { codePoint: 97, hitCount: 10, missCount: 1, timeToType: 120 },
      { codePoint: 98, hitCount: 8, missCount: 0, timeToType: 140 },
    ],
    ...overrides,
  };
}

describe("storedRowsToResults (audit L1: corrupt rows are skipped, not fatal)", () => {
  const layout = Layout.FA_IR;
  const language = Language.FA;

  it("converts well-formed rows into engine results", () => {
    const results = storedRowsToResults(layout, [
      makeRow(),
      makeRow({ timeStamp: 1700000001000 }),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.length).toBe(120);
    expect(results[0]?.errors).toBe(2);
  });

  it("stamps a missing timeStamp instead of rejecting the row", () => {
    const { timeStamp: _omitted, ...row } = makeRow();
    const results = storedRowsToResults(layout, [row]);
    expect(results).toHaveLength(1);
    expect(results[0]?.timeStamp).toBeGreaterThan(0);
  });

  it.each([
    ["a non-object row", "garbage"],
    ["a null row", null],
    ["non-numeric length", makeRow({ length: "120" })],
    ["NaN time", makeRow({ time: Number.NaN })],
    ["non-numeric errors", makeRow({ errors: null })],
    ["a missing histogram", makeRow({ histogram: undefined })],
    [
      "a histogram with malformed samples",
      makeRow({ histogram: [{ hitCount: 1 }] }),
    ],
    [
      "a histogram sample with NaN timeToType",
      makeRow({
        histogram: [
          { codePoint: 97, hitCount: 1, missCount: 0, timeToType: Number.NaN },
        ],
      }),
    ],
  ])("skips %s", (_name, row) => {
    const results = storedRowsToResults(layout, [makeRow(), row]);
    expect(results).toHaveLength(1); //only the healthy row survives
  });

  it("never passes NaN stats into the engine (the silent-poison vector)", () => {
    const results = storedRowsToResults(language.layout as never, [
      makeRow({ length: Number.NaN, errors: Number.NaN }),
    ]);
    expect(results).toHaveLength(0);
  });
});
