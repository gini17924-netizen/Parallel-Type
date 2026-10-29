import { Language } from "@monkeytype/schemas/languages";

/**
 * Learning/progressive-mode engine (Keybr-style, fully offline).
 *
 * Tracks per-letter accuracy across drills in localStorage and gates letter
 * groups behind accuracy thresholds, Keybr-style: start with a small set of
 * letters, unlock the next group once the current set is mastered.
 */

export type KeyStat = { correct: number; incorrect: number };

export type LearnState = {
  unlockedGroups: number;
  keyStats: Record<string, KeyStat>;
};

const LEARN_STATE_KEY = "mtDesktopLearnState";

/** letter groups in teaching order (QWERTY finger progression) */
const ENGLISH_GROUPS = [
  "fj",
  "dk",
  "sl",
  "a;",
  "gh",
  "eruv",
  "iwom",
  "tyqn",
  "pbcx",
  "z",
];

/** Persian groups ordered by letter frequency in common words */
const PERSIAN_GROUPS = [
  "الا",
  "یمن",
  "وتڑ",
  "رسی",
  "حبم",
  "شک",
  "دپ",
  "طف",
  "ژذغ",
  "ضصق",
];

/** letters that must be mastered (accuracy) in the current group before
 * unlocking the next one */
const UNLOCK_ACCURACY = 0.95;
const UNLOCK_MIN_SAMPLES = 20;

/** number of drill words generated per session */
export const DRILL_WORD_COUNT = 25;

export function getLearnState(): LearnState {
  try {
    const raw = window.localStorage.getItem(LEARN_STATE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as LearnState;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof parsed.unlockedGroups === "number" &&
        typeof parsed.keyStats === "object" &&
        parsed.keyStats !== null
      ) {
        return parsed;
      }
    }
  } catch {
    // fall through to default
  }
  return { unlockedGroups: 1, keyStats: {} };
}

function saveLearnState(state: LearnState): void {
  window.localStorage.setItem(LEARN_STATE_KEY, JSON.stringify(state));
}

export function resetLearnState(): void {
  window.localStorage.removeItem(LEARN_STATE_KEY);
}

export function groupsForLanguage(language: string): string[] {
  return language.startsWith("persian") ? PERSIAN_GROUPS : ENGLISH_GROUPS;
}

export function unlockedLetters(language: string): string {
  const groups = groupsForLanguage(language);
  const state = getLearnState();
  return groups.slice(0, state.unlockedGroups).join("");
}

/** pseudo-words built from the given letters, keybr-style */
export function generatePseudoWords(letters: string, count: number): string[] {
  const words: string[] = [];
  let seed = Date.now() % 2147483647;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    const len = 3 + Math.floor(rand() * 4); //3..6
    let word = "";
    for (let j = 0; j < len; j++) {
      word += letters[Math.floor(rand() * letters.length)];
    }
    words.push(word);
  }
  return words;
}

/** real words from the language list that only contain the given letters */
export function filterRealWords(
  wordList: string[],
  letters: string,
  count: number,
): string[] {
  const allowed = new Set(letters.split(""));
  // a character counts as a "letter" if it is Latin or Arabic-script
  // (anything else — punctuation, ZWNJ, digits — is always allowed)
  const isLetterChar = (ch: string): boolean =>
    /[a-zà-ÿ؀-ۿ]/i.test(ch);
  const matches = wordList.filter(
    (word) =>
      word.length >= 2 &&
      word.length <= 8 &&
      word
        .split("")
        .every(
          (ch) => allowed.has(ch.toLowerCase()) || !isLetterChar(ch),
        ),
  );
  const out: string[] = [];
  let i = Math.floor(Math.random() * Math.max(1, matches.length));
  while (out.length < count && matches.length > 0) {
    out.push(matches[i % matches.length]);
    i += Math.floor(1 + Math.random() * 7);
  }
  return out;
}

export function generateDrillWords(
  language: string,
  letters: string,
  wordList: string[],
  count = DRILL_WORD_COUNT,
): string[] {
  const real = filterRealWords(wordList, letters, count);
  while (real.length < count) {
    real.push(...generatePseudoWords(letters, count - real.length));
  }
  return real.slice(0, count);
}

/** computes per-letter correct/incorrect by diffing expected drill words
 * against the words actually typed */
export function computeLetterStats(
  drillWords: string[],
  typedWords: string[],
): Record<string, KeyStat> {
  const stats: Record<string, KeyStat> = {};
  const bump = (letter: string, correct: boolean): void => {
    const key = letter.toLowerCase();
    if (key === " " || key === "") return;
    const stat = stats[key] ?? { correct: 0, incorrect: 0 };
    if (correct) stat.correct++;
    else stat.incorrect++;
    stats[key] = stat;
  };

  const count = Math.min(drillWords.length, typedWords.length);
  for (let w = 0; w < count; w++) {
    const expected = drillWords[w];
    const typed = typedWords[w] ?? "";
    const len = Math.max(expected.length, typed.length);
    for (let c = 0; c < len; c++) {
      const expChar = expected[c] ?? "";
      const typedChar = typed[c] ?? "";
      if (expChar === "") {
        //extra characters typed
        bump(typedChar, false);
      } else if (typedChar === expChar) {
        bump(expChar, true);
      } else {
        bump(expChar, false);
        if (typedChar !== "") bump(typedChar, false);
      }
    }
  }
  return stats;
}

export function mergeKeyStats(
  state: LearnState,
  newStats: Record<string, KeyStat>,
): LearnState {
  for (const [letter, stat] of Object.entries(newStats)) {
    const existing = state.keyStats[letter] ?? { correct: 0, incorrect: 0 };
    state.keyStats[letter] = {
      correct: existing.correct + stat.correct,
      incorrect: existing.incorrect + stat.incorrect,
    };
  }
  return state;
}

/** returns the new unlockedGroups count (or the same value if not ready) */
export function evaluateUnlock(state: LearnState, language: string): number {
  const groups = groupsForLanguage(language);
  if (state.unlockedGroups >= groups.length) return state.unlockedGroups;

  const currentLetters = groups[state.unlockedGroups - 1]?.split("") ?? [];
  const allMastered = currentLetters.every((letter) => {
    const stat = state.keyStats[letter];
    if (stat === undefined) return stat !== undefined; //not typed at all yet
    const total = stat.correct + stat.incorrect;
    return (
      total >= UNLOCK_MIN_SAMPLES &&
      stat.incorrect / total <= 1 - UNLOCK_ACCURACY
    );
  });

  if (allMastered && currentLetters.length > 0) {
    return Math.min(state.unlockedGroups + 1, groups.length);
  }
  return state.unlockedGroups;
}

/** the letters the user struggles with most (lowest accuracy, enough samples) */
export function weakLetters(n = 8): { letter: string; acc: number }[] {
  const state = getLearnState();
  return Object.entries(state.keyStats)
    .map(([letter, stat]) => ({
      letter,
      acc: stat.correct + stat.incorrect > 0
        ? stat.correct / (stat.correct + stat.incorrect)
        : 1,
      total: stat.correct + stat.incorrect,
    }))
    .filter((it) => it.total >= 10)
    .sort((a, b) => a.acc - b.acc)
    .slice(0, n)
    .map(({ letter, acc }) => ({ letter, acc }));
}

/** builds a drill from the weakest letters (real words containing them) */
export function weakLetterDrillWords(
  wordList: string[],
  n = 8,
  count = 30,
): { letters: string; words: string[] } {
  const weak = weakLetters(n);
  const letters = weak.map((it) => it.letter).join("");
  if (letters === "") return { letters: "", words: [] };
  const allowed = new Set(letters.split(""));
  const matches = wordList.filter((word) =>
    word
      .toLowerCase()
      .split("")
      .some((ch) => allowed.has(ch)),
  );
  const words: string[] = [];
  let i = 0;
  while (words.length < count && matches.length > 0) {
    words.push(matches[i % matches.length]);
    i++;
  }
  return { letters, words };
}

export async function fetchWordList(language: Language): Promise<string[]> {
  const { cachedFetchJson } = await import("../utils/json-data");
  const data = await cachedFetchJson<{ words: string[] }>(
    `/languages/${language}.json`,
  );
  return data.words;
}
