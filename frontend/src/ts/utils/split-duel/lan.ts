import { BALANCE } from "./balance";
import {
  createLanSeed,
  wordIndexProgressCodec,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { generatePseudoWords } from "../learn-stats";

/**
 * Split-Key Showdown's LanPlayable (online wave, phase 9 — pattern H):
 * the hot-seat halves become a LAN duel — the host IS the left half, the
 * client IS the right half, each typing their own half's letters on
 * their OWN full keyboard. Both machines build the identical per-side
 * pseudo-word streams locally: the shared seed drives the bigram
 * generator (it already accepts an explicit seed) over the identical
 * bundled pool — nothing is shipped but the seed.
 *
 * The verdict is the doc's §۰.A.۱ rule: the lower finish time wins, the
 * accuracy breaks the tie, the exact parity is a draw. Pure — the lobby
 * passes the language in settings.
 */

export const SPLIT_LAN_LETTERS = {
  left: "qwertasdfgzxcvb",
  right: "yuiophjklnm",
} as const;

export type SplitSide = "left" | "right";

/** the role -> half mapping: the host sits on the left half (slot 1) */
export function sideForRole(role: "host" | "client"): SplitSide {
  return role === "host" ? "left" : "right";
}

export type SplitVerdict = "won" | "lost" | "draw";

/** §۰.A.۱: the lower finish time wins, accuracy breaks the tie */
export function resolveSplitVerdict(
  mine: { finishMs: number; acc: number },
  theirs: { finishMs: number; acc: number },
): SplitVerdict {
  if (mine.finishMs !== theirs.finishMs) {
    return mine.finishMs < theirs.finishMs ? "won" : "lost";
  }
  if (mine.acc !== theirs.acc) {
    return mine.acc > theirs.acc ? "won" : "lost";
  }
  return "draw";
}

/** both sides' seeded pseudo-word streams ([left, right]) — the bigram
 * generator over the identical pool, deterministic per seed */
export function splitLanStreams(
  pool: string[],
  seed: number,
  count: number,
): [string[], string[]] {
  return [
    generatePseudoWords(SPLIT_LAN_LETTERS.left, count, pool, "", seed),
    generatePseudoWords(SPLIT_LAN_LETTERS.right, count, pool, "", seed),
  ];
}

function coerceCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2147483647
  );
}

export const lanSplitDuel: LanPlayable = {
  gameId: "split-duel",
  route: "/games/split-duel",
  label: "split duel",
  icon: "fa-users",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "split-duel",
      seed: createLanSeed(),
      params: {
        lang: typeof lang === "string" && lang.length > 0 ? lang : "english",
        words: coerceCount(settings["words"], BALANCE.defaultWords),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "split-duel") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["words"]);
  },
  ...wordIndexProgressCodec(),
};
