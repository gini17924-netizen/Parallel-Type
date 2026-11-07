import {
  createDuelEngine,
  type DuelEngine,
  type DuelState,
  type PlayerEvent,
} from "../bot-duel/duel-engine";

/**
 * Ghost GP engine (idea G3, phase 1): the race mechanics are exactly the
 * duel engine's (idea G2) — a constant-rate opponent over one shared word
 * sequence, the crossing judged by time. The ghost source
 * (ghost-source.ts) supplies the opponent's wpm; the curve source joins in
 * phase G3.3 and will attach its per-second data to the race strip.
 */

export type GpPhase = DuelState["phase"];
export type GpState = DuelState;
export type GpPlayerEvent = PlayerEvent;

export function createGpEngine(options: {
  words: string[];
  ghostWpm: number;
}): DuelEngine {
  return createDuelEngine({ words: options.words, botWpm: options.ghostWpm });
}
