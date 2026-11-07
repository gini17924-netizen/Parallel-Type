/**
 * Type Pong balance (idea G13, phase 1): every tunable in one file —
 * both modes (pong + the C.5 breaker) share this file; nothing else
 * hardcodes values.
 */

export const BALANCE = {
  /** the court: 100 x 100 percentage units, y grows downward */
  courtW: 100,
  courtH: 100,
  /** the paddles' width (percentage units) and their y zones */
  paddleW: 20,
  playerZoneY: 97,
  aiZoneY: 3,
  /** the ball: the launch speed, +8% per paddle hit, the cap */
  ballSpeedStart: 60,
  ballSpeedPerHitMult: 1.08,
  ballSpeedMax: 160,
  /** the serve angles: enforce a minimum |vx| so the ball never walls
   * itself into an infinite vertical ping-pong; the bounce jitter +-2% */
  serveVxMin: 15,
  serveVxMax: 40,
  serveVyMin: 40,
  serveVyMax: 60,
  minAbsVx: 15,
  bounceJitter: 0.02,
  /** the AI paddle: the tracking speed in court-units per second,
   * derived from the tier wpm (1 wpm = 1 unit/s on the 100-wide court) */
  aiSpeedPerWpm: 1,
  /** the paddle lerp: each correct char pulls the paddle this fraction
   * of the remaining distance to the ball's live x */
  paddlePullPerChar: 0.5,
  /** the match: first to this score wins (doc G13 §۰.A.۳) */
  targetScore: 5,
  /** the breaker mode (C.5): 5 rows x 8 cols of bricks, 3 lives */
  breakerRows: 5,
  breakerCols: 8,
  breakerLives: 3,
  breakerBrickHp: 2,
  breakerScorePerChar: 20,
  breakerPaddleScore: 5,
} as const;
