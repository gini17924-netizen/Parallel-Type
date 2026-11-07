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
 * Word Blast's daily wrapper (idea G22, phase 2): the launcher game
 * joins the gauntlet. The daily locks the difficulty to
 * DAILY_PARAMS.wordBlast.difficulty and the normalizer maps the score
 * linearly onto 0..1000 with the target from the params table:
 * `clamp(score / targetScore × 1000)` — the doc §۱'s own example.
 */

export type WordBlastDailyRaw = {
  score: number;
  difficulty: string;
};

/** pure 0..1000: 0 at no score, 1000 exactly at the daily target */
export function normalizeWordBlastDaily(raw: { score: number }): number {
  const safe = Number.isFinite(raw.score) ? Math.max(0, raw.score) : 0;
  return Math.min(
    1000,
    Math.round((safe / DAILY_PARAMS.wordBlast.targetScore) * 1000),
  );
}

export function registerDailyWordBlast(): void {
  const impl: DailyPlayable = {
    gameId: "word-blast",
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
export function completeDailyWordBlast(raw: {
  score: number;
  difficulty: string;
}): boolean {
  return completeDailyStageForGame({
    gameId: "word-blast",
    normalize: (r) =>
      normalizeWordBlastDaily({ score: Number(r["score"] ?? 0) }),
    raw: { score: raw.score, difficulty: raw.difficulty },
    won: normalizeWordBlastDaily({ score: raw.score }) >= 500,
  });
}

export { resolveDailyStage, takePendingDailyStage };
