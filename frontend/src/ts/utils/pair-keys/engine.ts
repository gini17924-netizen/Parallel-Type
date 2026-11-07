import { BALANCE } from "./balance";
import {
  createBoard,
  type PairBoard,
  type PairCard,
  type PairKeysMode,
} from "./board";

/**
 * Pair Keys engine (idea G18, phase 1): the memory-game rules. The page
 * flips cards (flip), and after a mismatched pair it calls resolve()
 * once the 700ms flip-back window passes (the page owns that timer).
 * Level 1 shows every card for a preview window first — the phase
 * switches lazily off the injected clock. The clock also runs the
 * elapsed time, which starts at the FIRST flip. PURE.
 */

export type PairCardState = "down" | "up" | "matched";

export type PairKeysResult = {
  score: number;
  moves: number;
  elapsedMs: number;
  perfect: boolean;
};

export type PairKeysState = {
  phase: "preview" | "playing" | "done";
  mode: PairKeysMode;
  pairs: number;
  /** one entry per card: its face state (the face data lives in board) */
  faces: PairCardState[];
  /** the indexes currently up (0, 1 or 2 while a mismatch pends) */
  open: number[];
  moves: number;
  matched: number;
  score: number;
  elapsedMs: number;
  perfect: boolean;
  result: PairKeysResult | undefined;
};

export type PairKeysEngine = {
  state(): PairKeysState;
  /** the grid data (stable for the whole run) */
  board(): PairBoard;
  /** flips a card; ignored while previewing/finished/pending mismatch */
  flip(index: number): PairKeysState;
  /** the page calls this after the 700ms mismatch flip-back */
  resolve(): PairKeysState;
};

export function createPairKeysEngine(options: {
  mode: PairKeysMode;
  /** the candidate letters (learn groups / weak letters, read-only) */
  letters: string[];
  pairs?: number;
  /** the level-1 whole-grid preview; 0 = no preview (level 2) */
  previewMs?: number;
  rng: () => number;
  /** the deterministic clock in ms */
  now: () => number;
}): PairKeysEngine {
  const board = createBoard({
    mode: options.mode,
    pairs: options.pairs,
    letters: options.letters,
    rng: options.rng,
  });
  const pairs = board.pairs;
  const previewMs = options.previewMs ?? 0;
  const faces: PairCardState[] = board.cards.map(
    () => (previewMs > 0 ? "up" : "down"), //level 1 shows the whole grid first
  );
  let phase: PairKeysState["phase"] = previewMs > 0 ? "preview" : "playing";
  let open: number[] = [];
  let moves = 0;
  let matched = 0;
  let score = 0;
  let startedAt: number | undefined;
  const previewUntil = options.now() + previewMs;

  const elapsed = (): number =>
    startedAt === undefined ? 0 : Math.max(0, options.now() - startedAt);

  /** the lazy preview → playing transition (doc §۱.۴: level 1 previews) */
  function settlePreview(): void {
    if (phase !== "preview") return;
    if (options.now() >= previewUntil) {
      phase = "playing";
      for (let i = 0; i < faces.length; i++) faces[i] = "down";
    }
  }

  function finish(): void {
    if (matched < pairs) return;
    const perfect = moves === pairs;
    score = perfect ? score * BALANCE.perfectBonus : score;
    phase = "done";
  }

  function snapshot(): PairKeysState {
    settlePreview();
    const done = matched >= pairs;
    return {
      phase: done ? "done" : phase,
      mode: options.mode,
      pairs,
      faces: [...faces],
      open: [...open],
      moves,
      matched,
      score,
      elapsedMs: elapsed(),
      perfect: done ? moves === pairs : false,
      result:
        done && phase !== "preview"
          ? { score, moves, elapsedMs: elapsed(), perfect: moves === pairs }
          : undefined,
    };
  }

  function doMatch(first: number, second: number): void {
    faces[first] = "matched";
    faces[second] = "matched";
    matched += 1;
    const extraMoves = Math.max(0, moves - matched);
    score += Math.max(
      BALANCE.pairFloor,
      BALANCE.pairBase - extraMoves * BALANCE.extraMovePenalty,
    );
    open = [];
    finish();
  }

  function flip(index: number): PairKeysState {
    settlePreview();
    if (phase !== "playing") return snapshot();
    const card = board.cards[index];
    if (card === undefined) return snapshot();
    if (faces[index] !== "down") return snapshot(); //matched or already up
    if (open.length >= 2) return snapshot(); //a mismatch pends — resolve first
    if (startedAt === undefined) startedAt = options.now();
    faces[index] = "up";
    open = [...open, index];
    if (open.length === 2) {
      moves += 1;
      const [first, second] = open as [number, number];
      const a = board.cards[first];
      const b = board.cards[second];
      if (
        a !== undefined &&
        b !== undefined &&
        a.baseLetter === b.baseLetter &&
        (options.mode === "letter" || a.kind !== b.kind)
      ) {
        doMatch(first, second);
      }
    }
    return snapshot();
  }

  function resolve(): PairKeysState {
    settlePreview();
    if (open.length < 2) return snapshot();
    for (const index of open) {
      if (faces[index] === "up") faces[index] = "down";
    }
    open = [];
    return snapshot();
  }

  return {
    state: () => snapshot(),
    board: () => board,
    flip,
    resolve,
  };
}
