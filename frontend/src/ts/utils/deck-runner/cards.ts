import { z } from "zod";

import type { WordEvent } from "./round-engine";
import type { WeaknessMap } from "../weakness-model";

/**
 * Deck Runner Joker cards (idea G24, phase 2).
 *
 * Each Joker = exactly ONE effect (combos are two cards) so interpretation
 * and tests stay linear; effects apply in slot order. Kinds split across
 * three application points:
 * - score pipeline (per word): flatChips / chipsPer / mult / ruleWeakLetters
 * - round rules (per round): comboFloor / ruleAccuracyShield / ruleSkipRefund
 * - run economy: economyGold / economyDiscount / riskQuota
 */

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("comboAtLeast"), n: z.number() }),
  z.object({ type: z.literal("wordLengthAtLeast"), n: z.number() }),
  z.object({ type: z.literal("perfectWord") }),
  z.object({ type: z.literal("languageIs"), lang: z.string() }),
  z.object({ type: z.literal("codeWord") }),
  z.object({ type: z.literal("everyNthWord"), n: z.number() }),
]);

export const JokerEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flatChips"), value: z.number() }),
  z.object({
    kind: z.literal("chipsPer"),
    when: TriggerSchema,
    value: z.number(),
  }),
  z.object({ kind: z.literal("mult"), when: TriggerSchema, value: z.number() }),
  z.object({ kind: z.literal("comboFloor"), value: z.number() }),
  z.object({ kind: z.literal("ruleSkipRefund"), ratio: z.number() }),
  z.object({ kind: z.literal("ruleAccuracyShield") }),
  z.object({ kind: z.literal("ruleWeakLetters"), multiplier: z.number() }),
  z.object({ kind: z.literal("economyGold"), perWord: z.number() }),
  z.object({ kind: z.literal("economyDiscount"), ratio: z.number() }),
  z.object({
    kind: z.literal("riskQuota"),
    quotaMult: z.number(),
    rewardMult: z.number(),
  }),
]);

export const RaritySchema = z.enum(["common", "rare", "legendary"]);

export const JokerDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  rarity: RaritySchema,
  cost: z.number().positive(),
  effect: JokerEffectSchema,
});

export type Trigger = z.infer<typeof TriggerSchema>;
export type JokerEffect = z.infer<typeof JokerEffectSchema>;
export type Rarity = z.infer<typeof RaritySchema>;
export type JokerDef = z.infer<typeof JokerDefSchema>;

// ---------------------------------------------------------------------------
// trigger evaluation
// ---------------------------------------------------------------------------

export type TriggerContext = {
  combo: number;
  wordIndex?: number;
  language?: string;
  sourceId: string;
};

export function triggerMatches(
  trigger: Trigger,
  evt: WordEvent,
  ctx: TriggerContext,
): boolean {
  switch (trigger.type) {
    case "always":
      return true;
    case "comboAtLeast":
      return ctx.combo >= trigger.n;
    case "wordLengthAtLeast":
      return evt.word.length >= trigger.n;
    case "perfectWord":
      return evt.correct && evt.errors === 0 && !evt.skipped;
    case "languageIs":
      return ctx.language === trigger.lang;
    case "codeWord":
      return ctx.sourceId.startsWith("code");
    case "everyNthWord":
      return (ctx.wordIndex ?? 0) % trigger.n === 0;
  }
}

// ---------------------------------------------------------------------------
// registry (v1: 14 jokers covering every effect kind)
// ---------------------------------------------------------------------------

export const JOKER_REGISTRY: Record<string, JokerDef> = {
  greedy_fox: {
    id: "greedy_fox",
    name: "Greedy Fox",
    description: "+25 chips on every word.",
    rarity: "common",
    cost: 4,
    effect: { kind: "flatChips", value: 150 },
  },
  bookworm: {
    id: "bookworm",
    name: "Bookworm",
    description: "+30 chips on perfect words.",
    rarity: "common",
    cost: 4,
    effect: { kind: "chipsPer", when: { type: "perfectWord" }, value: 150 },
  },
  code_monkey: {
    id: "code_monkey",
    name: "Code Monkey",
    description: "+15 chips on code words.",
    rarity: "common",
    cost: 4,
    effect: { kind: "chipsPer", when: { type: "codeWord" }, value: 100 },
  },
  persian_charm: {
    id: "persian_charm",
    name: "Persian Charm",
    description: "x1.5 score on Persian words.",
    rarity: "common",
    cost: 4,
    effect: {
      kind: "mult",
      when: { type: "languageIs", lang: "persian" },
      value: 1.5,
    },
  },
  skip_broker: {
    id: "skip_broker",
    name: "Skip Broker",
    description: "Skipping a word refunds half of it.",
    rarity: "common",
    cost: 4,
    effect: { kind: "ruleSkipRefund", ratio: 0.5 },
  },
  discount_hammer: {
    id: "discount_hammer",
    name: "Discount Hammer",
    description: "Shop cards cost 25% less.",
    rarity: "common",
    cost: 4,
    effect: { kind: "economyDiscount", ratio: 0.25 },
  },
  golden_typist: {
    id: "golden_typist",
    name: "Golden Typist",
    description: "+1 gold for every word typed.",
    rarity: "common",
    cost: 5,
    effect: { kind: "economyGold", perWord: 1 },
  },
  streak_demon: {
    id: "streak_demon",
    name: "Streak Demon",
    description: "x2 score while your combo is at least 30.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "mult", when: { type: "comboAtLeast", n: 30 }, value: 2 },
  },
  long_words_lord: {
    id: "long_words_lord",
    name: "Lord of Long Words",
    description: "x2 score on words of 8+ letters.",
    rarity: "rare",
    cost: 7,
    effect: {
      kind: "mult",
      when: { type: "wordLengthAtLeast", n: 8 },
      value: 2,
    },
  },
  forgiveness_ink: {
    id: "forgiveness_ink",
    name: "Forgiveness Ink",
    description: "Mistyped words no longer break your combo.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "ruleAccuracyShield" },
  },
  weakness_lens: {
    id: "weakness_lens",
    name: "Weakness Lens",
    description: "x2 chips on words containing your weak letters.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "ruleWeakLetters", multiplier: 2 },
  },
  rhythm_master: {
    id: "rhythm_master",
    name: "Rhythm Master",
    description: "x3 score on every 5th word.",
    rarity: "legendary",
    cost: 12,
    effect: { kind: "mult", when: { type: "everyNthWord", n: 5 }, value: 3 },
  },
  safety_net: {
    id: "safety_net",
    name: "Safety Net",
    description: "Your combo never drops below 10.",
    rarity: "legendary",
    cost: 12,
    effect: { kind: "comboFloor", value: 10 },
  },
  high_roller: {
    id: "high_roller",
    name: "High Roller",
    description: "Quotas x1.5 harder, gold x2 richer.",
    rarity: "legendary",
    cost: 12,
    effect: { kind: "riskQuota", quotaMult: 1.5, rewardMult: 2 },
  },
  //idea G24 M4: the remaining 16 of the 30-joker v1 deck
  marathon_ink: {
    id: "marathon_ink",
    name: "Marathon Ink",
    description: "x1.5 score while your combo is at least 5.",
    rarity: "common",
    cost: 4,
    effect: { kind: "mult", when: { type: "comboAtLeast", n: 5 }, value: 1.5 },
  },
  sprinter: {
    id: "sprinter",
    name: "Sprinter",
    description: "+40 chips on every 3rd word.",
    rarity: "common",
    cost: 4,
    effect: {
      kind: "chipsPer",
      when: { type: "everyNthWord", n: 3 },
      value: 200,
    },
  },
  quick_fingers: {
    id: "quick_fingers",
    name: "Quick Fingers",
    description: "+15 chips on every 2nd word.",
    rarity: "common",
    cost: 4,
    effect: {
      kind: "chipsPer",
      when: { type: "everyNthWord", n: 2 },
      value: 75,
    },
  },
  wordsmith: {
    id: "wordsmith",
    name: "Wordsmith",
    description: "x1.3 score on words of 5+ letters.",
    rarity: "common",
    cost: 4,
    effect: {
      kind: "mult",
      when: { type: "wordLengthAtLeast", n: 5 },
      value: 1.3,
    },
  },
  english_rose: {
    id: "english_rose",
    name: "English Rose",
    description: "x1.4 score on English words.",
    rarity: "common",
    cost: 4,
    effect: {
      kind: "mult",
      when: { type: "languageIs", lang: "english" },
      value: 1.4,
    },
  },
  perfectionist: {
    id: "perfectionist",
    name: "Perfectionist",
    description: "x2 score on perfect words.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "mult", when: { type: "perfectWord" }, value: 2 },
  },
  combo_engine: {
    id: "combo_engine",
    name: "Combo Engine",
    description: "Your combo never drops below 5.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "comboFloor", value: 5 },
  },
  shopkeepers_friend: {
    id: "shopkeepers_friend",
    name: "Shopkeeper's Friend",
    description: "Shop cards cost 15% less.",
    rarity: "common",
    cost: 4,
    effect: { kind: "economyDiscount", ratio: 0.15 },
  },
  gold_rush: {
    id: "gold_rush",
    name: "Gold Rush",
    description: "+2 gold for every word typed.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "economyGold", perWord: 2 },
  },
  fifty_fifty: {
    id: "fifty_fifty",
    name: "Fifty Fifty",
    description: "Quotas x1.25 harder, gold x1.5 richer.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "riskQuota", quotaMult: 1.25, rewardMult: 1.5 },
  },
  long_haul: {
    id: "long_haul",
    name: "Long Haul",
    description: "+80 chips on every word.",
    rarity: "legendary",
    cost: 12,
    effect: { kind: "flatChips", value: 400 },
  },
  combo_king: {
    id: "combo_king",
    name: "Combo King",
    description: "x2 score while your combo is at least 15.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "mult", when: { type: "comboAtLeast", n: 15 }, value: 2 },
  },
  phoenix: {
    id: "phoenix",
    name: "Phoenix",
    description: "Your combo never drops below 20.",
    rarity: "legendary",
    cost: 12,
    effect: { kind: "comboFloor", value: 20 },
  },
  heavy_hitter: {
    id: "heavy_hitter",
    name: "Heavy Hitter",
    description: "+60 chips on every word.",
    rarity: "rare",
    cost: 7,
    effect: { kind: "flatChips", value: 300 },
  },
  code_poet: {
    id: "code_poet",
    name: "Code Poet",
    description: "+40 chips on perfect code words.",
    rarity: "rare",
    cost: 7,
    effect: {
      kind: "chipsPer",
      when: { type: "codeWord" },
      value: 250,
    },
  },
  second_wind: {
    id: "second_wind",
    name: "Second Wind",
    description: "Skipping a word refunds it entirely (still breaks nothing).",
    rarity: "legendary",
    cost: 12,
    effect: { kind: "ruleSkipRefund", ratio: 1 },
  },
};

/** jokers gated on other features: excluded from pools until the feature
 * exists (ruleWeakLetters needs the idea #7 weakness map) */
export function jokerIsAvailable(
  jokerId: string,
  hasWeakness: boolean,
): boolean {
  const def = JOKER_REGISTRY[jokerId];
  if (def === undefined) return false;
  if (def.effect.kind === "ruleWeakLetters") return hasWeakness;
  return true;
}

// ---------------------------------------------------------------------------
// runtime view (what the round/run engines consume)
// ---------------------------------------------------------------------------

export type JokerRuntime = {
  scorePipeline: ((
    acc: { chips: number; mult: number },
    evt: WordEvent,
    ctx: TriggerContext,
  ) => { chips: number; mult: number })[];
  comboFloor: number;
  accuracyShield: boolean;
  skipRefundRatio: number;
  goldPerWord: number;
  quotaMult: number;
  rewardMult: number;
  shopDiscount: number;
};

export function jokerRuntime(
  jokerIds: string[],
  weakness?: WeaknessMap,
): JokerRuntime {
  const runtime: JokerRuntime = {
    scorePipeline: [],
    comboFloor: 0,
    accuracyShield: false,
    skipRefundRatio: 0,
    goldPerWord: 0,
    quotaMult: 1,
    rewardMult: 1,
    shopDiscount: 0,
  };
  for (const id of jokerIds) {
    const def = JOKER_REGISTRY[id];
    if (def === undefined) continue;
    const effect = def.effect;
    switch (effect.kind) {
      case "flatChips":
        runtime.scorePipeline.push((acc) => ({
          chips: acc.chips + effect.value,
          mult: acc.mult,
        }));
        break;
      case "chipsPer":
        runtime.scorePipeline.push((acc, evt, ctx) => {
          if (!triggerMatches(effect.when, evt, ctx)) return acc;
          return { chips: acc.chips + effect.value, mult: acc.mult };
        });
        break;
      case "mult":
        runtime.scorePipeline.push((acc, evt, ctx) => {
          if (!triggerMatches(effect.when, evt, ctx)) return acc;
          return { chips: acc.chips, mult: acc.mult * effect.value };
        });
        break;
      case "ruleWeakLetters":
        runtime.scorePipeline.push((acc, evt) => {
          const hasWeakChar = [...evt.word.toLowerCase()].some(
            (ch) => weakness?.[ch] !== undefined,
          );
          if (!hasWeakChar) return acc;
          return { chips: acc.chips * effect.multiplier, mult: acc.mult };
        });
        break;
      case "comboFloor":
        runtime.comboFloor = Math.max(runtime.comboFloor, effect.value);
        break;
      case "ruleAccuracyShield":
        runtime.accuracyShield = true;
        break;
      case "ruleSkipRefund":
        runtime.skipRefundRatio = Math.max(
          runtime.skipRefundRatio,
          effect.ratio,
        );
        break;
      case "economyGold":
        runtime.goldPerWord += effect.perWord;
        break;
      case "economyDiscount":
        runtime.shopDiscount = Math.min(
          0.75,
          runtime.shopDiscount + effect.ratio,
        );
        break;
      case "riskQuota":
        runtime.quotaMult *= effect.quotaMult;
        runtime.rewardMult *= effect.rewardMult;
        break;
    }
  }
  return runtime;
}

/** duplicates are allowed only for stacking kinds (flatChips/economyGold) */
export function duplicateAllowed(jokerId: string): boolean {
  const kind = JOKER_REGISTRY[jokerId]?.effect.kind;
  return kind === "flatChips" || kind === "economyGold";
}

export function costAfterDiscount(def: JokerDef, shopDiscount: number): number {
  return Math.max(1, Math.round(def.cost * (1 - shopDiscount)));
}
