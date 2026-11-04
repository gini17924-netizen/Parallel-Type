import { z } from "zod";

import { LocalStorageWithSchema } from "./local-storage-with-schema";
import { type Difficulty } from "./word-blast";

/**
 * Word Blast highscores and recent-game history for the desktop offline
 * build (closes KI-21). Small and sync-friendly: localStorage via
 * LocalStorageWithSchema (zod-validated with fallback), not IndexedDB.
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`wordBlastScores` field, optional since schema v2).
 */

export const WORD_BLAST_SCORES_KEY = "mtDesktopWordBlastScores";

const DifficultySchema = z.enum(["easy", "normal", "hard"]);

const GameRecordSchema = z.object({
  at: z.number(),
  difficulty: DifficultySchema,
  score: z.number(),
  wpm: z.number(),
});

const ScoresSchema = z.object({
  best: z.record(z.string(), GameRecordSchema),
  history: z.array(GameRecordSchema).max(10),
});

export type WordBlastGameRecord = z.infer<typeof GameRecordSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<WordBlastScores>({
  key: WORD_BLAST_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { best: {}, history: [] },
});

type WordBlastScores = z.infer<typeof ScoresSchema>;

export type RecordResult = {
  isNewRecord: boolean;
  /** the difficulty's best AFTER this game (the new record when flagged) */
  best: WordBlastGameRecord | undefined;
};

/**
 * Records a finished Word Blast game: updates the difficulty's best when
 * the score beats it and prepends the game to the recent history
 * (newest first, capped at 10).
 */
export function recordWordBlastGame(input: {
  difficulty: Difficulty;
  score: number;
  wpm: number;
}): RecordResult {
  const current = store.get();
  const previousBest = current.best[input.difficulty];
  const record: WordBlastGameRecord = {
    at: Date.now(),
    difficulty: input.difficulty,
    score: input.score,
    wpm: input.wpm,
  };
  const isNewRecord =
    previousBest === undefined || input.score > previousBest.score;
  const next: WordBlastScores = {
    best: {
      ...current.best,
      [input.difficulty]: isNewRecord ? record : (previousBest ?? record),
    },
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  };
  store.set(next);
  const best = next.best[input.difficulty];
  return {
    isNewRecord,
    best: isDifficultyRecord(best) ? best : undefined,
  };
}

/** the best score record of one difficulty, if any */
export function getWordBlastBest(
  difficulty: Difficulty,
): WordBlastGameRecord | undefined {
  const best = store.get().best[difficulty];
  return isDifficultyRecord(best) ? best : undefined;
}

/** the most recent games, newest first (default: up to 10) */
export function getWordBlastHistory(
  limit = HISTORY_LIMIT,
): WordBlastGameRecord[] {
  return store.get().history.slice(0, limit);
}

function isDifficultyRecord(
  value: WordBlastGameRecord | undefined,
): value is WordBlastGameRecord {
  return value !== undefined && typeof value.score === "number";
}

/** test hook: drops the memoized cache and the stored payload so a test's
 * store reads start fresh (repo convention: _-prefixed test hooks) */
export function _resetWordBlastScoresForTests(): void {
  store.remove();
}

/**
 * Coerces an imported (possibly hand-edited or from an older build) payload
 * into a schema-valid shape (audit L4): unknown/garbage entries are dropped
 * and the history is trimmed to the newest 10. Without this, a payload that
 * fails the store's schema would be wiped to the empty fallback by the next
 * get() - silently losing every best score.
 */
export function sanitizeImportedWordBlastScores(
  value: unknown,
): Record<string, unknown> {
  const sanitized: {
    best: Record<string, WordBlastGameRecord>;
    history: WordBlastGameRecord[];
  } = {
    best: {},
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as { best?: unknown; history?: unknown };
  if (typeof raw.best === "object" && raw.best !== null) {
    for (const [difficulty, record] of Object.entries(
      raw.best as Record<string, unknown>,
    )) {
      const parsed = GameRecordSchema.safeParse(record);
      if (parsed.success && DifficultySchema.safeParse(difficulty).success) {
        sanitized.best[difficulty] = parsed.data;
      }
    }
  }
  if (Array.isArray(raw.history)) {
    sanitized.history = raw.history
      .map((it) => GameRecordSchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  return sanitized;
}
