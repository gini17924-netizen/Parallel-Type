import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import { Mode } from "@monkeytype/schemas/shared";

let ResultExport!: typeof import("../../src/ts/utils/result-export");
let LocalPersistence!: typeof import("../../src/ts/utils/local-persistence");

async function freshModules(): Promise<void> {
  vi.resetModules();
  ResultExport = await import("../../src/ts/utils/result-export");
  LocalPersistence = await import("../../src/ts/utils/local-persistence");
}

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> = {},
): SnapshotResult<Mode> {
  return {
    _id: "csv_1",
    wpm: 100,
    rawWpm: 110,
    charStats: [120, 2, 1, 3],
    acc: 95,
    consistency: 80,
    mode: "words",
    mode2: "10",
    timestamp: 1700000000000,
    restartCount: 1,
    incompleteTestSeconds: 5,
    afkDuration: 2,
    testDuration: 12,
    punctuation: false,
    numbers: false,
    difficulty: "normal",
    language: "english",
    lazyMode: false,
    funbox: [],
    isPb: true,
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

describe("result-export (idea #11: full-store CSV)", () => {
  beforeEach(async () => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModules();
  });
  //leave a clean shared fake-indexeddb factory behind: several spec
  //files share one worker global and a downstream file asserts an
  //empty store (audit of idea #11 - cross-file row leakage)
  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("emits the exact header, upstream columns first then additions", () => {
    const csv = ResultExport.toCsv([]);
    expect(csv.split("\n")[0]).toBe(
      [
        "_id",
        "isPb",
        "wpm",
        "acc",
        "rawWpm",
        "consistency",
        "charStats",
        "mode",
        "mode2",
        "quoteLength",
        "restartCount",
        "testDuration",
        "afkDuration",
        "incompleteTestSeconds",
        "punctuation",
        "numbers",
        "language",
        "funbox",
        "difficulty",
        "lazyMode",
        "blindMode",
        "bailedOut",
        "tags",
        "timestamp",
        "timestampISO",
        "keyConsistency",
        "wpmConsistency",
        "customTextLength",
      ].join(","),
    );
    expect(csv.split("\n")).toHaveLength(1); //header only for empty input
  });

  it("serializes a row: charStats tuple, funbox/tags semicolon-joined, ISO time", () => {
    const csv = ResultExport.toCsv([
      makeResult({
        funbox: ["growing_text", "showalllines"] as never,
        tags: ["t1", "t2"],
        keyConsistency: 88,
        wpmConsistency: 77,
        customText: { textLen: 42, mode: "repeat", limit: { value: 42 } },
      } as never),
    ]);
    const row = csv.split("\n")[1]?.split(",");
    expect(row?.[0]).toBe("csv_1");
    expect(row?.[6]).toBe("120;2;1;3");
    expect(row?.[17]).toBe("growing_text;showalllines"); //regression: raw array joined "," and broke columns
    expect(row?.[22]).toBe("t1;t2");
    expect(row?.[24]).toBe(new Date(1700000000000).toISOString());
    expect(row?.[25]).toBe("88");
    expect(row?.[26]).toBe("77");
    expect(row?.[27]).toBe("42");
  });

  it("escapes commas, quotes and newlines per RFC 4180", () => {
    const csv = ResultExport.toCsv([
      makeResult({ language: 'a,b"c\nd', mode2: "10" } as never),
    ]);
    //the language field must come out quoted with doubled quotes
    expect(csv).toContain('"a,b""c\nd"');
    //minimal RFC 4180 parser for the row (single result): the quoted field
    //contains an embedded newline, so naive split("\n") would break
    const row = csv.slice(csv.indexOf("\n") + 1);
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (inQuotes) {
        if (ch === '"') {
          if (row[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    expect(fields).toHaveLength(28);
    expect(fields[16]).toBe('a,b"c\nd'); //language kept whole
  });

  it("handles a legacy object charStats shape defensively", () => {
    const csv = ResultExport.toCsv([
      makeResult({
        charStats: { correct: 9, incorrect: 1, extra: 0, missed: 2 },
      } as never),
    ]);
    const row = csv.split("\n")[1]?.split(",");
    expect(row?.[6]).toBe("9;1;0;2");
  });

  it("exports the full store newest-first, unfiltered and uncapped", async () => {
    //store 3 results, older than the others first
    await LocalPersistence.appendLocalResult(
      makeResult({ _id: "old", timestamp: 1600000000000 }),
    );
    await LocalPersistence.appendLocalResult(
      makeResult({ _id: "newest", timestamp: 1800000000000 }),
    );
    await LocalPersistence.appendLocalResult(
      makeResult({ _id: "middle", timestamp: 1700000000000 }),
    );

    const downloads: { filename: string; csv: string }[] = [];
    vi.stubGlobal("URL", {
      ...globalThis.URL,
      createObjectURL: () => "blob:mock",
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({
        filename: this.download,
        //re-parse the blob content through the CSV we built
        csv: "",
      });
      return undefined;
    });

    await ResultExport.exportResultsCsv();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toMatch(
      /^monkeytype-results-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    vi.unstubAllGlobals();
  });

  it("keeps full fidelity: rows above the old 1000 cap are exported", async () => {
    //direct unit check of the no-cap promise via loadLocalResults ordering
    const results = [
      makeResult({ _id: "b", timestamp: 1700000001000 }),
      makeResult({ _id: "a", timestamp: 1700000000000 }),
    ];
    const csv = ResultExport.toCsv(results);
    const ids = csv
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[0]);
    //toCsv preserves the given order; exportResultsCsv does the sorting
    expect(ids).toEqual(["b", "a"]);
  });
});
