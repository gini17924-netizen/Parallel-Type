import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * The gauntlet's two stores (idea G22, phase 3): the CURRENT day's
 * resumable state (`mtDesktopGauntletState` — the close-the-app
 * mid-run resume rule) and the career stats (`mtDesktopGauntletStats`
 * — streak, calendar, bests). The gauntlet never writes PBs/XP — only
 * its own stats (the games' rule). Backup owner:
 * utils/local-persistence.ts (both fields, wired in the page phase).
 */

export const GAUNTLET_STATE_KEY = "mtDesktopGauntletState";
export const GAUNTLET_STATS_KEY = "mtDesktopGauntletStats";

const StageSchema = z.object({
  gameId: z.string(),
  title: z.string(),
  seed: z.number(),
  params: z.record(z.string(), z.unknown()),
});

const StageResultSchema = z.object({
  gameId: z.string(),
  normalized: z.number(),
  raw: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
  won: z.boolean(),
});

const StateSchema = z.object({
  dayKey: z.string(),
  stages: z.array(StageSchema).max(3),
  stageIndex: z.number(),
  results: z.array(StageResultSchema).max(3),
  phase: z.enum(["ready", "between", "complete", "voided"]),
  locked: z.boolean(),
  startedAt: z.number().nullable(),
  voidReason: z.string().nullable(),
});

const CalendarEntrySchema = z.object({
  total: z.number(),
  stagesWon: z.number(),
});

const StatsSchema = z.object({
  streak: z.number(),
  maxStreak: z.number(),
  calendar: z.record(z.string(), CalendarEntrySchema),
  bestTotal: z.number(),
  history: z
    .array(
      z.object({
        at: z.number(),
        dayKey: z.string(),
        total: z.number(),
        stagesWon: z.number(),
      }),
    )
    .max(10),
});

export type GauntletStageSnapshot = z.infer<typeof StageSchema>;
export type GauntletStateSnapshot = z.infer<typeof StateSchema>;
export type GauntletCalendarEntry = z.infer<typeof CalendarEntrySchema>;
export type GauntletStats = z.infer<typeof StatsSchema>;

const stateStore = new LocalStorageWithSchema<GauntletStateSnapshot>({
  key: GAUNTLET_STATE_KEY,
  schema: StateSchema,
  fallback: {
    dayKey: "",
    stages: [],
    stageIndex: 0,
    results: [],
    phase: "voided",
    locked: false,
    startedAt: null,
    voidReason: "empty",
  },
});

const statsStore = new LocalStorageWithSchema<GauntletStats>({
  key: GAUNTLET_STATS_KEY,
  schema: StatsSchema,
  fallback: {
    streak: 0,
    maxStreak: 0,
    calendar: {},
    bestTotal: 0,
    history: [],
  },
});

/** the savable shape: the engine's undefined-or-value fields also pass */
export type SavableGauntletState = Omit<
  GauntletStateSnapshot,
  "startedAt" | "voidReason"
> & {
  startedAt?: number | null;
  voidReason?: string | null;
};

/** persists the resumable day state (the resume-after-close rule) */
export function saveGauntletState(state: SavableGauntletState): void {
  //undefined fields become null so the schema's nullable accepts them
  stateStore.set({
    ...state,
    startedAt: state.startedAt ?? null,
    voidReason: state.voidReason ?? null,
  });
}

export function loadGauntletState(): GauntletStateSnapshot | undefined {
  const state = stateStore.get();
  if (state.dayKey === "") return undefined;
  return state;
}

/** clears the day state (a completed or voided day frees the slot) */
export function clearGauntletState(): void {
  stateStore.remove();
}

/** yesterday's dayKey for the streak arithmetic (local time) */
export function previousDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map((it) => Number(it));
  if (y === undefined || m === undefined || d === undefined) return "";
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** records a completed day: the calendar stamp + the streak arithmetic */
export function recordGauntletCompletion(input: {
  dayKey: string;
  total: number;
  stagesWon: number;
}): { isNewBest: boolean; streak: number } {
  const stats = statsStore.get();
  const yesterday = previousDayKey(input.dayKey);
  const streak = stats.calendar[yesterday] === undefined ? 1 : stats.streak + 1;
  const isNewBest = input.total > stats.bestTotal;
  statsStore.set({
    streak,
    maxStreak: Math.max(stats.maxStreak, streak),
    calendar: {
      ...stats.calendar,
      [input.dayKey]: {
        total: input.total,
        stagesWon: input.stagesWon,
      },
    },
    bestTotal: isNewBest ? input.total : stats.bestTotal,
    history: [
      {
        at: Date.now(),
        dayKey: input.dayKey,
        total: input.total,
        stagesWon: input.stagesWon,
      },
      ...stats.history,
    ].slice(0, 10),
  });
  return { isNewBest, streak };
}

export function getGauntletStats(): GauntletStats {
  return statsStore.get();
}

export function getGauntletCalendarEntry(
  dayKey: string,
): GauntletCalendarEntry | undefined {
  return statsStore.get().calendar[dayKey];
}

/** test hook: drops both stores */
export function _resetGauntletStoresForTests(): void {
  stateStore.remove();
  statsStore.remove();
}

/** the sanitized state payload (dot-accessible, backup-importer friendly) */
export type SanitizedGauntletState = GauntletStateSnapshot;

export function sanitizeImportedGauntletState(
  value: unknown,
): SanitizedGauntletState | undefined {
  const parsed = StateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** the sanitized stats payload (audit L4) */
export type SanitizedGauntletStats = GauntletStats;

export function sanitizeImportedGauntletStats(
  value: unknown,
): SanitizedGauntletStats {
  const parsed = StatsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const sanitized: SanitizedGauntletStats = {
    streak: 0,
    maxStreak: 0,
    calendar: {},
    bestTotal: 0,
    history: [],
  };
  if (typeof value !== "object" || value === null) return sanitized;
  const raw = value as Record<string, unknown>;
  const num = (it: unknown): number | undefined =>
    typeof it === "number" && Number.isFinite(it) && it >= 0
      ? Math.floor(it)
      : undefined;
  const streak = num(raw["streak"]);
  if (streak !== undefined) sanitized.streak = streak;
  const maxStreak = num(raw["maxStreak"]);
  if (maxStreak !== undefined) sanitized.maxStreak = maxStreak;
  const bestTotal = num(raw["bestTotal"]);
  if (bestTotal !== undefined) sanitized.bestTotal = bestTotal;
  const calendar = raw["calendar"];
  if (typeof calendar === "object" && calendar !== null) {
    for (const [dayKey, entry] of Object.entries(
      calendar as Record<string, unknown>,
    )) {
      if (typeof entry !== "object" || entry === null) continue;
      const total = num((entry as Record<string, unknown>)["total"]);
      const stagesWon = num((entry as Record<string, unknown>)["stagesWon"]);
      if (total === undefined || stagesWon === undefined) continue;
      sanitized.calendar[dayKey] = { total, stagesWon };
    }
  }
  const history = raw["history"];
  if (Array.isArray(history)) {
    for (const it of history) {
      if (typeof it !== "object" || it === null) continue;
      const at = num((it as Record<string, unknown>)["at"]);
      const total = num((it as Record<string, unknown>)["total"]);
      const stagesWon = num((it as Record<string, unknown>)["stagesWon"]);
      const dayKey = (it as Record<string, unknown>)["dayKey"];
      if (at === undefined || total === undefined || stagesWon === undefined) {
        continue;
      }
      if (typeof dayKey !== "string") continue;
      sanitized.history.push({ at, dayKey, total, stagesWon });
    }
    sanitized.history = sanitized.history.slice(0, 10);
  }
  return sanitized;
}
