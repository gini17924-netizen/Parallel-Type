import { z } from "zod";

import { Mode } from "@monkeytype/schemas/shared";
import { Snapshot, SnapshotResult } from "../constants/default-snapshot";

/**
 * Storage key of the progressive learning state (owned here so the storage
 * layer and learn-stats share it without a circular import).
 */
export const LEARN_STATE_KEY = "mtDesktopLearnState";

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
export const MAX_RESULTS = 1000;

/** whether a results collection is at the storage cap (its owner should
 * disclose that older rows are hidden) */
export function isResultsCapped(count: number): boolean {
  return count >= MAX_RESULTS;
}

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
  const clone = structuredClone(result) as Record<string, unknown>;
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clone)) {
    if ((STRIPPED_RESULT_FIELDS as readonly string[]).includes(key)) continue;
    stripped[key] = value;
  }
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

async function openResultsDb(): Promise<IDBDatabase> {
  resultsDbPromise ??= new Promise((resolve, reject) => {
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
  return resultsDbPromise;
}

async function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
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
export async function ensureResultsMigrated(): Promise<void> {
  migrationPromise ??= (async () => {
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
  })().catch((error: unknown) => {
    console.error("Failed to migrate legacy local results", error);
    migrationPromise = undefined; //allow a retry on the next call
    throw error;
  });
  return migrationPromise;
}

/** Loads all locally stored results, oldest first. */
export async function loadLocalResults(): Promise<SnapshotResult<Mode>[]> {
  await ensureResultsMigrated();
  const db = await openResultsDb();
  const tx = db.transaction(RESULTS_STORE, "readonly");
  const all = await requestToPromise(
    tx.objectStore(RESULTS_STORE).getAll() as IDBRequest<
      SnapshotResult<Mode>[]
    >,
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
      const cursorRequest = store.index(RESULTS_TIMESTAMP_INDEX).openCursor();
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

/** Deletes one stored result by id. A missing id is a no-op (IndexedDB
 * delete on an absent key completes successfully) and all other rows are
 * preserved. */
export async function deleteLocalResult(resultId: string): Promise<void> {
  await ensureResultsMigrated();
  const db = await openResultsDb();
  const tx = db.transaction(RESULTS_STORE, "readwrite");
  tx.objectStore(RESULTS_STORE).delete(resultId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("failed to delete result"));
    tx.onabort = () => reject(tx.error ?? new Error("delete aborted"));
  });
}

// ---------------------------------------------------------------------------
// snapshot fields (localStorage, synchronous boot path)
// ---------------------------------------------------------------------------

type PersistedSnapshotFields = Pick<
  Snapshot,
  | "personalBests"
  | "typingStats"
  | "xp"
  | "streak"
  | "maxStreak"
  | "streakLastResultTimestamp"
>;

/** snapshot fields as loaded from disk: personalBests may be absent
 * in legacy data; every other field falls back to a default */
export type LoadedSnapshotFields = {
  personalBests: PersistedSnapshotFields["personalBests"] | undefined;
  typingStats: NonNullable<PersistedSnapshotFields["typingStats"]>;
  xp: number;
  streak: number;
  maxStreak: number;
  streakLastResultTimestamp: number;
};

export function loadLocalSnapshotFields(): LoadedSnapshotFields | undefined {
  try {
    const raw = window.localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<PersistedSnapshotFields>;
    return {
      personalBests: parsed.personalBests,
      typingStats: parsed.typingStats ?? {
        timeTyping: 0,
        startedTests: 0,
        completedTests: 0,
      },
      xp: parsed.xp ?? 0,
      streak: parsed.streak ?? 0,
      maxStreak: parsed.maxStreak ?? 0,
      streakLastResultTimestamp: parsed.streakLastResultTimestamp ?? 0,
    };
  } catch {
    return undefined;
  }
}

export function saveLocalSnapshotFields(fields: PersistedSnapshotFields): void {
  try {
    window.localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(fields));
  } catch (error) {
    console.error("Failed to persist local snapshot", error);
  }
}

// ---------------------------------------------------------------------------
// desktop state outside the snapshot (backed up since schema v2)
// ---------------------------------------------------------------------------

const DAILY_GOAL_KEY = "mtDesktopDailyGoalMinutes"; //owner: utils/daily-goal.ts
//owner: components/pages/games/GamesPage.tsx (the difficulty picker writes it)
const WORD_BLAST_DIFFICULTY_KEY = "mtDesktopWordBlastDifficulty";
const WORD_BLAST_SCORES_KEY = "mtDesktopWordBlastScores"; //owner: utils/word-blast-scores.ts
const CUSTOM_TEXT_KEY = "customText"; //owner: test/custom-text.ts
const CUSTOM_TEXT_LONG_KEY = "customTextLong"; //owner: test/custom-text.ts
const CUSTOM_TEXT_SETTINGS_KEY = "customTextSettings"; //owner: test/custom-text.ts
const CUSTOM_TEXT_ROTATION_KEY = "customTextRotation"; //owner: test/custom-text.ts

/** transient runtime state that must never be carried across restores */
const KEYBR_STATE_EXCLUDED = new Set(["mtKeybrBootError"]);

/** every localStorage key holding keybr engine state (owner: keybr/session.ts) */
function keybrStateKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (
      key !== null &&
      key.startsWith("mtKeybr") &&
      !KEYBR_STATE_EXCLUDED.has(key)
    ) {
      keys.push(key);
    }
  }
  return keys;
}

/** keybr engine state as raw key/value pairs, or undefined when absent */
export function loadKeybrState(): Record<string, string> | undefined {
  const keys = keybrStateKeys();
  if (keys.length === 0) return undefined;
  const state: Record<string, string> = {};
  for (const key of keys) {
    state[key] = window.localStorage.getItem(key) ?? "";
  }
  return state;
}

/** whether any keybr engine state exists (auto-backup emptiness gate) */
export function hasKeybrState(): boolean {
  return keybrStateKeys().length > 0;
}

/** v1 backups carry no keybr state: keep whatever the user has */
function restoreKeybrState(state: Record<string, string> | undefined): void {
  if (state === undefined) return;
  for (const key of keybrStateKeys()) {
    window.localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(state)) {
    window.localStorage.setItem(key, value);
  }
}

function loadDailyGoal(): number | undefined {
  const raw = window.localStorage.getItem(DAILY_GOAL_KEY);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// backup / restore (full local data as one JSON file)
// ---------------------------------------------------------------------------

const BACKUP_SCHEMA_VERSION = 2;

export type LocalBackup = {
  schemaVersion: number;
  exportedAt: string;
  results: SnapshotResult<Mode>[];
  snapshot: LoadedSnapshotFields | undefined;
  learnState: Record<string, unknown> | undefined;
  /** schema v2: keybr engine state (mtKeybr* keys, per-language histories) */
  keybrState?: Record<string, string> | undefined;
  /** schema v2: daily goal minutes (mtDesktopDailyGoalMinutes) */
  dailyGoal?: number | undefined;
  /** schema v2: word blast difficulty (mtDesktopWordBlastDifficulty) */
  wordBlast?: string | undefined;
  /** schema v2: word blast bests + recent history (mtDesktopWordBlastScores) */
  wordBlastScores?: Record<string, unknown> | undefined;
  /** schema v2: saved custom texts, their settings and the rotation state */
  customTexts?: Record<string, unknown> | undefined;
  customTextsLong?: Record<string, unknown> | undefined;
  customTextSettings?: Record<string, unknown> | undefined;
  customTextRotation?: Record<string, unknown> | undefined;
};

/** Exports all local data (results + snapshot fields) as a backup object. */
export async function exportBackup(): Promise<LocalBackup> {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    results: await loadLocalResults(),
    snapshot: loadLocalSnapshotFields(),
    learnState: readJsonSafe(LEARN_STATE_KEY),
    keybrState: loadKeybrState(),
    dailyGoal: loadDailyGoal(),
    wordBlast:
      window.localStorage.getItem(WORD_BLAST_DIFFICULTY_KEY) ?? undefined,
    wordBlastScores: readJsonSafe(WORD_BLAST_SCORES_KEY),
    customTexts: readJsonSafe(CUSTOM_TEXT_KEY),
    customTextsLong: readJsonSafe(CUSTOM_TEXT_LONG_KEY),
    customTextSettings: readJsonSafe(CUSTOM_TEXT_SETTINGS_KEY),
    customTextRotation: readJsonSafe(CUSTOM_TEXT_ROTATION_KEY),
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

// ---------------------------------------------------------------------------
// backup snapshot field validation (audit Y6)
// ---------------------------------------------------------------------------

const nonNegativeNumber = z.number().finite().nonnegative();

const typingStatsSchema = z.object({
  timeTyping: nonNegativeNumber,
  startedTests: nonNegativeNumber,
  completedTests: nonNegativeNumber,
});

/** the structural essence of PersonalBests: mode -> mode2 -> pb rows */
const personalBestsSchema = z.record(
  z.string(),
  z.record(z.string(), z.array(z.unknown())),
);

/** the value when valid, undefined (with a console note) when not */
function importNumberField(
  value: unknown,
  fallback: number,
  name: string,
): number {
  const parsed = nonNegativeNumber.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(
    `backup import: invalid snapshot field "${name}" (${String(value)}), keeping the current value`,
  );
  return fallback;
}

function parseTypingStats(
  value: unknown,
): LoadedSnapshotFields["typingStats"] | undefined {
  const parsed = typingStatsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value !== undefined) {
    console.error(
      "backup import: invalid typingStats, keeping the current value",
    );
  }
  return undefined;
}

function parsePersonalBests(
  value: unknown,
): LoadedSnapshotFields["personalBests"] {
  const parsed = personalBestsSchema.safeParse(value);
  if (parsed.success) return value as LoadedSnapshotFields["personalBests"];
  if (value !== undefined && value !== null) {
    console.error(
      "backup import: invalid personalBests, keeping the current value",
    );
  }
  return undefined;
}

/**
 * Replaces all local data with the given backup. Results are capped at
 * MAX_RESULTS like normal appends. Throws on an invalid backup file.
 */
export async function importBackup(backup: LocalBackup): Promise<number> {
  if (
    backup === null ||
    typeof backup !== "object" ||
    !Array.isArray(backup.results) ||
    (backup.schemaVersion !== 1 &&
      backup.schemaVersion !== BACKUP_SCHEMA_VERSION)
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
    tx.onerror = () =>
      reject(tx.error ?? new Error("failed to import results"));
    tx.onabort = () => reject(tx.error ?? new Error("import aborted"));
  });

  if (backup.snapshot !== undefined && backup.snapshot !== null) {
    //field-level validation (audit Y6): the file may be hand-edited or
    //corrupt (yet valid JSON), so every field is checked and an invalid one
    //falls back to the current stored value instead of poisoning the
    //snapshot. An absent field means "no data", not "erase" - the current
    //value is kept there too.
    const src = backup.snapshot;
    const current = loadLocalSnapshotFields();
    const pbs = parsePersonalBests(src.personalBests) ?? current?.personalBests;
    const typingStats = parseTypingStats(src.typingStats) ??
      current?.typingStats ?? {
        timeTyping: 0,
        startedTests: 0,
        completedTests: 0,
      };
    saveLocalSnapshotFields({
      personalBests: pbs,
      typingStats,
      xp: importNumberField(src.xp, current?.xp ?? 0, "xp"),
      streak: importNumberField(src.streak, current?.streak ?? 0, "streak"),
      maxStreak: importNumberField(
        src.maxStreak,
        current?.maxStreak ?? 0,
        "maxStreak",
      ),
      streakLastResultTimestamp: importNumberField(
        src.streakLastResultTimestamp,
        current?.streakLastResultTimestamp ?? 0,
        "streakLastResultTimestamp",
      ),
    } as PersistedSnapshotFields);
  }

  //restore the learning state (progressive-mode progress) if present
  const learnState = (backup as { learnState?: Record<string, unknown> })
    .learnState;
  if (learnState !== undefined && learnState !== null) {
    window.localStorage.setItem(LEARN_STATE_KEY, JSON.stringify(learnState));
  }

  //schema v2 desktop state: a v1 backup carries none of it, and the current
  //values are kept in that case
  restoreKeybrState(backup.keybrState);
  if (backup.dailyGoal !== undefined && backup.dailyGoal !== null) {
    window.localStorage.setItem(DAILY_GOAL_KEY, String(backup.dailyGoal));
  }
  if (backup.wordBlast !== undefined && backup.wordBlast !== null) {
    window.localStorage.setItem(WORD_BLAST_DIFFICULTY_KEY, backup.wordBlast);
  }
  if (backup.wordBlastScores !== undefined && backup.wordBlastScores !== null) {
    window.localStorage.setItem(
      WORD_BLAST_SCORES_KEY,
      JSON.stringify(backup.wordBlastScores),
    );
  }
  const jsonBackedKeys: [string, Record<string, unknown> | undefined][] = [
    [CUSTOM_TEXT_KEY, backup.customTexts],
    [CUSTOM_TEXT_LONG_KEY, backup.customTextsLong],
    [CUSTOM_TEXT_SETTINGS_KEY, backup.customTextSettings],
    [CUSTOM_TEXT_ROTATION_KEY, backup.customTextRotation],
  ];
  for (const [key, payload] of jsonBackedKeys) {
    if (payload !== undefined && payload !== null) {
      window.localStorage.setItem(key, JSON.stringify(payload));
    }
  }
  return validResults.length;
}
