import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Type Pong stats for the desktop offline build (idea G13, phase 1):
 * two mode namespaces (pong now, the C.5 breaker later) + the shared
 * history. Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`typePongScores` field, optional — wired
 * in the page phase).
 */

export const TYPE_PONG_SCORES_KEY = "mtDesktopTypePongScores";

const RunRecordSchema = z.object({
  at: z.number(),
  mode: z.enum(["pong", "breaker"]),
  won: z.boolean(),
  score: z.number(),
});

const PongStatsSchema = z.object({
  wins: z.number(),
  losses: z.number(),
  bestRally: z.number(),
});

const BreakerStatsSchema = z.object({
  wins: z.number(),
  bestTimeMs: z.number(),
  bestScore: z.number(),
});

const ScoresSchema = z.object({
  pong: PongStatsSchema,
  breaker: BreakerStatsSchema,
  history: z.array(RunRecordSchema).max(10),
});

export type TypePongRunRecord = z.infer<typeof RunRecordSchema>;
type TypePongScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<TypePongScores>({
  key: TYPE_PONG_SCORES_KEY,
  schema: ScoresSchema,
  fallback: {
    pong: { wins: 0, losses: 0, bestRally: 0 },
    breaker: { wins: 0, bestTimeMs: 0, bestScore: 0 },
    history: [],
  },
});

export type RecordPongResult = { isNewBestRally: boolean };

/** H5: the offline pong difficulty persists separately from the scores
 * (changing it must never touch the stats shape) */
const DifficultySchema = z.object({
  pong: z.enum(["easy", "normal", "hard"]),
});
export type PongDifficulty = z.infer<typeof DifficultySchema>["pong"];

const settingsStore = new LocalStorageWithSchema<{
  pong: PongDifficulty;
}>({
  key: "mtDesktopTypePongSettings",
  schema: DifficultySchema,
  fallback: { pong: "normal" },
});

export function getPongDifficulty(): PongDifficulty {
  return settingsStore.get().pong;
}

export function setPongDifficulty(difficulty: PongDifficulty): void {
  settingsStore.set({ pong: difficulty });
}

/** records a finished pong match: the pong namespace + the history */
export function recordPongMatch(input: {
  won: boolean;
  playerScore: number;
  aiScore: number;
  bestRally: number;
}): RecordPongResult {
  const current = store.get();
  const record: TypePongRunRecord = {
    at: Date.now(),
    mode: "pong",
    won: input.won,
    score: input.playerScore,
  };
  const previousBest = current.pong.bestRally;
  const isNewBestRally = input.bestRally > previousBest;
  store.set({
    pong: {
      wins: current.pong.wins + (input.won ? 1 : 0),
      losses: current.pong.losses + (input.won ? 0 : 1),
      bestRally: Math.max(previousBest, input.bestRally),
    },
    breaker: current.breaker,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewBestRally };
}

/** records a finished breaker run (wired by the C.5 phase) */
export function recordBreakerRun(input: {
  won: boolean;
  timeMs: number;
  score: number;
}): void {
  const current = store.get();
  const record: TypePongRunRecord = {
    at: Date.now(),
    mode: "breaker",
    won: input.won,
    score: input.score,
  };
  store.set({
    pong: current.pong,
    breaker: {
      wins: current.breaker.wins + (input.won ? 1 : 0),
      bestTimeMs: input.won
        ? current.breaker.bestTimeMs === 0
          ? input.timeMs
          : Math.min(current.breaker.bestTimeMs, input.timeMs)
        : current.breaker.bestTimeMs,
      bestScore: Math.max(current.breaker.bestScore, input.score),
    },
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
}

export function getPongStats(): TypePongScores["pong"] {
  return store.get().pong;
}

export function getTypePongHistory(limit = HISTORY_LIMIT): TypePongRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetTypePongScoresForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedTypePongScores = {
  pong: TypePongScores["pong"];
  breaker: TypePongScores["breaker"];
  history: TypePongRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedTypePongScores(
  value: unknown,
): SanitizedTypePongScores {
  const sanitized: SanitizedTypePongScores = {
    pong: { wins: 0, losses: 0, bestRally: 0 },
    breaker: { wins: 0, bestTimeMs: 0, bestScore: 0 },
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    pong?: { wins?: unknown; losses?: unknown; bestRally?: unknown };
    breaker?: { wins?: unknown; bestTimeMs?: unknown; bestScore?: unknown };
    history?: unknown;
  };
  if (typeof raw.pong === "object" && raw.pong !== null) {
    if (typeof raw.pong.wins === "number" && Number.isFinite(raw.pong.wins)) {
      sanitized.pong.wins = raw.pong.wins;
    }
    if (
      typeof raw.pong.losses === "number" &&
      Number.isFinite(raw.pong.losses)
    ) {
      sanitized.pong.losses = raw.pong.losses;
    }
    if (
      typeof raw.pong.bestRally === "number" &&
      Number.isFinite(raw.pong.bestRally)
    ) {
      sanitized.pong.bestRally = raw.pong.bestRally;
    }
  }
  if (typeof raw.breaker === "object" && raw.breaker !== null) {
    if (
      typeof raw.breaker.wins === "number" &&
      Number.isFinite(raw.breaker.wins)
    ) {
      sanitized.breaker.wins = raw.breaker.wins;
    }
    if (
      typeof raw.breaker.bestTimeMs === "number" &&
      Number.isFinite(raw.breaker.bestTimeMs)
    ) {
      sanitized.breaker.bestTimeMs = raw.breaker.bestTimeMs;
    }
    if (
      typeof raw.breaker.bestScore === "number" &&
      Number.isFinite(raw.breaker.bestScore)
    ) {
      sanitized.breaker.bestScore = raw.breaker.bestScore;
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
