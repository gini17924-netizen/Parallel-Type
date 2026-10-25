import { Mode } from "@monkeytype/schemas/shared";
import { Snapshot, SnapshotResult } from "../constants/default-snapshot";

/**
 * Desktop (offline) persistence layer.
 *
 * The desktop build runs signed-out (no Firebase). Upstream monkeytype does
 * not keep history for signed-out users, so this module adds localStorage
 * backed persistence for results, personal bests and typing stats.
 */

/** single switch for desktop-only behaviour */
export const DESKTOP_OFFLINE = true;

const LOCAL_RESULTS_KEY = "mtDesktopLocalResults";
const LOCAL_SNAPSHOT_KEY = "mtDesktopLocalSnapshot";
const MAX_RESULTS = 1000;

/** fields too heavy (or not needed) to keep in localStorage */
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

export function loadLocalResults(): SnapshotResult<Mode>[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_RESULTS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is SnapshotResult<Mode> =>
        it !== null &&
        typeof it === "object" &&
        typeof (it as { _id?: unknown })._id === "string" &&
        typeof (it as { timestamp?: unknown }).timestamp === "number",
    );
  } catch {
    return [];
  }
}

export function appendLocalResult(result: SnapshotResult<Mode>): void {
  try {
    const stripped = structuredClone(result) as Record<string, unknown>;
    for (const field of STRIPPED_RESULT_FIELDS) delete stripped[field];

    const results = loadLocalResults();
    results.push(stripped as unknown as SnapshotResult<Mode>);
    results.sort((a, b) => a.timestamp - b.timestamp);
    while (results.length > MAX_RESULTS) results.shift();

    window.localStorage.setItem(LOCAL_RESULTS_KEY, JSON.stringify(results));
  } catch (error) {
    console.error("Failed to persist local result", error);
  }
}

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
