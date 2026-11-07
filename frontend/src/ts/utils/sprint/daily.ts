import { DAILY_PARAMS } from "../daily-gauntlet/params";
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
 * Sprint's daily wrapper (idea G22, phase 2): the 10-second sprint
 * joins the gauntlet. The normalizer maps the finished wpm linearly
 * onto 0..1000: `clamp(wpm / targetWpm × 1000)` — hitting 100wpm (the
 * documented target) scores the full 1000.
 */

export type SprintDailyRaw = {
  wpm: number;
};

/** pure 0..1000: 0 at 0wpm, 1000 exactly at the target wpm */
export function normalizeSprintDaily(raw: { wpm: number }): number {
  const safe = Number.isFinite(raw.wpm) ? Math.max(0, raw.wpm) : 0;
  return Math.min(
    1000,
    Math.round((safe / DAILY_PARAMS.sprint.targetWpm) * 1000),
  );
}

export function registerDailySprint(): void {
  const impl: DailyPlayable = {
    gameId: "sprint",
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
export function completeDailySprint(raw: { wpm: number }): boolean {
  return completeDailyStageForGame({
    gameId: "sprint",
    normalize: (r) => normalizeSprintDaily({ wpm: Number(r["wpm"] ?? 0) }),
    raw: { wpm: raw.wpm },
    won: normalizeSprintDaily({ wpm: raw.wpm }) >= 500,
  });
}

export { resolveDailyStage, takePendingDailyStage };
