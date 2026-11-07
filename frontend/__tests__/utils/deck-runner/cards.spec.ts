import { describe, it, expect } from "vitest";

import {
  jokerIsAvailable,
  jokerRuntime,
  JokerDefSchema,
  JOKER_REGISTRY,
  costAfterDiscount,
  type JokerDef,
} from "../../../src/ts/utils/deck-runner/cards";
import { wordScore } from "../../../src/ts/utils/deck-runner/scoring";
import type { WordEvent } from "../../../src/ts/utils/deck-runner/round-engine";

function evt(word: string, overrides: Partial<WordEvent> = {}): WordEvent {
  return {
    word,
    typed: word,
    correct: true,
    accuracy: 1,
    chars: word.length,
    errors: 0,
    skipped: false,
    elapsedMs: 0,
    comboBefore: 0,
    ...overrides,
  };
}

describe("deck-runner cards (G24 phase 2)", () => {
  it("every registry joker validates against the JokerDef schema", () => {
    for (const def of Object.values(JOKER_REGISTRY)) {
      expect(JokerDefSchema.safeParse(def).success, def.id).toBe(true);
    }
  });

  it("flatChips adds its value to every word", () => {
    const runtime = jokerRuntime(["greedy_fox"]);
    const result = wordScore(evt("abc"), {
      combo: 0,
      sourceId: "en-1k",
      jokers: runtime.scorePipeline,
    });
    expect(result.chips).toBe(15 + 150);
  });

  it("chipsPer perfectWord: pays on perfect, nothing on errors", () => {
    const runtime = jokerRuntime(["bookworm"]);
    const perfect = wordScore(evt("abc"), {
      combo: 0,
      sourceId: "en-1k",
      jokers: runtime.scorePipeline,
    });
    const flawed = wordScore(
      evt("abc", { errors: 1, correct: false, accuracy: 2 / 3 }),
      {
        combo: 0,
        sourceId: "en-1k",
        jokers: runtime.scorePipeline,
      },
    );
    expect(perfect.chips).toBe(15 + 150);
    expect(flawed.chips).toBe(15);
  });

  it("mult comboAtLeast applies only at the threshold", () => {
    const runtime = jokerRuntime(["streak_demon"]);
    const below = wordScore(evt("abc"), {
      combo: 29,
      sourceId: "en-1k",
      wordIndex: 0,
      jokers: runtime.scorePipeline,
    });
    const at = wordScore(evt("abc"), {
      combo: 30,
      sourceId: "en-1k",
      wordIndex: 0,
      jokers: runtime.scorePipeline,
    });
    //combo 29: the base combo tier (>=15 -> x1.5) applies, the joker does not
    expect(below.total).toBe(23);
    //combo 30: base tier (x2) and the joker (x2) stack -> 15x4
    expect(at.total).toBe(60);
  });

  it("languageIs matches the run language", () => {
    const runtime = jokerRuntime(["persian_charm"]);
    const fa = wordScore(evt("سلام"), {
      combo: 0,
      sourceId: "fa-1k",
      language: "persian",
      wordIndex: 0,
      jokers: runtime.scorePipeline,
    });
    const en = wordScore(evt("abc"), {
      combo: 0,
      sourceId: "en-1k",
      language: "english",
      wordIndex: 0,
      jokers: runtime.scorePipeline,
    });
    expect(fa.mult).toBe(1.5);
    expect(en.mult).toBe(1);
  });

  it("two identical flatChips jokers stack (duplicate rule)", () => {
    const runtime = jokerRuntime(["greedy_fox", "greedy_fox"]);
    const result = wordScore(evt("abc"), {
      combo: 0,
      sourceId: "en-1k",
      jokers: runtime.scorePipeline,
    });
    expect(result.chips).toBe(15 + 300);
  });

  it("ruleWeakLetters doubles chips on words with weak chars", () => {
    const runtime = jokerRuntime(["weakness_lens"], {
      ف: { letter: "ف", score: 1, acc: 0.3, total: 10, evidence: [] },
    });
    const weakness = {
      ف: { letter: "ف", score: 1, acc: 0.3, total: 10, evidence: [] },
    };
    const weak = wordScore(evt("فبب"), {
      combo: 0,
      sourceId: "fa-1k",
      weakness,
      jokers: runtime.scorePipeline,
    });
    //strong word: 3 common chars (avoid the fa rare table - ث would add +20)
    const strong = wordScore(evt("بال"), {
      combo: 0,
      sourceId: "fa-1k",
      weakness,
      jokers: runtime.scorePipeline,
    });
    expect(weak.chips).toBe(15 * 2);
    expect(strong.chips).toBe(15);
  });

  it("comboFloor from safety_net shows in the runtime", () => {
    const runtime = jokerRuntime(["safety_net"]);
    expect(runtime.comboFloor).toBe(10);
  });

  it("high_roller multiplies quota and reward in the runtime", () => {
    const runtime = jokerRuntime(["high_roller"]);
    expect(runtime.quotaMult).toBeCloseTo(1.5, 6);
    expect(runtime.rewardMult).toBe(2);
  });

  it("weakness_lens is gated on the weakness feature", () => {
    expect(jokerIsAvailable("weakness_lens", false)).toBe(false);
    expect(jokerIsAvailable("weakness_lens", true)).toBe(true);
    expect(jokerIsAvailable("greedy_fox", false)).toBe(true);
  });

  it("costAfterDiscount applies the shop discount, min 1", () => {
    const def = JOKER_REGISTRY["greedy_fox"] as JokerDef;
    expect(costAfterDiscount(def, 0)).toBe(4);
    expect(costAfterDiscount(def, 0.25)).toBe(3);
    expect(costAfterDiscount(def, 0.9)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M4: the full 30-joker deck — table-driven effect checks. Each row runs the
// joker's pipeline over a controlled word/combo and asserts the resulting
// chips/mult delta vs the same input WITHOUT the joker.
// ---------------------------------------------------------------------------

function baseline(
  word: string,
  combo: number,
  sourceId = "en-1k",
): { chips: number; mult: number; total: number } {
  return wordScore(evt(word, { comboBefore: combo }), {
    combo,
    sourceId,
    wordIndex: 0,
  });
}

function withJoker(
  jokerId: string,
  word: string,
  combo: number,
  sourceId = "en-1k",
  weakness?: Record<string, unknown>,
  language = sourceId.startsWith("fa") ? "persian" : "english",
): { chips: number; mult: number; total: number } {
  const runtime = jokerRuntime([jokerId], weakness as never);
  return wordScore(evt(word), {
    combo,
    sourceId,
    language,
    wordIndex: 0,
    weakness: weakness as never,
    jokers: runtime.scorePipeline,
  });
}

describe("the 30-joker deck (G24 M4)", () => {
  it("registry holds exactly 30 uniquely-named jokers", () => {
    const ids = Object.keys(JOKER_REGISTRY);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
  });

  it("every joker's pipeline produces the documented delta", () => {
    const cases: {
      id: string;
      word: string;
      combo: number;
      sourceId?: string;
      weakness?: Record<string, unknown>;
      /** expected total = baseline total multiplied/adjusted thus */
      expectTotal: (baseline: number) => number;
    }[] = [
      //flat chips add AFTER the mult applies to base? no: pipeline order is
      //chips then mult — the +N chips land inside the multiplier window
      { id: "greedy_fox", word: "abc", combo: 0, expectTotal: (b) => b + 150 },
      { id: "bookworm", word: "abc", combo: 0, expectTotal: (b) => b + 150 },
      //baseline already includes the +15 code bonus; the joker adds +15 more
      {
        id: "code_monkey",
        word: "abc",
        combo: 0,
        sourceId: "code-python",
        expectTotal: (b) => b + 100,
      },
      {
        id: "persian_charm",
        word: "سلام",
        combo: 0,
        sourceId: "fa-1k",
        expectTotal: (b) => Math.round(b * 1.5),
      },
      {
        id: "streak_demon",
        word: "abc",
        combo: 30,
        expectTotal: (b) => Math.round(b * 2),
      },
      {
        id: "long_words_lord",
        word: "abcdefgh",
        combo: 0,
        expectTotal: (b) => Math.round(b * 2),
      },
      {
        id: "marathon_ink",
        word: "abc",
        combo: 5,
        expectTotal: (b) => Math.round(b * 1.5),
      },
      { id: "sprinter", word: "abc", combo: 0, expectTotal: (b) => b + 200 },
      {
        id: "quick_fingers",
        word: "abc",
        combo: 0,
        expectTotal: (b) => b + 75,
      },
      {
        id: "wordsmith",
        word: "abcde",
        combo: 0,
        expectTotal: (b) => Math.round(b * 1.3),
      },
      {
        id: "english_rose",
        word: "abc",
        combo: 0,
        expectTotal: (b) => Math.round(b * 1.4),
      },
      {
        id: "perfectionist",
        word: "abc",
        combo: 0,
        expectTotal: (b) => Math.round(b * 2),
      },
      //15 chips x 1.5 tier x 2 joker = 45 (the baseline total is pre-rounded,
      //so the multiplicative expectation is computed from the raw chips)
      { id: "combo_king", word: "abc", combo: 15, expectTotal: () => 45 },
      {
        id: "heavy_hitter",
        word: "abc",
        combo: 0,
        expectTotal: (b) => b + 300,
      },
      { id: "long_haul", word: "abc", combo: 0, expectTotal: (b) => b + 400 },
      {
        id: "rhythm_master",
        word: "abc",
        combo: 0,
        expectTotal: (b) => Math.round(b * 3),
      },
      //baseline includes the +15 code bonus; the joker adds +40 more
      {
        id: "code_poet",
        word: "abc",
        combo: 0,
        sourceId: "code-python",
        expectTotal: (b) => b + 250,
      },
    ];
    for (const testCase of cases) {
      const base = baseline(
        testCase.word,
        testCase.combo,
        testCase.sourceId,
      ).total;
      const withJ = withJoker(
        testCase.id,
        testCase.word,
        testCase.combo,
        testCase.sourceId,
      ).total;
      expect(withJ, testCase.id).toBe(testCase.expectTotal(base));
    }
  });

  it("weakness_lens doubles chips only on words with weak chars", () => {
    const weakness = {
      ف: { letter: "ف", score: 1, acc: 0.3, total: 10, evidence: [] },
    };
    const base = baseline("فبب", 0, "fa-1k").total;
    const withJ = withJoker("weakness_lens", "فبب", 0, "fa-1k", weakness).total;
    expect(withJ).toBe(base * 2);
  });

  it("rule jokers surface in the runtime flags", () => {
    expect(jokerRuntime(["forgiveness_ink"]).accuracyShield).toBe(true);
    expect(jokerRuntime(["skip_broker"]).skipRefundRatio).toBe(0.5);
    expect(jokerRuntime(["second_wind"]).skipRefundRatio).toBe(1);
    expect(jokerRuntime(["safety_net"]).comboFloor).toBe(10);
    expect(jokerRuntime(["phoenix"]).comboFloor).toBe(20);
    expect(jokerRuntime(["combo_engine"]).comboFloor).toBe(5);
    expect(jokerRuntime(["golden_typist"]).goldPerWord).toBe(1);
    expect(jokerRuntime(["gold_rush"]).goldPerWord).toBe(2);
    expect(jokerRuntime(["discount_hammer"]).shopDiscount).toBeCloseTo(0.25, 6);
    expect(jokerRuntime(["shopkeepers_friend"]).shopDiscount).toBeCloseTo(
      0.15,
      6,
    );
    expect(jokerRuntime(["high_roller"]).quotaMult).toBeCloseTo(1.5, 6);
    expect(jokerRuntime(["fifty_fifty"]).quotaMult).toBeCloseTo(1.25, 6);
  });
});
