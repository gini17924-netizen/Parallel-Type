import { BALANCE } from "./balance";
import { mazeExit, type Cell, type Maze } from "./maze";
import { buildTwistyMaze, gateWordPicker, placeGates } from "./solver";

/**
 * Maze Runner engine (idea G14, phase 1): the runner auto-walks the BFS
 * path toward the exit (doc §۰.۳ — a typing race, not exploration) and
 * STOPS at every closed gate; typing the gate's word opens it. A wrong
 * key only costs the +200ms penalty — the partial is preserved (doc
 * §۰.۵). Score = max(0, par×2 − elapsed) + the error-free bonus. PURE:
 * the clock comes in with every call.
 */

export type MazeGate = {
  pathIndex: number;
  cell: Cell;
  word: string;
  typed: number;
  open: boolean;
};

export type MazeRunResult = {
  timeMs: number;
  score: number;
  errors: number;
  noError: boolean;
  turns: number;
};

export type MazeRunnerState = {
  phase: "running" | "done";
  level: number;
  maze: Maze;
  path: Cell[];
  /** the runner's current path index (the page slides the circle) */
  runnerIndex: number;
  gates: MazeGate[];
  /** the index of the first closed gate (the typing target) */
  activeGateIndex: number;
  elapsedMs: number;
  penaltyMs: number;
  parMs: number;
  errors: number;
  turns: number;
  exitCell: Cell;
  result: MazeRunResult | undefined;
};

export type MazeRunnerEngine = {
  state(): MazeRunnerState;
  /** the auto-walk step; safe to call on any cadence */
  tick(nowMs: number): MazeRunnerState;
  /** one bare character against the active gate's word */
  feedKey(ch: string, nowMs: number): MazeRunnerState;
};

export function createMazeRunnerEngine(options: {
  level: number;
  /** the word pool for the gate words (language list, read-only) */
  words: string[];
  rng: () => number;
}): MazeRunnerEngine {
  const level = Math.max(1, Math.min(BALANCE.maxLevel, options.level));
  const [cols, rows] = BALANCE.dimsByLevel[level] ?? [15, 11];
  const [minLen, maxLen] = BALANCE.gateLenByLevel[level] ?? [3, 5];
  const { maze, path, turns } = buildTwistyMaze(cols, rows, options.rng);
  const pickWord = gateWordPicker(options.words, minLen, maxLen, options.rng);
  const gates: MazeGate[] = placeGates(path, BALANCE.gateEvery, (index) =>
    pickWord(index),
  ).map((plan) => ({
    pathIndex: plan.pathIndex,
    cell: plan.cell,
    word: plan.word,
    typed: 0,
    open: false,
  }));
  const parMs = gates.reduce(
    (sum, gate) => sum + gate.word.length * BALANCE.parMsPerChar,
    0,
  );
  const exitCell = mazeExit(maze);

  let phase: MazeRunnerState["phase"] = "running";
  let runnerIndex = 0;
  let elapsedMs = 0;
  let penaltyMs = 0;
  let errors = 0;
  let lastTickAt: number | undefined;
  let walkCarry = 0;
  let finishedAtMs: number | undefined;

  function activeGateIndex(): number {
    const index = gates.findIndex((gate) => !gate.open);
    return index;
  }

  function totalMs(nowMs: number): number {
    return (finishedAtMs ?? nowMs) - 0 + penaltyMs;
  }

  function finish(nowMs: number): void {
    if (phase === "done") return;
    phase = "done";
    finishedAtMs = nowMs;
  }

  function snapshot(nowMs: number): MazeRunnerState {
    const timeMs = phase === "running" ? elapsedMs + penaltyMs : totalMs(nowMs);
    const noError = errors === 0;
    const rawScore = Math.max(0, parMs * 2 - timeMs);
    const score =
      phase === "done"
        ? rawScore + (noError ? BALANCE.noErrorBonus : 0)
        : rawScore;
    const result: MazeRunResult | undefined =
      phase === "done" && finishedAtMs !== undefined
        ? {
            timeMs,
            score,
            errors,
            noError,
            turns,
          }
        : undefined;
    return {
      phase,
      level,
      maze,
      path,
      runnerIndex,
      gates: gates.map((gate) => ({ ...gate })),
      activeGateIndex: activeGateIndex(),
      elapsedMs,
      penaltyMs,
      parMs,
      errors,
      turns,
      exitCell,
      result,
    };
  }

  /** whether the runner may step from runnerIndex to runnerIndex + 1 */
  function canAdvance(): boolean {
    const nextIndex = runnerIndex + 1;
    const nextCell = path[nextIndex];
    if (nextCell === undefined) return false;
    const blocking = gates.find(
      (gate) =>
        !gate.open && gate.cell.x === nextCell.x && gate.cell.y === nextCell.y,
    );
    return blocking === undefined; //a closed gate blocks stepping onto it
  }

  function tick(nowMs: number): MazeRunnerState {
    if (phase !== "running") return snapshot(nowMs);
    if (lastTickAt !== undefined) {
      walkCarry += Math.max(0, nowMs - lastTickAt);
    }
    lastTickAt = nowMs;
    while (walkCarry >= BALANCE.walkMsPerCell) {
      if (!canAdvance()) {
        //H4: a gate blocks the step — the runner WAITS at the gate. The
        //carry caps at one cell's worth so the blocked seconds never pile
        //up into a burst of teleport steps when the gate opens
        walkCarry = BALANCE.walkMsPerCell;
        break;
      }
      walkCarry -= BALANCE.walkMsPerCell;
      runnerIndex += 1;
      if (runnerIndex >= path.length - 1) {
        runnerIndex = path.length - 1;
        finish(nowMs);
        break;
      }
    }
    elapsedMs = nowMs; //the clock is relative: nowMs = ms since run start
    return snapshot(nowMs);
  }

  function feedKey(ch: string, nowMs: number): MazeRunnerState {
    if (phase !== "running") return snapshot(nowMs);
    if (ch.length !== 1) return snapshot(nowMs);
    const gate = gates[activeGateIndex()];
    if (gate === undefined) return snapshot(nowMs);
    const expected = gate.word[gate.typed]?.toLowerCase();
    if (expected !== ch.toLowerCase()) {
      //a wrong key: the penalty only — the partial is PRESERVED (§۰.۵)
      errors += 1;
      penaltyMs += BALANCE.errorPenaltyMs;
      return snapshot(nowMs);
    }
    gate.typed += 1;
    if (gate.typed >= gate.word.length) {
      gate.open = true;
      gate.typed = 0;
      //H4: the walk RESTARTS at the open moment — the blocked time and
      //the typing time must not pile into the carry as a teleport burst
      lastTickAt = nowMs;
      walkCarry = 0;
    }
    return snapshot(nowMs);
  }

  return {
    state: () => snapshot(lastTickAt ?? 0),
    tick,
    feedKey,
  };
}
