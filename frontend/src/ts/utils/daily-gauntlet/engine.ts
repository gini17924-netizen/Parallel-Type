import type { DailyStage, DailyStageResult } from "../games/game-registry";

/**
 * The gauntlet engine (idea G22, phase 3): the composite run's state
 * machine over the day's stages. The functions are PURE — each returns
 * a fresh state object the store can serialize (the resume-after-close
 * rule, doc §۰.۲). The day LOCKS after the first stage completes (doc
 * §۰.۵ — no rerolling for a friendly seed) and a dayKey change mid-run
 * voids the round without a record (doc §۶).
 */

export type GauntletPhase = "ready" | "between" | "complete" | "voided";

export type GauntletState = {
  dayKey: string;
  stages: DailyStage[];
  /** the stage awaiting its run (results.length === stageIndex) */
  stageIndex: number;
  results: DailyStageResult[];
  phase: GauntletPhase;
  /** true after the first stage completes — no restarting the day */
  locked: boolean;
  startedAt: number | undefined;
  voidReason: string | undefined;
};

export function createGauntlet(
  dayKey: string,
  stages: DailyStage[],
): GauntletState {
  return {
    dayKey,
    stages: stages.map((stage) => ({ ...stage })),
    stageIndex: 0,
    results: [],
    phase: "ready",
    locked: false,
    startedAt: undefined,
    voidReason: undefined,
  };
}

/** the stage the player is about to run (undefined when done/voided) */
export function currentStage(state: GauntletState): DailyStage | undefined {
  if (state.phase === "complete" || state.phase === "voided") return undefined;
  return state.stages[state.stageIndex];
}

/** the composite score so far (Σ normalized) */
export function gauntletTotal(state: GauntletState): number {
  return state.results.reduce((sum, it) => sum + it.normalized, 0);
}

/** records one stage's result; the day locks from here on */
export function advanceGauntlet(
  state: GauntletState,
  result: DailyStageResult,
): GauntletState {
  if (state.phase === "complete" || state.phase === "voided") return state;
  const stage = state.stages[state.stageIndex];
  if (stage === undefined || stage.gameId !== result.gameId) return state;
  const normalized = Math.max(0, Math.min(1000, Math.round(result.normalized)));
  const results = [
    ...state.results,
    { ...result, normalized, gameId: stage.gameId },
  ];
  const done = results.length >= state.stages.length;
  return {
    ...state,
    results,
    stageIndex: Math.min(state.stageIndex + 1, state.stages.length),
    phase: done ? "complete" : "between",
    locked: true,
    startedAt: state.startedAt ?? Date.now(),
  };
}

/** the dayKey changed mid-run → void without a record (doc §۶) */
export function voidGauntlet(
  state: GauntletState,
  reason: string,
): GauntletState {
  if (state.phase === "complete") return state;
  return { ...state, phase: "voided", voidReason: reason };
}

/** the midnight check: the state's day vs the real day */
export function checkGauntletDay(
  state: GauntletState,
  currentDayKey: string,
): GauntletState {
  if (state.dayKey === currentDayKey) return state;
  if (state.phase === "complete") return state; //a finished day stays
  return voidGauntlet(
    state,
    "the day rolled over mid-run — the round was voided",
  );
}
