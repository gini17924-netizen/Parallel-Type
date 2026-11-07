import type {
  DuelEngine,
  DuelState,
  PlayerEvent,
} from "../bot-duel/duel-engine";
import { createDuelEngine } from "../bot-duel/duel-engine";
import { createCurvePacer } from "./curve-pacer";
import type { Ghost } from "./ghost-source";

/**
 * Ghost GP engine (idea G3): the race mechanics are exactly the duel
 * engine's (idea G2) — the crossing judged by time over one shared word
 * sequence. The ghost decides the pace: a constant ghost paces at its wpm,
 * a curve ghost (phase 3) injects its own pacer so it accelerates like the
 * real race it came from.
 */

export type GpPhase = DuelState["phase"];
export type GpState = DuelState;
export type GpPlayerEvent = PlayerEvent;

export function createGpEngine(options: {
  words: string[];
  ghost: Ghost;
}): DuelEngine {
  const pacer =
    options.ghost.kind === "curve"
      ? createCurvePacer({
          perSecondWpm: options.ghost.perSecondWpm,
          words: options.words,
        })
      : undefined;
  return createDuelEngine({
    words: options.words,
    botWpm:
      options.ghost.kind === "curve"
        ? options.ghost.averageWpm
        : options.ghost.wpm,
    pacer,
  });
}
