/**
 * Wordle engine (idea G4, phase 1): pure daily-wordle logic for Persian and
 * English. No fetching, no storage — the page feeds the word lists (filtered
 * and intersected by computeWordlePools) and persists via wordle-store.ts.
 *
 * The answer pick is a deterministic hash of the calendar day key + language
 * over the SORTED answer pool, so every installation gets the same word per
 * day per language and the pick is stable across module reloads.
 */

export type LetterState = "green" | "yellow" | "gray";

export type LetterResult = {
  letter: string;
  state: LetterState;
};

export type WordlePools = {
  /** the day's answer pool: common 5-letter words that are also guessable */
  answers: string[];
  /** every acceptable 5-letter guess */
  validGuesses: string[];
};

const ZWNJ = "\u200C";
const WORDLE_LENGTH = 5;

/** strips the joiners/formatting a keyboard may add, then lowercases */
export function normalizeGuess(raw: string): string {
  return raw.replaceAll(ZWNJ, "").replaceAll("-", "").trim().toLowerCase();
}

/** letters only: ZWNJ, hyphens and digits are excluded (the doc's isalpha) */
export function isAlphaWord(word: string): boolean {
  return [...word].every((ch) => /[آ-یa-zA-Z]/.test(ch));
}

/** keeps 5-letter alpha words */
export function len5(words: string[]): string[] {
  return words.filter(
    (word) => word.length === WORDLE_LENGTH && isAlphaWord(word),
  );
}

/**
 * The doc's fairness rule: answers = len5(common 5k) ∩ len5(valid list) —
 * the answer is always guessable. Both pools come out sorted (the stable
 * order pickAnswer hashes into).
 */
export function computeWordlePools(
  wordsCommon: string[],
  wordsValid: string[],
): WordlePools {
  const valid = new Set(len5(wordsValid));
  const validGuesses = [...valid].sort();
  const answers = [...new Set(len5(wordsCommon))]
    .filter((word) => valid.has(word))
    .sort();
  return { answers, validGuesses };
}

/** a deterministic string hash (the fork's 31-based LCG-seed family) */
export function hashSeed(text: string): number {
  let hash = 7;
  for (const ch of text) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647;
  }
  return hash;
}

/** the day's answer: hash(dayKey + lang) into the sorted pool */
export function pickAnswer(
  answers: string[],
  dayKey: string,
  lang: string,
): string | undefined {
  if (answers.length === 0) return undefined;
  return answers[hashSeed(`${dayKey}:${lang}`) % answers.length];
}

/**
 * The official two-pass grade, duplicate-safe: pass 1 lands the position
 * matches (greens) and consumes them from the answer's letter counts; pass
 * 2 walks the leftovers and marks yellow while the answer still has that
 * letter left, gray otherwise. One algorithm for both languages.
 */
export function gradeGuess(answer: string, guess: string): LetterResult[] {
  const pool = new Map<string, number>();
  for (const ch of answer) pool.set(ch, (pool.get(ch) ?? 0) + 1);

  const result: LetterResult[] = [];
  const pending: number[] = [];
  for (let i = 0; i < guess.length; i++) {
    const letter = guess[i] ?? "";
    if (answer[i] === letter) {
      result.push({ letter, state: "green" });
      pool.set(letter, (pool.get(letter) ?? 0) - 1);
    } else {
      result.push({ letter, state: "gray" }); //provisional until pass 2
      pending.push(i);
    }
  }
  for (const i of pending) {
    const letter = guess[i] ?? "";
    const left = pool.get(letter) ?? 0;
    if (left > 0) {
      result[i] = { letter, state: "yellow" };
      pool.set(letter, left - 1);
    }
  }
  return result;
}

/** a guess is valid when the normalized form is 5 letters in the valid list */
export function isValidGuess(guess: string, validSet: Set<string>): boolean {
  const normalized = normalizeGuess(guess);
  return normalized.length === WORDLE_LENGTH && validSet.has(normalized);
}

/** the shareable emoji grid + header, eg. "wordle-like #3 fa 4/6" */
export function buildShareGrid(rows: LetterResult[][], header: string): string {
  const emoji: Record<LetterState, string> = {
    green: "🟩",
    yellow: "🟨",
    gray: "⬛",
  };
  const grid = rows
    .map((row) => row.map((cell) => emoji[cell.state]).join(""))
    .join("\n");
  return `${header}\n${grid}`;
}
