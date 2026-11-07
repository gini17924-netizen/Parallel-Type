import { BALANCE } from "./balance";
import { capSpeed, enforceMinVx, stepBall, type Ball } from "./ball";

/**
 * Type Pong match engine (idea G13, phase 1, mode A): the player's
 * paddle ONLY moves when typing — each correct char pulls it halfway
 * toward the ball's live x (the doc's lerp-by-progress); completing the
 * word snaps it onto the ball and issues the next word. The AI paddle
 * tracks the ball at a tier-capped speed (1 wpm = 1 unit/s). The ball
 * bounces off the paddles (+8% speed, capped); passing a paddle scores
 * for the other side; first to 5 wins (doc G13 §۰.A).
 *
 * PURE: the injected nextWord callback supplies the words; the rng is
 * injected for the serves and the bounce jitter.
 */

export type PongPhase = "running" | "done";

export type PongWinner = "player" | "ai";

export type PongResult = {
  winner: PongWinner;
  playerScore: number;
  aiScore: number;
  bestRally: number;
};

export type PongState = {
  phase: PongPhase;
  playerScore: number;
  aiScore: number;
  ball: Ball;
  playerX: number;
  aiX: number;
  word: string;
  typed: number;
  rally: number;
  bestRally: number;
  winner: PongWinner | undefined;
  result: PongResult | undefined;
};

export type PongEngine = {
  state(): PongState;
  /** the ball + the AI paddle */
  tick(dtMs: number): PongState;
  /** a letter: pulls the paddle toward the ball, completes = a snap */
  feedKey(key: string): PongState;
};

export function createPongEngine(options: {
  nextWord: () => string;
  rng: () => number;
  /** the AI paddle's tracking speed in units/sec (the tier wpm) */
  aiSpeed?: number;
  targetScore?: number;
}): PongEngine {
  const targetScore = options.targetScore ?? BALANCE.targetScore;
  const aiSpeed = options.aiSpeed ?? 60; //the 60wpm tier default
  const paddleHalf = BALANCE.paddleW / 2;
  const rng = options.rng;
  let phase: PongPhase = "running";
  let playerScore = 0;
  let aiScore = 0;
  let rally = 0;
  let bestRally = 0;
  let winner: PongWinner | undefined;
  let ball: Ball = { x: 50, y: 50, vx: 0, vy: 0 };
  let playerX = 50;
  let aiX = 50;
  //serve() issues the first word — do NOT consume one here (the double
  //nextWord shifted the stream by one and the serve's word never matched)
  let word = "";
  let typed = 0;
  let wordStartX = 50;

  function serve(): void {
    ball = {
      x: 50,
      y: 50,
      vx:
        (rng() < 0.5 ? -1 : 1) *
        (BALANCE.serveVxMin +
          rng() * (BALANCE.serveVxMax - BALANCE.serveVxMin)),
      vy:
        (rng() < 0.5 ? -1 : 1) *
        (BALANCE.serveVyMin +
          rng() * (BALANCE.serveVyMax - BALANCE.serveVyMin)),
    };
    enforceMinVx(ball);
    capSpeed(ball);
    word = options.nextWord();
    typed = 0;
    wordStartX = playerX;
    rally = 0;
  }

  serve();

  function playerPaddleX(): number {
    const progress = Math.min(1, typed / Math.max(1, word.length));
    return wordStartX + (ball.x - wordStartX) * progress;
  }

  function bouncePlayer(): void {
    //the offset angle: hitting with the paddle's edge angles the ball
    const offset = (ball.x - playerX) / paddleHalf;
    ball.vy = -Math.abs(ball.vy);
    ball.vx = ball.vx + offset * 20;
    enforceMinVx(ball);
    capSpeed(ball);
    rally += 1;
  }

  function bounceAi(): void {
    const offset = (ball.x - aiX) / paddleHalf;
    ball.vy = Math.abs(ball.vy);
    ball.vx = ball.vx + offset * 20;
    enforceMinVx(ball);
    capSpeed(ball);
  }

  function scorePlayer(): void {
    playerScore += 1;
    rally = 0;
    if (playerScore >= targetScore) {
      winner = "player";
      phase = "done";
      return; //the serve would overwrite the done state
    }
    serve();
  }

  function scoreAi(): void {
    aiScore += 1;
    rally = 0;
    if (aiScore >= targetScore) {
      winner = "ai";
      phase = "done";
      return; //the serve would overwrite the done state
    }
    serve();
  }

  return {
    state: () => ({
      phase,
      playerScore,
      aiScore,
      ball: { ...ball },
      playerX,
      aiX,
      word,
      typed,
      rally,
      bestRally,
      winner,
      result:
        phase === "done" && winner !== undefined
          ? { winner, playerScore, aiScore, bestRally }
          : undefined,
    }),
    tick(dtMs) {
      if (phase !== "running") return this.state();
      const seconds = dtMs / 1000;
      stepBall(ball, seconds, rng);
      //the AI paddle tracks the ball at its capped speed
      if (aiX < ball.x) aiX = Math.min(ball.x, aiX + aiSpeed * seconds);
      else if (aiX > ball.x) aiX = Math.max(ball.x, aiX - aiSpeed * seconds);
      aiX = Math.max(paddleHalf, Math.min(BALANCE.courtW - paddleHalf, aiX));
      //the player's paddle zone: y >= the zone line
      if (ball.y >= BALANCE.playerZoneY) {
        if (Math.abs(ball.x - playerX) <= paddleHalf) {
          bouncePlayer();
          bestRally = Math.max(bestRally, rally);
          ball.y = BALANCE.playerZoneY - 0.5;
        } else if (ball.y >= BALANCE.courtH + 3) {
          scoreAi(); //passed the paddle
        }
      }
      //the AI's paddle zone: y <= the zone line
      if (phase === "running" && ball.y <= BALANCE.aiZoneY) {
        if (Math.abs(ball.x - aiX) <= paddleHalf) {
          bounceAi();
          ball.y = BALANCE.aiZoneY + 0.5;
        } else if (ball.y <= -3) {
          scorePlayer(); //the AI missed
        }
      }
      return this.state();
    },
    feedKey(key) {
      if (phase !== "running") return this.state();
      if (key.length !== 1) return this.state();
      const ch = key.toLowerCase();
      const expected = word[typed]?.toLowerCase();
      if (expected !== ch) return this.state(); //inert: the paddle stalls
      typed += 1;
      //each correct char pulls the paddle toward the ball's live x
      playerX = playerPaddleX();
      if (typed >= word.length) {
        playerX = ball.x; //the word complete: snapped onto the ball
        word = options.nextWord();
        typed = 0;
        wordStartX = playerX;
      }
      return this.state();
    },
  };
}
