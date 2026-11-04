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
