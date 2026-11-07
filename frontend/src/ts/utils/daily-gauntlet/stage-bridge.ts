import type { DailyStage, DailyStageResult } from "../games/game-registry";

/**
 * The daily stage bridge (idea G22, phase 2): the seam between a
 * game's DailyPlayable wrapper and the game's own UI. The wrapper's
 * runDailyStage arms the bridge with the pending stage; the gauntlet
 * page (H.4) navigates to the game, the game reads its pending stage
 * and, when the run ends, resolves the bridge with its normalized
 * result. ONE stage pending at a time. PURE state; no UI imports.
 */

type PendingStage = {
  stage: DailyStage;
  resolve: (result: DailyStageResult) => void;
};

let pending: PendingStage | undefined;

/** arms a stage (called by the wrapper's runDailyStage) */
export function armDailyStage(
  stage: DailyStage,
  resolve: (result: DailyStageResult) => void,
): void {
  pending = { stage, resolve };
}

/** the game UI asks for ITS pending daily stage (undefined when none) */
export function takePendingDailyStage(gameId: string): DailyStage | undefined {
  const stage = pending?.stage;
  return stage?.gameId === gameId ? stage : undefined;
}

/** the game UI finished: resolves the armed wrapper's promise */
export function resolveDailyStage(result: DailyStageResult): void {
  const armed = pending;
  if (armed === undefined || armed.stage.gameId !== result.gameId) return;
  pending = undefined;
  armed.resolve(result);
}

/** whether a stage is awaiting its run (the gauntlet page's guard) */
export function hasPendingDailyStage(): boolean {
  return pending !== undefined;
}

/** test hook: drops any armed stage */
export function _resetDailyStageBridgeForTests(): void {
  pending = undefined;
}
