import { BALANCE } from "./balance";
import { createFireSim, type FireSim } from "./sim";

/**
 * Firefight engine (idea G16, phase 1): the single-hose typing layer over
 * the fire sim — ONE active word at a time (the most critical burning
 * cell: the one with the most intact neighbors it would spread to).
 * Typing the active cell's word extinguishes it (back to intact, it can
 * reignite later) for len x 15 + combo; a wrong key breaks the combo; a
 * cell that ashes mid-word discards its partial and the hose shifts.
 * The run is won by surviving the full window with < the ash ratio; the
 * final score pays an ash penalty. PURE (the sim + the injected words).
 */

export type FirefightPhase = "running" | "won" | "lost";

export type FirefightResult = {
  /** the raw score minus the ash penalty, floored at 0 */
  score: number;
  won: boolean;
  ashes: number;
  extinguished: number;
  maxCombo: number;
  elapsedMs: number;
};

export type FirefightState = {
  phase: FirefightPhase;
  score: number;
  combo: number;
  maxCombo: number;
  extinguished: number;
  /** the fire grid snapshot (fresh per-cell references, the KI-34 lesson) */
  cells: {
    state: "intact" | "burning" | "ashes";
    word: string | undefined;
    typed: number;
  }[];
  activeIndex: number | undefined;
  activeWord: string | undefined;
  activeTyped: number;
  elapsedMs: number;
  remainingMs: number;
  ashRatio: number;
  result: FirefightResult | undefined;
};

export type FirefightEngine = {
  state(): FirefightState;
  /** advances the fire: spread, burn-out, the win/loss checks */
  tick(dtMs: number): FirefightState;
  /** a letter against the active cell's word */
  feedKey(key: string): FirefightState;
};

export function createFirefightEngine(options: {
  wordFor: () => string;
  rng: () => number;
  cols?: number;
  rows?: number;
  surviveMs?: number;
}): FirefightEngine {
  const surviveMs = options.surviveMs ?? BALANCE.surviveMs;
  const sim: FireSim = createFireSim({
    cols: options.cols,
    rows: options.rows,
    wordFor: options.wordFor,
    rng: options.rng,
    surviveMs,
  });

  let phase: FirefightPhase = "running";
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let extinguished = 0;

  /** the most critical burning cell = the most intact neighbors it would
   * spread to; ties break toward the earliest-ignited (FIFO-ish) */
  function selectActive(): number | undefined {
    const burning = sim.burningIndices();
    if (burning.length === 0) return undefined;
    let best: number | undefined;
    let bestCriticality = -1;
    for (const idx of burning) {
      const criticality = sim.intactNeighborCount(idx);
      if (
        criticality > bestCriticality ||
        (criticality === bestCriticality &&
          best !== undefined &&
          (sim.cells[idx]?.ignitedAtMs ?? 0) <
            (sim.cells[best]?.ignitedAtMs ?? 0))
      ) {
        best = idx;
        bestCriticality = criticality;
      }
    }
    return best;
  }

  function finish(won: boolean): FirefightState {
    phase = won ? "won" : "lost";
    return snapshotWith({});
  }

  function snapshotWith(extra: Partial<FirefightState>): FirefightState {
    const activeIndex = phase === "running" ? selectActive() : undefined;
    const active =
      activeIndex === undefined ? undefined : sim.cells[activeIndex];
    const ashes = sim.ashCount();
    return {
      phase,
      score,
      combo,
      maxCombo,
      extinguished,
      //fresh cell references: the page's <For> keys by reference (KI-34)
      cells: sim.cells.map((cell) => ({ ...cell })),
      activeIndex,
      activeWord: active?.word,
      activeTyped: active?.typed ?? 0,
      elapsedMs: sim.elapsedMs,
      remainingMs: Math.max(0, surviveMs - sim.elapsedMs),
      ashRatio: sim.ashRatio(),
      //the result is COMPUTED in the snapshot: a hardcoded undefined here
      //would be wiped by the next state() read after the run finished
      result:
        phase === "running"
          ? undefined
          : {
              score: Math.max(0, score - ashes * BALANCE.ashPenalty),
              won: phase === "won",
              ashes,
              extinguished,
              maxCombo,
              elapsedMs: sim.elapsedMs,
            },
      ...extra,
    };
  }

  return {
    state: () => snapshotWith({}),
    tick(dtMs) {
      if (phase !== "running") return snapshotWith({});
      sim.tick(dtMs);
      if (sim.ashRatio() >= BALANCE.ashLossRatio) {
        return finish(false); //the building is lost (doc G16 §۰.۴)
      }
      if (sim.elapsedMs >= surviveMs) {
        return finish(true); //survived the window
      }
      return snapshotWith({});
    },
    feedKey(key) {
      if (phase !== "running") return snapshotWith({});
      if (key.length !== 1) return snapshotWith({});
      const activeIndex = selectActive();
      if (activeIndex === undefined) return snapshotWith({});
      const cell = sim.cells[activeIndex];
      if (cell?.state !== "burning") {
        return snapshotWith({});
      }
      const ch = key.toLowerCase();
      const expected = cell.word?.[cell.typed]?.toLowerCase();
      if (expected !== ch) {
        combo = 0; //a wrong key on the active word breaks the combo
        return snapshotWith({});
      }
      cell.typed += 1;
      if (cell.typed >= (cell.word?.length ?? 0)) {
        //extinguished: back to intact (it can reignite later)
        const len = cell.word?.length ?? 0;
        cell.state = "intact";
        cell.word = undefined;
        cell.typed = 0;
        extinguished += 1;
        combo += 1;
        maxCombo = Math.max(maxCombo, combo);
        score += len * BALANCE.scorePerChar;
      }
      return snapshotWith({});
    },
  };
}
