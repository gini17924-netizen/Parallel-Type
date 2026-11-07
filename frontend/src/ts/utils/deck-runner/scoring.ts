import type { WeaknessMap } from "../weakness-model";
import type { WordEvent } from "./round-engine";

/**
 * Deck Runner scoring (idea G24): word score = (chips + bonuses) × mult.
 *
 * - chips base = 5 × word chars
 * - bonuses: +10 per rare char (per-language table), +15 code word,
 *   +20 word ≥ 8 chars
 * - mult: combo tiers (type.win style streaks) — combo is the streak BEFORE
 *   growth; the engine passes the post-update streak
 * - Joker pipeline (phase 2): applied in slot order over a ScoreAcc
 */

export type ScoreAcc = { chips: number; mult: number };
export type ScoreContext = {
  /** streak before this word's growth (engine passes post-update streak) */
  combo: number;
  sourceId: string;
  /** for languageIs triggers */
  language?: string;
  /** 0-based index of this word in the test (everyNthWord trigger) */
  wordIndex?: number;
  /** for ruleWeakLetters (idea #7 map, injected) */
  weakness?: WeaknessMap;
  /** Joker pipeline; applied in slot order, receiving the full ctx */
  jokers?: ((acc: ScoreAcc, evt: WordEvent, ctx: ScoreContext) => ScoreAcc)[];
};

/** per-language rare character tables (M4/balance.ts may tune) */
import {
  CHIPS_PER_CHAR,
  CODE_WORD_BONUS,
  COMBO_TIERS,
  LONG_WORD_BONUS,
  LONG_WORD_MIN,
  RARE_CHAR_BONUS,
} from "./balance";

export {
  RARE_CHAR_BONUS,
  CODE_WORD_BONUS,
  LONG_WORD_BONUS,
  LONG_WORD_MIN,
  CHIPS_PER_CHAR,
} from "./balance";

export const RARE_CHARS: Record<string, string[]> = {
  fa: ["ظ", "ض", "ژ", "ث", "ذ", "غ", "ع", "ح", "ص", "ط"],
  en: ["q", "x", "z", "j", "k", "v"],
};

const RARE_SETS: Record<"fa" | "en", Set<string>> = {
  fa: new Set(RARE_CHARS["fa"] ?? []),
  en: new Set(RARE_CHARS["en"] ?? []),
};

export function comboMultiplier(combo: number): number {
  let mult = 1;
  for (const [threshold, tierMult] of COMBO_TIERS) {
    if (combo >= threshold) {
      mult = tierMult;
      break; //tiers are sorted high -> low
    }
  }
  return mult;
}

/** rare-char table by run language, falling back to the sourceId prefix for
 * direct scoring callers that never pass language (sourceId prefixes alone
 * missed weakness:/custom:/code: ids) */
function rareBonus(word: string, sourceId: string, language?: string): number {
  const set =
    language === "persian" ||
    (language === undefined && sourceId.startsWith("fa"))
      ? RARE_SETS.fa
      : language === "english" ||
          (language === undefined && sourceId.startsWith("en"))
        ? RARE_SETS.en
        : new Set<string>();
  if (set.size === 0) return 0;
  return (
    [...word.toLowerCase()].filter((ch) => set.has(ch)).length * RARE_CHAR_BONUS
  );
}

export function wordScore(
  evt: WordEvent,
  ctx: ScoreContext,
): { chips: number; mult: number; total: number } {
  let acc: ScoreAcc = {
    chips:
      CHIPS_PER_CHAR * evt.chars +
      rareBonus(evt.word, ctx.sourceId, ctx.language) +
      (ctx.sourceId.startsWith("code") ? CODE_WORD_BONUS : 0) +
      (evt.word.length >= LONG_WORD_MIN ? LONG_WORD_BONUS : 0),
    mult: comboMultiplier(ctx.combo),
  };
  for (const joker of ctx.jokers ?? []) {
    acc = joker(acc, evt, ctx);
  }
  return {
    chips: acc.chips,
    mult: acc.mult,
    total: Math.round(acc.chips * acc.mult),
  };
}
