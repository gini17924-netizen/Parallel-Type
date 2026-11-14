import { type LanPlayable, type LanStartPayload } from "../games/lan-registry";

/**
 * The word relay's LanPlayable (phase 83): the alternating two-player
 * co-op — side 0 (the host) takes the even words, side 1 (the client)
 * the odd ones. The host ships the word list in the start (pattern R1's
 * exact-words shape); both sides derive their own word subsets from it.
 */

export const lanRelay: LanPlayable = {
  gameId: "relay",
  route: "/games/relay",
  label: "word relay",
  icon: "fa-people-arrows",
  buildStart(settings) {
    const pool = Array.isArray(settings["words"])
      ? (settings["words"] as unknown[]).filter(
          (word): word is string => typeof word === "string",
        )
      : [];
    const words =
      pool.length >= 4
        ? pool
        : ["relay", "teams", "alternate", "words", "on", "the", "same", "list"];
    const start: LanStartPayload = {
      gameId: "relay",
      params: { length: words.length },
      words,
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "relay") return false;
    return (
      Array.isArray(start.words) &&
      start.words.length >= 4 &&
      start.words.every((word) => typeof word === "string" && word.length > 0)
    );
  },
  encodeProgress(state: { myIndex: number }) {
    return { ...state };
  },
  decodeProgress(state: unknown) {
    if (typeof state !== "object" || state === null) return undefined;
    const candidate = state as { myIndex?: unknown };
    if (typeof candidate.myIndex !== "number" || candidate.myIndex < 0) {
      return undefined;
    }
    return { myIndex: candidate.myIndex };
  },
};
