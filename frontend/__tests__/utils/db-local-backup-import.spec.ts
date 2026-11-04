import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import { Mode, PersonalBests } from "@monkeytype/schemas/shared";

vi.mock("../../src/ts/states/notifications", () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showNoticeNotification: vi.fn(),
}));

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> = {},
): SnapshotResult<Mode> {
  return {
    _id: "test_import_1",
    wpm: 80,
    rawWpm: 90,
    charStats: { correct: 40, incorrect: 1, extra: 0, missed: 2 },
    acc: 95,
    mode: "words",
    mode2: "10",
    timestamp: 1700000000000,
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 10,
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

const restoredPbs: PersonalBests = {
  time: {
    "30": [
      {
        language: "english",
        difficulty: "normal",
        lazyMode: false,
        punctuation: false,
        numbers: false,
        wpm: 120,
        acc: 98,
        raw: 130,
        timestamp: 1690000000000,
        consistency: 90,
      },
    ],
  },
  words: {},
  quote: {},
  zen: {},
  custom: {},
};

function makeBackup(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    exportedAt: "2026-11-04T00:00:00.000Z",
    results: [
      makeResult(),
      makeResult({ _id: "test_import_2", timestamp: 1700000001000 }),
    ],
    snapshot: {
      personalBests: restoredPbs,
      typingStats: { timeTyping: 600, startedTests: 50, completedTests: 40 },
      xp: 100,
      streak: 3,
      maxStreak: 7,
      //yesterday relative to the test run: a result "today" continues the streak
      streakLastResultTimestamp: Date.now() - 86_400_000,
    },
    learnState: { unlockedGroups: 2, keyStats: {} },
  };
}

type FakeInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** installs a fake Tauri global with a mutable "disk" file */
function installFakeTauri(initialFile: string | null = null): void {
  const state: { contents: string | null } = { contents: initialFile };
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "backup_write") {
          state.contents = args?.["contents"] as string;
          return null;
        }
        if (cmd === "backup_read") {
          return state.contents;
        }
        throw new Error(`unexpected command ${cmd}`);
      }) as FakeInvoke,
    },
  };
}

function removeFakeTauri(): void {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
}

async function freshDb(): Promise<typeof import("../../src/ts/db")> {
  return import("../../src/ts/db");
}

describe("importLocalBackup (audit Y1: in-memory session follows restored storage)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    removeFakeTauri();
    vi.clearAllMocks();
  });
  //leave a clean shared fake-indexeddb factory behind: several spec
  //files share one worker global and a downstream file asserts an
  //empty store (audit of idea #11 - cross-file row leakage)
  afterEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
  });

  it("resyncs the in-memory snapshot and last result after a direct import", async () => {
    vi.resetModules();
    const Db = await freshDb();
    const { loadLocalResults } =
      await import("../../src/ts/utils/local-persistence");
    const { getLastResult } = await import("../../src/ts/states/snapshot");

    const count = await Db.importLocalBackup(makeBackup() as never);

    expect(count).toBe(2);
    const snapshot = Db.getSnapshot();
    expect(snapshot?.xp).toBe(100);
    expect(snapshot?.streak).toBe(3);
    expect(snapshot?.maxStreak).toBe(7);
    expect(snapshot?.typingStats?.timeTyping).toBe(600);
    expect(snapshot?.personalBests?.time["30"]?.[0]?.wpm).toBe(120);
    expect(getLastResult()?._id).toBe("test_import_2");
    expect(await loadLocalResults()).toHaveLength(2);
  });

  it("acceptance: auto-restore followed by saveLocalResult in the same session keeps the restored snapshot (the Y1 clobber)", async () => {
    installFakeTauri(JSON.stringify(makeBackup()));
    vi.resetModules();

    const AutoBackup = await import("../../src/ts/utils/desktop-auto-backup");
    const Db = await freshDb();
    const { loadLocalResults, loadLocalSnapshotFields } =
      await import("../../src/ts/utils/local-persistence");
    const { computeLocalXp } = await import("../../src/ts/utils/local-xp");

    await AutoBackup.restoreFromAutoBackupIfNeeded();

    //the session now sees the restored state...
    const snapshot = Db.getSnapshot();
    expect(snapshot?.xp).toBe(100);
    expect(snapshot?.streak).toBe(3);
    expect(snapshot?.personalBests?.time["30"]?.[0]?.wpm).toBe(120);

    //...and the first completed test of the session must build on it,
    //not on an empty snapshot
    const newResult = makeResult({
      _id: "test_import_new",
      timestamp: Date.now(),
    });
    Db.saveLocalResult({ result: newResult });

    const persisted = loadLocalSnapshotFields();
    expect(persisted?.streak).toBe(4); //3 restored + today's result
    expect(persisted?.maxStreak).toBe(7); //historical record survives
    expect(persisted?.xp).toBe(100 + computeLocalXp(newResult, 4));
    expect(persisted?.personalBests?.time["30"]?.[0]?.wpm).toBe(120);
    expect((await loadLocalResults()).map((it) => it._id)).toEqual([
      "test_import_1",
      "test_import_2",
      "test_import_new",
    ]);
  });

  it("keeps the stale in-memory snapshot untouched when the import fails validation", async () => {
    vi.resetModules();
    const Db = await freshDb();

    await expect(
      Db.importLocalBackup({ schemaVersion: 99, results: [] } as never),
    ).rejects.toThrow();

    //storage and memory are unchanged by the failed import
    expect(window.localStorage.getItem("mtDesktopLocalSnapshot")).toBeNull();
  });
});
