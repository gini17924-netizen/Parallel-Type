import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Nitro Run highscores and recent-run history for the desktop offline
 * build (idea G23, phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`nitroRunStats` field, optional — wired in
 * the page phase).
 */

export const NITRO_RUN_STATS_KEY = "mtDesktopNitroRunStats";

const RunRecordSchema = z.object({
  at: z.number(),
  rankScore: z.number(),
  rank: z.number(),
  distanceM: z.number(),
  nitroUses: z.number(),
});

const StatsSchema = z.object({
  bestRankScore: z.number(),
  bestDistanceM: z.number(),
  nitroUsesTotal: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type NitroRunRecord = z.infer<typeof RunRecordSchema>;
type NitroRunStats = z.infer<typeof StatsSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<NitroRunStats>({
  key: NITRO_RUN_STATS_KEY,
  schema: StatsSchema,
  fallback: {
    bestRankScore: 0,
    bestDistanceM: 0,
    nitroUsesTotal: 0,
    history: [],
  },
});

export type RecordRunResult = {
  isNewScoreRecord: boolean;
  isNewDistanceRecord: boolean;
};

/** records a finished run: bests, the nitro total, the recent history */
export function recordNitroRun(input: {
  rankScore: number;
  rank: number;
  distanceM: number;
  nitroUses: number;
}): RecordRunResult {
  const current = store.get();
  const record: NitroRunRecord = {
    at: Date.now(),
    rankScore: input.rankScore,
    rank: input.rank,
    distanceM: input.distanceM,
    nitroUses: input.nitroUses,
  };
  const isNewScoreRecord = input.rankScore > current.bestRankScore;
  const isNewDistanceRecord = input.distanceM > current.bestDistanceM;
  store.set({
    bestRankScore: isNewScoreRecord ? input.rankScore : current.bestRankScore,
    bestDistanceM: isNewDistanceRecord
      ? input.distanceM
      : current.bestDistanceM,
    nitroUsesTotal: current.nitroUsesTotal + input.nitroUses,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord, isNewDistanceRecord };
}

export function getNitroBestRankScore(): number {
  return store.get().bestRankScore;
}

export function getNitroBestDistanceM(): number {
  return store.get().bestDistanceM;
}

export function getNitroHistory(limit = HISTORY_LIMIT): NitroRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetNitroRunStatsForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedNitroRunStats = {
  bestRankScore: number;
  bestDistanceM: number;
  nitroUsesTotal: number;
  history: NitroRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedNitroRunStats(
  value: unknown,
): SanitizedNitroRunStats {
  const sanitized: SanitizedNitroRunStats = {
    bestRankScore: 0,
    bestDistanceM: 0,
    nitroUsesTotal: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestRankScore?: unknown;
    bestDistanceM?: unknown;
    nitroUsesTotal?: unknown;
    history?: unknown;
  };
  if (
    typeof raw.bestRankScore === "number" &&
    Number.isFinite(raw.bestRankScore)
  ) {
    sanitized.bestRankScore = raw.bestRankScore;
  }
  if (
    typeof raw.bestDistanceM === "number" &&
    Number.isFinite(raw.bestDistanceM)
  ) {
    sanitized.bestDistanceM = raw.bestDistanceM;
  }
  if (
    typeof raw.nitroUsesTotal === "number" &&
    Number.isFinite(raw.nitroUsesTotal)
  ) {
    sanitized.nitroUsesTotal = raw.nitroUsesTotal;
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
