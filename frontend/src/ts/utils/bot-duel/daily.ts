import {
  armDailyStage,
  resolveDailyStage,
  takePendingDailyStage,
} from "../daily-gauntlet/stage-bridge";
import { completeDailyStageForGame } from "../daily-gauntlet/complete";
import {
  registerDailyPlayable,
  type DailyPlayable,
  type DailyStageResult,
} from "../games/game-registry";

/**
 * Bot Duel's daily wrapper (idea G22, phase 2): one duel at the day's
 * fixed tier joins the gauntlet. The normalizer is pure and
 * documented: a WIN scores 650 + accuracy×3 (650..950 — the win is the
 * bulk, clean typing tops it up); a LOSS scores accuracy×2 (0..200 —
 * showing up clean still counts a little); a DRAW scores 400.
 */

export type BotDuelDailyRaw = {
  /** "won" | "lost" | "draw" */
  result: string;
  /** the player's accuracy percent 0..100 */
  accuracy: number;
};

export function botDuelWon(raw: BotDuelDailyRaw): boolean {
  return raw.result === "won";
}

/** pure 0..1000 per the documented table */
export function normalizeBotDuelDaily(raw: BotDuelDailyRaw): number {
  const acc = Number.isFinite(raw.accuracy)
    ? Math.max(0, Math.min(100, raw.accuracy))
    : 0;
  if (raw.result === "won") {
    return Math.min(1000, Math.round(650 + acc * 3));
  }
  if (raw.result === "draw") return 400;
  return Math.round(acc * 2);
}

export function registerDailyBotDuel(): void {
  const impl: DailyPlayable = {
    gameId: "bot-duel",
    runDailyStage: async (stage) => {
      const run = new Promise<DailyStageResult>((resolve) => {
        armDailyStage(stage, resolve);
      });
      return await run;
    },
  };
  registerDailyPlayable(impl);
}

/** the game page's one-call completion (resolves + advances the day) */
export function completeDailyBotDuel(raw: {
  result: string;
  accuracy: number;
}): boolean {
  return completeDailyStageForGame({
    gameId: "bot-duel",
    normalize: (r) =>
      normalizeBotDuelDaily({
        result: String(r["result"] ?? "lost"),
        accuracy: Number(r["accuracy"] ?? 0),
      }),
    raw: { result: raw.result, accuracy: raw.accuracy },
    won: raw.result === "won",
  });
}

export { resolveDailyStage, takePendingDailyStage };
