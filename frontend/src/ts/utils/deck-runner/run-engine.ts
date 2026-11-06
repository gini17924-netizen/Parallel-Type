import { z } from "zod";

import {
  costAfterDiscount,
  duplicateAllowed,
  jokerRuntime,
  JOKER_REGISTRY,
  type JokerRuntime,
} from "./cards";
import { GOLD_BASE, GOLD_BOSS } from "./round-engine";
import {
  BASE_QUOTA,
  BLIND_BUDGET,
  BLIND_QUOTA_MULT,
  BLINDS_PER_ANTE,
  MAX_JOKER_SLOTS,
  QUOTA_GROWTH,
  REROLL_COST,
  START_GOLD,
} from "./balance";

export { BLINDS_PER_ANTE, MAX_JOKER_SLOTS, REROLL_COST, START_GOLD };

/**
 * Deck Runner run state machine (idea G24, phase 2): blind -> reward ->
 * shop -> blind x3 per ante (quota grows ~x1.6 per ante) -> gameover on a
 * lost blind. PURE: state in, state out; the per-blind round itself is
 * round-engine's job. Resume = serialize this state between blinds (a blind
 * in progress is abandoned - v1 simplicity, spec §10).
 *
 * Randomness: per-position reseeding (LCG over seed ^ mix(ante, blindIndex,
 * purpose)) - no rng stream state needs persisting, so resume is trivial.
 */

export type DeckPhase = "blind" | "reward" | "shop" | "gameover";

export const DeckRunStateSchema = z.object({
  seed: z.number(),
  language: z.string(),
  wordSourceId: z.string(),
  phase: z.enum(["blind", "reward", "shop", "gameover"]),
  ante: z.number().int().min(1),
  blindIndex: z
    .number()
    .int()
    .min(0)
    .max(BLINDS_PER_ANTE - 1),
  gold: z.number().nonnegative(),
  jokers: z.array(z.string()).max(MAX_JOKER_SLOTS),
  rerolls: z.number().int().nonnegative(),
  score: z.number(),
  totalScore: z.number().nonnegative(),
  wordsTyped: z.number().int().nonnegative(),
  goldFromWords: z.number().nonnegative(),
  lastRound: z
    .object({
      score: z.number(),
      won: z.boolean(),
      gold: z.number(),
    })
    .nullable(),
  updatedAt: z.number(),
});

export type DeckRunState = z.infer<typeof DeckRunStateSchema>;

export function deriveSeed(base: number, salt: string): number {
  let hash = base ^ 0x9e3779b9;
  for (const ch of salt) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647;
  }
  if (hash <= 0) hash += 2147483646;
  return hash;
}

export function startRun(options: {
  seed: number;
  language: string;
  wordSourceId: string;
}): DeckRunState {
  return {
    seed: options.seed,
    language: options.language,
    wordSourceId: options.wordSourceId,
    phase: "blind",
    ante: 1,
    blindIndex: 0,
    gold: START_GOLD,
    jokers: [],
    rerolls: 0,
    score: 0,
    totalScore: 0,
    wordsTyped: 0,
    goldFromWords: 0,
    lastRound: null,
    updatedAt: Date.now(),
  };
}

/** quota/budget/isBoss of the current blind, with run-level multipliers
 * (riskQuota) applied to the quota */
export function currentBlindConfig(
  state: DeckRunState,
  runtime: JokerRuntime,
): {
  quota: number;
  wordBudget: number;
  wordSourceId: string;
  language: string;
  isBoss: boolean;
} {
  const base =
    BASE_QUOTA *
    Math.pow(QUOTA_GROWTH, state.ante - 1) *
    (BLIND_QUOTA_MULT[state.blindIndex] ?? 1);
  return {
    quota: Math.round(base * runtime.quotaMult),
    wordBudget: BLIND_BUDGET[state.blindIndex] ?? 25,
    wordSourceId: state.wordSourceId,
    language: state.language,
    isBoss: state.blindIndex === BLINDS_PER_ANTE - 1,
  };
}

/** ends the current blind: won -> reward phase (gold + summary), lost ->
 * gameover. `runtime` feeds gold-per-word and the reward multiplier. */
export function endBlind(
  state: DeckRunState,
  round: {
    score: number;
    won: boolean;
    wordsTyped: number;
    wordsSkipped: number;
  },
  runtime: JokerRuntime,
  config: { isBoss: boolean },
): DeckRunState {
  const base = round.won ? (config.isBoss ? GOLD_BOSS : GOLD_BASE) : 0;
  const gold = Math.round(
    (base + runtime.goldPerWord * round.wordsTyped) * runtime.rewardMult,
  );
  const totalWords = round.wordsTyped + round.wordsSkipped;
  return {
    ...state,
    phase: round.won ? "reward" : "gameover",
    gold: state.gold + gold,
    totalScore: state.totalScore + Math.max(0, round.score),
    wordsTyped: state.wordsTyped + totalWords,
    goldFromWords: state.goldFromWords + runtime.goldPerWord * round.wordsTyped,
    score: round.score,
    lastRound: { score: round.score, won: round.won, gold },
    updatedAt: Date.now(),
  };
}

/** reward phase: claim one of the 1-of-3 offers into a free slot */
export function claimReward(
  state: DeckRunState,
  jokerId: string,
): DeckRunState {
  if (state.phase !== "reward") return state;
  const def = JOKER_REGISTRY[jokerId];
  if (def === undefined) return state;
  if (state.jokers.length >= MAX_JOKER_SLOTS) return state;
  if (state.jokers.includes(jokerId) && !duplicateAllowed(jokerId)) {
    return state;
  }
  return {
    ...state,
    jokers: [...state.jokers, jokerId],
    phase: "shop",
    updatedAt: Date.now(),
  };
}

export function skipReward(state: DeckRunState): DeckRunState {
  if (state.phase !== "reward") return state;
  return { ...state, phase: "shop", updatedAt: Date.now() };
}

/** shop: buy a joker (gold, free slot, duplicate rule) */
export function buyJoker(
  state: DeckRunState,
  jokerId: string,
  runtime: JokerRuntime,
): DeckRunState {
  if (state.phase !== "shop") return state;
  const def = JOKER_REGISTRY[jokerId];
  if (def === undefined) return state;
  if (state.gold < costAfterDiscount(def, runtime.shopDiscount)) return state;
  if (state.jokers.length >= MAX_JOKER_SLOTS) return state;
  if (state.jokers.includes(jokerId) && !duplicateAllowed(jokerId)) {
    return state;
  }
  return {
    ...state,
    jokers: [...state.jokers, jokerId],
    gold: state.gold - costAfterDiscount(def, runtime.shopDiscount),
    updatedAt: Date.now(),
  };
}

export function rerollShop(state: DeckRunState): DeckRunState {
  if (state.phase !== "shop" || state.gold < REROLL_COST) return state;
  return {
    ...state,
    gold: state.gold - REROLL_COST,
    rerolls: state.rerolls + 1,
    updatedAt: Date.now(),
  };
}

/** shop -> next blind (or next ante when the boss was cleared) */
export function nextBlind(state: DeckRunState): DeckRunState {
  if (state.phase !== "shop") return state;
  const nextIndex = state.blindIndex + 1;
  const advanced = nextIndex >= BLINDS_PER_ANTE;
  return {
    ...state,
    phase: "blind",
    ante: advanced ? state.ante + 1 : state.ante,
    blindIndex: advanced ? 0 : nextIndex,
    score: 0,
    goldFromWords: 0,
    updatedAt: Date.now(),
  };
}

export function jokerRuntimeFor(
  state: DeckRunState,
  weakness?: WeaknessMapLike,
): JokerRuntime {
  return jokerRuntime(state.jokers, weakness);
}

import type { WeaknessMap } from "../weakness-model";

type WeaknessMapLike = WeaknessMap;
