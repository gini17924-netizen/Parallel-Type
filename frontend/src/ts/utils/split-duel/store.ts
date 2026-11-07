import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Split-Key Showdown stats for the desktop offline build (idea G19,
 * phase 1). Player names are session-only — the storage keeps just the
 * numbers (doc §۱). Backup owner: utils/local-persistence.ts
 * (`duelLocalStats` field, optional — wired in the page phase).
 */

export const DUEL_LOCAL_STATS_KEY = "mtDesktopDuelLocalStats";

const RunRecordSchema = z.object({
  at: z.number(),
  mode: z.enum(["turn", "simultaneous"]),
  /** 0 = the exact tie */
  winnerSlot: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  marginMs: z.number(),
});

const StatsSchema = z.object({
  matches: z.number(),
  winsBySlot: z.object({
    "1": z.number(),
    "2": z.number(),
  }),
  history: z.array(RunRecordSchema).max(10),
});

export type DuelRunRecord = z.infer<typeof RunRecordSchema>;
type DuelStats = z.infer<typeof StatsSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<DuelStats>({
  key: DUEL_LOCAL_STATS_KEY,
  schema: StatsSchema,
  fallback: { matches: 0, winsBySlot: { "1": 0, "2": 0 }, history: [] },
});

/** records a finished match: the win counters + the recent history */
export function recordDuelMatch(input: {
  mode: "turn" | "simultaneous";
  winnerSlot: 0 | 1 | 2;
  marginMs: number;
}): void {
  const current = store.get();
  const winsBySlot = { ...current.winsBySlot };
  if (input.winnerSlot === 1) winsBySlot["1"] += 1;
  else if (input.winnerSlot === 2) winsBySlot["2"] += 1;
  store.set({
    matches: current.matches + 1,
    winsBySlot,
    history: [
      {
        at: Date.now(),
        mode: input.mode,
        winnerSlot: input.winnerSlot,
        marginMs: input.marginMs,
      },
      ...current.history,
    ].slice(0, HISTORY_LIMIT),
  });
}

export function getDuelWinsBySlot(): { "1": number; "2": number } {
  return store.get().winsBySlot;
}

export function getDuelMatches(): number {
  return store.get().matches;
}

export function getDuelHistory(limit = HISTORY_LIMIT): DuelRunRecord[] {
  return store.get().history.slice(0, limit);
}

/** test hook: drops the memoized cache and the stored payload */
export function _resetDuelStatsForTests(): void {
  store.remove();
}

/** the sanitized payload shape (dot-accessible, backup-importer friendly) */
export type SanitizedDuelStats = {
  matches: number;
  winsBySlot: { "1": number; "2": number };
  history: DuelRunRecord[];
};

/** coerces an imported payload into a schema-valid shape (audit L4) */
export function sanitizeImportedDuelStats(value: unknown): SanitizedDuelStats {
  const sanitized: SanitizedDuelStats = {
    matches: 0,
    winsBySlot: { "1": 0, "2": 0 },
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as {
    matches?: unknown;
    winsBySlot?: unknown;
    history?: unknown;
  };
  if (typeof raw.matches === "number" && Number.isFinite(raw.matches)) {
    sanitized.matches = Math.max(0, Math.floor(raw.matches));
  }
  if (typeof raw.winsBySlot === "object" && raw.winsBySlot !== null) {
    const wins = (raw.winsBySlot as Record<string, unknown>)["1"];
    const wins2 = (raw.winsBySlot as Record<string, unknown>)["2"];
    if (typeof wins === "number" && Number.isFinite(wins)) {
      sanitized.winsBySlot["1"] = Math.max(0, Math.floor(wins));
    }
    if (typeof wins2 === "number" && Number.isFinite(wins2)) {
      sanitized.winsBySlot["2"] = Math.max(0, Math.floor(wins2));
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
