import { Config } from "../config/store";

/**
 * Custom punctuation set resolution (desktop fork, idea #4).
 *
 * The main Config.punctuation toggle stays the master switch; this module
 * only resolves WHICH characters the punctuation branches use when the
 * style is "custom". Branch probabilities and control flow in
 * words-generator.ts are untouched.
 *
 * ZWNJ (U+200C) is strictly an internal word joiner for joining-script
 * languages: it is never a branch character, never a suffix, and is only
 * applied when customPunctuationZwnj is enabled.
 */

const ZWNJ = "\u200C";
const WRAPPER_OPEN = "«";
const WRAPPER_CLOSE = "»";

export type ResolvedPunctuationSet = {
  /** false: the branches use the built-in per-language tables */
  custom: boolean;
  /** characters the punctuation branches may apply */
  chars: string[];
  /** paired wrapper for the double-quote branch, e.g. ["«", "»"] */
  wrapperPair: [string, string] | undefined;
  /** internal word joiner, "" when disabled */
  joiner: string;
};

const defaultSet: ResolvedPunctuationSet = {
  custom: false,
  chars: [],
  wrapperPair: undefined,
  joiner: "",
};

export function resolvePunctuationSet(): ResolvedPunctuationSet {
  if (Config.punctuationStyle !== "custom") {
    return defaultSet;
  }

  //dedupe preserving first-seen order; ZWNJ is never a branch character
  const seen: string[] = [];
  for (const char of Array.from(Config.customPunctuation)) {
    if (char === ZWNJ) continue;
    if (!seen.includes(char)) seen.push(char);
  }

  let wrapperPair: [string, string] | undefined;
  if (seen.includes(WRAPPER_OPEN) && seen.includes(WRAPPER_CLOSE)) {
    wrapperPair = [WRAPPER_OPEN, WRAPPER_CLOSE];
  }

  const chars = seen.filter((c) => c !== WRAPPER_OPEN && c !== WRAPPER_CLOSE);
  if (chars.length === 0) {
    //explicit safe fallback: an empty usable set reverts to the built-in
    //per-language tables instead of producing a broken generator
    return defaultSet;
  }

  return {
    custom: true,
    chars,
    wrapperPair,
    joiner: Config.customPunctuationZwnj ? ZWNJ : "",
  };
}
