import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Wordle persistence (idea G4, phase 1): the in-progress puzzle and the
 * career stats, BOTH per language — each language gets its own storage keys
 * (`..._fa` / `..._en`) and its own streak. localStorage via
 * LocalStorageWithSchema (zod-validated with fallback).
 *
 * Storage owner: this module. Backup owner: utils/local-persistence.ts
 * (`wordleState` / `wordleStats` fields, optional since schema v3).
 */

export const WORDLE_LANGS = ["fa", "en"] as const;
export type WordleLang = (typeof WORDLE_LANGS)[number];

export const wordleStateKey = (lang: string): string =>
  `mtDesktopWordleState_${lang}`;
export const wordleStatsKey = (lang: string): string =>
  `mtDesktopWordleStats_${lang}`;

/** the local calendar day key in the HUMAN convention (1-indexed months) —
 * the same strings yesterdayKey's arithmetic works on; the page passes this */
export function wordleDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const StateSchema = z.object({
  dayKey: z.string(),
  lang: z.string(),
  guesses: z.array(z.string()),
  finished: z.union([z.null(), z.enum(["won", "lost"])]),
});

const StatsSchema = z.object({
  played: z.number(),
  won: z.number(),
  streak: z.number(),
  maxStreak: z.number(),
  /** wins by guess count, index 0 = guessed in 1 */
  distribution: z.array(z.number()).length(6),
  lastCompletedDay: z.string().optional(),
});

export type WordleState = z.infer<typeof StateSchema>;
export type WordleStats = z.infer<typeof StatsSchema>;

const HISTORY_LIMIT = 6; //the distribution width: six guesses
const DAY_MS = 24 * 60 * 60 * 1000;

function emptyState(lang: string, dayKey: string): WordleState {
  return { dayKey, lang, guesses: [], finished: null };
}

const stateStores = new Map<string, LocalStorageWithSchema<WordleState>>();
const statsStores = new Map<string, LocalStorageWithSchema<WordleStats>>();

function stateStore(lang: string): LocalStorageWithSchema<WordleState> {
  let store = stateStores.get(lang);
  if (store === undefined) {
    store = new LocalStorageWithSchema<WordleState>({
      key: wordleStateKey(lang),
      schema: StateSchema,
      //complete on its own: get() returns the fallback WITHOUT parsing
      fallback: emptyState(lang, ""),
    });
    stateStores.set(lang, store);
  }
  return store;
}

function statsStore(lang: string): LocalStorageWithSchema<WordleStats> {
  let store = statsStores.get(lang);
  if (store === undefined) {
    store = new LocalStorageWithSchema<WordleStats>({
      key: wordleStatsKey(lang),
      schema: StatsSchema,
      fallback: {
        played: 0,
        won: 0,
        streak: 0,
        maxStreak: 0,
        distribution: [0, 0, 0, 0, 0, 0],
      },
    });
    statsStores.set(lang, store);
  }
  return store;
}

/**
 * Loads the language's puzzle state, rolling it over when the calendar day
 * changed: a new dayKey resets the guesses (the old puzzle is gone).
 */
export function loadWordleState(lang: string, todayKey: string): WordleState {
  const saved = stateStore(lang).get();
  if (saved.dayKey !== todayKey) {
    return emptyState(lang, todayKey);
  }
  return saved;
}

export function saveWordleState(lang: string, state: WordleState): void {
  stateStore(lang).set(state);
}

/** pure UTC calendar math on the dayKey string: the previous calendar day,
 * independent of the system timezone (a mis-set system clock must not bend
 * the streak comparison). Wordle day keys are HUMAN-calendar strings
 * (1-indexed months) — the same convention the page will pass in. */
function yesterdayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const utc = Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1) - DAY_MS;
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

export type RecordWordleInput = {
  lang: string;
  dayKey: string;
  won: boolean;
  /** the guess count of a win (1-6); ignored on a loss */
  guessCount: number;
};

/**
 * Records a finished puzzle: played always, a win bumps the win count, the
 * distribution bucket and the streak (consecutive days extend it, a gap or
 * a loss restarts it), a loss zeroes the streak without touching the
 * distribution or the last-win day.
 */
export function recordWordleGame(input: RecordWordleInput): WordleStats {
  const current = statsStore(input.lang).get();
  const distribution = [...current.distribution];
  let streak = current.streak;
  let lastCompletedDay = current.lastCompletedDay;
  let won = current.won;

  if (input.won) {
    won += 1;
    const bucket = Math.min(Math.max(1, input.guessCount), HISTORY_LIMIT) - 1;
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    streak =
      lastCompletedDay === input.dayKey
        ? current.streak
        : lastCompletedDay === yesterdayKey(input.dayKey)
          ? current.streak + 1
          : 1;
    lastCompletedDay = input.dayKey;
  } else {
    streak = 0;
  }

  const next: WordleStats = {
    played: current.played + 1,
    won,
    streak,
    maxStreak: Math.max(current.maxStreak, streak),
    distribution,
    lastCompletedDay,
  };
  statsStore(input.lang).set(next);
  return next;
}

export function getWordleStats(lang: string): WordleStats {
  return statsStore(lang).get();
}

/** test hook (repo _-prefixed convention) */
export function _resetWordleStoresForTests(): void {
  for (const lang of WORDLE_LANGS) {
    stateStore(lang).remove();
    statsStore(lang).remove();
  }
}

/**
 * Coerces an imported payload into a schema-valid shape (audit L4
 * pattern): garbage fields fall back and out-of-range distribution entries
 * are dropped. Without this, a payload that fails the store's schema would
 * be wiped to the empty fallback by the next get().
 */
export function sanitizeImportedWordleState(value: unknown): WordleState {
  const parsed = StateSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value !== "object" || value === null) {
    return emptyState("fa", "");
  }
  const raw = value as Record<string, unknown>;
  return {
    dayKey: typeof raw["dayKey"] === "string" ? raw["dayKey"] : "",
    lang: typeof raw["lang"] === "string" ? raw["lang"] : "fa",
    guesses: Array.isArray(raw["guesses"])
      ? (raw["guesses"] as unknown[]).filter(
          (it): it is string => typeof it === "string",
        )
      : [],
    finished:
      raw["finished"] === "won" || raw["finished"] === "lost"
        ? raw["finished"]
        : null,
  };
}

export function sanitizeImportedWordleStats(value: unknown): WordleStats {
  const parsed = StatsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fallback: WordleStats = {
    played: 0,
    won: 0,
    streak: 0,
    maxStreak: 0,
    distribution: [0, 0, 0, 0, 0, 0],
  };
  if (typeof value !== "object" || value === null) return fallback;
  const raw = value as Record<string, unknown>;
  const num = (key: string): number =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? raw[key] : 0;
  const distribution = Array.isArray(raw["distribution"])
    ? (raw["distribution"] as unknown[])
        .slice(0, HISTORY_LIMIT)
        .map((it) => (typeof it === "number" && Number.isFinite(it) ? it : 0))
    : [];
  while (distribution.length < HISTORY_LIMIT) distribution.push(0);
  return {
    played: num("played"),
    won: num("won"),
    streak: num("streak"),
    maxStreak: num("maxStreak"),
    distribution,
    lastCompletedDay:
      typeof raw["lastCompletedDay"] === "string"
        ? raw["lastCompletedDay"]
        : undefined,
  };
}
