import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Crane Stack highscores for the desktop offline build (idea G17,
 * phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`craneScores` field, optional — wired in
 * the page phase).
 */

export const CRANE_SCORES_KEY = "mtDesktopCraneScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  height: z.number(),
  perfectCount: z.number(),
  misses: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  bestHeight: z.number(),
  perfectCount: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type CraneRunRecord = z.infer<typeof RunRecordSchema>;
type CraneScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<CraneScores>({
  key: CRANE_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, bestHeight: 0, perfectCount: 0, history: [] },
});

export type RecordRunResult = { isNewScoreRecord: boolean };

/** records a finished run: bests + the recent history (newest first) */
export function recordCraneRun(input: {
  score: number;
  height: number;
  perfectCount: number;
  misses: number;
}): RecordRunResult {
  const current = store.get();
  const record: CraneRunRecord = {
    at: Date.now(),
    score: input.score,
    height: input.height,
    perfectCount: input.perfectCount,
    misses: input.misses,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    bestHeight: Math.max(current.bestHeight, input.height),
    perfectCount: Math.max(current.perfectCount, input.perfectCount),
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord };
}

export function getCraneBestScore(): number {
  return store.get().bestScore;
}

export function getCraneBestHeight(): number {
  return store.get().bestHeight;
}

export function getCraneHistory(limit = HISTORY_LIMIT): CraneRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetCraneScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedCraneScores = {
  bestScore: number;
  bestHeight: number;
  perfectCount: number;
  history: CraneRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedCraneScores(
  value: unknown,
): SanitizedCraneScores {
  const sanitized: SanitizedCraneScores = {
    bestScore: 0,
    bestHeight: 0,
    perfectCount: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    bestHeight?: unknown;
    perfectCount?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
  }
  if (typeof raw.bestHeight === "number" && Number.isFinite(raw.bestHeight)) {
    sanitized.bestHeight = raw.bestHeight;
  }
  if (
    typeof raw.perfectCount === "number" &&
    Number.isFinite(raw.perfectCount)
  ) {
    sanitized.perfectCount = raw.perfectCount;
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
