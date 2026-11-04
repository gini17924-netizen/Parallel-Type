import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import { Mode } from "@monkeytype/schemas/shared";

vi.mock("../../src/ts/states/notifications", () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showNoticeNotification: vi.fn(),
}));

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> = {},
): SnapshotResult<Mode> {
  return {
    _id: "pb_identity_1",
    wpm: 80,
    rawWpm: 90,
    charStats: { correct: 40, incorrect: 1, extra: 0, missed: 2 },
    acc: 95,
    consistency: 80,
    mode: "words",
    mode2: "10",
    timestamp: 1700000000000,
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 10,
    punctuation: true,
    numbers: false,
    difficulty: "normal",
    language: "english",
    lazyMode: false,
    funbox: [],
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

describe("local PB punctuation identity (audit Y5b)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keys PB buckets on the effective set, not the raw config string", async () => {
    vi.resetModules();
    const setters = await import("../../src/ts/config/setters");
    const Db = await import("../../src/ts/db");
    const { loadLocalResults } =
      await import("../../src/ts/utils/local-persistence");

    Db.initLocalSnapshot();
    //a raw set is configured but the style is default: the generator uses
    //the built-in tables, so the PB must land in the "" identity bucket
    setters.setConfig("customPunctuation", "؟");
    Db.saveLocalResult({
      result: makeResult({ _id: "pb_default" }),
      isPb: true,
    });

    const entry = Db.getSnapshot()?.personalBests?.words["10"]?.[0];
    expect(entry?.customPunctuation).toBe("");
    expect(
      Db.getLocalPB("words", "10", true, false, "english", "normal", false, []),
    ).toBeDefined();

    //switching the style to custom moves to a different identity: the ""
    //entry must NOT be reused for custom-style results
    setters.setConfig("punctuationStyle", "custom");
    expect(
      Db.getLocalPB("words", "10", true, false, "english", "normal", false, []),
    ).toBeUndefined();

    Db.saveLocalResult({
      result: makeResult({ _id: "pb_custom", wpm: 110 }),
      isPb: true,
    });

    const entries = Db.getSnapshot()?.personalBests?.words["10"];
    expect(entries).toHaveLength(2); //separate buckets, not one overwritten
    expect(entries?.[1]?.customPunctuation).toBe("؟");
    const found = Db.getLocalPB(
      "words",
      "10",
      true,
      false,
      "english",
      "normal",
      false,
      [],
    );
    expect(found?.wpm).toBe(110);

    //Y5: the stored result row records the effective set at save time
    const rows = await loadLocalResults();
    const customRow = rows.find((r) => r._id === "pb_custom") as unknown as {
      customPunctuation?: string;
    };
    expect(customRow?.customPunctuation).toBe("؟");
  });
});
