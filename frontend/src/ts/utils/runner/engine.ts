import { BALANCE } from "./balance";
import { nextObstacle, type Obstacle, type ObstacleKind } from "./gen";

/**
 * Endless Runner engine (idea G15, phase 1 — mode B): the runner moves
 * by itself; typing the nearest obstacle's word clears it (jump/slide/
 * destroy per its kind) and an obstacle that PASSES the runner untyped
 * costs one life — three hits end the run (doc §۰.B.۱). Distance is the
 * score; clean obstacles build the combo. PURE: the word source and the
 * rng are injected, the clock comes in per tick.
 */

export type RunnerPhase = "running" | "done";

export type RunnerObstacle = Obstacle & {
  /** px from the runner (positive = ahead, ≤ 0 = passing) */
  xPx: number;
  cleared: boolean;
};

export type RunnerResult = {
  distanceM: number;
  hits: number;
  bestCombo: number;
};

export type RunnerState = {
  phase: RunnerPhase;
  distancePx: number;
  speedPxPerS: number;
  obstacles: RunnerObstacle[];
  /** the nearest un-cleared obstacle ahead (the typing target) */
  activeId: number | undefined;
  word: string;
  typed: number;
  lives: number;
  hits: number;
  combo: number;
  bestCombo: number;
  result: RunnerResult | undefined;
};

export type RunnerEngine = {
  state(): RunnerState;
  tick(dtMs: number): RunnerState;
  /** one bare character against the active obstacle's word */
  feedKey(ch: string): RunnerState;
};

export function createRunnerEngine(options: {
  /** picks the obstacle word in the given length window */
  pickWord: (minLen: number, maxLen: number) => string;
  rng: () => number;
}): RunnerEngine {
  let phase: RunnerPhase = "running";
  let distancePx = 0;
  let speed: number = BALANCE.speedStartPxPerS;
  let lives = BALANCE.lives;
  let hits = 0;
  let combo = 0;
  let bestCombo = 0;
  let typed = 0;
  let nextId = 1;
  let nextSpawnPx = 200; //the first obstacle appears just ahead
  const obstacles: RunnerObstacle[] = [];
  let obstacleIndex = 0;

  function spawn(): void {
    const obstacle = nextObstacle({
      id: nextId++,
      index: obstacleIndex++,
      speedPxPerS: speed,
      rng: options.rng,
      pickWord: options.pickWord,
    });
    obstacles.push({ ...obstacle, xPx: nextSpawnPx, cleared: false });
    nextSpawnPx += obstacle.gapPx;
  }

  function activeObstacle(): RunnerObstacle | undefined {
    return obstacles.find((it) => !it.cleared && it.xPx > 0);
  }

  function snapshot(): RunnerState {
    const active = activeObstacle();
    const done = phase === "done";
    return {
      phase,
      distancePx,
      speedPxPerS: speed,
      obstacles: obstacles
        .filter((it) => it.xPx > -80 && !it.cleared)
        .map((it) => ({ ...it })),
      activeId: active?.id,
      word: active?.word ?? "",
      typed,
      lives,
      hits,
      combo,
      bestCombo,
      result: done
        ? {
            distanceM: Math.floor(distancePx / BALANCE.pxPerMeter),
            hits,
            bestCombo,
          }
        : undefined,
    };
  }

  function tick(dtMs: number): RunnerState {
    if (phase !== "running") return snapshot();
    const dt = Math.max(0, dtMs) / 1000;
    distancePx += speed * dt;
    const meters = distancePx / BALANCE.pxPerMeter;
    speed = Math.min(
      BALANCE.speedMaxPxPerS,
      BALANCE.speedStartPxPerS + (meters / 100) * BALANCE.speedGainPer100m,
    );
    //spawn the obstacles whose spawn line came into view
    while (
      nextSpawnPx - distancePx <
      BALANCE.spawnAheadPx + BALANCE.gapStartPx
    ) {
      spawn();
    }
    //the obstacles stream toward the runner
    for (const obstacle of obstacles) obstacle.xPx -= speed * dt;
    //a passed obstacle that was never cleared = one hit
    for (const obstacle of obstacles) {
      if (obstacle.cleared || obstacle.xPx > 0) continue;
      obstacle.cleared = true; //it passed
      if (partialForId === obstacle.id) {
        typed = 0;
        partialForId = undefined;
      }
      hits += 1;
      combo = 0;
      lives -= 1;
      if (lives <= 0) phase = "done";
    }
    return snapshot();
  }

  /** the id the current typing partial belongs to */
  let partialForId: number | undefined;

  function feedKey(ch: string): RunnerState {
    if (phase !== "running") return snapshot();
    if (ch.length !== 1) return snapshot();
    const active = activeObstacle();
    if (active === undefined) return snapshot();
    if (partialForId !== active.id) {
      partialForId = active.id;
      typed = 0;
    }
    const expected = active.word[typed]?.toLowerCase();
    if (expected !== ch.toLowerCase()) {
      typed = 0; //the stream rule: a wrong key restarts the word
      return snapshot();
    }
    typed += 1;
    if (typed >= active.word.length) {
      active.cleared = true;
      combo += 1;
      bestCombo = Math.max(bestCombo, combo);
      typed = 0;
      partialForId = undefined;
    }
    return snapshot();
  }

  return {
    state: () => snapshot(),
    tick,
    feedKey,
  };
}

export type { ObstacleKind };
