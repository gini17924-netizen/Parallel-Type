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
  };
}

/** gold payout for a finished round (shop economy input) */
export function goldEarned(config: BlindConfig, state: RoundState): number {
  if (!state.won) return 0;
  return config.isBoss ? GOLD_BOSS : GOLD_BASE;
}
