import { LCG } from "@keybr/rand";

import type { Wordset } from "../test/wordset";
import { buildCurrentWeakness } from "./smart-drill";
import type { WeaknessMap } from "./weakness-model";

/**
 * Funbox `weak_letters` (idea #8) — persistent weakness-weighted words for
 * the MAIN test, built on the unified weakness model (idea #7). Unlike the
 * upstream weakspot (live EMA, session-only), the weighting comes from the
 * persisted drill + keybr stats.
 *
 * Selection: the weakspot argmax trick — sample 20 uniform candidates and
 * take the one with the highest mean letter weakness. Letters without
 * evidence are neutral (skipped in the mean), so a language switch degrades
 * gracefully: the funbox simply stops reshuffling words it knows nothing
 * about. An empty map is a full pass-through (uniform first-candidate).
 *
 * Determinism: one module-level LCG seeded at startup (runtime) or via the
 * test hook (fixed seed). The weakness map is cached for the session — it
 * changes only when a test/drill completes, and weights shift slowly
 * enough that within-session staleness is invisible.
 */

const WORD_SAMPLES = 20; //weakspot parity

let cachedWeakness: WeaknessMap | undefined;
let lcg: ReturnType<typeof LCG> = LCG(Date.now());

function getWeakness(): WeaknessMap {
  cachedWeakness ??= buildCurrentWeakness();
  return cachedWeakness;
}

function meanWeight(word: string, weakness: WeaknessMap): number {
  const known = [...word.toLowerCase()].filter(
    (ch) => weakness[ch] !== undefined,
  );
  if (known.length === 0) return 0; //neutral: no evidence for this word
  return (
    known.reduce((sum, ch) => sum + (weakness[ch]?.score ?? 0), 0) /
    known.length
  );
}

/** picks one word from the wordset, weighted towards the user's weakest
 * letters; "" for an undefined/empty wordset (weakspot parity). Sampling
 * runs on the module LCG: the same seed over the same wordset/weakness
 * yields the same word. */
export function pickWord(wordset?: Wordset): string {
  if (wordset === undefined || wordset.words.length === 0) return "";
  const weakness = getWeakness();
  const hasEvidence = Object.keys(weakness).length > 0;
  let best = "";
  let bestWeight = -1;
  for (let i = 0; i < WORD_SAMPLES; i++) {
    const candidate =
      wordset.words[
        Math.floor(lcg() * wordset.words.length) % wordset.words.length
      ] ?? "";
    const weight = hasEvidence ? meanWeight(candidate, weakness) : 0;
    if (i === 0 || weight > bestWeight) {
      best = candidate;
      bestWeight = weight;
    }
  }
  return best;
}

/** test hook: reseeds the sampler AND drops the weakness cache, so tests
 * with fixed seeds see fresh storage fixtures (repo _-prefixed convention) */
export function _setWeakLettersSeedForTests(seed: number): void {
  lcg = LCG(seed);
  cachedWeakness = undefined;
}
