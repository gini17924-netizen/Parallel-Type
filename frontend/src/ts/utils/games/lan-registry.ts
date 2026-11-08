/**
 * LanPlayable contract (online wave, phase 1): the per-game registration
 * that turns the bot-duel-specific online layer into a registry. Each
 * online-capable game registers one `LanPlayable`; the lobby picker and
 * `states/lan-match.ts` read everything through this contract — no game
 * is hard-coded anywhere.
 *
 * Pure module: no game imports, no I/O. The games register themselves in
 * `utils/games/lan-games.ts` (the barrel — KI-43's lesson: a registry is
 * filled by module loads, never by page mounts).
 */

import type { FaSolidIcon } from "../../types/font-awesome";

/** the games that have an online mode — grows one entry per phase */
export type LanGameId =
  | "bot-duel"
  | "sprint"
  | "ghost-gp"
  | "split-duel"
  | "maze-runner";

/** what a game's buildStart produces — the caller (the lobby) ships it
 * inside the `start` message; the armed match adds role/peerName/seq */
export type LanStartPayload = {
  gameId: LanGameId;
  /** shared seed for seeded streams (patterns R2/S) — word-shipping
   * games (pattern R1) carry `words` instead */
  seed?: number;
  /** per-game settings echoed back for validation and the rematch */
  params: Record<string, unknown>;
  /** pattern R1: the host ships the exact word sequence */
  words?: string[];
};

export type LanPlayable = {
  gameId: LanGameId;
  /** where BOTH players navigate when the match starts */
  route:
    | "/games/bot-duel"
    | "/games/sprint"
    | "/games/ghost-gp"
    | "/games/split-duel"
    | "/games/maze-runner";
  /** the lobby picker card (English, per the standing rule) */
  label: string;
  icon: FaSolidIcon;
  /** host side: settings (race length, pool words, ...) -> the start
   * payload. Pure — the lobby fetches any pool and passes it in. */
  buildStart(settings: Record<string, unknown>): LanStartPayload;
  /** both sides: a received start is armed only if this passes */
  validateStart(start: LanStartPayload): boolean;
  /** both sides: the live per-word/state values -> the relayed progress
   * state (the {type:"progress", gameId, state} envelope lives in
   * lan-match) */
  encodeProgress(state: Record<string, unknown>): Record<string, unknown>;
  /** both sides: the peer's progress state, or undefined when the shape
   * is not trusted */
  decodeProgress(payload: unknown): Record<string, unknown> | undefined;
};

const registry = new Map<LanGameId, LanPlayable>();

/** registers one game; a duplicate id is a bug and throws */
export function registerLanGame(game: LanPlayable): void {
  if (registry.has(game.gameId)) {
    throw new Error(`lan: game already registered (${game.gameId})`);
  }
  registry.set(game.gameId, game);
}

export function getLanGame(gameId: LanGameId): LanPlayable | undefined {
  return registry.get(gameId);
}

/** every registered game, in registration order (the lobby picker) */
export function getLanGames(): LanPlayable[] {
  return [...registry.values()];
}

/** the host's one-shot shared seed (positive 31-bit, fits the LCG) */
export function createLanSeed(): number {
  return Math.floor(Math.random() * 2147483647) + 1;
}

/** the shared {wordIndex, correctChars} progress codec — the duel-family
 * games (bot-duel, ghost-gp, …) relay exactly this pair */
export function wordIndexProgressCodec(): {
  encodeProgress(state: Record<string, unknown>): Record<string, unknown>;
  decodeProgress(payload: unknown): Record<string, unknown> | undefined;
} {
  const coerce = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  return {
    encodeProgress(state) {
      return {
        wordIndex: coerce(state["wordIndex"]),
        correctChars: coerce(state["correctChars"]),
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
      return {
        wordIndex: Math.floor(wordIndex),
        correctChars: Math.floor(correctChars),
      };
    },
  };
}

/** test hook: empties the registry (specs re-register what they need) */
export function _resetLanRegistryForTests(): void {
  registry.clear();
}
