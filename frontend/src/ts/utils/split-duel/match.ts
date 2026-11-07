import { BALANCE } from "./balance";
import {
  createStreamEngine,
  type StreamEngine,
  type StreamState,
} from "./engine";
import { sideOf } from "./sides";

/**
 * Split-Key Showdown match (idea G19, phase 1): the two-player state
 * machine over two independent stream engines (doc §۰).
 *
 * Mode A (turn-based): player 1 types the whole shared stream, then the
 * match parks in "turn-swap" until the page confirms player 2, who types
 * the SAME sequence; the lower time wins (accuracy tiebreak).
 * Mode B (simultaneous): keydowns route per SIDE — the left half feeds
 * player 1's engine, the right half player 2's; both run the same word
 * sequence; the first to finish wins. Modifiers never reach here (the
 * page filters to bare characters).
 *
 * PURE: every timing call takes an injected nowMs.
 */

export type DuelMode = "turn" | "simultaneous";

export type MatchPhase = "countdown" | "running" | "turn-swap" | "result";

export type PlayerSlot = 1 | 2;

export type MatchResult = {
  /** 0 = the exact tie */
  winnerSlot: 0 | 1 | 2;
  p1Ms: number;
  p2Ms: number;
  p1Acc: number;
  p2Acc: number;
  marginMs: number;
};

export type SplitDuelState = {
  phase: MatchPhase;
  mode: DuelMode;
  names: [string, string];
  /** turn mode only: whose turn it is */
  activeSlot: PlayerSlot | undefined;
  countdownEndsAtMs: number | undefined;
  players: Record<PlayerSlot, StreamState>;
  result: MatchResult | undefined;
};

export type SplitDuelMatch = {
  state(): SplitDuelState;
  /** arms the shared countdown (doc §۰.B.۵) */
  startCountdown(nowMs: number): SplitDuelState;
  /** leaves the countdown once it has elapsed (turn mode: slot 1) */
  begin(nowMs: number): SplitDuelState;
  /** turn mode only: the page's "P2 ready" confirmation — starts P2's
   * fresh run at the confirmation moment */
  swapTo(second: 2, nowMs: number): SplitDuelState;
  /** one bare character, routed per mode (doc §۰) */
  feedKey(ch: string, code: string, nowMs: number): SplitDuelState;
};

export function createSplitDuelMatch(options: {
  mode: DuelMode;
  words: string[];
  names?: [string, string];
}): SplitDuelMatch {
  const words = options.words;
  if (words.length === 0) throw new Error("split-duel needs words");
  const names: [string, string] = options.names ?? ["P1", "P2"];
  const engines: Record<PlayerSlot, StreamEngine> = {
    1: createStreamEngine({ words }),
    2: createStreamEngine({ words }),
  };
  let phase: MatchPhase = "countdown";
  let activeSlot: PlayerSlot | undefined =
    options.mode === "turn" ? 1 : undefined;
  let countdownEndsAtMs: number | undefined;
  const finishedMs: Partial<Record<PlayerSlot, number>> = {};

  function snapshot(): SplitDuelState {
    return {
      phase,
      mode: options.mode,
      names,
      activeSlot,
      countdownEndsAtMs,
      players: { 1: engines[1].state(), 2: engines[2].state() },
      result: buildResult(),
    };
  }

  function startCountdown(nowMs: number): SplitDuelState {
    if (phase !== "countdown") return snapshot();
    countdownEndsAtMs = nowMs + BALANCE.countdownMs;
    return snapshot();
  }

  function begin(nowMs: number): SplitDuelState {
    if (phase !== "countdown") return snapshot();
    if (countdownEndsAtMs === undefined || nowMs < countdownEndsAtMs) {
      return snapshot(); //the countdown gates the start
    }
    phase = "running";
    if (options.mode === "simultaneous") {
      engines[1].start(nowMs);
      engines[2].start(nowMs);
    } else {
      engines[activeSlot ?? 1].start(nowMs);
    }
    return snapshot();
  }

  function swapTo(second: 2, nowMs: number): SplitDuelState {
    if (options.mode !== "turn") return snapshot();
    if (phase !== "turn-swap") return snapshot();
    activeSlot = second;
    phase = "running";
    engines[second].start(nowMs); //P2's clock starts at the confirmation
    return snapshot();
  }

  function buildResult(): MatchResult | undefined {
    const p1 = finishedMs[1];
    const p2 = finishedMs[2];
    if (p1 === undefined || p2 === undefined) return undefined;
    const acc1 = engines[1].state().acc;
    const acc2 = engines[2].state().acc;
    let winnerSlot: 0 | 1 | 2;
    if (p1 < p2) winnerSlot = 1;
    else if (p2 < p1) winnerSlot = 2;
    else if (acc1 > acc2) winnerSlot = 1; //the accuracy tiebreak (§۰.A.۱)
    else if (acc2 > acc1) winnerSlot = 2;
    else winnerSlot = 0;
    return {
      winnerSlot,
      p1Ms: p1,
      p2Ms: p2,
      p1Acc: acc1,
      p2Acc: acc2,
      marginMs: Math.abs(p1 - p2),
    };
  }

  function settle(nowMs: number): void {
    //a finished engine freezes its own time; the match reacts to both
    for (const slot of [1, 2] as const) {
      const state = engines[slot].state();
      if (state.phase === "done" && finishedMs[slot] === undefined) {
        finishedMs[slot] = state.elapsedMs;
      }
    }
    if (options.mode === "turn" && phase === "running") {
      const active = activeSlot ?? 1;
      if (finishedMs[active] !== undefined) {
        if (active === 1 && finishedMs[2] === undefined) {
          phase = "turn-swap"; //P1's round is over — P2 confirms next
        } else {
          phase = "result";
        }
      }
    } else if (options.mode === "simultaneous" && phase === "running") {
      if (finishedMs[1] !== undefined && finishedMs[2] !== undefined) {
        phase = "result";
      }
    }
    void nowMs;
  }

  function feedKey(ch: string, code: string, nowMs: number): SplitDuelState {
    if (phase !== "running") return snapshot();
    if (ch.length !== 1) return snapshot();
    if (options.mode === "turn") {
      engines[activeSlot ?? 1].feedKey(ch, nowMs);
    } else {
      const side = sideOf(code);
      if (side === "left") engines[1].feedKey(ch, nowMs);
      else if (side === "right") engines[2].feedKey(ch, nowMs);
      //sideless codes are ignored in simultaneous mode
    }
    settle(nowMs);
    return snapshot();
  }

  return {
    state: () => snapshot(),
    startCountdown,
    begin,
    swapTo,
    feedKey,
  };
}
