import { BALANCE } from "./balance";
import { stepBall, type Ball } from "./ball";

/**
 * Brick Breaker engine (idea G13, phase 1, mode B): a wall of bricks
 * (5x8) each carrying a word; the ball launches up from the paddle and
 * bounces (AABB brick collisions chip the hp); typing the ACTIVE brick's
 * word (the lowest alive brick — word-first nearest the paddle) breaks
 * it instantly for len x 20. The ball past the floor costs a life (3);
 * clearing every brick wins. The paddle moves by typing (the pong lerp).
 *
 * PURE: the injected nextWord callback supplies the brick words; the rng
 * is injected for the serve angle and the bounce jitter.
 */

export type BreakerPhase = "running" | "won" | "lost";

export type Brick = {
  row: number;
  col: number;
  word: string;
  typed: number;
  hp: number;
  alive: boolean;
};

export type BreakerResult = {
  won: boolean;
  score: number;
  lives: number;
  bricksBroken: number;
};

export type BreakerState = {
  phase: BreakerPhase;
  bricks: Brick[];
  ball: Ball;
  playerX: number;
  activeBrickIdx: number | undefined;
  activeWord: string | undefined;
  activeTyped: number;
  /** aliases for the shared word-display component */
  word: string | undefined;
  typed: number;
  lives: number;
  score: number;
  bricksBroken: number;
  elapsedMs: number;
  result: BreakerResult | undefined;
};

export type BreakerEngine = {
  state(): BreakerState;
  tick(dtMs: number): BreakerState;
  feedKey(key: string): BreakerState;
};

/** the brick layout: rows occupy the top ~40% of the court */
export function brickRect(
  row: number,
  col: number,
): { x: number; y: number; w: number; h: number } {
  const w = BALANCE.courtW / BALANCE.breakerCols;
  const h = 12;
  return { x: col * w, y: row * h, w, h };
}

export function createBreakerEngine(options: {
  nextWord: () => string;
  rng: () => number;
  lives?: number;
}): BreakerEngine {
  let lives = options.lives ?? BALANCE.breakerLives;
  const rng = options.rng;
  let phase: BreakerPhase = "running";
  let score = 0;
  let bricksBroken = 0;
  let playerX = 50;
  let elapsedMs = 0;
  let rageAcc = 0;
  let ball: Ball = { x: 50, y: 90, vx: 0, vy: 0 };

  const bricks: Brick[] = [];
  for (let row = 0; row < BALANCE.breakerRows; row++) {
    for (let col = 0; col < BALANCE.breakerCols; col++) {
      const word = options.nextWord();
      //longer words = tougher bricks (2 hp)
      bricks.push({
        row,
        col,
        word,
        typed: 0,
        hp: word.length >= 6 ? BALANCE.breakerBrickHp : 1,
        alive: true,
      });
    }
  }

  function aliveBricks(): Brick[] {
    return bricks.filter((b) => b.alive);
  }

  /** the active brick: the lowest alive brick (the largest row = closest
   * to the paddle — word-first nearest, doc G16 phasing §C.۵) */
  function selectActive(): Brick | undefined {
    let best: Brick | undefined;
    for (const brick of aliveBricks()) {
      if (best === undefined || brick.row > best.row) best = brick;
    }
    return best;
  }

  function serve(): void {
    ball = {
      x: playerX,
      y: 90,
      vx: (rng() < 0.5 ? -1 : 1) * (20 + rng() * 20),
      vy: -(50 + rng() * 20), //always launches upward
    };
  }

  serve();

  function breakBrick(brick: Brick): void {
    brick.alive = false;
    bricksBroken += 1;
    score += brick.word.length * BALANCE.breakerScorePerChar;
    if (aliveBricks().length === 0) {
      phase = "won";
    }
  }

  function finish(lost: boolean): BreakerState {
    phase = lost ? "lost" : "won";
    return snapshot();
  }

  function snapshot(): BreakerState {
    const active = phase === "running" ? selectActive() : undefined;
    return {
      phase,
      bricks: bricks.map((b) => ({ ...b })),
      ball: { ...ball },
      playerX,
      activeBrickIdx: active === undefined ? undefined : bricks.indexOf(active),
      activeWord: active?.word,
      activeTyped: active?.typed ?? 0,
      //aliases for the shared word-display component (the page renders
      //both modes through the same WordDisplay)
      word: active?.word,
      typed: active?.typed ?? 0,
      lives: Math.max(0, lives),
      score,
      bricksBroken,
      elapsedMs,
      result:
        phase === "running"
          ? undefined
          : {
              won: phase === "won",
              score,
              lives: Math.max(0, lives),
              bricksBroken,
            },
    };
  }

  function brickAtPoint(x: number, y: number): Brick | undefined {
    for (const brick of aliveBricks()) {
      const rect = brickRect(brick.row, brick.col);
      if (
        x >= rect.x &&
        x <= rect.x + rect.w &&
        y >= rect.y &&
        y <= rect.y + rect.h
      ) {
        return brick;
      }
    }
    return undefined;
  }

  return {
    state: () => snapshot(),
    tick(dtMs) {
      if (phase !== "running") return snapshot();
      elapsedMs += dtMs;
      const seconds = dtMs / 1000;
      //the rage: the ball speeds up 8% every 15 seconds (doc G13 §۰.B.۲)
      rageAcc += dtMs;
      while (rageAcc >= 15000) {
        rageAcc -= 15000;
        ball.vx *= 1.08;
        ball.vy *= 1.08;
      }
      stepBall(ball, seconds, rng);
      //the brick collisions (AABB: the ball's center inside the rect)
      const hit = brickAtPoint(ball.x, ball.y);
      if (hit !== undefined) {
        hit.hp -= 1;
        if (hit.hp <= 0) {
          breakBrick(hit);
        }
        ball.vy = Math.abs(ball.vy); //bounce downward off the brick
      }
      //the floor: the ball past the bottom costs a life
      if (ball.y > BALANCE.courtH + 5) {
        lives -= 1;
        if (lives <= 0) {
          return finish(true); //lost
        }
        serve(); //re-launch from the paddle
      }
      //the win: every brick broken
      if (aliveBricks().length === 0) {
        return finish(false);
      }
      return snapshot();
    },
    feedKey(key) {
      if (phase !== "running") return snapshot();
      if (key.length !== 1) return snapshot();
      const ch = key.toLowerCase();
      const active = selectActive();
      if (active === undefined) return snapshot();
      const expected = active.word[active.typed]?.toLowerCase();
      if (expected !== ch) return snapshot(); //inert: the paddle stalls
      active.typed += 1;
      //the paddle pulls toward the ball (the pong lerp)
      const progress = Math.min(
        1,
        active.typed / Math.max(1, active.word.length),
      );
      playerX =
        playerX + (ball.x - playerX) * progress * BALANCE.paddlePullPerChar;
      if (active.typed >= active.word.length) {
        breakBrick(active);
      }
      return snapshot();
    },
  };
}
