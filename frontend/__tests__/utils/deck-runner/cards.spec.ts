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
    expect(result.chips).toBe(15 + 25);
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
    expect(perfect.chips).toBe(15 + 30);
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
    expect(result.chips).toBe(15 + 50);
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
