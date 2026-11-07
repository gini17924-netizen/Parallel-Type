import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Letter Strike highscores and recent-run history for the desktop offline
 * build (idea G8, phase 1). Small and sync-friendly: localStorage via
 * LocalStorageWithSchema (zod-validated with fallback), not IndexedDB.
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`letterStrikeScores` field, optional — wired in the page phase).
 */

export const LETTER_STRIKE_SCORES_KEY = "mtDesktopLetterStrikeScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  wave: z.number(),
  maxCombo: z.number(),
  shipsDestroyed: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  bestWave: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type LetterStrikeRunRecord = z.infer<typeof RunRecordSchema>;
type LetterStrikeScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<LetterStrikeScores>({
  key: LETTER_STRIKE_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, bestWave: 0, history: [] },
});

export type RecordRunResult = {
  isNewScoreRecord: boolean;
  isNewWaveRecord: boolean;
};

/**
 * Records a finished Letter Strike run: updates the score and wave bests
 * when beaten and prepends the run to the recent history (newest first,
 * capped at 10).
 */
export function recordLetterStrikeRun(input: {
  score: number;
  wave: number;
  maxCombo: number;
  shipsDestroyed: number;
}): RecordRunResult {
  const current = store.get();
  const record: LetterStrikeRunRecord = {
    at: Date.now(),
    score: input.score,
    wave: input.wave,
    maxCombo: input.maxCombo,
    shipsDestroyed: input.shipsDestroyed,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  const isNewWaveRecord = input.wave > current.bestWave;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    bestWave: isNewWaveRecord ? input.wave : current.bestWave,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord, isNewWaveRecord };
}

export function getLetterStrikeBestScore(): number {
  return store.get().bestScore;
}

export function getLetterStrikeBestWave(): number {
  return store.get().bestWave;
}

/** the most recent runs, newest first (default: up to 10) */
export function getLetterStrikeHistory(
  limit = HISTORY_LIMIT,
): LetterStrikeRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload (repo
 * convention: _-prefixed test hooks) */
export function _resetLetterStrikeScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (a type alias keeps it assignable to
 * Record<string, unknown> for the backup importer while staying
 * dot-accessible) */
export type SanitizedLetterStrikeScores = {
  bestScore: number;
  bestWave: number;
  history: LetterStrikeRunRecord[];
};

/**
 * Coerces an imported (possibly hand-edited or from an older build) payload
 * into a schema-valid shape (audit L4 pattern): invalid entries are dropped
 * and the history is trimmed to the newest 10 — without this, a payload
 * failing the schema would be wiped to the fallback by the next get(),
 * silently losing every best score.
 */
export function sanitizeImportedLetterStrikeScores(
  value: unknown,
): SanitizedLetterStrikeScores {
  const sanitized: LetterStrikeScores = {
    bestScore: 0,
    bestWave: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    bestWave?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
  }
  if (typeof raw.bestWave === "number" && Number.isFinite(raw.bestWave)) {
    sanitized.bestWave = raw.bestWave;
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
