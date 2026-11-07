import { createBotPacer, type BotPacer } from "./bot-pacer";

/**
 * Bot Duel engine (idea G2): a 1-vs-1 race over one shared word sequence —
 * the player types it, the bot types it at a constant nominal wpm. Pure:
 * the UI owns the typing buffer and feeds events; the engine owns the RACE
 * state (word indexes, delta, momentum, accuracy, win/lose).
 *
 * Fairness across tick granularity: the bot's crossing is judged by TIME
 * (its deterministic finishMs), not by whether a tick happened to run — a
 * player completion can never overtake a bot that crossed strictly earlier.
 * The draw is the exact-tie case (the same millisecond).
 */

export const BALANCE = {
  /** monkeytype's chars-per-word convention (wpm * 5 chars per minute) */
  charsPerWord: 5,
  /**
   * keymania momentum (idea G2): a perfect word builds one step, any wrong
   * key resets it. v1: the bonus is DISPLAY ONLY (delta prestige) — it
   * never moves the player's word index.
   */
  momentumBonusMode: "display",
  momentumStepChars: 5,
  momentumCapMult: 2, //cap = 2 x 5 = 10 bonus chars
} as const;

export type DuelPhase = "ready" | "running" | "playerWon" | "botWon" | "draw";

export type PlayerEvent =
  | { type: "char"; correct: boolean }
  | { type: "wordCompleted"; errors: number };

export type DuelState = {
  phase: DuelPhase;
  playerWordIndex: number;
  botWordIndex: number;
  /** player chars (with the display-only momentum bonus) vs the bot's */
  deltaChars: number;
  momentum: number;
  /** the race length in words */
  raceWords: number;
  /** the winner's elapsed time; undefined while the race runs */
  finishedAtMs: number | undefined;
  playerCorrectChars: number;
  playerWrongChars: number;
};

export type DuelEngine = {
  state(): DuelState;
  /** anchors the race start (leaves the ready phase); t = 0 for both sides */
  start(nowMs: number): void;
  /** re-evaluates the bot's progress (call on the 50ms UI tick) */
  tick(nowMs: number): DuelState;
  feed(event: PlayerEvent, nowMs: number): DuelState;
  /** the bot's deterministic finish time in elapsed running ms */
  botFinishMs: number;
};

export function createDuelEngine(options: {
  words: string[];
  botWpm: number;
  /** inject a custom opponent pacer (ghost-gp's curve ghost); the default
   * is the constant-rate bot pacer at botWpm */
  pacer?: BotPacer;
}): DuelEngine {
  if (options.words.length === 0) throw new Error("duel needs words");
  const pacer =
    options.pacer ??
    createBotPacer({ wpm: options.botWpm, words: options.words });
  const raceWords = options.words.length;

  let phase: DuelPhase = "ready";
  let startedAt = 0;
  let playerWordIndex = 0;
  let playerChars = 0;
  let momentum = 0;
  let correctChars = 0;
  let wrongChars = 0;
  let finishedAtMs: number | undefined;
  //the frozen bot fields of a terminal phase (set once at the finish)
  let frozen: { botWordIndex: number; deltaChars: number } | undefined;

  const momentumBonus = (): number =>
    Math.min(
      momentum * BALANCE.momentumStepChars,
      BALANCE.momentumStepChars * BALANCE.momentumCapMult,
    );

  /** a full snapshot: counters from the closures, the bot's fields live
   * while running, zero in ready, frozen once finished */
  function snapshot(nowMs: number): DuelState {
    const base = {
      phase,
      playerWordIndex,
      momentum,
      raceWords,
      finishedAtMs,
      playerCorrectChars: correctChars,
      playerWrongChars: wrongChars,
    };
    if (phase === "running") {
      const at = Math.max(0, nowMs - startedAt);
      return {
        ...base,
        botWordIndex: pacer.wordIndex(at),
        deltaChars: Math.round(
          playerChars + momentumBonus() - pacer.progressChars(at),
        ),
      };
    }
    if (phase === "ready") return { ...base, botWordIndex: 0, deltaChars: 0 };
    return {
      ...base,
      botWordIndex: frozen?.botWordIndex ?? 0,
      deltaChars: frozen?.deltaChars ?? 0,
    };
  }

  function finish(winner: "playerWon" | "botWon" | "draw", atMs: number): void {
    phase = winner;
    finishedAtMs = atMs;
    frozen = {
      botWordIndex: pacer.wordIndex(atMs),
      deltaChars: Math.round(
        playerChars + momentumBonus() - pacer.progressChars(atMs),
      ),
    };
  }

  return {
    botFinishMs: pacer.finishMs,
    state: () => snapshot(startedAt),
    start(nowMs) {
      if (phase !== "ready") return;
      startedAt = nowMs;
      phase = "running";
    },
    tick(nowMs) {
      if (phase !== "running") return snapshot(nowMs);
      const at = Math.max(0, nowMs - startedAt);
      if (at >= pacer.finishMs) finish("botWon", pacer.finishMs);
      return snapshot(nowMs);
    },
    feed(event, nowMs) {
      if (phase !== "running") return snapshot(nowMs);
      const at = Math.max(0, nowMs - startedAt);
      if (event.type === "char") {
        playerChars += 1;
        if (event.correct) {
          correctChars += 1;
        } else {
          wrongChars += 1;
          momentum = 0; //keymania: a wrong key resets the momentum (idea G2)
        }
      } else {
        playerChars += 1; //the separating space, like the bot's
        playerWordIndex += 1;
        if (event.errors === 0) momentum += 1;
        else momentum = 0;
        if (playerWordIndex >= raceWords) {
          //the finish line: the bot wins when it crossed strictly earlier,
          //the exact same millisecond is a draw
          if (at > pacer.finishMs) finish("botWon", pacer.finishMs);
          else if (at === pacer.finishMs) finish("draw", pacer.finishMs);
          else finish("playerWon", at);
        }
      }
      return snapshot(nowMs);
    },
  };
}
