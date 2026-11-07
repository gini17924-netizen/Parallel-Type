import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/maze-runner/balance";
import {
  createMazeRunnerEngine,
  type MazeRunnerEngine,
} from "../../../src/ts/utils/maze-runner/engine";

const WORDS = [
  "cat",
  "sun",
  "map",
  "fox",
  "day",
  "ring",
  "mesh",
  "task",
  "wolf",
  "pine",
  "gust",
  "clay",
];

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function makeEngine(seed = 7): { engine: MazeRunnerEngine; t: { v: number } } {
  const engine = createMazeRunnerEngine({
    level: 1,
    words: WORDS,
    rng: makeRng(seed),
  });
  return { engine, t: { v: 0 } };
}

/** walks the runner forward to its blocking gate (or the exit) */
function walkToGate(engine: MazeRunnerEngine, t: { v: number }): void {
  let guard = 0;
  while (engine.state().phase === "running" && guard++ < 400) {
    t.v += 50;
    engine.tick(t.v);
    const state = engine.state();
    const active = state.activeGateIndex;
    if (active !== -1) {
      const gate = state.gates[active];
      const onNext = state.path[state.runnerIndex + 1];
      if (
        gate !== undefined &&
        onNext !== undefined &&
        gate.cell.x === onNext.x &&
        gate.cell.y === onNext.y
      ) {
        return; //blocked by the next gate
      }
    }
  }
}

/** types the active gate's word cleanly */
function openActiveGate(engine: MazeRunnerEngine, t: { v: number }): void {
  const state = engine.state();
  const gate = state.gates[state.activeGateIndex];
  if (gate === undefined) return;
  for (const ch of gate.word) {
    t.v += 30;
    engine.feedKey(ch, t.v);
  }
}

function runToExit(engine: MazeRunnerEngine, t: { v: number }): void {
  let guard = 0;
  while (engine.state().phase === "running" && guard++ < 400) {
    walkToGate(engine, t);
    if (engine.state().phase !== "running") break;
    openActiveGate(engine, t);
    engine.tick((t.v += 50));
  }
}

describe("maze-runner engine (idea G14 phase 1)", () => {
  it("the level builds with gates on the path and a par budget", () => {
    const { engine } = makeEngine();
    const state = engine.state();
    expect(state.level).toBe(1);
    expect(state.maze.cols).toBe(15);
    expect(state.path.length).toBeGreaterThan(15);
    expect(state.gates.length).toBeGreaterThan(2);
    expect(state.parMs).toBeGreaterThan(0);
    for (const gate of state.gates) {
      expect(gate.word.length).toBeGreaterThanOrEqual(3);
      expect(gate.open).toBe(false);
    }
  });

  it("the runner auto-walks until a closed gate blocks it", () => {
    const { engine, t } = makeEngine();
    walkToGate(engine, t);
    const state = engine.state();
    const gate = state.gates[state.activeGateIndex];
    expect(gate).toBeDefined();
    const next = state.path[state.runnerIndex + 1];
    expect(gate?.cell.x).toBe(next?.x);
    expect(gate?.cell.y).toBe(next?.y);
    expect(state.elapsedMs).toBeGreaterThan(0);
  });

  it("typing the gate's word opens it and the walk resumes", () => {
    const { engine, t } = makeEngine();
    walkToGate(engine, t);
    const before = engine.state().runnerIndex;
    openActiveGate(engine, t);
    expect(engine.state().gates[engine.state().activeGateIndex - 1]?.open).toBe(
      true,
    );
    t.v += 200;
    engine.tick(t.v);
    expect(engine.state().runnerIndex).toBeGreaterThan(before);
  });

  it("a wrong key keeps the partial and adds the penalty", () => {
    const { engine, t } = makeEngine();
    walkToGate(engine, t);
    const gate = engine.state().gates[engine.state().activeGateIndex];
    const word = gate?.word ?? "cat";
    t.v += 30;
    engine.feedKey(word[0] ?? "c", t.v);
    t.v += 30;
    engine.feedKey("z", t.v); //wrong
    const state = engine.state();
    expect(state.errors).toBe(1);
    expect(state.penaltyMs).toBe(BALANCE.errorPenaltyMs);
    expect(state.gates[state.activeGateIndex]?.typed).toBe(1); //partial kept
  });

  it("a clean full run scores par×2 minus the time plus the bonus", () => {
    const { engine, t } = makeEngine();
    runToExit(engine, t);
    const state = engine.state();
    const result = state.result;
    expect(state.phase).toBe("done");
    expect(result).toBeDefined();
    expect(result?.errors).toBe(0);
    expect(result?.noError).toBe(true);
    const timeMs = result?.timeMs ?? 0;
    const expected =
      Math.max(0, state.parMs * 2 - timeMs) + BALANCE.noErrorBonus;
    expect(result?.score).toBe(expected);
    expect(state.runnerIndex).toBe(state.path.length - 1);
  });

  it("a slow run floors the score at zero (no bonus on errors)", () => {
    const { engine, t } = makeEngine();
    //run with errors AND burn far past 2×par before the exit
    let guard = 0;
    while (engine.state().phase === "running" && guard++ < 400) {
      walkToGate(engine, t);
      if (engine.state().phase !== "running") break;
      //idle at the gate burns real time on the relative clock
      t.v += 4000;
      engine.tick(t.v);
      //two wrong keys per gate: +400ms penalty
      engine.feedKey("z", (t.v += 30));
      engine.feedKey("z", (t.v += 30));
      openActiveGate(engine, t);
      engine.tick((t.v += 50));
    }
    const state = engine.state();
    expect(state.phase).toBe("done");
    expect(state.result?.noError).toBe(false);
    //~7 gates × 4s idle + 400ms walk steps + penalties ≫ 2×par
    expect(state.result?.score).toBe(0);
  });

  it("the snapshot hands out fresh gate copies (the KI-34 lesson)", () => {
    const { engine } = makeEngine();
    const a = engine.state().gates;
    const b = engine.state().gates;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
