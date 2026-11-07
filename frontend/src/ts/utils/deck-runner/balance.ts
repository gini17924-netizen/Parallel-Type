/**
 * Deck Runner balance file (idea G24, M4): EVERY tunable number of the game
 * lives here so playtest iterations are one-file edits. The engine modules
 * import from this file; nothing else should hardcode values.
 */

// --- run structure ----------------------------------------------------------

export const BLINDS_PER_ANTE = 3;
export const BASE_QUOTA = 500;
export const QUOTA_GROWTH = 1.6; //quota multiplier per ante
/** quota multiplier per blind slot within an ante (small / big / boss) */
export const BLIND_QUOTA_MULT: readonly [number, number, number] = [
  1, 1.5, 2.5,
];
/** word budget per blind slot */
export const BLIND_BUDGET: readonly [number, number, number] = [25, 25, 30];
/** errorPenalty boss rule (big blind): chips subtracted per imperfect word.
 * Tuned small on purpose: it must dent the income, not zero it (phase 5
 * headless sim: 50 made the big blind unwinnable, 10 keeps it pressuring). */
export const BOSS_ERROR_PENALTY = 10;

// --- economy ----------------------------------------------------------------

export const START_GOLD = 4;
export const GOLD_BASE = 3; //won small/big blind
export const GOLD_BOSS = 5; //won boss blind
export const REROLL_COST = 2;
export const MAX_JOKER_SLOTS = 5;

// --- scoring ----------------------------------------------------------------

export const CHIPS_PER_CHAR = 5;
export const RARE_CHAR_BONUS = 10;
export const CODE_WORD_BONUS = 15;
export const LONG_WORD_BONUS = 20;
export const LONG_WORD_MIN = 8;

/** combo streak tiers: [streak threshold, multiplier] — highest match wins */
export const COMBO_TIERS: readonly [number, number][] = [
  [100, 5],
  [50, 3],
  [30, 2],
  [15, 1.5],
  [5, 1.2],
];

// --- word source ------------------------------------------------------------

export const DEFAULT_MIN_LENGTH = 3;
export const DEFAULT_MAX_LENGTH = 10;
export const RECENT_WINDOW = 10;
export const ARGMAX_SAMPLES = 20; //weak-spot trick parity
/** boss "longWords": the minimum length the source is raised to */
export const LONG_WORDS_BOSS_MIN = 6;
/** latency target for the keybr slowness signal is in weakness-model; the
 * deck runner only consumes the resulting scores */

// --- shop -------------------------------------------------------------------

/** rarity weights per ante bracket: [ante 1, ante >= 2] */
export const RARITY_WEIGHT: Record<Rarity, readonly [number, number]> = {
  common: [62, 46],
  rare: [28, 36],
  legendary: [10, 18],
};
export const SHOP_OFFERS_ANTE_1 = 3;
export const SHOP_OFFERS_LATER = 4;

type Rarity = "common" | "rare" | "legendary";
