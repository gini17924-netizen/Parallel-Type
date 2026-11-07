import type { DailyPlayable, DailyStage } from "../games/game-registry";
import { DAILY_PARAMS } from "./params";

/**
 * The daily composer (idea G22, phase 3): turns a dayKey into the day's
 * three stages — deterministic under hash(dayKey), never repeating a
 * game, shrinking gracefully when fewer games are registered (doc §۳).
 * The same dayKey composes the SAME gauntlet across reloads. PURE.
 */

/** the small FNV-1a the doc asks for (doc §۲) */
export function hashKey(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** the local `YYYY-MM-DD` day key (the daily-goal pattern, padded) */
export function dayKeyOf(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const STAGE_COUNT = 3;

/** the per-game display titles (the compose table; the doc asks for a
 * title on every stage) */
const DAILY_TITLES: Record<string, string> = {
  "word-blast": "word blast",
  sprint: "10s sprint",
  "bot-duel": "bot duel",
};

function titleOf(gameId: string): string {
  return DAILY_TITLES[gameId] ?? gameId;
}

/** the day's per-game parameters (DAILY_PARAMS keyed by camelCase) */
const PARAM_KEYS: Record<string, keyof typeof DAILY_PARAMS> = {
  "word-blast": "wordBlast",
  sprint: "sprint",
  "bot-duel": "botDuel",
};

function paramsOf(gameId: string): Record<string, unknown> {
  const key = PARAM_KEYS[gameId];
  const entry = key === undefined ? undefined : DAILY_PARAMS[key];
  return entry === undefined ? {} : { ...entry };
}

/** builds the day's stages from the registered games (order-stable) */
export function buildDaily(
  dayKey: string,
  registered: DailyPlayable[],
): DailyStage[] {
  const ids = registered.map((it) => it.gameId);
  //a seeded shuffle of the eligible games: deterministic per day
  const order = [...ids];
  let seed = hashKey(dayKey);
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    const a = order[i];
    const b = order[j];
    if (a === undefined || b === undefined) continue;
    order[i] = b;
    order[j] = a;
  }
  const picked = order.slice(0, STAGE_COUNT);
  return picked.map((gameId) => ({
    gameId,
    title: titleOf(gameId),
    seed: hashKey(`${dayKey}:${gameId}`),
    params: paramsOf(gameId),
  }));
}
