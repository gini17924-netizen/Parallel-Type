import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * The LAN champions table (phase 86): per game, per name, the BEST
 * result a player has produced on this host. The host's lan-match layer
 * records a champion when a room client's `finished` lands (the score
 * comes from the client's last progress state — the games ship it per
 * tick). The lobby renders the table for the selected game.
 */

export type LanChampion = {
  name: string;
  score: number;
  acc: number;
  at: number;
};

const championsStore = new LocalStorageWithSchema({
  key: "mtDesktopLanChampions",
  schema: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        score: z.number().nonnegative(),
        acc: z.number().min(0).max(100),
        at: z.number().nonnegative(),
      }),
    ),
  ),
  fallback: {},
});

const TABLE_CAP = 10;

/**
 * records a finished room match: the best score per name survives.
 * Returns whether this result became (or beat) the name's champion row.
 */
export function recordLanChampion(
  gameId: string,
  name: string,
  score: number,
  acc: number,
): boolean {
  const champions = championsStore.get();
  const game = champions[gameId] ?? {};
  const existing = game[name];
  if (existing !== undefined && existing.score >= score) return false;
  champions[gameId] = {
    ...game,
    [name]: {
      score,
      acc,
      at: Date.now(),
    },
  };
  championsStore.set(champions);
  return true;
}

/** the champions table for one game: strongest first, capped at 10 */
export function championsFor(gameId: string): LanChampion[] {
  const game = championsStore.get()[gameId] ?? {};
  return Object.entries(game)
    .map(([name, row]) => ({ name, ...row }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TABLE_CAP);
}

/** wipes the table (the specs' reset; the prod flows never call it) */
export function resetLanChampions(): void {
  championsStore.clear();
}
