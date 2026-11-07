import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Firefight highscores and recent-run history for the desktop offline
 * build (idea G16, phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`firefightScores` field, optional — wired
 * in the page phase).
 */

export const FIREFIGHT_SCORES_KEY = "mtDesktopFirefightScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  won: z.boolean(),
  ashes: z.number(),
  extinguished: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  wins: z.number(),
  survivedRuns: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type FirefightRunRecord = z.infer<typeof RunRecordSchema>;
type FirefightScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<FirefightScores>({
  key: FIREFIGHT_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, wins: 0, survivedRuns: 0, history: [] },
});

export type RecordRunResult = { isNewScoreRecord: boolean };

/** records a finished run: the best, the win/survive counters, history */
export function recordFirefightRun(input: {
  score: number;
  won: boolean;
  ashes: number;
  extinguished: number;
}): RecordRunResult {
  const current = store.get();
  const record: FirefightRunRecord = {
    at: Date.now(),
    score: input.score,
    won: input.won,
    ashes: input.ashes,
    extinguished: input.extinguished,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    wins: current.wins + (input.won ? 1 : 0),
    survivedRuns: current.survivedRuns + 1,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord };
}

export function getFirefightBestScore(): number {
  return store.get().bestScore;
}

export function getFirefightWins(): number {
  return store.get().wins;
}

export function getFirefightHistory(
  limit = HISTORY_LIMIT,
): FirefightRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetFirefightScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedFirefightScores = {
  bestScore: number;
  wins: number;
  survivedRuns: number;
  history: FirefightRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedFirefightScores(
  value: unknown,
): SanitizedFirefightScores {
  const sanitized: SanitizedFirefightScores = {
    bestScore: 0,
    wins: 0,
    survivedRuns: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    wins?: unknown;
    survivedRuns?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
  }
  if (typeof raw.wins === "number" && Number.isFinite(raw.wins)) {
    sanitized.wins = raw.wins;
  }
  if (
    typeof raw.survivedRuns === "number" &&
    Number.isFinite(raw.survivedRuns)
  ) {
    sanitized.survivedRuns = raw.survivedRuns;
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
