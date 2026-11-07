import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Sky Scores — the DUAL-NAMESPACE store for the two G15 modes (idea
 * G15, phase 1): climber (mode A) and runner (mode B, wired in F.5)
 * share ONE key, `mtDesktopSkyScores`, with two namespaces (doc §۱
 * decision). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`skyScores` field, optional — wired in
 * the page phase).
 */

export const SKY_SCORES_KEY = "mtDesktopSkyScores";

const ClimberRunSchema = z.object({
  at: z.number(),
  height: z.number(),
  score: z.number(),
  falls: z.number(),
});

const RunnerRunSchema = z.object({
  at: z.number(),
  distanceM: z.number(),
  hits: z.number(),
});

const ClimberSchema = z.object({
  bestHeight: z.number(),
  bestScore: z.number(),
  games: z.number(),
  history: z.array(ClimberRunSchema).max(10),
});

const RunnerSchema = z.object({
  bestDistanceM: z.number(),
  games: z.number(),
  history: z.array(RunnerRunSchema).max(10),
});

const SkySchema = z.object({
  climber: ClimberSchema,
  runner: RunnerSchema,
});

export type ClimberRunRecord = z.infer<typeof ClimberRunSchema>;
export type RunnerRunRecord = z.infer<typeof RunnerRunSchema>;
type SkyScores = z.infer<typeof SkySchema>;

const HISTORY_LIMIT = 10;

const EMPTY_CLIMBER = {
  bestHeight: 0,
  bestScore: 0,
  games: 0,
  history: [] as ClimberRunRecord[],
};
const EMPTY_RUNNER = {
  bestDistanceM: 0,
  games: 0,
  history: [] as RunnerRunRecord[],
};

const store = new LocalStorageWithSchema<SkyScores>({
  key: SKY_SCORES_KEY,
  schema: SkySchema,
  fallback: { climber: EMPTY_CLIMBER, runner: EMPTY_RUNNER },
});

export type RecordClimberResult = {
  isNewHeightRecord: boolean;
  isNewScoreRecord: boolean;
};

/** records a finished climber run into the climber namespace */
export function recordClimberRun(input: {
  height: number;
  score: number;
  falls: number;
}): RecordClimberResult {
  const current = store.get().climber;
  const record: ClimberRunRecord = {
    at: Date.now(),
    height: input.height,
    score: input.score,
    falls: input.falls,
  };
  const isNewHeightRecord = input.height > current.bestHeight;
  const isNewScoreRecord = input.score > current.bestScore;
  store.set({
    climber: {
      bestHeight: isNewHeightRecord ? input.height : current.bestHeight,
      bestScore: isNewScoreRecord ? input.score : current.bestScore,
      games: current.games + 1,
      history: [record, ...current.history].slice(0, HISTORY_LIMIT),
    },
    runner: store.get().runner,
  });
  return { isNewHeightRecord, isNewScoreRecord };
}

/** records a finished runner run into the runner namespace (F.5) */
export function recordRunnerRun(input: { distanceM: number; hits: number }): {
  isNewRecord: boolean;
} {
  const current = store.get().runner;
  const record: RunnerRunRecord = {
    at: Date.now(),
    distanceM: input.distanceM,
    hits: input.hits,
  };
  const isNewRecord = input.distanceM > current.bestDistanceM;
  store.set({
    climber: store.get().climber,
    runner: {
      bestDistanceM: isNewRecord ? input.distanceM : current.bestDistanceM,
      games: current.games + 1,
      history: [record, ...current.history].slice(0, HISTORY_LIMIT),
    },
  });
  return { isNewRecord };
}

export function getClimberBestHeight(): number {
  return store.get().climber.bestHeight;
}

export function getClimberBestScore(): number {
  return store.get().climber.bestScore;
}

export function getRunnerBestDistanceM(): number {
  return store.get().runner.bestDistanceM;
}

export function getClimberHistory(limit = HISTORY_LIMIT): ClimberRunRecord[] {
  return store.get().climber.history.slice(0, limit);
}

export function getRunnerHistory(limit = HISTORY_LIMIT): RunnerRunRecord[] {
  return store.get().runner.history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetSkyScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedSkyScores = {
  climber: {
    bestHeight: number;
    bestScore: number;
    games: number;
    history: ClimberRunRecord[];
  };
  runner: {
    bestDistanceM: number;
    games: number;
    history: RunnerRunRecord[];
  };
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedSkyScores(value: unknown): SanitizedSkyScores {
  const parsed = SkySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const sanitized: SanitizedSkyScores = {
    climber: { ...EMPTY_CLIMBER, history: [] },
    runner: { ...EMPTY_RUNNER, history: [] },
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as { climber?: unknown; runner?: unknown };
  if (typeof raw.climber === "object" && raw.climber !== null) {
    const c = raw.climber as Record<string, unknown>;
    if (
      typeof c["bestHeight"] === "number" &&
      Number.isFinite(c["bestHeight"]) &&
      c["bestHeight"] >= 0
    ) {
      sanitized.climber.bestHeight = c["bestHeight"];
    }
    if (
      typeof c["bestScore"] === "number" &&
      Number.isFinite(c["bestScore"]) &&
      c["bestScore"] >= 0
    ) {
      sanitized.climber.bestScore = c["bestScore"];
    }
    if (typeof c["games"] === "number" && Number.isFinite(c["games"])) {
      sanitized.climber.games = Math.max(0, Math.floor(c["games"]));
    }
    const climberHistory = c["history"];
    if (Array.isArray(climberHistory)) {
      sanitized.climber.history = climberHistory
        .map((it) => ClimberRunSchema.safeParse(it))
        .filter((it) => it.success)
        .map((it) => it.data)
        .slice(0, HISTORY_LIMIT);
    }
  }
  if (typeof raw.runner === "object" && raw.runner !== null) {
    const r = raw.runner as Record<string, unknown>;
    if (
      typeof r["bestDistanceM"] === "number" &&
      Number.isFinite(r["bestDistanceM"]) &&
      r["bestDistanceM"] >= 0
    ) {
      sanitized.runner.bestDistanceM = r["bestDistanceM"];
    }
    if (typeof r["games"] === "number" && Number.isFinite(r["games"])) {
      sanitized.runner.games = Math.max(0, Math.floor(r["games"]));
    }
    const runnerHistory = r["history"];
    if (Array.isArray(runnerHistory)) {
      sanitized.runner.history = runnerHistory
        .map((it) => RunnerRunSchema.safeParse(it))
        .filter((it) => it.success)
        .map((it) => it.data)
        .slice(0, HISTORY_LIMIT);
    }
  }
  return sanitized;
}
