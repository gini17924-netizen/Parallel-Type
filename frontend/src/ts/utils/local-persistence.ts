import { Mode } from "@monkeytype/schemas/shared";
import { Snapshot, SnapshotResult } from "../constants/default-snapshot";

/**
 * Desktop (offline) persistence layer.
 *
 * The desktop build runs signed-out (no Firebase). Upstream monkeytype does
 * not keep history for signed-out users, so this module adds local
 * persistence for results, personal bests and typing stats.
 *
 * Results live in IndexedDB (large, async, survives quota pressure better
 * than localStorage); personal bests / typing stats are tiny and needed
 * synchronously at boot, so they stay in localStorage.
 */

/** single switch for desktop-only behaviour */
export const DESKTOP_OFFLINE = true;

const LOCAL_SNAPSHOT_KEY = "mtDesktopLocalSnapshot";
/** legacy results key from 0.1.x, migrated into IndexedDB */
const LEGACY_RESULTS_KEY = "mtDesktopLocalResults";
const RESULTS_DB_NAME = "mtDesktopResults";
const RESULTS_STORE = "results";
const RESULTS_TIMESTAMP_INDEX = "by_timestamp";
const MAX_RESULTS = 1000;

/** fields too heavy (or not needed) to keep in local storage */
const STRIPPED_RESULT_FIELDS = [
  "chartData",
  "keySpacing",
  "keyDuration",
] as const;

export function makeLocalResultId(): string {
  return `local_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function stripHeavyFields(result: SnapshotResult<Mode>): SnapshotResult<Mode> {
  const stripped = structuredClone(result) as Record<string, unknown>;
  for (const field of STRIPPED_RESULT_FIELDS) delete stripped[field];
  return stripped as unknown as SnapshotResult<Mode>;
}

// ---------------------------------------------------------------------------
// results store (IndexedDB)
// ---------------------------------------------------------------------------

let resultsDbPromise: Promise<IDBDatabase> | undefined;
let migrationPromise: Promise<void> | undefined;

function createResultsStore(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(RESULTS_STORE)) {
    const store = db.createObjectStore(RESULTS_STORE, { keyPath: "_id" });
    store.createIndex(RESULTS_TIMESTAMP_INDEX, "timestamp");
  }
}

function openResultsDb(): Promise<IDBDatabase> {
  if (resultsDbPromise === undefined) {
    resultsDbPromise = new Promise((resolve, reject) => {
      //open without a version: whatever version the database is at, opening
      //must succeed. the store is only created (via a version bump) when it
      //is missing - e.g. an externally created or empty database. opening
      //with a fixed version would throw VersionError once the repair bumped
      //the version past it.
      const request = indexedDB.open(RESULTS_DB_NAME);
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(RESULTS_STORE)) {
          resolve(db);
          return;
        }
        const currentVersion = db.version;
        db.close();
        const retry = indexedDB.open(RESULTS_DB_NAME, currentVersion + 1);
        retry.onupgradeneeded = () => createResultsStore(retry.result);
        retry.onsuccess = () => resolve(retry.result);
        retry.onerror = () =>
          reject(retry.error ?? new Error("failed to repair results db"));
      };
      request.onerror = () =>
        reject(request.error ?? new Error("failed to open results db"));
    });
  }
  return resultsDbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexeddb request failed"));
  });
}

/**
 * Moves results persisted by 0.1.x (localStorage) into IndexedDB, once.
 * Safe to call repeatedly; runs before any read or write.
 */
export function ensureResultsMigrated(): Promise<void> {
  if (migrationPromise === undefined) {
    migrationPromise = (async () => {
      const raw = window.localStorage.getItem(LEGACY_RESULTS_KEY);
      if (raw === null) return;
      let legacy: unknown;
      try {
        legacy = JSON.parse(raw);
      } catch {
        legacy = null;
      }
      window.localStorage.removeItem(LEGACY_RESULTS_KEY);
      if (!Array.isArray(legacy)) return;
      const valid = legacy.filter(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          typeof (item as { _id?: unknown })._id === "string" &&
          typeof (item as { timestamp?: unknown }).timestamp === "number",
      );
      if (valid.length === 0) return;
      const db = await openResultsDb();
      const tx = db.transaction(RESULTS_STORE, "readwrite");
      const store = tx.objectStore(RESULTS_STORE);
      for (const item of valid) store.put(item);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("migration failed"));
        tx.onabort = () => reject(tx.error ?? new Error("migration aborted"));
      });
    })().catch((error) => {
      console.error("Failed to migrate legacy local results", error);
      migrationPromise = undefined; //allow a retry on the next call
      throw error;
    });
  }
  return migrationPromise;
}

/** Loads all locally stored results, oldest first. */
export async function loadLocalResults(): Promise<SnapshotResult<Mode>[]> {
  await ensureResultsMigrated();
  const db = await openResultsDb();
  const tx = db.transaction(RESULTS_STORE, "readonly");
  const all = await requestToPromise(
    tx.objectStore(RESULTS_STORE).getAll() as IDBRequest<SnapshotResult<Mode>[]>,
  );
  return all
    .filter(
      (it) =>
        it !== null &&
        typeof it === "object" &&
        typeof it._id === "string" &&
        typeof it.timestamp === "number",
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Adds a result, keeping at most MAX_RESULTS (oldest dropped). */
export async function appendLocalResult(
  result: SnapshotResult<Mode>,
): Promise<void> {
  await ensureResultsMigrated();
  const db = await openResultsDb();
  const tx = db.transaction(RESULTS_STORE, "readwrite");
  const store = tx.objectStore(RESULTS_STORE);
  store.put(stripHeavyFields(result));
  //cap enforcement: count, then delete the oldest overflow entries.
  //all requests are chained inside success handlers so the transaction
  //never idles out mid-way
  await new Promise<void>((resolve, reject) => {
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const overflow = countRequest.result - MAX_RESULTS;
      if (overflow <= 0) {
        resolve();
        return;
      }
      let toDelete = overflow;
      const cursorRequest = store
        .index(RESULTS_TIMESTAMP_INDEX)
        .openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null || toDelete <= 0) {
          resolve();
          return;
        }
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error("cap cursor failed"));
    };
    countRequest.onerror = () =>
      reject(countRequest.error ?? new Error("cap count failed"));
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("failed to append result"));
    tx.onabort = () => reject(tx.error ?? new Error("append aborted"));
  });
}

// ---------------------------------------------------------------------------
// snapshot fields (localStorage, synchronous boot path)
// ---------------------------------------------------------------------------

type PersistedSnapshotFields = Pick<
  Snapshot,
  "personalBests" | "typingStats" | "xp" | "streak" | "maxStreak"
>;

export function loadLocalSnapshotFields(): PersistedSnapshotFields | undefined {
  try {
    const raw = window.localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<PersistedSnapshotFields>;
    return {
      personalBests: parsed.personalBests,
      typingStats:
        parsed.typingStats ?? {
          timeTyping: 0,
          startedTests: 0,
          completedTests: 0,
        },
      xp: parsed.xp ?? 0,
      streak: parsed.streak ?? 0,
      maxStreak: parsed.maxStreak ?? 0,
    };
  } catch {
    return undefined;
  }
}

export function saveLocalSnapshotFields(snapshot: Snapshot): void {
  try {
    const fields: PersistedSnapshotFields = {
      personalBests: snapshot.personalBests,
      typingStats: snapshot.typingStats,
      xp: snapshot.xp,
      streak: snapshot.streak,
      maxStreak: snapshot.maxStreak,
    };
    window.localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(fields));
  } catch (error) {
    console.error("Failed to persist local snapshot", error);
  }
}

// ---------------------------------------------------------------------------
// backup / restore (full local data as one JSON file)
// ---------------------------------------------------------------------------

const BACKUP_SCHEMA_VERSION = 1;

export type LocalBackup = {
  schemaVersion: number;
  exportedAt: string;
  results: SnapshotResult<Mode>[];
  snapshot: PersistedSnapshotFields | undefined;
  learnState: Record<string, unknown> | undefined;
};

/** Exports all local data (results + snapshot fields) as a backup object. */
export async function exportBackup(): Promise<LocalBackup> {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    results: await loadLocalResults(),
    snapshot: loadLocalSnapshotFields(),
    learnState: readJsonSafe(LEARN_STATE_KEY),
  };
}

function readJsonSafe(key: string): Record<string, unknown> | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Replaces all local data with the given backup. Results are capped at
 * MAX_RESULTS like normal appends. Throws on an invalid backup file.
 */
export async function importBackup(backup: LocalBackup): Promise<number> {
  if (
    backup === null ||
    typeof backup !== "object" ||
    backup.schemaVersion !== BACKUP_SCHEMA_VERSION ||
    !Array.isArray(backup.results)
  ) {
    throw new Error("Invalid backup file: unknown schema");
  }

  const validResults = backup.results
    .filter(
      (it) =>
        it !== null &&
        typeof it === "object" &&
        typeof it._id === "string" &&
        typeof it.timestamp === "number",
    )
    .sort((a, b) => b.timestamp - a.timestamp) //newest first
    .slice(0, MAX_RESULTS)
    .map(stripHeavyFields);

  await ensureResultsMigrated();
  const db = await openResultsDb();
  const tx = db.transaction(RESULTS_STORE, "readwrite");
  const store = tx.objectStore(RESULTS_STORE);
  store.clear();
  for (const item of validResults) store.put(item);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("failed to import results"));
    tx.onabort = () => reject(tx.error ?? new Error("import aborted"));
  });

  if (backup.snapshot !== undefined && backup.snapshot !== null) {
    saveLocalSnapshotFields({
      personalBests: backup.snapshot.personalBests,
      typingStats: backup.snapshot.typingStats ?? {
        timeTyping: 0,
        startedTests: 0,
        completedTests: 0,
      },
      xp: backup.snapshot.xp ?? 0,
      streak: backup.snapshot.streak ?? 0,
      maxStreak: backup.snapshot.maxStreak ?? 0,
    } as PersistedSnapshotFields);
  }

  //restore the learning state (progressive-mode progress) if present
  const learnState = (backup as { learnState?: Record<string, unknown> })
    .learnState;
  if (learnState !== undefined && learnState !== null) {
    window.localStorage.setItem(
      "mtDesktopLearnState",
      JSON.stringify(learnState),
    );
  }
  return validResults.length;
}
