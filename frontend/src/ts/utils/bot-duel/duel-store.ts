import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Bot Duel stats (idea G2): per-tier win/loss/draw records and the recent
 * race history for the desktop offline build. Same shape as the other game
 * stores: localStorage via LocalStorageWithSchema (zod-validated with
 * fallback), not IndexedDB.
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`botDuelStats` field, optional since schema v3).
 */

export const BOT_DUEL_STATS_KEY = "mtDesktopBotDuelStats";

/** the bot speed tiers the picker offers (wpm) */
export const BOT_TIERS = ["40", "60", "80", "100", "120", "140"] as const;
export type BotTier = (typeof BOT_TIERS)[number];

export type DuelResult = "won" | "lost" | "draw";

const TierStatsSchema = z.object({
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  /** the fastest WON race at this tier; null while no win is recorded */
  bestFinishMs: z.number().nullable(),
});

const HistoryEntrySchema = z.object({
  at: z.number(),
  botWpm: z.number(),
  words: z.number(),
  result: z.enum(["won", "lost", "draw"]),
  /** null on a loss (the bot's crossing is not the player's finish) */
  finishMs: z.number().nullable(),
  /** the player's accuracy percent (0-100) */
  accuracy: z.number(),
});

const StatsSchema = z.object({
  byTier: z.record(z.string(), TierStatsSchema),
  history: z.array(HistoryEntrySchema).max(10),
});

export type BotDuelStats = z.infer<typeof StatsSchema>;
export type BotDuelTierStats = z.infer<typeof TierStatsSchema>;
export type BotDuelHistoryEntry = z.infer<typeof HistoryEntrySchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<BotDuelStats>({
  key: BOT_DUEL_STATS_KEY,
  schema: StatsSchema,
  //complete on its own: get() returns the fallback WITHOUT parsing when no
  //value is stored (the word-blast v2 lesson)
  fallback: { byTier: {}, history: [] },
});

function tierStatsOf(stats: BotDuelStats, tier: string): BotDuelTierStats {
  return (
    stats.byTier[tier] ?? { wins: 0, losses: 0, draws: 0, bestFinishMs: null }
  );
}

export type RecordDuelInput = {
  botWpm: number;
  /** the race length in words */
  words: number;
  result: DuelResult;
  /** the winner's time in ms; null on a loss */
  finishMs: number | null;
  /** the player's accuracy percent (0-100) */
  accuracy: number;
};

/**
 * Records a finished duel: bumps the tier's win/loss/draw counters, keeps
 * the tier's fastest WON finish and prepends the race to the recent history
 * (newest first, capped at 10).
 */
export function recordDuelResult(input: RecordDuelInput): BotDuelStats {
  const current = store.get();
  const tier = String(input.botWpm);
  const stats = tierStatsOf(current, tier);
  const next: BotDuelStats = {
    byTier: {
      ...current.byTier,
      [tier]: {
        wins: stats.wins + (input.result === "won" ? 1 : 0),
        losses: stats.losses + (input.result === "lost" ? 1 : 0),
        draws: stats.draws + (input.result === "draw" ? 1 : 0),
        bestFinishMs:
          input.result === "won" && input.finishMs !== null
            ? stats.bestFinishMs === null
              ? input.finishMs
              : Math.min(stats.bestFinishMs, input.finishMs)
            : stats.bestFinishMs,
      },
    },
    history: [
      {
        at: Date.now(),
        botWpm: input.botWpm,
        words: input.words,
        result: input.result,
        finishMs: input.finishMs,
        accuracy: input.accuracy,
      },
      ...current.history,
    ].slice(0, HISTORY_LIMIT),
  };
  store.set(next);
  return next;
}

export function getBotDuelStats(): BotDuelStats {
  return store.get();
}

export function getBotDuelTierStats(tier: BotTier): BotDuelTierStats {
  return tierStatsOf(store.get(), tier);
}

/** test hook (repo _-prefixed convention) */
export function _resetBotDuelStatsForTests(): void {
  store.remove();
}

/**
 * Coerces an imported (possibly hand-edited or from an older build) payload
 * into a schema-valid shape (audit L4 pattern): garbage entries are dropped
 * and the history is trimmed to the newest 10. Without this, a payload that
 * fails the store's schema would be wiped to the empty fallback by the next
 * get() - silently losing every tier record.
 */
export function sanitizeImportedBotDuelStats(
  value: unknown,
): Record<string, unknown> {
  const sanitized: BotDuelStats = { byTier: {}, history: [] };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as { byTier?: unknown; history?: unknown };
  if (typeof raw.byTier === "object" && raw.byTier !== null) {
    for (const [tier, stats] of Object.entries(
      raw.byTier as Record<string, unknown>,
    )) {
      const parsed = TierStatsSchema.safeParse(stats);
      if (parsed.success) sanitized.byTier[tier] = parsed.data;
    }
  }
  if (Array.isArray(raw.history)) {
    sanitized.history = raw.history
      .map((it) => HistoryEntrySchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  return sanitized;
}
