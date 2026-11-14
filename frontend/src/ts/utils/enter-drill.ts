/**
 * Enter-key drill generator (idea #9) — flat token arrays where ONLY the
 * last token of each line ends with "\n" (the engine's upstream newline
 * support does the rest: input gating, commit parsing, the ↵ glyph, the
 * real line break, and the automatic Shift+Enter quick-restart shift).
 *
 * Token contracts (all load-bearing, see the idea spec):
 * - no token ever contains a space (the separator IS the surface/newline)
 * - "\n" only at the END of a token, never in the middle (getCustomText
 *   splits on spaces only - a mid-token newline would break the diff)
 * - at most MAX_CUSTOM_TEXT_TOKENS tokens total (custom mode cap)
 * - the last line's Enter is stripped by the engine (the test's final word
 *   is commit-free) - accepted, documented behavior
 *
 * Deterministic: all randomness flows from the explicit seed.
 */

export type EnterDrillStyle = "prose" | "code" | "chat";

/** custom mode rejects more tokens (words-generator cap) */
const MAX_CUSTOM_TEXT_TOKENS = 100;

/** LCG matching learn-stats' bigram generator (deterministic, seedable) */
function makeRand(seed: number): () => number {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return (): number => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

const pick = (pool: string[], rand: () => number): string =>
  pool[Math.floor(rand() * pool.length) % pool.length] ?? "";

/** small built-in fallback pool so the drill works even without a loaded
 * language list (the UI passes the fetched word list when available) */
const FALLBACK_WORDS = [
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "and",
  "then",
  "rests",
  "a",
  "bit",
  "type",
  "these",
  "words",
  "line",
  "by",
  "line",
  "enter",
  "after",
  "each",
];

const CODE_TOKENS = [
  "if",
  "(x)",
  "{",
  "}",
  "return;",
  "const",
  "value",
  "=",
  "x+1;",
  "for",
  "(i)",
  "in",
  "range",
  "print",
  "else",
  "null",
  "true",
  "arr.push(x);",
  "while",
  "break;",
];

export function generateEnterDrillWords(
  style: EnterDrillStyle,
  wordList: string[],
  lines = 25,
  seed = Date.now(),
): string[] {
  const rand = makeRand(seed);
  const tokens: string[] = [];
  const words = wordList.length > 0 ? wordList : FALLBACK_WORDS;
  //prose/chat words must be single tokens (no internal spaces)
  const cleanWords = words.filter((w) => w.length > 0 && !w.includes(" "));
  const budget = Math.min(MAX_CUSTOM_TEXT_TOKENS, lines * 5);

  let line = 0;
  while (line < lines && tokens.length < budget) {
    let lineTokens: string[] = [];
    switch (style) {
      case "prose": {
        const length = 4 + Math.floor(rand() * 3); //4..6
        lineTokens = Array.from({ length }, () => pick(cleanWords, rand));
        break;
      }
      case "chat": {
        const length = 2 + Math.floor(rand() * 3); //2..4
        lineTokens = Array.from({ length }, () => pick(cleanWords, rand));
        //a chat line often ends with ? or !
        if (rand() < 0.6) {
          const last = lineTokens[lineTokens.length - 1];
          if (last !== undefined) {
            lineTokens[lineTokens.length - 1] =
              last + (rand() < 0.5 ? "؟" : "!");
          }
        }
        break;
      }
      case "code": {
        const length = 3 + Math.floor(rand() * 3); //3..5
        lineTokens = Array.from({ length }, () => pick(CODE_TOKENS, rand));
        break;
      }
    }
    //append the newline commit character to the LAST token of the line
    const lastIndex = lineTokens.length - 1;
    lineTokens = lineTokens.map((token, index) =>
      index === lastIndex ? `${token}\n` : token,
    );
    //budget: never exceed the custom-mode cap mid-line
    if (tokens.length + lineTokens.length > budget) break;
    tokens.push(...lineTokens);
    line++;
  }
  return tokens;
}

/** the stored/display key for the newline stat ("enter" reads better in the
 * grids than a raw glyph); SM-2 logic is identical for either key */
export const ENTER_STAT_KEY = "enter";

/** maps the raw "\n" stat key produced by computeLetterStats to the friendly
 * "enter" key, merging into an existing entry (idea #9) */
export function normalizeEnterStatKey(
  stats: Record<string, { correct: number; incorrect: number }>,
): Record<string, { correct: number; incorrect: number }> {
  const newlineStat = stats["\n"];
  if (newlineStat === undefined) return stats;
  const rest = { ...stats };
  delete rest["\n"];
  const existing = rest[ENTER_STAT_KEY] ?? { correct: 0, incorrect: 0 };
  rest[ENTER_STAT_KEY] = {
    correct: existing.correct + newlineStat.correct,
    incorrect: existing.incorrect + newlineStat.incorrect,
  };
  return rest;
}
