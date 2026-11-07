import { BALANCE, comboMult, levelForScore, stageUpScore } from "./balance";

/**
 * Balloon Pop engine (idea G6, phase 1): bubbles rise from the arena
 * bottom (y = 100vh, top-based coordinates) toward the danger line
 * (y = 6vh); reaching it is an escape (a life) and breaks the combo.
 * Typing pops: stage 1 pops any single-letter balloon with that letter
 * (nearest to the top first); stages 2+ use the started-or-most-risen
 * word balloon (Word Blast's selection with the direction reversed).
 * The stage promotes at the cumulative score thresholds.
 *
 * PURE: the injected spawn callback supplies new payloads/speeds (the page
 * wires it to its spawner); dtMs scales the movement; the game never
 * writes the learn state (the doc's v1 rule).
 */

export type BalloonPhase = "running" | "done";

export type Balloon = {
  id: number;
  payload: string;
  /** top-based vh: 100 = the arena bottom, 6 = the danger line */
  y: number;
  /** rising speed, vh per second */
  speed: number;
  typed: number;
};

export type BalloonResult = {
  score: number;
  stage: number;
  level: number;
  popped: number;
  escaped: number;
  maxCombo: number;
};

export type BalloonState = {
  phase: BalloonPhase;
  score: number;
  stage: number;
  level: number;
  lives: number;
  combo: number;
  maxCombo: number;
  popped: number;
  escaped: number;
  bubbles: Balloon[];
  /** the stage-up marker for the UI's banner */
  justPromoted: boolean;
  result: BalloonResult | undefined;
};

export type SpawnCallback = (
  stage: number,
  level: number,
) => {
  payload: string;
  speed: number;
};

export type BalloonEngine = {
  state(): BalloonState;
  /** advances the physics by dtMs: movement, escapes, spawns */
  tick(dtMs: number): BalloonState;
  /** feeds one typed key (a character; the engine handles the matching) */
  feedKey(key: string): BalloonState;
  /** pauses/resumes on window blur (anti unfair-death, per the doc) */
  setPaused(paused: boolean): void;
  isPaused(): boolean;
};

export function createBalloonEngine(options: {
  spawn: SpawnCallback;
  letters: string[];
  startStage?: number;
  lives?: number;
}): BalloonEngine {
  let phase: BalloonPhase = "running";
  let score = 0;
  let stage = Math.min(Math.max(options.startStage ?? 1, 1), 4) as
    | 1
    | 2
    | 3
    | 4;
  let lives = options.lives ?? BALANCE.startLives;
  let combo = 0;
  let maxCombo = 0;
  let popped = 0;
  let escaped = 0;
  let paused = false;
  let nextId = 1;
  let spawnAcc = 0;

  const bubbles: Balloon[] = [];

  function level(): number {
    return levelForScore(score);
  }

  function spawnInterval(): number {
    return Math.max(
      400,
      (BALANCE.stageSpawnMs[stage - 1] ?? BALANCE.stageSpawnMs[0]) -
        (level() - 1) * BALANCE.spawnLevelStepMs,
    );
  }

  function spawnOne(): void {
    const spawned = options.spawn(stage, level());
    bubbles.push({
      id: nextId++,
      payload: spawned.payload,
      y: BALANCE.arenaBottomVh,
      speed: spawned.speed,
      typed: 0,
    });
  }

  function snapshot(): BalloonState {
    return {
      phase,
      score,
      stage,
      level: level(),
      lives,
      combo,
      maxCombo,
      popped,
      escaped,
      bubbles: [...bubbles],
      justPromoted: false,
      result: phase === "done" ? finishResult() : undefined,
    };
  }

  function finishResult(): BalloonResult {
    return {
      score,
      stage,
      level: level(),
      popped,
      escaped,
      maxCombo,
    };
  }

  function popBalloon(balloon: Balloon): void {
    const index = bubbles.findIndex((b) => b.id === balloon.id);
    if (index === -1) return;
    bubbles.splice(index, 1);
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    popped += 1;
    const stageBonus = (stage - 1) * BALANCE.stageBonus;
    score += Math.round(
      balloon.payload.length * 10 * comboMult(combo) + stageBonus,
    );
    //stage promotion: every stageClearScore cumulative points
    while (stage < 4 && score >= stageUpScore(stage)) {
      stage = (stage + 1) as 2 | 3 | 4;
    }
  }

  function breakCombo(): void {
    combo = 0;
  }

  spawnOne();

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running" || paused) return snapshot();
      const seconds = dtMs / 1000;
      //movement: bubbles rise (y decreases); escapes at the danger line
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const balloon = bubbles[i];
        if (balloon === undefined) continue;
        balloon.y -= balloon.speed * seconds;
        if (balloon.y <= BALANCE.dangerLineVh) {
          bubbles.splice(i, 1);
          escaped += 1;
          breakCombo();
          lives -= 1;
        }
      }
      if (lives <= 0) {
        lives = 0;
        phase = "done";
        return snapshot();
      }
      //spawning on the stage's cadence (shrinking with the level), holding
      //when the field is full so an emptied field doesn't burst-spawn
      spawnAcc += dtMs;
      const interval = spawnInterval();
      while (spawnAcc >= interval && bubbles.length < 8) {
        spawnAcc -= interval;
        spawnOne();
      }
      if (bubbles.length >= 8) spawnAcc = 0;
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running" || paused) return snapshot();
      const lower = key.toLowerCase();
      if (lower.length !== 1) return snapshot();

      if (stage === 1) {
        //single letters: any balloon with the letter pops, nearest to the
        //top (the smallest y) first
        const candidates = bubbles.filter((b) => b.payload === lower);
        if (candidates.length === 0) {
          breakCombo();
          return snapshot();
        }
        candidates.sort((a, b) => a.y - b.y);
        popBalloon(candidates[0] as Balloon);
        return snapshot();
      }

      //stages 2+: the started balloon first, else the most-risen one
      let target = bubbles.find((b) => b.typed > 0);
      target ??= [...bubbles].sort((a, b) => a.y - b.y)[0];
      if (target === undefined) return snapshot();
      const expected = target.payload[target.typed]?.toLowerCase();
      if (expected !== lower) {
        breakCombo();
        return snapshot();
      }
      target.typed += 1;
      if (target.typed >= target.payload.length) {
        popBalloon(target);
      }
      return snapshot();
    },
    setPaused(value) {
      paused = value;
    },
    isPaused: () => paused,
  };
}
