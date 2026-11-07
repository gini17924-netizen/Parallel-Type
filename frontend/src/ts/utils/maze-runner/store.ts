import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Maze Runner scores for the desktop offline build (idea G14, phase 1).
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`mazeScores` field, optional — wired in the page phase).
 */

export const MAZE_SCORES_KEY = "mtDesktopMazeScores";

const RunRecordSchema = z.object({
  at: z.number(),
  level: z.number(),
  timeMs: z.number(),
  score: z.number(),
  errors: z.number(),
});

const ScoresSchema = z.object({
  bestTimeByLevel: z.record(z.string(), z.number()),
  noErrorRuns: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type MazeRunRecord = z.infer<typeof RunRecordSchema>;
type MazeScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<MazeScores>({
  key: MAZE_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestTimeByLevel: {}, noErrorRuns: 0, history: [] },
});

export type RecordMazeRunResult = { isNewBestTime: boolean };

/** records a finished run: per-level best TIME + the history (newest first) */
export function recordMazeRun(input: {
  level: number;
  timeMs: number;
  score: number;
  errors: number;
}): RecordMazeRunResult {
  const current = store.get();
  const levelKey = String(input.level);
  const previousBest = current.bestTimeByLevel[levelKey];
  const isNewBestTime =
    previousBest === undefined || input.timeMs < previousBest;
  const bestTimeByLevel = { ...current.bestTimeByLevel };
  if (isNewBestTime) bestTimeByLevel[levelKey] = input.timeMs;
  store.set({
    bestTimeByLevel,
    noErrorRuns: current.noErrorRuns + (input.errors === 0 ? 1 : 0),
    history: [
      {
        at: Date.now(),
        level: input.level,
        timeMs: input.timeMs,
        score: input.score,
        errors: input.errors,
      },
      ...current.history,
    ].slice(0, HISTORY_LIMIT),
  });
  return { isNewBestTime };
}

export function getMazeBestTime(level: number): number | undefined {
  return store.get().bestTimeByLevel[String(level)];
}

export function getMazeNoErrorRuns(): number {
  return store.get().noErrorRuns;
}

export function getMazeHistory(limit = HISTORY_LIMIT): MazeRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetMazeScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedMazeScores = {
  bestTimeByLevel: Record<string, number>;
  noErrorRuns: number;
  history: MazeRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedMazeScores(
  value: unknown,
): SanitizedMazeScores {
  const sanitized: SanitizedMazeScores = {
    bestTimeByLevel: {},
    noErrorRuns: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestTimeByLevel?: unknown;
    noErrorRuns?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestTimeByLevel === "object" && raw.bestTimeByLevel !== null) {
    for (const [level, time] of Object.entries(
      raw.bestTimeByLevel as Record<string, unknown>,
    )) {
      if (typeof time === "number" && Number.isFinite(time) && time >= 0) {
        sanitized.bestTimeByLevel[level] = time;
      }
    }
  }
  if (typeof raw.noErrorRuns === "number" && Number.isFinite(raw.noErrorRuns)) {
    sanitized.noErrorRuns = Math.max(0, Math.floor(raw.noErrorRuns));
  }
  if (Array.isArray(raw.history)) {
    sanitized.history = raw.history
      .map((it) => RunRecordSchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  return sanitized;
}
