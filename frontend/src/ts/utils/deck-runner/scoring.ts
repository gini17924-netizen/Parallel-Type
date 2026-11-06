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
  /** Joker pipeline from phase 2; empty in phase 1 */
  jokers?: ((acc: ScoreAcc, evt: WordEvent) => ScoreAcc)[];
};

/** per-language rare character tables (M4/balance.ts may tune) */
export const RARE_CHARS: Record<string, string[]> = {
  fa: ["ظ", "ض", "ژ", "ث", "ذ", "غ", "ع", "ح", "ص", "ط"],
  en: ["q", "x", "z", "j", "k", "v"],
};

export const RARE_CHAR_BONUS = 10;
export const CODE_WORD_BONUS = 15;
export const LONG_WORD_BONUS = 20;
export const LONG_WORD_MIN = 8;
export const CHIPS_PER_CHAR = 5;

export function comboMultiplier(combo: number): number {
  if (combo >= 100) return 5;
  if (combo >= 50) return 3;
  if (combo >= 30) return 2;
  if (combo >= 15) return 1.5;
  if (combo >= 5) return 1.2;
  return 1;
}

function rareBonus(word: string, sourceId: string): number {
  const table = sourceId.startsWith("fa")
    ? (RARE_CHARS["fa"] ?? [])
    : sourceId.startsWith("en")
      ? (RARE_CHARS["en"] ?? [])
      : (RARE_CHARS["default"] ?? []);
  if (table.length === 0) return 0;
  const set = new Set(table);
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
      rareBonus(evt.word, ctx.sourceId) +
      (ctx.sourceId.startsWith("code") ? CODE_WORD_BONUS : 0) +
      (evt.word.length >= LONG_WORD_MIN ? LONG_WORD_BONUS : 0),
    mult: comboMultiplier(ctx.combo),
  };
  for (const joker of ctx.jokers ?? []) {
    acc = joker(acc, evt);
  }
  return {
    chips: acc.chips,
    mult: acc.mult,
    total: Math.round(acc.chips * acc.mult),
  };
}
