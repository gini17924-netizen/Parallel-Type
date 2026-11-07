import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Fruit Slash highscores and recent-run history for the desktop offline
 * build (idea G10, phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`fruitSlashScores` field, optional — wired
 * in the page phase).
 */

export const FRUIT_SLASH_SCORES_KEY = "mtDesktopFruitSlashScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  slashed: z.number(),
  bombsTyped: z.number(),
  maxCombo: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  bestSlashed: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type FruitSlashRunRecord = z.infer<typeof RunRecordSchema>;
type FruitSlashScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<FruitSlashScores>({
  key: FRUIT_SLASH_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, bestSlashed: 0, history: [] },
});

export type RecordRunResult = {
  isNewScoreRecord: boolean;
  isNewSlashedRecord: boolean;
};

/** records a finished run: bests + the recent history (newest first) */
export function recordFruitSlashRun(input: {
  score: number;
  slashed: number;
  bombsTyped: number;
  maxCombo: number;
}): RecordRunResult {
  const current = store.get();
  const record: FruitSlashRunRecord = {
    at: Date.now(),
    score: input.score,
    slashed: input.slashed,
    bombsTyped: input.bombsTyped,
    maxCombo: input.maxCombo,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  const isNewSlashedRecord = input.slashed > current.bestSlashed;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    bestSlashed: isNewSlashedRecord ? input.slashed : current.bestSlashed,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord, isNewSlashedRecord };
}

export function getFruitSlashBestScore(): number {
  return store.get().bestScore;
}

export function getFruitSlashBestSlashed(): number {
  return store.get().bestSlashed;
}

export function getFruitSlashHistory(
  limit = HISTORY_LIMIT,
): FruitSlashRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetFruitSlashScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedFruitSlashScores = {
  bestScore: number;
  bestSlashed: number;
  history: FruitSlashRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedFruitSlashScores(
  value: unknown,
): SanitizedFruitSlashScores {
  const sanitized: SanitizedFruitSlashScores = {
    bestScore: 0,
    bestSlashed: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    bestSlashed?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
  }
  if (typeof raw.bestSlashed === "number" && Number.isFinite(raw.bestSlashed)) {
    sanitized.bestSlashed = raw.bestSlashed;
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
