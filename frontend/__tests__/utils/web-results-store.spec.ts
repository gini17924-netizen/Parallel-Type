import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

//the results DB connection is cached at module level — every test gets a
//fresh module against a FRESH fake-idb factory (the local-persistence.spec
//convention), otherwise the previous test's row survives the reset
let LocalPersistence!: typeof import("../../src/ts/utils/local-persistence");
let Importer!: typeof import("../../src/ts/utils/web-results-import");

async function freshModules(): Promise<void> {
  vi.resetModules();
  LocalPersistence = await import("../../src/ts/utils/local-persistence");
  Importer = await import("../../src/ts/utils/web-results-import");
}

const WEB_ROW = {
  timestamp: Date.parse("2026-11-01T12:00:00"),
  mode: "time",
  mode2: "60",
  wpm: 72.5,
  acc: 96.2,
  rawWpm: 80,
  consistency: 82,
};

describe("phase 112 — importWebResults writes the store", () => {
  beforeEach(async () => {
    //own the store: several spec files share one worker-level
    //fake-indexeddb global (the local-persistence.spec convention)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    await freshModules();
  });

  it("a web export array lands as local rows", async () => {
    const outcome = await Importer.importWebResults([WEB_ROW, WEB_ROW]);
    //the two rows share a timestamp — the second is a duplicate
    expect(outcome).toEqual({
      imported: 1,
      skipped: 0,
      duplicates: 1,
    });
    const results = await LocalPersistence.loadLocalResults();
    expect(results).toHaveLength(1);
    expect(results[0]?.timestamp).toBe(WEB_ROW.timestamp);
    expect(results[0]?.wpm).toBe(72.5);
  });

  it("a hostile payload imports nothing and reports the skips", async () => {
    const outcome = await Importer.importWebResults("garbage");
    expect(outcome).toEqual({ imported: 0, skipped: 1, duplicates: 0 });
    expect(await LocalPersistence.loadLocalResults()).toHaveLength(0);
  });

  it("a second import of the same export imports nothing new", async () => {
    await Importer.importWebResults([WEB_ROW]);
    const second = await Importer.importWebResults([WEB_ROW]);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(await LocalPersistence.loadLocalResults()).toHaveLength(1);
  });
});
