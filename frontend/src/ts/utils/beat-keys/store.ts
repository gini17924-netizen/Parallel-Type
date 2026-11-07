import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Beat Keys scores + calibration settings for the desktop offline build
 * (idea G21, phase 1). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`beatKeysScores` field, optional — wired
 * in the page phase).
 */

export const BEAT_KEYS_SCORES_KEY = "mtDesktopBeatKeysScores";

const BestRecordSchema = z.object({
  score: z.number(),
  acc: z.number(),
  rank: z.enum(["S", "A", "B", "C"]),
  maxCombo: z.number(),
});

const RunRecordSchema = BestRecordSchema.extend({
  at: z.number(),
  bpm: z.number(),
  misses: z.number(),
});

const ScoresSchema = z.object({
  bestByBpm: z.record(z.string(), BestRecordSchema),
  history: z.array(RunRecordSchema).max(10),
  settings: z.object({ offsetMs: z.number() }),
});

export type BeatBestRecord = z.infer<typeof BestRecordSchema>;
export type BeatRunRecord = z.infer<typeof RunRecordSchema>;
type BeatScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<BeatScores>({
  key: BEAT_KEYS_SCORES_KEY,
  schema: ScoresSchema,
  fallback: {
    bestByBpm: {},
    history: [],
    settings: { offsetMs: 0 },
  },
});

export type RecordBeatRunResult = { isNewRecord: boolean };

/** records a finished run: per-BPM best + the recent history (newest first) */
export function recordBeatKeysRun(input: {
  bpm: number;
  score: number;
  acc: number;
  rank: "S" | "A" | "B" | "C";
  maxCombo: number;
  misses: number;
}): RecordBeatRunResult {
  const current = store.get();
  const bpmKey = String(input.bpm);
  const previousBest = current.bestByBpm[bpmKey];
  const record: BeatRunRecord = {
    at: Date.now(),
    bpm: input.bpm,
    score: input.score,
    acc: input.acc,
    rank: input.rank,
    maxCombo: input.maxCombo,
    misses: input.misses,
  };
  const isNewRecord =
    previousBest === undefined || input.score > previousBest.score;
  const bestByBpm = { ...current.bestByBpm };
  if (isNewRecord) {
    bestByBpm[bpmKey] = {
      score: input.score,
      acc: input.acc,
      rank: input.rank,
      maxCombo: input.maxCombo,
    };
  }
  store.set({
    bestByBpm,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
    settings: current.settings,
  });
  return { isNewRecord };
}

export function getBeatBest(bpm: number): BeatBestRecord | undefined {
  return store.get().bestByBpm[String(bpm)];
}

export function getBeatKeysHistory(limit = HISTORY_LIMIT): BeatRunRecord[] {
  return store.get().history.slice(0, limit);
}

export function getBeatOffsetMs(): number {
  return store.get().settings.offsetMs;
}

/** the calibration result (doc §۰.۴: «۸ taps on the beat» → the average) */
export function setBeatOffsetMs(offsetMs: number): void {
  const current = store.get();
  store.set({
    bestByBpm: current.bestByBpm,
    history: current.history,
    settings: { offsetMs: Math.max(-300, Math.min(300, offsetMs)) },
  });
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetBeatKeysForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedBeatKeysScores = {
  bestByBpm: Record<string, BeatBestRecord>;
  history: BeatRunRecord[];
  settings: { offsetMs: number };
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedBeatKeysScores(
  value: unknown,
): SanitizedBeatKeysScores {
  const parsed = ScoresSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const sanitized: SanitizedBeatKeysScores = {
    bestByBpm: {},
    history: [],
    settings: { offsetMs: 0 },
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    bestByBpm?: unknown;
    history?: unknown;
    settings?: unknown;
  };
  if (typeof raw.bestByBpm === "object" && raw.bestByBpm !== null) {
    for (const [bpm, best] of Object.entries(
      raw.bestByBpm as Record<string, unknown>,
    )) {
      const bestParsed = BestRecordSchema.safeParse(best);
      if (bestParsed.success) sanitized.bestByBpm[bpm] = bestParsed.data;
    }
  }
  if (Array.isArray(raw.history)) {
    sanitized.history = raw.history
      .map((it) => RunRecordSchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  if (typeof raw.settings === "object" && raw.settings !== null) {
    const offset = (raw.settings as { offsetMs?: unknown }).offsetMs;
    if (typeof offset === "number" && Number.isFinite(offset)) {
      sanitized.settings = {
        offsetMs: Math.max(-300, Math.min(300, offset)),
      };
    }
  }
  return sanitized;
}
