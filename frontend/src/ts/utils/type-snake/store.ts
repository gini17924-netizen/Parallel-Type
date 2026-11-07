import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Type Snake highscores and recent-run history for the desktop offline
 * build (idea G11, phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`typeSnakeScores` field, optional — wired
 * in the page phase).
 */

export const TYPE_SNAKE_SCORES_KEY = "mtDesktopTypeSnakeScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  length: z.number(),
  eaten: z.number(),
  maxCombo: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  bestLength: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type TypeSnakeRunRecord = z.infer<typeof RunRecordSchema>;
type TypeSnakeScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<TypeSnakeScores>({
  key: TYPE_SNAKE_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, bestLength: 0, history: [] },
});

export type RecordRunResult = {
  isNewScoreRecord: boolean;
  isNewLengthRecord: boolean;
};

/** records a finished run: bests + the recent history (newest first) */
export function recordTypeSnakeRun(input: {
  score: number;
  length: number;
  eaten: number;
  maxCombo: number;
}): RecordRunResult {
  const current = store.get();
  const record: TypeSnakeRunRecord = {
    at: Date.now(),
    score: input.score,
    length: input.length,
    eaten: input.eaten,
    maxCombo: input.maxCombo,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  const isNewLengthRecord = input.length > current.bestLength;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    bestLength: isNewLengthRecord ? input.length : current.bestLength,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord, isNewLengthRecord };
}

export function getTypeSnakeBestScore(): number {
  return store.get().bestScore;
}

export function getTypeSnakeBestLength(): number {
  return store.get().bestLength;
}

export function getTypeSnakeHistory(
  limit = HISTORY_LIMIT,
): TypeSnakeRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetTypeSnakeScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedTypeSnakeScores = {
  bestScore: number;
  bestLength: number;
  history: TypeSnakeRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedTypeSnakeScores(
  value: unknown,
): SanitizedTypeSnakeScores {
  const sanitized: SanitizedTypeSnakeScores = {
    bestScore: 0,
    bestLength: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    bestLength?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
  }
  if (typeof raw.bestLength === "number" && Number.isFinite(raw.bestLength)) {
    sanitized.bestLength = raw.bestLength;
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
