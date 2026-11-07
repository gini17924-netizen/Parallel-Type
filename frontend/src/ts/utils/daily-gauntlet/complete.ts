import { dayKeyOf } from "./compose";
import { advanceGauntlet, type GauntletState } from "./engine";
import { loadGauntletState, saveGauntletState } from "./store";
import { resolveDailyStage, takePendingDailyStage } from "./stage-bridge";

/**
 * The stage completion helper (idea G22, phase 4): a game's page calls
 * this when its run ends while a daily stage is pending. It resolves
 * the wrapper's promise AND advances the persisted gauntlet state (the
 * coordinator is the STORE, not a mounted component — navigating away
 * must not lose the result).
 */

export function completeDailyStageForGame(options: {
  gameId: string;
  /** the game's own pure normalizer (0..1000) */
  normalize: (raw: Record<string, number | boolean | string>) => number;
  raw: Record<string, number | boolean | string>;
  won: boolean;
}): boolean {
  const stage = takePendingDailyStage(options.gameId);
  if (stage === undefined) return false;
  const normalized = options.normalize(options.raw);
  resolveDailyStage({
    gameId: options.gameId,
    normalized,
    raw: options.raw,
    won: options.won,
  });
  const saved = loadGauntletState();
  if (saved === undefined || saved.dayKey !== dayKeyOf()) return true;
  const state = advanceGauntlet(saved as GauntletState, {
    gameId: options.gameId,
    normalized,
    raw: options.raw,
    won: options.won,
  });
  saveGauntletState(state);
  return true;
}
