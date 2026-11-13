/*
 * The specialized persian drills (phase 69): two word generators built
 * by definition — the ZWNJ drill compounds real morphemes into
 * half-space forms, the punctuation drill attaches persian punctuation
 * to word-pool tokens. Both are PURE (every random choice flows from
 * the injected seed, the smart-drill contract) and both are unregistered
 * pattern practice (like row drills — no SM-2 review schedule).
 *
 * The ZWNJ drill is also the phase-68 strip's one exception: its whole
 * point is typing ZWNJ, so its targets must keep the soft characters
 * the generator would otherwise remove (the words-generator checks the
 * custom-text indicator against ZWNJ_DRILL_NAME).
 */
import { LCG } from "@keybr/rand";

export const ZWNJ_DRILL_NAME = "ZWNJ drill";
export const PERSIAN_PUNCTUATION_DRILL_NAME = "punctuation drill";
export const PERSIAN_DRILL_WORD_COUNT = 25;
/** the ZWNJ character itself — spelled out so the drills stay readable */
export const ZWNJ = "\u200c";

const VERB_STEMS = ["رو", "خور", "بین", "خوان", "نو", "دان", "ساز", "کش"];
const PERSONAL_ENDINGS = ["م", "ی", "د", "یم", "ید", "ند"];
const VERB_PREFIXES = ["می", "نمی"];
const NOUNS = [
  "کتاب",
  "خانه",
  "گل",
  "شهر",
  "دست",
  "چشم",
  "روز",
  "باغ",
  "دوست",
  "مدرسه",
];
const NOUN_SUFFIXES = ["ها", "های", "ان", "ام", "هایم"];
const SUPERLATIVE_ADJECTIVES = ["بزرگ", "کوچک", "خوب", "زیبا", "ساده"];

/**
 * ZWNJ drill words: valid persian compounds joined with the half-space —
 * prefixed verbs (می‌روم، نمی‌خواند), noun suffixes (کتاب‌ها، خانه‌های)
 * and superlatives (بزرگ‌ترین).
 */
export function buildZwnjDrillWords(
  count = PERSIAN_DRILL_WORD_COUNT,
  seed = Date.now(),
): string[] {
  const rng = LCG(seed);
  const words = new Set<string>();
  //the seeded rng may cycle within a branch — cap the attempts so a
  //degenerate cycle can never spin forever (the punctuation guard rule)
  let attempts = 0;
  while (words.size < count && attempts < count * 100) {
    attempts++;
    const kind = Math.floor(rng() * 3);
    if (kind === 0) {
      const prefix = VERB_PREFIXES[Math.floor(rng() * VERB_PREFIXES.length)] as string;
      const stem = VERB_STEMS[Math.floor(rng() * VERB_STEMS.length)] as string;
      const ending =
        PERSONAL_ENDINGS[Math.floor(rng() * PERSONAL_ENDINGS.length)] as string;
      words.add(`${prefix}${ZWNJ}${stem}${ending}`);
    } else if (kind === 1) {
      const noun = NOUNS[Math.floor(rng() * NOUNS.length)] as string;
      const suffix =
        NOUN_SUFFIXES[Math.floor(rng() * NOUN_SUFFIXES.length)] as string;
      words.add(`${noun}${ZWNJ}${suffix}`);
    } else {
      const adjective =
        SUPERLATIVE_ADJECTIVES[
          Math.floor(rng() * SUPERLATIVE_ADJECTIVES.length)
        ] as string;
      words.add(`${adjective}${ZWNJ}ترین`);
    }
  }
  return [...words].slice(0, count);
}

/** the persian punctuation the drill practices: five trailing marks plus
 * the «» wrap pair (which produces ONE token shape per word, not two) */
export const TRAILING_MARKS = ["،", "؛", "؟", "!", ":"] as const;
export const PERSIAN_PUNCTUATION = [...TRAILING_MARKS, "«", "»"] as const;

/**
 * Punctuation drill words: word-pool tokens carrying persian
 * punctuation — trailing ، ؛ ؟ ! : or wrapped in «». Falls back to the
 * built-in noun pool when no word list is available.
 */
export function buildPersianPunctuationDrillWords(
  count = PERSIAN_DRILL_WORD_COUNT,
  seed = Date.now(),
  wordPool: string[] = [],
): string[] {
  const rng = LCG(seed);
  //the effective pool falls back to the built-in nouns — the unique-token
  //budget below must use ITS size, not the (possibly empty) wordPool
  const pool =
    wordPool.length > 0
      ? wordPool.filter((word) => word.trim() !== "")
      : NOUNS;
  const effective = pool.length > 0 ? pool : NOUNS;
  const pick = (): string =>
    (effective[Math.floor(rng() * effective.length)] as string).trim();
  const words: string[] = [];
  const seen = new Set<string>();
  //a tiny pool cannot fill the count with unique tokens — stop when the
  //combination space is exhausted instead of looping forever. shapes:
  //five trailing marks plus the «…» wrap (both guillemets make the same
  //shape), so the space is effective-pool-size x 6
  const maxUnique = effective.length * (TRAILING_MARKS.length + 1);
  while (words.length < count && seen.size < maxUnique) {
    const word = pick();
    const kind = Math.floor(rng() * PERSIAN_PUNCTUATION.length);
    const mark = PERSIAN_PUNCTUATION[kind] as string;
    const token = mark === "«" || mark === "»" ? `«${word}»` : `${word}${mark}`;
    if (seen.has(token)) continue;
    seen.add(token);
    words.push(token);
  }
  return words;
}
