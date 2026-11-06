import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";
import { DeckRunStateSchema, type DeckRunState } from "./run-engine";

/**
 * Deck Runner persistence (idea G24, phase 2) — mirrors the word-blast
 * pattern: LocalStorageWithSchema + zod + a _-prefixed test reset hook, and
 * two OPTIONAL LocalBackup fields (schema v3 stays; absent = keep, the Y6
 * principle).
 *
 * - active run: resumable between blinds (a blind in progress is abandoned
 *   - v1 simplicity); cleared when the run ends
 * - stats: counters + best + the 10 most recent run summaries + daily best
 */

export const DECK_RUNNER_RUN_KEY = "mtDesktopDeckRunnerRun";
export const DECK_RUNNER_STATS_KEY = "mtDesktopDeckRunnerStats";

const RunSummarySchema = z.object({
  date: z.string(), //ISO
  ante: z.number().int().min(1),
  score: z.number(),
  won: z.boolean(),
  jokers: z.array(z.string()),
});

const StatsSchema = z.object({
  runs: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  bestScore: z.number().nonnegative(),
  bestAnte: z.number().int().min(0),
  history: z.array(RunSummarySchema).max(10),
  dailyBest: z.object({ date: z.string(), score: z.number() }).optional(),
});

export type DeckRunnerStats = z.infer<typeof StatsSchema>;
export type DeckRunSummary = z.infer<typeof RunSummarySchema>;

const runStore = new LocalStorageWithSchema<DeckRunState | null>({
  key: DECK_RUNNER_RUN_KEY,
  schema: DeckRunStateSchema.nullable(),
  fallback: null,
});

const statsStore = new LocalStorageWithSchema<DeckRunnerStats>({
  key: DECK_RUNNER_STATS_KEY,
  schema: StatsSchema,
  fallback: { runs: 0, wins: 0, bestScore: 0, bestAnte: 0, history: [] },
});

/** the resumable run, or null when none is in progress */
export function loadActiveRun(): DeckRunState | null {
  return runStore.get();
}

export function saveActiveRun(state: DeckRunState): void {
  runStore.set(state);
}

/** called when a run reaches gameover (the active run is over) */
export function clearActiveRun(): void {
  runStore.remove();
}

export function getDeckRunnerStats(): DeckRunnerStats {
  return statsStore.get();
}

/** records a finished run: counters, bests and the ≤10 summaries, plus the
 * per-calendar-day best (daily runs compare fairly via their shared seed) */
export function recordRunEnd(summary: DeckRunSummary): DeckRunnerStats {
  const stats = statsStore.get();
  const next: DeckRunnerStats = {
    runs: stats.runs + 1,
    wins: stats.wins + (summary.won ? 1 : 0),
    bestScore: Math.max(stats.bestScore, summary.score),
    bestAnte: Math.max(stats.bestAnte, summary.ante),
    history: [summary, ...stats.history].slice(0, 10),
    dailyBest: (() => {
      const date = summary.date.slice(0, 10);
      if (
        stats.dailyBest?.date === date &&
        stats.dailyBest.score >= summary.score
      ) {
        return stats.dailyBest;
      }
      return { date, score: summary.score };
    })(),
  };
  statsStore.set(next);
  return next;
}

/** test hook (repo _-prefixed convention) */
export function _resetDeckRunnerStoresForTests(): void {
  runStore.remove();
  statsStore.remove();
}
