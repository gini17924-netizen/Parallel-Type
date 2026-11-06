import { wordScore } from "./scoring";
import type { WordSource } from "./words-source";

/**
 * Deck Runner blind round engine (idea G24) — a typing round with a SCORE
 * QUOTA and a WORD BUDGET (word budget replaces a timer: deterministic and
 * testable; an optional timer is v2).
 *
 * Events: a committed word is either an exact match (correct — combo grows,
 * scored) or not (errors counted; combo resets, unless the boss freezes it).
 * Skip: the word is dropped WITHOUT breaking the combo, but it burns budget.
 *
 * Boss rules mutate the round:
 * - longWords: word source minimum length is raised (the caller creates the
 *   source with effectiveWordLengths)
 * - errorPenalty: a word with errors subtracts `chips` from the round score
 *   (floored at 0)
 * - perfectComboOnly: an imperfect commit FREEZES the combo instead of
 *   resetting it (growth still requires a perfect word)
 */

export type BossRule =
  | { kind: "longWords"; minLength: number }
  | { kind: "errorPenalty"; chips: number }
  | { kind: "perfectComboOnly" };

export type BlindConfig = {
  quota: number;
  wordBudget: number;
  wordSourceId: string;
  isBoss: boolean;
  bossRule?: BossRule;
};

export type WordEvent = {
  word: string;
  typed: string;
  correct: boolean;
  accuracy: number;
  chars: number;
  errors: number;
  skipped: boolean;
  elapsedMs: number;
  comboBefore: number;
};

export type RoundState = {
  score: number;
  wordsLeft: number;
  combo: number;
  events: WordEvent[];
  finished: boolean;
  won: boolean;
  /** the word awaiting input (unchanged once finished) */
  currentWord: string;
  /** correctly typed characters of the current word (idea G24 phase 3) */
  buffer: string;
  /** mistyped keystrokes on the current word (combo breaks happen per key) */
  errorsThisWord: number;
};

export const GOLD_BASE = 3;
export const GOLD_BOSS = 5;

export function effectiveWordLengths(config: BlindConfig): {
  minLength: number;
  maxLength: number;
} {
  const boss = config.bossRule;
  const minLength = boss?.kind === "longWords" ? boss.minLength : undefined;
  return { minLength: minLength ?? 3, maxLength: 10 };
}

export function startRound(
  config: BlindConfig,
  source: WordSource,
): RoundState {
  return {
    score: 0,
    wordsLeft: config.wordBudget,
    combo: 0,
    events: [],
    finished: false,
    won: false,
    currentWord: source.nextWord(),
    buffer: "",
    errorsThisWord: 0,
  };
}

function diffChars(
  expected: string,
  typed: string,
): { correct: number; errors: number } {
  const length = Math.max(expected.length, typed.length);
  let correct = 0;
  let errors = 0;
  for (let i = 0; i < length; i++) {
    const expChar = expected[i] ?? "";
    const typedChar = typed[i] ?? "";
    if (expChar === "" && typedChar === "") continue;
    if (typedChar === "" || expChar === "") {
      errors++;
      continue;
    }
    if (typedChar === expChar) correct++;
    else errors++;
  }
  return { correct, errors };
}

export type WordInput = {
  typed?: string;
  skipped?: boolean;
  elapsedMs?: number;
};

export function submitWord(
  state: RoundState,
  config: BlindConfig,
  source: WordSource,
  input: WordInput,
): RoundState {
  if (state.finished) return state;
  const word = state.currentWord;
  let score = state.score;
  let combo = state.combo;
  let evt: WordEvent;

  if (input.skipped === true) {
    //skip: budget burns, combo survives (penalising it would be unfair)
    evt = {
      word,
      typed: "",
      correct: false,
      accuracy: 0,
      chars: word.length,
      errors: 0,
      skipped: true,
      elapsedMs: input.elapsedMs ?? 0,
      comboBefore: combo,
    };
  } else {
    //a non-skip submit without typed text counts as an empty commit
    const typed = input.typed ?? "";
    const { correct: correctChars, errors } = diffChars(word, typed);
    const correct = typed === word;
    const attempts = correctChars + errors;
    const accuracy = attempts > 0 ? correctChars / attempts : 1;
    const perfectOnly =
      config.isBoss && config.bossRule?.kind === "perfectComboOnly";
    const comboAfter = correct
      ? combo + 1
      : perfectOnly
        ? combo //freeze instead of reset (boss rule)
        : 0;
    evt = {
      word,
      typed,
      correct,
      accuracy,
      chars: word.length,
      errors,
      skipped: false,
      elapsedMs: input.elapsedMs ?? 0,
      comboBefore: combo,
    };
    combo = comboAfter;
    const { total } = wordScore(evt, {
      combo: comboAfter,
      sourceId: config.wordSourceId,
    });
    score += total;
    if (errors > 0 && config.bossRule?.kind === "errorPenalty") {
      score = Math.max(0, score - config.bossRule.chips);
    }
  }

  const wordsLeft = state.wordsLeft - 1;
  const won = score >= config.quota;
  const finished = won || wordsLeft <= 0;
  return {
    score,
    wordsLeft,
    combo,
    events: [...state.events, evt],
    finished,
    won,
    currentWord: finished ? state.currentWord : source.nextWord(),
    buffer: "",
    errorsThisWord: 0,
  };
}

/**
 * One keystroke against the current word (idea G24 phase 3): the matching
 * character grows the buffer (auto-committing the word when complete); a
 * mismatch breaks the combo immediately (accuracyShield/comboFloor honored)
 * and counts toward the word's errors. The word is scored on completion.
 */
export function typeChar(
  state: RoundState,
  config: BlindConfig,
  source: WordSource,
  char: string,
  runtime: {
    comboFloor: number;
    accuracyShield: boolean;
    goldPerWord: number;
    rewardMult: number;
  } = { comboFloor: 0, accuracyShield: false, goldPerWord: 0, rewardMult: 1 },
): RoundState {
  if (state.finished) return state;
  const expected = state.currentWord[state.buffer.length];
  if (char === expected) {
    const buffer = state.buffer + char;
    if (buffer === state.currentWord) {
      //word complete: score it (errors already broke the combo mid-word)
      const attempts = buffer.length + state.errorsThisWord;
      const evt: WordEvent = {
        word: state.currentWord,
        typed: buffer,
        correct: true,
        accuracy: attempts > 0 ? buffer.length / attempts : 1,
        chars: state.currentWord.length,
        errors: state.errorsThisWord,
        skipped: false,
        elapsedMs: 0,
        comboBefore: state.combo,
      };
      const comboAfter = state.combo + 1;
      const { total } = wordScore(evt, {
        combo: comboAfter,
        sourceId: config.wordSourceId,
      });
      let score = state.score + total;
      if (
        state.errorsThisWord > 0 &&
        config.bossRule?.kind === "errorPenalty"
      ) {
        score = Math.max(0, score - config.bossRule.chips);
      }
      const wordsLeft = state.wordsLeft - 1;
      const won = score >= config.quota;
      const finished = won || wordsLeft <= 0;
      return {
        score,
        wordsLeft,
        combo: comboAfter,
        events: [...state.events, evt],
        finished,
        won,
        currentWord: finished ? state.currentWord : source.nextWord(),
        buffer: "",
        errorsThisWord: 0,
      };
    }
    return { ...state, buffer };
  }
  //mismatch: combo breaks (shield keeps it), floor lifts it back up
  const combo = runtime.accuracyShield
    ? Math.max(state.combo, runtime.comboFloor)
    : Math.max(runtime.comboFloor, 0);
  return { ...state, combo, errorsThisWord: state.errorsThisWord + 1 };
}

/** removes the last typed character (no combo effect) */
export function backspace(state: RoundState): RoundState {
  if (state.finished || state.buffer === "") return state;
  return { ...state, buffer: state.buffer.slice(0, -1) };
}

/** gold payout for a finished round (shop economy input) */
export function goldEarned(config: BlindConfig, state: RoundState): number {
  if (!state.won) return 0;
  return config.isBoss ? GOLD_BOSS : GOLD_BASE;
}

/** skips the current word: burns budget (with a ruleSkipRefund giving some
 * back), spares the combo, pulls the next word (idea G24 phase 3) */
export function skipWord(
  state: RoundState,
  config: BlindConfig,
  source: WordSource,
  runtime: { skipRefundRatio: number } = { skipRefundRatio: 0 },
): RoundState {
  if (state.finished) return state;
  const skippedState = submitWord(state, config, source, {
    typed: "",
    skipped: true,
  });
  const refund = runtime.skipRefundRatio;
  return {
    ...skippedState,
    wordsLeft: Math.min(config.wordBudget, skippedState.wordsLeft + refund),
  };
}
