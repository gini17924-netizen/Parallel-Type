import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Ghost GP stats (idea G3, phase 1): races against your own ghosts — the
 * game never writes results/PBs/XP (project rule), these counters live
 * only here. localStorage via LocalStorageWithSchema (zod-validated with
 * fallback), not IndexedDB.
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`ghostGpStats` field, optional since schema v3).
 */

export const GHOST_GP_STATS_KEY = "mtDesktopGhostGpStats";

const GhostRaceSchema = z.object({
  wpm: z.number(),
  lang: z.string(),
  at: z.number(),
});

const StatsSchema = z.object({
  races: z.number(),
  winsVsGhost: z.number(),
  losses: z.number(),
  //council addition (2026-11-07): the idea sketch buckets only wins/losses,
  //but the engine can produce a draw — it is neither, so it gets its own
  draws: z.number(),
  /** the fastest WON race against any ghost; null while none */
  bestFinishMs: z.number().nullable(),
  ghostsRaced: z.array(GhostRaceSchema).max(10),
});

export type GhostGpStats = z.infer<typeof StatsSchema>;
export type GhostRaceEntry = z.infer<typeof GhostRaceSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<GhostGpStats>({
  key: GHOST_GP_STATS_KEY,
  schema: StatsSchema,
  //complete on its own: get() returns the fallback WITHOUT parsing when no
  //value is stored (the word-blast v2 lesson)
  fallback: {
    races: 0,
    winsVsGhost: 0,
    losses: 0,
    draws: 0,
    bestFinishMs: null,
    ghostsRaced: [],
  },
});

export type RecordGhostRaceInput = {
  result: "won" | "lost" | "draw";
  /** the winner's time in ms; null on a loss */
  finishMs: number | null;
  ghostWpm: number;
  lang: string;
};

/**
 * Records a finished ghost race: bumps the counters, keeps the fastest WON
 * finish across all ghosts and prepends the ghost to the recently-raced
 * list (newest first, capped at 10).
 */
export function recordGhostRace(input: RecordGhostRaceInput): GhostGpStats {
  const current = store.get();
  const won = input.result === "won";
  const next: GhostGpStats = {
    races: current.races + 1,
    winsVsGhost: current.winsVsGhost + (won ? 1 : 0),
    losses: current.losses + (input.result === "lost" ? 1 : 0),
    draws: current.draws + (input.result === "draw" ? 1 : 0),
    bestFinishMs:
      won && input.finishMs !== null
        ? current.bestFinishMs === null
          ? input.finishMs
          : Math.min(current.bestFinishMs, input.finishMs)
        : current.bestFinishMs,
    ghostsRaced: [
      { wpm: input.ghostWpm, lang: input.lang, at: Date.now() },
      ...current.ghostsRaced,
    ].slice(0, HISTORY_LIMIT),
  };
  store.set(next);
  return next;
}

export function getGhostGpStats(): GhostGpStats {
  return store.get();
}

/** test hook (repo _-prefixed convention) */
export function _resetGhostGpStatsForTests(): void {
  store.remove();
}

/**
 * Coerces an imported payload into a schema-valid shape (audit L4
 * pattern): garbage fields are dropped and the ghosts list is trimmed to
 * the newest 10. Without this, a payload that fails the store's schema
 * would be wiped to the empty fallback by the next get().
 */
export function sanitizeImportedGhostGpStats(
  value: unknown,
): Record<string, unknown> {
  const sanitized: GhostGpStats = {
    races: 0,
    winsVsGhost: 0,
    losses: 0,
    draws: 0,
    bestFinishMs: null,
    ghostsRaced: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as Record<string, unknown>;
  const num = (key: string, fallbackValue: number): number =>
    typeof raw[key] === "number" && Number.isFinite(raw[key])
      ? raw[key]
      : fallbackValue;
  sanitized.races = num("races", 0);
  sanitized.winsVsGhost = num("winsVsGhost", 0);
  sanitized.losses = num("losses", 0);
  sanitized.draws = num("draws", 0);
  sanitized.bestFinishMs =
    typeof raw["bestFinishMs"] === "number" ? raw["bestFinishMs"] : null;
  if (Array.isArray(raw["ghostsRaced"])) {
    sanitized.ghostsRaced = (raw["ghostsRaced"] as unknown[])
      .map((it) => GhostRaceSchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  return sanitized;
}
