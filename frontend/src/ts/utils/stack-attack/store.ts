import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Stack Attack highscores and recent-run history for the desktop offline
 * build (idea G12, phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`stackAttackScores` field, optional — wired
 * in the page phase).
 */

export const STACK_ATTACK_SCORES_KEY = "mtDesktopStackAttackScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  rowsCleared: z.number(),
  level: z.number(),
  blocksLocked: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type StackAttackRunRecord = z.infer<typeof RunRecordSchema>;
type StackAttackScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<StackAttackScores>({
  key: STACK_ATTACK_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, history: [] },
});

export type RecordRunResult = { isNewScoreRecord: boolean };

/** records a finished run: the best + the recent history (newest first) */
export function recordStackAttackRun(input: {
  score: number;
  rowsCleared: number;
  level: number;
  blocksLocked: number;
}): RecordRunResult {
  const current = store.get();
  const record: StackAttackRunRecord = {
    at: Date.now(),
    score: input.score,
    rowsCleared: input.rowsCleared,
    level: input.level,
    blocksLocked: input.blocksLocked,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord };
}

export function getStackAttackBestScore(): number {
  return store.get().bestScore;
}

export function getStackAttackHistory(
  limit = HISTORY_LIMIT,
): StackAttackRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetStackAttackScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedStackAttackScores = {
  bestScore: number;
  history: StackAttackRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedStackAttackScores(
  value: unknown,
): SanitizedStackAttackScores {
  const sanitized: SanitizedStackAttackScores = {
    bestScore: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
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
