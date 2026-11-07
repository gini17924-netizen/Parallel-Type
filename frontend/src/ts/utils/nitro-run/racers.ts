import { aiSpeedMps, checkpointMult } from "./balance";

/**
 * Nitro Run AI racers (idea G23, phase 1): pure pacing math — each AI
 * holds a fixed wpm base (converted to m/s like the player's scoring:
 * 5-char words x the per-char progress) and accelerates x1.05 per
 * checkpoint the RACE passes. PURE.
 */

export type AiRacer = {
  lane: number;
  wpmBase: number;
  progressM: number;
};

export function createAiRacer(options: {
  wpmBase: number;
  lane: number;
}): AiRacer {
  return { lane: options.lane, wpmBase: options.wpmBase, progressM: 0 };
}

/** advances one AI racer by dtSec at its checkpoint-scaled speed */
export function aiAdvance(
  racer: AiRacer,
  dtSec: number,
  checkpoints: number,
): void {
  racer.progressM +=
    aiSpeedMps(racer.wpmBase) * checkpointMult(checkpoints) * dtSec;
}

/** the race checkpoint count for a player distance */
export function checkpointsFor(
  playerProgressM: number,
  everyM: number,
): number {
  return Math.floor(Math.max(0, playerProgressM) / everyM);
}
