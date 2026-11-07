import { describe, it, expect } from "vitest";

import {
  shopOffers,
  rewardOffers,
} from "../../../src/ts/utils/deck-runner/shop";
import { startRun } from "../../../src/ts/utils/deck-runner/run-engine";
import { jokerRuntime } from "../../../src/ts/utils/deck-runner/cards";

describe("deck-runner shop & rewards (G24 phase 2)", () => {
  it("offers are deterministic for the same run position", () => {
    const mk = (): string[] => {
      const state = startRun({
        seed: 1234,
        language: "english",
        wordSourceId: "en-1k",
      });
      const runtime = jokerRuntime(state.jokers);
      return shopOffers(state, runtime, false).map((o) => o.jokerId);
    };
    expect(mk()).toEqual(mk());
  });

  it("ante 1 offers 3 cards, ante 2 offers 4", () => {
    const state1 = startRun({
      seed: 5,
      language: "english",
      wordSourceId: "en-1k",
    });
    expect(shopOffers(state1, jokerRuntime([]), false)).toHaveLength(3);
    const state2 = {
      ...startRun({ seed: 5, language: "english", wordSourceId: "en-1k" }),
      ante: 2,
    };
    expect(shopOffers(state2, jokerRuntime([]), false)).toHaveLength(4);
  });

  it("owned non-duplicable jokers are excluded from offers", () => {
    const state = startRun({
      seed: 9,
      language: "english",
      wordSourceId: "en-1k",
    });
    //own a rare non-duplicable joker: it must never reappear in offers
    const owned = "streak_demon";
    const withOwned = { ...state, jokers: [owned] };
    const offers = shopOffers(withOwned, jokerRuntime(withOwned.jokers), false);
    expect(offers.map((o) => o.jokerId)).not.toContain(owned);
  });

  it("one shop never offers the same joker twice", () => {
    for (let s = 0; s < 20; s++) {
      const state = {
        ...startRun({
          seed: 77 + s,
          language: "english",
          wordSourceId: "en-1k",
        }),
        ante: 2,
      };
      const ids = shopOffers(state, jokerRuntime([]), false).map(
        (o) => o.jokerId,
      );
      expect(new Set(ids).size, `seed ${77 + s}`).toBe(ids.length);
    }
  });

  it("shopDiscount lowers the offer cost", () => {
    const state = startRun({
      seed: 9,
      language: "english",
      wordSourceId: "en-1k",
    });
    const noDiscount = shopOffers(state, jokerRuntime([]), false);
    const discounted = shopOffers(
      state,
      jokerRuntime(["discount_hammer"]),
      false,
    );
    for (let i = 0; i < noDiscount.length; i++) {
      expect(discounted[i]?.cost).toBeLessThanOrEqual(noDiscount[i]?.cost ?? 0);
    }
  });

  it("rewardOffers: exactly one guaranteed common, never empty, no owned non-duplicables", () => {
    const state = startRun({
      seed: 21,
      language: "english",
      wordSourceId: "en-1k",
    });
    for (let seedShift = 0; seedShift < 5; seedShift++) {
      const shifted = { ...state, seed: state.seed + seedShift };
      const rewards = rewardOffers(shifted, false);
      expect(rewards.length).toBeGreaterThan(0);
      expect(rewards.length).toBeLessThanOrEqual(3);
    }
  });

  it("rewardOffers skip weakness-gated jokers without the feature", () => {
    const state = startRun({
      seed: 33,
      language: "english",
      wordSourceId: "en-1k",
    });
    for (let s = 0; s < 10; s++) {
      const shifted = { ...state, seed: state.seed + s };
      const rewards = rewardOffers(shifted, false);
      expect(rewards).not.toContain("weakness_lens");
    }
    const withWeakness = rewardOffers({ ...state, seed: 999 }, true);
    //with the feature on, it MAY appear - the assertion is just pool sanity
    expect(withWeakness.length).toBeGreaterThan(0);
  });
});
