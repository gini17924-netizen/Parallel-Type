import { type LanPlayable, type LanStartPayload } from "../games/lan-registry";
import { FALLBACK_WORDS, buildRaceWords } from "./duel-words";

/**
 * bot-duel's LanPlayable (online wave, phase 1): the first registry
 * member. Pure — the lobby fetches the language pool and passes it in
 * `settings.words`; without a pool the deterministic fallback cycles.
 * The live progress relayed during a race is the pair the page already
 * sends today (wordIndex + correctChars).
 */

export type BotDuelProgress = {
  wordIndex: number;
  correctChars: number;
};

const DEFAULT_RACE_LENGTH = 30;

function coerceLength(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_RACE_LENGTH;
}

function isWordList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((word) => typeof word === "string" && word.length > 0)
  );
}

export const lanBotDuel: LanPlayable = {
  gameId: "bot-duel",
  route: "/games/bot-duel",
  label: "bot duel",
  icon: "fa-robot",
  buildStart(settings) {
    const length = coerceLength(settings["length"]);
    const pool = isWordList(settings["words"])
      ? settings["words"]
      : FALLBACK_WORDS;
    const words = buildRaceWords(pool, length);
    const start: LanStartPayload = {
      gameId: "bot-duel",
      params: { length },
      words,
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "bot-duel") return false;
    const length = start.params["length"];
    if (typeof length !== "number" || !Number.isFinite(length) || length <= 0) {
      return false;
    }
    return isWordList(start.words);
  },
  encodeProgress(state) {
    const wordIndex = state["wordIndex"];
    const correctChars = state["correctChars"];
    return {
      wordIndex:
        typeof wordIndex === "number" && wordIndex >= 0
          ? Math.floor(wordIndex)
          : 0,
      correctChars:
        typeof correctChars === "number" && correctChars >= 0
          ? Math.floor(correctChars)
          : 0,
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const wordIndex = record["wordIndex"];
    const correctChars = record["correctChars"];
    if (
      typeof wordIndex !== "number" ||
      !Number.isFinite(wordIndex) ||
      wordIndex < 0
    ) {
      return undefined;
    }
    if (
      typeof correctChars !== "number" ||
      !Number.isFinite(correctChars) ||
      correctChars < 0
    ) {
      return undefined;
    }
    const progress: BotDuelProgress = {
      wordIndex: Math.floor(wordIndex),
      correctChars: Math.floor(correctChars),
    };
    return { ...progress };
  },
};
