import { Filter, type PhoneticModel } from "@keybr/phonetic-model";
import { LCG } from "@keybr/rand";

import {
  filterRealWords,
  generatePseudoWords,
  getLearnState,
  weakLettersDetailed,
} from "./learn-stats";
import { buildWeaknessMap, type WeaknessMap } from "./weakness-model";
import { loadKeybrLetterStats } from "./keybr-letter-stats";

/**
 * Smart drill generator (idea #7, part 2) — PURE: the phonetic model is
 * injected (the UI wires the session.ts singleton), every randomness comes
 * from the explicit seed, and storage is never touched.
 *
 * Blend: real words from the language list, selected with the weakspot
 * argmax trick (sample N candidates, take the one whose letters carry the
 * highest mean weakness), then phonetic model words that GUARANTEE the
 * presence of a focused weak letter (the keybr Filter contract). When the
 * model is unavailable the old bigram pseudo-words fill the drill instead
 * (usedFallback - the UI surfaces it once).
 */

export const SMART_DRILL_WORD_COUNT = 30;
/** per-word retries before accepting an unfocused phonetic word */
const WORD_ATTEMPTS = 10;
/** candidates sampled for the argmax trick (weakspot: wordSamples = 20) */
const REAL_SAMPLE_COUNT = 20;
/** rank-normalized scores floor at 0; the floor keeps strong letters
 * occasionally focused instead of never */
const WEIGHT_FLOOR = 0.05;

export type SmartDrillPlan = {
  words: string[];
  /** true when the phonetic model was unavailable and the bigram fallback
   * produced (part of) the drill */
  usedFallback: boolean;
  /** distinct weak letters that actually appear in the final drill */
  focusedLetters: string[];
};

export function buildCurrentWeakness(): WeaknessMap {
  return buildWeaknessMap(getLearnState(), loadKeybrLetterStats());
}

function meanWeakness(word: string, weakness: WeaknessMap): number {
  const letters = [...word.toLowerCase()].filter(
    (ch) => weakness[ch] !== undefined,
  );
  if (letters.length === 0) return 0;
  return (
    letters.reduce((sum, ch) => sum + (weakness[ch]?.score ?? 0), 0) /
    letters.length
  );
}

/** weakspot argmax trick over the real-word matches: sample, then take the
 * highest mean-weakness words, best first */
function pickRealWords(
  wordList: string[],
  allowedLetters: string,
  weakness: WeaknessMap,
  count: number,
  lcg: ReturnType<typeof LCG>,
): string[] {
  const candidates = filterRealWords(
    wordList,
    allowedLetters,
    REAL_SAMPLE_COUNT,
    lcg,
  );
  return [...new Set(candidates)]
    .sort((a, b) => meanWeakness(b, weakness) - meanWeakness(a, weakness))
    .slice(0, count);
}

export function generateSmartDrillWords(options: {
  /** undefined when the model failed to load: the bigram fallback fills */
  model: PhoneticModel | undefined;
  allowedLetters: string;
  weakness: WeaknessMap;
  wordList: string[];
  count?: number;
  seed: number;
}): SmartDrillPlan {
  const count = options.count ?? SMART_DRILL_WORD_COUNT;
  const allowed = [
    ...new Set([...options.allowedLetters].filter((ch) => ch !== "")),
  ];
  if (allowed.length === 0 || count <= 0) {
    return {
      words: [],
      usedFallback: options.model === undefined,
      focusedLetters: [],
    };
  }
  const lcg = LCG(options.seed);
  //the phonetic generator only knows the MODEL's letters (Letter objects):
  //the drill alphabet is allowed ∩ model letters, matched by CODEPOINT —
  //model letter labels carry a ZWNJ prefix (joining-script rendering) and
  //must never be string-compared (idea #7 debugging note)
  const allowedCodePoints = new Set(
    allowed.map((ch) => ch.codePointAt(0) ?? 0),
  );
  const letterObjs = (options.model?.letters ?? []).filter((l) =>
    allowedCodePoints.has(l.codePoint),
  );
  const modelLetterCodePoints = new Set(letterObjs.map((l) => l.codePoint));

  //focused-letter pool: allowed ∩ model letters the weakness model speaks
  //for, weighted P ∝ score (+floor so strong letters stay possible)
  const focusedPool = allowed
    .filter((letter) => modelLetterCodePoints.has(letter.codePointAt(0) ?? 0))
    .map((letter) => ({ letter, score: options.weakness[letter]?.score ?? -1 }))
    .filter((it) => it.score >= 0);
  const weights = focusedPool.map((it) => it.score + WEIGHT_FLOOR);
  const pickFocused = (): string | undefined => {
    if (focusedPool.length === 0) return undefined;
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = lcg() * total;
    for (let i = 0; i < focusedPool.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return focusedPool[i]?.letter;
    }
    return focusedPool[focusedPool.length - 1]?.letter;
  };

  const focusedLetters = new Set<string>();
  const words: string[] = [];
  let usedFallback = options.model === undefined;

  //real words first: argmax-selected by weakness (up to half the drill)
  const realQuota = Math.floor(count / 2);
  for (const word of pickRealWords(
    options.wordList,
    options.allowedLetters,
    options.weakness,
    realQuota,
    lcg,
  )) {
    if (words.length >= count) break;
    words.push(word);
  }

  while (words.length < count) {
    let word = "";
    let honoredFocused: string | undefined;
    const focused = pickFocused();
    const model = options.model;
    const focusedLetter =
      focused === undefined
        ? null
        : (letterObjs.find(
            (l) => l.codePoint === (focused.codePointAt(0) ?? 0),
          ) ?? null);
    //Filter wants a Letter object (Letter.toLetter throws on a bare string)
    for (
      let attempt = 0;
      attempt < WORD_ATTEMPTS && model !== undefined;
      attempt++
    ) {
      try {
        const filter = new Filter(letterObjs, focusedLetter);
        const phonetic = model.nextWord(filter, lcg);
        if (phonetic.length > 0) {
          word = phonetic;
          if (focused !== undefined && phonetic.includes(focused)) {
            honoredFocused = focused;
          }
          break; //a usable phonetic word (focused or fallback-unfocused)
        }
      } catch {
        //Filter contract violation (focused not in the model alphabet):
        //give up on phonetic for this slot
        word = "";
        break;
      }
    }
    if (word.length > 0) {
      words.push(word);
      if (honoredFocused !== undefined) focusedLetters.add(honoredFocused);
      continue;
    }
    //bigram fallback slot (model unavailable or unusable)
    usedFallback = true;
    const pseudo = generatePseudoWords(
      options.allowedLetters,
      1,
      options.wordList,
      "",
      options.seed + words.length,
    );
    const slot = pseudo[0];
    if (slot === undefined || slot === "") break; //cannot happen, defensive
    words.push(slot);
  }

  //distinct weak letters that actually made it into the drill
  for (const word of words) {
    for (const ch of word.toLowerCase()) {
      if (options.weakness[ch] !== undefined) focusedLetters.add(ch);
    }
  }

  return {
    words: words.slice(0, count),
    usedFallback,
    focusedLetters: [...focusedLetters],
  };
}

/** convenience for the UI: weakness map + detailed weak letters in one call */
export function smartDrillInputs(): {
  weakness: WeaknessMap;
  detailed: ReturnType<typeof weakLettersDetailed>;
} {
  const detailed = weakLettersDetailed(8);
  return { weakness: buildCurrentWeakness(), detailed };
}
