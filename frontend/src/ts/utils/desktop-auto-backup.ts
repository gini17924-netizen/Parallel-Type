import {
  exportBackup,
  hasKeybrState,
  loadLocalResults,
  loadLocalSnapshotFields,
  LEARN_STATE_KEY,
  type LocalBackup,
} from "./local-persistence";
import { showSuccessNotification } from "../states/notifications";

/**
 * Desktop auto-backup (closes KI-02).
 *
 * localStorage and IndexedDB both live inside the WebView2 profile, so a
 * wiped or migrated profile loses everything. This module mirrors all local
 * data to one JSON file in the Tauri app data dir (outside the profile) and
 * restores it automatically when the app boots with completely empty stores.
 * The file is written through the `backup_write`/`backup_read` commands in
 * src-tauri/src/main.rs.
 */

const MIN_WRITE_INTERVAL_MS = 30_000;

let writeTimer: ReturnType<typeof setTimeout> | undefined;
let lastWriteAt = 0;
let minWriteInterval = MIN_WRITE_INTERVAL_MS;

/** test hook: shrink the throttle window (production keeps 30s) */
export function _setMinWriteIntervalForTests(ms: number): void {
  minWriteInterval = ms;
}

type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

function getInvoke(): TauriInvoke | undefined {
  const tauri = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: TauriInvoke } };
    }
  ).__TAURI__;
  const invoke = tauri?.core?.invoke;
  return typeof invoke === "function" ? invoke : undefined;
}

/** Serializes all local data and writes it to the app data dir. */
export async function writeAutoBackup(): Promise<void> {
  const invoke = getInvoke();
  if (invoke === undefined) return; //not running inside Tauri
  try {
    const backup = await exportBackup();
    await invoke("backup_write", { contents: JSON.stringify(backup) });
  } catch (error) {
    console.error("automatic backup write failed", error);
  }
}

/**
 * Schedules a backup write, throttled to one write per
 * MIN_WRITE_INTERVAL_MS: bursts of results collapse into a single write,
 * and the trailing write always captures the latest state.
 */
export function queueAutoBackup(): void {
  if (getInvoke() === undefined) return;
  if (writeTimer !== undefined) return; //already scheduled
  const wait = Math.max(0, lastWriteAt + minWriteInterval - Date.now());
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    lastWriteAt = Date.now();
    void writeAutoBackup();
  }, wait);
}

/**
 * Boot-time recovery: when every local store is empty (fresh/migrated
 * webview profile) and a backup file exists, restore it. A non-empty store
 * is never touched. Restores are pushed back to the current app data dir
 * afterwards, since the file may have been read from the legacy location.
 */
export async function restoreFromAutoBackupIfNeeded(): Promise<void> {
  const invoke = getInvoke();
  if (invoke === undefined) return;
  try {
    const results = await loadLocalResults();
    const snapshot = loadLocalSnapshotFields();
    const learnState = window.localStorage.getItem(LEARN_STATE_KEY);
    if (
      results.length > 0 ||
      snapshot !== undefined ||
      learnState !== null ||
      hasKeybrState()
    ) {
      return; //local data exists - nothing to recover
    }
    const contents = await invoke<string | null>("backup_read");
    if (contents === null || contents === undefined) return;
    const backup = JSON.parse(contents) as LocalBackup;
    //late-bound import: db.ts statically imports this module, so a static
    //import here would create a module cycle (same pattern as
    //learn-stats.ts fetchWordList)
    const db = await import("../db");
    const count = await db.importLocalBackup(backup);
    await writeAutoBackup(); //re-anchor the file to the current app data dir
    showSuccessNotification(`Restored ${count} results from automatic backup`);
  } catch (error) {
    console.error("automatic backup restore failed", error);
  }
}
