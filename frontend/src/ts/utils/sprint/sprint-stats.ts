import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Ten-Second Sprint stats (idea G5): per-language bests, the recent history
 * and the daily-sprint streak. Same shape as the other game stores:
 * localStorage via LocalStorageWithSchema (zod-validated with fallback).
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`sprintStats` field, optional since schema v3).
 */

export const SPRINT_STATS_KEY = "mtDesktopSprintStats";

/** the local calendar-day key (the daily-goal.ts pattern: Y-M-D, local time,
 * month not zero-padded) */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const HistoryEntrySchema = z.object({
  at: z.number(),
  lang: z.string(),
  wpm: z.number(),
  raw: z.number(),
  acc: z.number(),
  daily: z.boolean(),
});

const StatsSchema = z.object({
  bestByLang: z.record(
    z.string(),
    z.object({ wpm: z.number(), at: z.number() }),
  ),
  history: z.array(HistoryEntrySchema).max(20),
  daily: z.object({
    /** the last day a daily sprint was recorded */
    dayKey: z.string().optional(),
    done: z.boolean(),
    /** that day's best daily wpm */
    bestWpm: z.number(),
    streak: z.number(),
    maxStreak: z.number(),
  }),
});

export type SprintStats = z.infer<typeof StatsSchema>;
export type SprintHistoryEntry = z.infer<typeof HistoryEntrySchema>;

const HISTORY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const store = new LocalStorageWithSchema<SprintStats>({
  key: SPRINT_STATS_KEY,
  schema: StatsSchema,
  //complete on its own: get() returns the fallback WITHOUT parsing when no
  //value is stored (the word-blast v2 lesson)
  fallback: {
    bestByLang: {},
    history: [],
    daily: { done: false, bestWpm: 0, streak: 0, maxStreak: 0 },
  },
});

export type RecordSprintInput = {
  lang: string;
  wpm: number;
  raw: number;
  /** the accuracy percent (0-100) */
  acc: number;
  /** whether this attempt was a Daily Sprint (streak bookkeeping) */
  daily: boolean;
  /** injected clock for tests (default Date.now()) */
  nowMs?: number;
};

/**
 * Records a finished sprint: bumps the language's best, prepends the race
 * to the recent history (newest first, capped at 20) and runs the daily
 * streak bookkeeping — the first daily result of a day extends the streak
 * (consecutive days) or restarts it (a gap), later same-day results only
 * raise that day's best.
 */
export function recordSprintResult(input: RecordSprintInput): SprintStats {
  const current = store.get();
  const nowMs = input.nowMs ?? Date.now();
  const previousBest = current.bestByLang[input.lang];
  const isNewBest = previousBest === undefined || input.wpm > previousBest.wpm;

  const next: SprintStats = {
    bestByLang: {
      ...current.bestByLang,
      [input.lang]: {
        wpm: Math.max(previousBest?.wpm ?? 0, input.wpm),
        at: isNewBest ? nowMs : (previousBest?.at ?? nowMs),
      },
    },
    history: [
      {
        at: nowMs,
        lang: input.lang,
        wpm: input.wpm,
        raw: input.raw,
        acc: input.acc,
        daily: input.daily,
      },
      ...current.history,
    ].slice(0, HISTORY_LIMIT),
    daily: current.daily,
  };

  if (input.daily) {
    const key = dayKeyOf(nowMs);
    const daily = current.daily;
    if (daily.dayKey === key) {
      //same day: the streak already counted, only the day's best moves
      next.daily = {
        ...daily,
        done: true,
        bestWpm: Math.max(daily.bestWpm, input.wpm),
      };
    } else {
      const yesterday = dayKeyOf(nowMs - DAY_MS);
      const streak = daily.dayKey === yesterday ? daily.streak + 1 : 1;
      next.daily = {
        dayKey: key,
        done: true,
        bestWpm: input.wpm,
        streak,
        maxStreak: Math.max(daily.maxStreak, streak),
      };
    }
  }

  store.set(next);
  return next;
}

export function getSprintStats(): SprintStats {
  return store.get();
}

/** test hook (repo _-prefixed convention) */
export function _resetSprintStatsForTests(): void {
  store.remove();
}

/**
 * Coerces an imported payload into a schema-valid shape (audit L4
 * pattern): garbage counters fall back, garbage history entries are dropped
 * and the list is trimmed to the newest 20. Without this, a payload that
 * fails the store's schema would be wiped to the empty fallback by the next
 * get().
 */
export function sanitizeImportedSprintStats(
  value: unknown,
): Record<string, unknown> {
  const sanitized: SprintStats = {
    bestByLang: {},
    history: [],
    daily: { done: false, bestWpm: 0, streak: 0, maxStreak: 0 },
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as Record<string, unknown>;
  if (typeof raw["bestByLang"] === "object" && raw["bestByLang"] !== null) {
    for (const [lang, best] of Object.entries(
      raw["bestByLang"] as Record<string, unknown>,
    )) {
      const parsed = z
        .object({ wpm: z.number(), at: z.number() })
        .safeParse(best);
      if (parsed.success) sanitized.bestByLang[lang] = parsed.data;
    }
  }
  if (Array.isArray(raw["history"])) {
    sanitized.history = (raw["history"] as unknown[])
      .map((it) => HistoryEntrySchema.safeParse(it))
      .filter((it) => it.success)
      .map((it) => it.data)
      .slice(0, HISTORY_LIMIT);
  }
  const rawDaily = raw["daily"];
  if (typeof rawDaily === "object" && rawDaily !== null) {
    const parsed = rawDaily as Record<string, unknown>;
    sanitized.daily = {
      dayKey:
        typeof parsed["dayKey"] === "string" ? parsed["dayKey"] : undefined,
      done: parsed["done"] === true,
      bestWpm: typeof parsed["bestWpm"] === "number" ? parsed["bestWpm"] : 0,
      streak: typeof parsed["streak"] === "number" ? parsed["streak"] : 0,
      maxStreak:
        typeof parsed["maxStreak"] === "number" ? parsed["maxStreak"] : 0,
    };
  }
  return sanitized;
}
