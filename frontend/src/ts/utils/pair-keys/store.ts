import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";
import type { PairKeysMode } from "./board";

/**
 * Pair Keys stats for the desktop offline build (idea G18, phase 1).
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`pairKeysStats` field, optional — wired in the page phase).
 */

export const PAIR_KEYS_STATS_KEY = "mtDesktopPairKeysStats";

const BestSchema = z.object({
  score: z.number(),
  moves: z.number(),
  timeMs: z.number(),
});

const RunRecordSchema = z.object({
  at: z.number(),
  mode: z.string(),
  score: z.number(),
  moves: z.number(),
  timeMs: z.number(),
  perfect: z.boolean(),
});

const StatsSchema = z.object({
  bestByMode: z.record(z.string(), BestSchema),
  games: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type PairBestRecord = z.infer<typeof BestSchema>;
export type PairRunRecord = z.infer<typeof RunRecordSchema>;
type PairStats = z.infer<typeof StatsSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<PairStats>({
  key: PAIR_KEYS_STATS_KEY,
  schema: StatsSchema,
  fallback: { bestByMode: {}, games: 0, history: [] },
});

export type RecordPairRunResult = { isNewRecord: boolean };

/** records a finished grid: per-mode best + games counter + history */
export function recordPairKeysRun(input: {
  mode: PairKeysMode;
  score: number;
  moves: number;
  timeMs: number;
  perfect: boolean;
}): RecordPairRunResult {
  const current = store.get();
  const previousBest = current.bestByMode[input.mode];
  const isNewRecord =
    previousBest === undefined || input.score > previousBest.score;
  const bestByMode = { ...current.bestByMode };
  if (isNewRecord) {
    bestByMode[input.mode] = {
      score: input.score,
      moves: input.moves,
      timeMs: input.timeMs,
    };
  }
  store.set({
    bestByMode,
    games: current.games + 1,
    history: [
      {
        at: Date.now(),
        mode: input.mode,
        score: input.score,
        moves: input.moves,
        timeMs: input.timeMs,
        perfect: input.perfect,
      },
      ...current.history,
    ].slice(0, HISTORY_LIMIT),
  });
  return { isNewRecord };
}

export function getPairKeysBest(
  mode: PairKeysMode,
): PairBestRecord | undefined {
  return store.get().bestByMode[mode];
}

export function getPairKeysGames(): number {
  return store.get().games;
}

export function getPairKeysHistory(limit = HISTORY_LIMIT): PairRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetPairKeysForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedPairKeysStats = {
  bestByMode: Record<string, PairBestRecord>;
  games: number;
  history: PairRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedPairKeysStats(
  value: unknown,
): SanitizedPairKeysStats {
  const sanitized: SanitizedPairKeysStats = {
    bestByMode: {},
    games: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestByMode?: unknown;
    games?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestByMode === "object" && raw.bestByMode !== null) {
    for (const [mode, best] of Object.entries(
      raw.bestByMode as Record<string, unknown>,
    )) {
      const parsed = BestSchema.safeParse(best);
      if (parsed.success) sanitized.bestByMode[mode] = parsed.data;
    }
  }
  if (typeof raw.games === "number" && Number.isFinite(raw.games)) {
    sanitized.games = Math.max(0, Math.floor(raw.games));
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
