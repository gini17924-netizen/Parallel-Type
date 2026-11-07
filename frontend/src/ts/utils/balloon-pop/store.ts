import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Balloon Pop scores (idea G6, phase 1): the best score per stage and the
 * recent runs. Same shape as the other game stores: localStorage via
 * LocalStorageWithSchema (zod-validated with fallback).
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`balloonPopScores` field, optional since schema v3).
 */

export const BALLOON_POP_SCORES_KEY = "mtDesktopBalloonPopScores";

const BestSchema = z.object({
  score: z.number(),
  at: z.number(),
});

const HistoryEntrySchema = z.object({
  at: z.number(),
  stage: z.number(),
  score: z.number(),
  popped: z.number(),
  escaped: z.number(),
});

const StatsSchema = z.object({
  bestByStage: z.record(z.string(), BestSchema),
  history: z.array(HistoryEntrySchema).max(10),
});

export type BalloonPopStats = z.infer<typeof StatsSchema>;
export type BalloonPopBest = z.infer<typeof BestSchema>;
export type BalloonPopHistoryEntry = z.infer<typeof HistoryEntrySchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<BalloonPopStats>({
  key: BALLOON_POP_SCORES_KEY,
  schema: StatsSchema,
  //complete on its own: get() returns the fallback WITHOUT parsing when no
  //value is stored (the word-blast v2 lesson)
  fallback: { bestByStage: {}, history: [] },
});

export type RecordBalloonRunInput = {
  stage: number;
  score: number;
  popped: number;
  escaped: number;
  /** injected clock for tests (default Date.now()) */
  nowMs?: number;
};

/**
 * Records a finished run: bumps the stage's best when the score beats it
 * and prepends the run to the recent history (newest first, capped at 10).
 */
export function recordBalloonRun(
  input: RecordBalloonRunInput,
): BalloonPopStats {
  const current = store.get();
  const nowMs = input.nowMs ?? Date.now();
  const previousBest = current.bestByStage[String(input.stage)];
  const isNewBest =
    previousBest === undefined || input.score > previousBest.score;
  const next: BalloonPopStats = {
    bestByStage: {
      ...current.bestByStage,
      [String(input.stage)]: isNewBest
        ? { score: input.score, at: nowMs }
        : (previousBest ?? { score: input.score, at: nowMs }),
    },
    history: [
      {
        at: nowMs,
        stage: input.stage,
        score: input.score,
        popped: input.popped,
        escaped: input.escaped,
      },
      ...current.history,
    ].slice(0, HISTORY_LIMIT),
  };
  store.set(next);
  return next;
}

export function getBalloonPopStats(): BalloonPopStats {
  return store.get();
}

/** test hook (repo _-prefixed convention) */
export function _resetBalloonPopScoresForTests(): void {
  store.remove();
}

/**
 * Coerces an imported payload into a schema-valid shape (audit L4
 * pattern): garbage stages/entries are dropped and the history is trimmed
 * to the newest 10. Without this, a payload that fails the store's schema
 * would be wiped to the empty fallback by the next get().
 */
export function sanitizeImportedBalloonPopScores(
  value: unknown,
): Record<string, unknown> {
  const sanitized: BalloonPopStats = { bestByStage: {}, history: [] };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as Record<string, unknown>;
  if (typeof raw["bestByStage"] === "object" && raw["bestByStage"] !== null) {
    for (const [stage, best] of Object.entries(
      raw["bestByStage"] as Record<string, unknown>,
    )) {
      const parsed = BestSchema.safeParse(best);
      if (parsed.success) sanitized.bestByStage[stage] = parsed.data;
    }
  }
  if (Array.isArray(raw["history"])) {
    sanitized.history = (raw["history"] as unknown[])
      .map((it) => HistoryEntrySchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  return sanitized;
}
