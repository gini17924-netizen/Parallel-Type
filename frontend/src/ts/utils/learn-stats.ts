import { Language } from "@monkeytype/schemas/languages";
import { LEARN_STATE_KEY } from "./local-persistence";
import { loadKeybrLetterStats } from "./keybr-letter-stats";

/**
 * Learning/progressive-mode engine (Keybr-style, fully offline).
 *
 * Tracks per-letter accuracy across drills in localStorage and gates letter
 * groups behind accuracy thresholds, Keybr-style: start with a small set of
 * letters, unlock the next group once the current set is mastered.
 */

export type KeyStat = { correct: number; incorrect: number };

/** spaced-review schedule of one letter (SM-2 lite) */
export type LetterReview = {
  /** last drill that contained the letter (epoch ms) */
  lastSeen: number;
  /** current review interval; 0 = due immediately */
  intervalMs: number;
  /** when the letter should be reviewed again (epoch ms) */
  dueAt: number;
};

export type LearnState = {
  unlockedGroups: number;
  keyStats: Record<string, KeyStat>;
  /** spaced-review schedules; absent in pre-0.10.0 states */
  reviewState?: Record<string, LetterReview>;
};

/**
 * Curated common Persian words for the early layout groups, where the real
 * language list has almost no coverage (measured against persian_1k: groups
 * 1-4 match 0/4/17/39 words). Indexed by the group that unlocks the word's
 * last letter; a word becomes available once all its letters are unlocked.
 * Groups 6+ rely on the language list alone.
 */
const PERSIAN_STARTER_WORDS: string[][] = [
  ["بت", "تب"],
  ["بین", "بن", "بیت"],
  ["نیست", "بیست", "سمت", "نسبت", "من"],
  ["یک", "شب", "کم", "کمی", "کن", "کمک", "ممکن", "بیش", "شکست", "سنگ", "کسی"],
  [
    "سال",
    "سلام",
    "تمام",
    "نام",
    "بالا",
    "است",
    "اما",
    "با",
    "ما",
    "این",
    "نشان",
    "شکل",
    "ماشین",
    "انسان",
    "کامل",
    "میان",
  ],
];

/** the curated starter words whose letters are all currently unlocked */
function starterWordsFor(unlocked: string): string[] {
  const allowed = new Set(unlocked.split(""));
  return PERSIAN_STARTER_WORDS.flat().filter((word) =>
    [...word].every((ch) => allowed.has(ch)),
  );
}

/** letter groups in teaching order (QWERTY finger progression) */
export const ENGLISH_GROUPS = [
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

/**
 * Persian groups in touch-typing teaching order, mirroring the English
 * progression (home row outward, one finger column at a time) on the
 * "persian standard" layout (static/layouts/persian_standard.json):
 * home row = ش س ی ب ل ا ت ن م ک گ, top = ض ص ث ق ف غ ع ه خ ح ج چ,
 * bottom = ظ ط ز ژ ر ذ د پ و . /
 * This front-loads the most frequent Persian letters, which sit on the
 * home row (ا ل ی م ن ب ت س ش ک گ). All Persian letters are covered
 * exactly once — the 32-letter alphabet plus آ (the shifted form), no
 * letters from other scripts.
 */
export const PERSIAN_GROUPS = [
  "بت", // index-finger home keys (f/j equivalents)
  "ین", // middle-finger home keys (d/k)
  "سم", // ring-finger home keys (s/l)
  "شگک", // pinky home keys (a/;) + گ (right pinky home)
  "لا", // index stretch (g/h) — home row complete
  "قفرژ", // left index: top (ق ف) + bottom (ژ ر)
  "غعذ", // right index: top (غ ع) + bottom (ذ)
  "هدو", // right-hand lower reach: ه (top), د و (bottom)
  "ثز", // left middle: top (ث) + bottom (ز)
  "خپ", // right ring: top (خ) + bottom (پ)
  "صط", // left ring: top (ص) + bottom (ط)
  "حجچ", // right pinky top (ح ج چ)
  "ضظ", // left pinky: top (ض) + bottom (ظ)
  "آ", // shifted key (Shift+ا), taught last
];

/** letters that must be mastered (accuracy) in the current group before
 * unlocking the next one */
const UNLOCK_ACCURACY = 0.95;
const UNLOCK_MIN_SAMPLES = 20;

/** number of drill words generated per session */
export const DRILL_WORD_COUNT = 25;

export type RowDrill = { label: string; letters: string };

/** QWERTY rows/hands for latin languages */
const QWERTY_ROW_DRILLS: RowDrill[] = [
  { label: "number row", letters: "1234567890" },
  { label: "top row", letters: "qwertyuiop" },
  { label: "home row", letters: "asdfghjkl" },
  { label: "bottom row", letters: "zxcvbnm" },
  { label: "left hand", letters: "qwertasdfgzxcvb" },
  { label: "right hand", letters: "yuiophjklnm" },
];

/**
 * Rows/hands of the Persian standard layout (static/layouts/persian_standard.json):
 * top = ضصثقفغعهخحجچ, home = شیبلاتنمکگ, bottom = ظطزژردپو.
 * Left hand = the keys under the left fingers (pinky ض ش ظ, ring ص س ط,
 * middle ث ی ز, index ق ف ب ل ژ ر), right hand = the rest (through گ و چ).
 */
const PERSIAN_ROW_DRILLS: RowDrill[] = [
  { label: "number row", letters: "۱۲۳۴۵۶۷۸۹۰" },
  { label: "top row", letters: "ضصثقفغعهخحجچ" },
  { label: "home row", letters: "شیبلاتنمکگ" },
  { label: "bottom row", letters: "ظطزژردپو" },
  { label: "left hand", letters: "ضشظصسطثیزقفبلژر" },
  { label: "right hand", letters: "غعاتذهندمخپحجچوکگ" },
];

/** row/hand drills for the active language: QWERTY for latin, the Persian
 * standard layout rows for persian languages */
export function rowDrillsForLanguage(language: string): RowDrill[] {
  return language.startsWith("persian")
    ? PERSIAN_ROW_DRILLS
    : QWERTY_ROW_DRILLS;
}

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
        //reviewState is optional (pre-0.10.0 states lack it)
        parsed.reviewState ??= {};
        return parsed;
      }
    }
  } catch {
    // fall through to default
  }
  return { unlockedGroups: 1, keyStats: {}, reviewState: {} };
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

/**
 * pseudo-words built from the given letters, keybr-style. When reference
 * words are available, letter transitions follow the language's own bigram
 * frequencies (restricted to the allowed letters), which produces
 * pronounceable strings instead of uniform letter soup. Letters in
 * `emphasizeLetters` (the group currently being learned) are sampled about
 * three times as often. Falls back to uniform sampling without references.
 */
export function generatePseudoWords(
  letters: string,
  count: number,
  referenceWords: string[] = [],
  emphasizeLetters = "",
): string[] {
  const words: string[] = [];
  let seed = Date.now() % 2147483647;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const allowed = letters.split("");
  const emphasize = new Set(emphasizeLetters.split(""));

  //weighted pick: base frequency × boost for currently-learned letters
  const pick = (pool: string[], weight: (letter: string) => number): string => {
    const total = pool.reduce((sum, letter) => sum + weight(letter), 0);
    if (total <= 0) {
      return pool[Math.floor(rand() * pool.length)] ?? "";
    }
    let roll = rand() * total;
    for (const letter of pool) {
      roll -= weight(letter);
      if (roll <= 0) return letter;
    }
    return pool[pool.length - 1] ?? "";
  };
  const boosted = (letter: string, base: number): number =>
    emphasize.has(letter) ? base * 3 : base;

  //bigram model from reference words restricted to the allowed letters
  const starts = new Map<string, number>();
  const transitions = new Map<string, Map<string, number>>();
  for (const raw of referenceWords) {
    const word = raw.toLowerCase();
    if (word.length < 2 || word.length > 12) continue;
    if (![...word].every((ch) => allowed.includes(ch))) continue;
    const first = word[0];
    if (first === undefined) continue;
    starts.set(first, (starts.get(first) ?? 0) + 1);
    for (let i = 0; i < word.length - 1; i++) {
      const from = word[i];
      const to = word[i + 1];
      if (from === undefined || to === undefined) continue;
      let row = transitions.get(from);
      if (row === undefined) {
        row = new Map();
        transitions.set(from, row);
      }
      row.set(to, (row.get(to) ?? 0) + 1);
    }
  }

  for (let i = 0; i < count; i++) {
    const len = 3 + Math.floor(rand() * 4); //3..6
    let word = pick(allowed, (letter) =>
      boosted(letter, starts.get(letter) ?? 1),
    );
    for (let j = 1; j < len; j++) {
      const last = word[word.length - 1] ?? "";
      const row = transitions.get(last);
      if (row === undefined || row.size === 0) {
        word += pick(allowed, (letter) => boosted(letter, 1));
      } else {
        word += pick([...row.keys()], (letter) =>
          boosted(letter, row.get(letter) ?? 1),
        );
      }
    }
    words.push(word);
  }
  return words;
}

/** picks `count` words, favouring words that exercise the emphasized
 * (currently learned) letters roughly two drills out of three */
function prioritizeWords(
  words: string[],
  emphasizeLetters: string,
  count: number,
): string[] {
  if (emphasizeLetters === "" || words.length === 0) {
    return words.slice(0, count);
  }
  const emphasize = new Set(emphasizeLetters.split(""));
  const withEmphasis: string[] = [];
  const rest: string[] = [];
  for (const word of words) {
    if (word.split("").some((ch) => emphasize.has(ch))) {
      withEmphasis.push(word);
    } else {
      rest.push(word);
    }
  }
  const out: string[] = [];
  let e = 0;
  let r = 0;
  while (out.length < count) {
    const nextEmphasis = withEmphasis[e];
    const nextRest = rest[r];
    if (nextEmphasis === undefined && nextRest === undefined) break;
    const takeEmphasis =
      nextEmphasis !== undefined &&
      (nextRest === undefined || out.length % 3 !== 2);
    if (takeEmphasis) {
      out.push(nextEmphasis);
      e++;
    } else if (nextRest !== undefined) {
      out.push(nextRest);
      r++;
    }
  }
  return out;
}

export function generateDrillWords(
  language: string,
  letters: string,
  wordList: string[],
  count = DRILL_WORD_COUNT,
  emphasizeLetters = "",
): string[] {
  //oversample real matches so emphasis-aware selection still fills the drill
  const real = filterRealWords(wordList, letters, count * 3);
  //curated Persian starters first: early groups have almost no real coverage
  //(multiplicity of `real` is intentional — it fills the drill)
  const candidates = [...starterWordsFor(letters), ...real];
  const chosen = prioritizeWords(candidates, emphasizeLetters, count);
  while (chosen.length < count) {
    chosen.push(
      ...generatePseudoWords(
        letters,
        count - chosen.length,
        wordList,
        emphasizeLetters,
      ),
    );
  }
  return chosen.slice(0, count);
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
  const isLetterChar = (ch: string): boolean => /[a-zà-ÿ؀-ۿ]/i.test(ch);
  const matches = wordList.filter(
    (word) =>
      word.length >= 2 &&
      word.length <= 8 &&
      word
        .split("")
        .every((ch) => allowed.has(ch.toLowerCase()) || !isLetterChar(ch)),
  );
  const out: string[] = [];
  let i = Math.floor(Math.random() * Math.max(1, matches.length));
  while (out.length < count && matches.length > 0) {
    const word = matches[i % matches.length];
    if (word === undefined) break;
    out.push(word);
    i += Math.floor(1 + Math.random() * 7);
  }
  return out;
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
    const expected = drillWords[w] ?? "";
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
    if (stat === undefined) return false; //not typed at all yet
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

/** the letters the user struggles with most (lowest accuracy, enough samples).
 * V3 of the keybr port: the keybr engine's per-character histograms merge in
 * read-only (keybr-letter-stats.ts) — the learn state itself stays
 * monkeytype-driven, so review scheduling and unlock gating are unchanged. */
export function weakLetters(n = 8): { letter: string; acc: number }[] {
  const state = getLearnState();
  const combined: Record<string, { correct: number; incorrect: number }> = {
    ...state.keyStats,
  };
  for (const [letter, stat] of Object.entries(loadKeybrLetterStats())) {
    const existing = combined[letter] ?? { correct: 0, incorrect: 0 };
    combined[letter] = {
      correct: existing.correct + stat.correct,
      incorrect: existing.incorrect + stat.incorrect,
    };
  }
  return Object.entries(combined)
    .map(([letter, stat]) => ({
      letter,
      acc:
        stat.correct + stat.incorrect > 0
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
    const word = matches[i % matches.length];
    if (word === undefined) break;
    words.push(word);
    i++;
  }
  return { letters, words };
}

// ---------------------------------------------------------------------------
// drill registration (the learning feedback loop)
// ---------------------------------------------------------------------------

/** words of the drill currently in progress — set when a learn drill starts,
 * consumed when its test finishes. A test started outside a learn drill
 * discards the stored words so foreign results never pollute the stats. */
let activeDrillWords: string[] | undefined;

export function setActiveDrillWords(words: string[]): void {
  activeDrillWords = [...words];
}

/** consumes the active drill words (clears them); undefined when no drill
 * was started or the words were already consumed. */
export function takeActiveDrillWords(): string[] | undefined {
  const words = activeDrillWords;
  activeDrillWords = undefined;
  return words;
}

/** spaced-review intervals: an error puts the letter back to due-now, a
 * fully correct appearance doubles the interval, capped at 30 days */
const REVIEW_START_INTERVAL_MS = 86_400_000; //1 day
const REVIEW_MAX_INTERVAL_MS = 30 * 86_400_000;

/**
 * Registers a finished drill: merges the per-letter stats of this attempt
 * into the persisted learn state, updates the spaced-review schedule and
 * evaluates the unlock threshold. Returns the updated state (also what is
 * persisted).
 */
export function registerDrillResult(
  drillWords: string[],
  typedWords: string[],
  language: string,
): LearnState {
  const state = getLearnState();
  const newStats = computeLetterStats(drillWords, typedWords);
  mergeKeyStats(state, newStats);
  updateReviewSchedule(state, newStats);
  state.unlockedGroups = evaluateUnlock(state, language);
  saveLearnState(state);
  return state;
}

/** SM-2 lite: letters typed without error double their review interval
 * (starting at 1 day, capped at 30); any error resets them to due-now. */
function updateReviewSchedule(
  state: LearnState,
  newStats: Record<string, KeyStat>,
): void {
  state.reviewState ??= {};
  const now = Date.now();
  for (const [letter, stat] of Object.entries(newStats)) {
    const previous = state.reviewState[letter];
    const clean = stat.incorrect === 0 && stat.correct > 0;
    const previousInterval = previous?.intervalMs ?? 0;
    const intervalMs = clean
      ? Math.min(
          (previousInterval > 0 ? previousInterval : REVIEW_START_INTERVAL_MS) *
            2,
          REVIEW_MAX_INTERVAL_MS,
        )
      : 0;
    state.reviewState[letter] = {
      lastSeen: now,
      intervalMs,
      dueAt: now + intervalMs,
    };
  }
}

/** letters that are due for review: never-reviewed, overdue, or reset by a
 * recent error — weakest accuracy first. Enough samples only: brand-new
 * letters are the learn drill's job (it emphasises them already). */
export function rustyLetters(n = 8): { letter: string; acc: number }[] {
  const state = getLearnState();
  const now = Date.now();
  return Object.entries(state.keyStats)
    .map(([letter, stat]) => {
      const review = state.reviewState?.[letter];
      const total = stat.correct + stat.incorrect;
      return {
        letter,
        acc: total > 0 ? stat.correct / total : 1,
        total,
        due: review === undefined || review.dueAt <= now,
      };
    })
    .filter((it) => it.due && it.total >= 10)
    .sort((a, b) => a.acc - b.acc)
    .slice(0, n)
    .map(({ letter, acc }) => ({ letter, acc }));
}

/** Enables the on-screen keyboard during learning drills (nosave): the
 * keymap highlights the next key, matching the finger-guidance recommendation
 * from the research. Returns the previous mode so it can be restored. */
export function enableDrillKeymap(): string {
  const previous = /"keymapMode":"([a-z]+)"/.exec(
    window.localStorage.getItem("config") ?? "",
  )?.[1];
  return previous ?? "off";
}

export async function fetchWordList(language: Language): Promise<string[]> {
  const { cachedFetchJson } = await import("../utils/json-data");
  const data = await cachedFetchJson<{ words: string[] }>(
    `/languages/${language}.json`,
  );
  return data.words;
}
