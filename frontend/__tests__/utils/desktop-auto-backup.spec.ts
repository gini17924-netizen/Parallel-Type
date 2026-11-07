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
    _id: "test_auto_1",
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

type FakeInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** installs a fake Tauri global with a mutable "disk" file */
function installFakeTauri(initialFile: string | null = null): {
  file: () => string | null;
} {
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
  return { file: () => state.contents };
}

function removeFakeTauri(): void {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
}

async function freshModule(): Promise<
  typeof import("../../src/ts/utils/desktop-auto-backup")
> {
  vi.resetModules();
  return import("../../src/ts/utils/desktop-auto-backup");
}

describe("DesktopAutoBackup (KI-02)", () => {
  beforeEach(() => {
    //fresh IndexedDB per test: fake-indexeddb's global store persists like a
    //real browser profile, but these tests assert exact store contents
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

  it("does nothing when local data already exists", async () => {
    installFakeTauri();
    const { appendLocalResult, loadLocalResults } =
      await import("../../src/ts/utils/local-persistence");
    await appendLocalResult(makeResult());

    const AutoBackup = await freshModule();
    await AutoBackup.restoreFromAutoBackupIfNeeded();

    const results = await loadLocalResults();
    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe("test_auto_1");
  });

  it("restores everything from the backup file when stores are empty", async () => {
    const backup = {
      schemaVersion: 1,
      exportedAt: "2026-10-31T00:00:00.000Z",
      results: [
        makeResult(),
        makeResult({ _id: "test_auto_2", timestamp: 1700000001000 }),
      ],
      snapshot: {
        personalBests: undefined,
        typingStats: { timeTyping: 60, startedTests: 5, completedTests: 2 },
        xp: 100,
        streak: 3,
        maxStreak: 7,
      },
      learnState: {
        unlockedGroups: 4,
        keyStats: { ف: { correct: 30, incorrect: 1 } },
      },
    };
    const fake = installFakeTauri(JSON.stringify(backup));

    const AutoBackup = await freshModule();
    //the restore hands the backup to db's importer through the registration
    //hook (db.ts registers it at boot in the app - module cycle, see
    //registerBackupImporter)
    const db = await import("../../src/ts/db");
    AutoBackup.registerBackupImporter(db.importLocalBackup);
    await AutoBackup.restoreFromAutoBackupIfNeeded();

    const { loadLocalResults, loadLocalSnapshotFields } =
      await import("../../src/ts/utils/local-persistence");
    const results = await loadLocalResults();
    expect(results).toHaveLength(2);
    const snapshot = loadLocalSnapshotFields();
    expect(snapshot?.streak).toBe(3);
    expect(window.localStorage.getItem("mtDesktopLearnState")).toContain(
      '"unlockedGroups":4',
    );
    //the backup is re-anchored to the current app data dir
    expect(fake.file()).toContain('"schemaVersion":3'); //idea #11 bump
  });

  it("does nothing when there is no backup file", async () => {
    installFakeTauri(null);
    const AutoBackup = await freshModule();
    await AutoBackup.restoreFromAutoBackupIfNeeded();
    const { loadLocalResults } =
      await import("../../src/ts/utils/local-persistence");
    expect(await loadLocalResults()).toHaveLength(0);
  });

  it("skips the restore when no importer is registered", async () => {
    const backup = { schemaVersion: 3, results: [], exportedAt: "x" };
    installFakeTauri(JSON.stringify(backup));
    const AutoBackup = await freshModule();
    await AutoBackup.restoreFromAutoBackupIfNeeded();
    const { loadLocalResults } =
      await import("../../src/ts/utils/local-persistence");
    expect(await loadLocalResults()).toHaveLength(0);
  });

  it("queues at most one write per interval and writes the latest data", async () => {
    const fake = installFakeTauri(null);
    const AutoBackup = await freshModule();
    AutoBackup._setMinWriteIntervalForTests(50);

    AutoBackup.queueAutoBackup();
    AutoBackup.queueAutoBackup();
    AutoBackup.queueAutoBackup(); //bursts collapse
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fake.file()).toContain('"schemaVersion":3'); //idea #11 bump //one write, immediately

    //new data after the write: the next queue is throttled, then the
    //trailing write captures the latest data
    const { appendLocalResult } =
      await import("../../src/ts/utils/local-persistence");
    await appendLocalResult(
      makeResult({ _id: "test_auto_q1", timestamp: 1700000050000 }),
    );
    AutoBackup.queueAutoBackup();
    expect(fake.file()).not.toContain("test_auto_q1"); //scheduled, not yet run
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fake.file()).toContain("test_auto_q1");
  });

  it("is a no-op outside Tauri (no __TAURI__ global)", async () => {
    const AutoBackup = await freshModule();
    await expect(
      AutoBackup.restoreFromAutoBackupIfNeeded(),
    ).resolves.toBeUndefined();
    expect(() => AutoBackup.queueAutoBackup()).not.toThrow();
  });

  it("flushes a pending throttled write on beforeunload (audit L6)", async () => {
    //poll instead of fixed sleeps: this test drives real timers and must
    //stay deterministic under parallel-suite load
    const waitFor = async (
      predicate: () => boolean,
      timeoutMs = 2_000,
    ): Promise<void> => {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    const fake = installFakeTauri(null);
    const AutoBackup = await freshModule();
    AutoBackup._setMinWriteIntervalForTests(60_000);
    AutoBackup.installExitFlush();

    //an initial write marks lastWriteAt: the next queue is parked by the
    //throttle instead of firing immediately
    AutoBackup.queueAutoBackup();
    await waitFor(() => fake.file() !== null); //warm-up write completed

    const { appendLocalResult } =
      await import("../../src/ts/utils/local-persistence");
    await appendLocalResult(
      makeResult({ _id: "test_exit_flush", timestamp: 1700000090000 }),
    );
    AutoBackup.queueAutoBackup();
    expect(fake.file()).not.toContain("test_exit_flush");

    //tearing the page down flushes it immediately
    window.dispatchEvent(new Event("beforeunload"));
    await waitFor(() => (fake.file() ?? "").includes("test_exit_flush"));

    //and a second beforeunload without a pending write stays harmless
    expect(() => window.dispatchEvent(new Event("beforeunload"))).not.toThrow();
  });
});
