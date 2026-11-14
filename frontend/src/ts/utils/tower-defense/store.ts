import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Tower Defense bests and recent-run history for the desktop offline
 * build (phase 85). Storage owner: this module. Backup owner:
 * utils/local-persistence.ts (`towerDefenseScores` field — wired in the
 * page phase like lane-defense's).
 */

export const TOWER_DEFENSE_SCORES_KEY = "mtDesktopTowerDefenseScores";

const RunRecordSchema = z.object({
  at: z.number(),
  score: z.number(),
  wave: z.number(),
  maxCombo: z.number(),
  kills: z.number(),
});

const ScoresSchema = z.object({
  bestScore: z.number(),
  bestWave: z.number(),
  history: z.array(RunRecordSchema).max(10),
});

export type TowerDefenseRunRecord = z.infer<typeof RunRecordSchema>;
type TowerDefenseScores = z.infer<typeof ScoresSchema>;

const HISTORY_LIMIT = 10;

const store = new LocalStorageWithSchema<TowerDefenseScores>({
  key: TOWER_DEFENSE_SCORES_KEY,
  schema: ScoresSchema,
  fallback: { bestScore: 0, bestWave: 0, history: [] },
});

export type RecordRunResult = {
  isNewScoreRecord: boolean;
  isNewWaveRecord: boolean;
};

/**
 * Records a finished Tower Defense run: the global bests and the recent
 * history (newest first, capped at 10).
 */
export function recordTowerDefenseRun(run: {
  score: number;
  wave: number;
  maxCombo: number;
  kills: number;
}): RecordRunResult {
  const current = store.get();
  const record: TowerDefenseRunRecord = {
    at: Date.now(),
    score: run.score,
    wave: run.wave,
    maxCombo: run.maxCombo,
    kills: run.kills,
  };
  const isNewScoreRecord = run.score > current.bestScore;
  const isNewWaveRecord = run.wave > current.bestWave;
  store.set({
    bestScore: Math.max(current.bestScore, run.score),
    bestWave: Math.max(current.bestWave, run.wave),
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
  return { isNewScoreRecord, isNewWaveRecord };
}

export function getTowerDefenseBests(): {
  bestScore: number;
  bestWave: number;
} {
  const current = store.get();
  return { bestScore: current.bestScore, bestWave: current.bestWave };
}
