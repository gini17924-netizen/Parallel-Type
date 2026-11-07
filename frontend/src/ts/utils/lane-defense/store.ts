import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Lane Defense highscores and recent-run history for the desktop offline
 * build (idea G9, phase 1), including per-zone bests (the educational
 * preset). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`laneDefenseScores` field, optional — wired
 * in the page phase).
 */

export const LANE_DEFENSE_SCORES_KEY = "mtDesktopLaneDefenseScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  wave: z.number(),
  maxCombo: z.number(),
  kills: z.number(),
  zone: z.string(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  bestWave: z.number(),
  byZone: z.record(z.string(), z.object({ bestScore: z.number() })),
  history: z.array(RunRecordSchema).max(10),
});

export type LaneDefenseRunRecord = z.infer<typeof RunRecordSchema>;
type LaneDefenseScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<LaneDefenseScores>({
  key: LANE_DEFENSE_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, bestWave: 0, byZone: {}, history: [] },
});

export type RecordRunResult = {
  isNewScoreRecord: boolean;
  isNewWaveRecord: boolean;
};

/**
 * Records a finished Lane Defense run: global bests, the zone's best and
 * the recent history (newest first, capped at 10). `zone` is the played
 * keyboard-zone letters ("" = free play).
 */
export function recordLaneDefenseRun(input: {
  score: number;
  wave: number;
  maxCombo: number;
  kills: number;
  zone: string;
}): RecordRunResult {
  const current = store.get();
  const record: LaneDefenseRunRecord = {
    at: Date.now(),
    score: input.score,
    wave: input.wave,
    maxCombo: input.maxCombo,
    kills: input.kills,
    zone: input.zone,
  };
  const isNewScoreRecord = input.score > current.bestScore;
  const isNewWaveRecord = input.wave > current.bestWave;
  const zoneBest = current.byZone[input.zone]?.bestScore ?? 0;
  store.set({
    bestScore: isNewScoreRecord ? input.score : current.bestScore,
    bestWave: isNewWaveRecord ? input.wave : current.bestWave,
    byZone: {
      ...current.byZone,
      [input.zone]: {
        bestScore: Math.max(zoneBest, input.score),
      },
    },
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord, isNewWaveRecord };
}

export function getLaneDefenseBestScore(): number {
  return store.get().bestScore;
}

export function getLaneDefenseBestWave(): number {
  return store.get().bestWave;
}

/** the best score of one keyboard zone (0 before any run there) */
export function getLaneDefenseZoneBest(zone: string): number {
  return store.get().byZone[zone]?.bestScore ?? 0;
}

/** the most recent runs, newest first (default: up to 10) */
export function getLaneDefenseHistory(
  limit = HISTORY_LIMIT,
): LaneDefenseRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetLaneDefenseScoresForTests(): void {
  store.remove();
}

/**
 * Coerces an imported (possibly hand-edited or from an older build) payload
 * into a schema-valid shape (audit L4 pattern): invalid entries are dropped
 * and the history is trimmed to the newest 10.
 */
export type SanitizedLaneDefenseScores = {
  bestScore: number;
  bestWave: number;
  byZone: Record<string, { bestScore: number }>;
  history: LaneDefenseRunRecord[];
};

export function sanitizeImportedLaneDefenseScores(
  value: unknown,
): SanitizedLaneDefenseScores {
  const sanitized: SanitizedLaneDefenseScores = {
    bestScore: 0,
    bestWave: 0,
    byZone: {},
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestScore?: unknown;
    bestWave?: unknown;
    byZone?: unknown;
    history?: unknown;
  };
  if (typeof raw.bestScore === "number" && Number.isFinite(raw.bestScore)) {
    sanitized.bestScore = raw.bestScore;
  }
  if (typeof raw.bestWave === "number" && Number.isFinite(raw.bestWave)) {
    sanitized.bestWave = raw.bestWave;
  }
  if (typeof raw.byZone === "object" && raw.byZone !== null) {
    for (const [zone, entry] of Object.entries(
      raw.byZone as Record<string, unknown>,
    )) {
      const bestScore = (entry as { bestScore?: unknown } | null)?.bestScore;
      if (typeof bestScore === "number" && Number.isFinite(bestScore)) {
        sanitized.byZone[zone] = { bestScore };
      }
    }
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
