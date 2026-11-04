import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    _id: "single_1",
    wpm: 100,
    rawWpm: 110,
    charStats: [120, 2, 1, 3],
    acc: 95,
    consistency: 80,
    mode: "words",
    mode2: "10",
    timestamp: 1700000000000,
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 12,
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

//queryOptions types queryFn as optional (and its union is not directly
//callable); it is always set here - one typed accessor for all call sites
type ResultsModule = typeof import("../../src/ts/collections/results");
async function queryFullResult(
  Results: ResultsModule,
  id: string,
): Promise<SnapshotResult<Mode>> {
  const queryFn = Results.getSingleResultQueryOptions(id).queryFn as unknown as
    | (() => Promise<SnapshotResult<Mode>>)
    | undefined;
  if (queryFn === undefined) throw new Error("queryFn missing");
  return queryFn();
}

describe("getSingleResultQueryOptions offline branch (idea #11)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
  });

  //leave a clean shared fake-indexeddb factory behind (cross-file hygiene)
  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("merges the stored light row with its heavy chartData twin", async () => {
    vi.resetModules();
    const Results = await import("../../src/ts/collections/results");
    const { appendLocalResult } =
      await import("../../src/ts/utils/local-persistence");
    const chartData = { wpm: [50, 60], burst: [55, 66], err: [0, 1] };
    await appendLocalResult(makeResult({ _id: "single_full", chartData }));

    const full = await queryFullResult(Results, "single_full");
    expect(full.wpm).toBe(100);
    expect(full.chartData).toEqual(chartData);
  });

  it("returns the bare light row when no heavy twin exists (pre-feature rows)", async () => {
    vi.resetModules();
    const Results = await import("../../src/ts/collections/results");
    const { appendLocalResult } =
      await import("../../src/ts/utils/local-persistence");
    await appendLocalResult(makeResult({ _id: "single_legacy" }));

    const bare = await queryFullResult(Results, "single_legacy");
    expect(bare.wpm).toBe(100);
    expect(bare.chartData).toBeUndefined();
  });

  it("throws for an id that is not in the local store", async () => {
    vi.resetModules();
    const Results = await import("../../src/ts/collections/results");
    await expect(queryFullResult(Results, "single_missing")).rejects.toThrow(
      "not found in the local store",
    );
  });
});
