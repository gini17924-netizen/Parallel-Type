import { describe, it, expect } from "vitest";

import { QUOTA_GROWTH } from "../../../src/ts/utils/deck-runner/balance";

import {
  currentBlindConfig,
  endBlind,
  claimReward,
  nextBlind,
  rerollShop,
  skipReward,
  startRun,
} from "../../../src/ts/utils/deck-runner/run-engine";
import { jokerRuntime } from "../../../src/ts/utils/deck-runner/cards";

describe("deck-runner run state machine (G24 phase 2)", () => {
  it("startRun: ante 1, blind 0, starting gold, blind phase", () => {
    const state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    expect(state.phase).toBe("blind");
    expect(state.ante).toBe(1);
    expect(state.blindIndex).toBe(0);
    expect(state.gold).toBe(4);
  });

  it("blind quota grows x1.6 per ante and x1/1.5/2.5 per blind slot", () => {
    const runtime = jokerRuntime([]);
    const mk = (ante: number, blindIndex: number): number =>
      currentBlindConfig(
        {
          ...startRun({ seed: 1, language: "english", wordSourceId: "en-1k" }),
          ante,
          blindIndex,
        },
        runtime,
      ).quota;
    const base = mk(1, 0);
    expect(mk(1, 1)).toBe(Math.round(base * 1.5));
    expect(mk(1, 2)).toBe(Math.round(base * 2.5));
    expect(mk(2, 0)).toBe(Math.round(base * QUOTA_GROWTH));
    //riskQuota joker multiplies the quota
    const roller = jokerRuntime(["high_roller"]);
    expect(
      currentBlindConfig(
        {
          ...startRun({ seed: 1, language: "english", wordSourceId: "en-1k" }),
          jokers: ["high_roller"],
        },
        roller,
      ).quota,
    ).toBe(Math.round(base * 1.5));
  });

  it("boss blind is the third slot", () => {
    const runtime = jokerRuntime([]);
    const boss = currentBlindConfig(
      {
        ...startRun({ seed: 1, language: "english", wordSourceId: "en-1k" }),
        blindIndex: 2,
      },
      runtime,
    );
    expect(boss.isBoss).toBe(true);
  });

  it("winning a blind moves to reward and pays gold (goldPerWord x rewardMult)", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    state = {
      ...state,
      jokers: ["golden_typist", "high_roller"],
    };
    const runtime = jokerRuntime(state.jokers);
    //a blind where 6 words were typed, all correct, quota crossed
    state = endBlind(
      state,
      { score: 500, won: true, wordsTyped: 6, wordsSkipped: 0 },
      runtime,
      {
        isBoss: false,
      },
    );
    expect(state.phase).toBe("reward");
    expect(state.gold).toBe(4 + Math.round((3 + 6 * 1) * 2));
    expect(state.lastRound?.won).toBe(true);
  });

  it("losing a blind ends the run in gameover", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    state = endBlind(
      state,
      { score: 10, won: false, wordsTyped: 25, wordsSkipped: 0 },
      jokerRuntime([]),
      {
        isBoss: false,
      },
    );
    expect(state.phase).toBe("gameover");
    expect(state.lastRound?.won).toBe(false);
  });

  it("claimReward adds the joker and moves to shop; respects slots and duplicates", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    state = { ...state, phase: "reward" as const };
    state = claimReward(state, "greedy_fox");
    expect(state.phase).toBe("shop");
    expect(state.jokers).toEqual(["greedy_fox"]);

    //duplicate of a non-duplicable joker is refused (state unchanged)
    const refused = claimReward(state, "greedy_fox");
    expect(refused.jokers).toEqual(["greedy_fox"]);

    //slot cap: fill 5 slots, a 6th claim is refused
    const full = {
      ...state,
      jokers: [
        "bookworm",
        "code_monkey",
        "persian_charm",
        "skip_broker",
        "streak_demon",
      ],
      phase: "reward" as const,
    };
    expect(claimReward(full, "greedy_fox").jokers).toHaveLength(5);
  });

  it("claimReward outside the reward phase is a no-op", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    const before = { ...state };
    state = claimReward(state, "greedy_fox");
    expect(state).toEqual(before);
  });

  it("skipReward moves reward -> shop", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    state = { ...state, phase: "reward" as const };
    state = skipReward(state);
    expect(state.phase).toBe("shop");
  });

  it("nextBlind advances blindIndex then the ante, resetting the blind score", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    state = { ...state, phase: "shop" as const, score: 123 };
    state = nextBlind(state);
    expect(state.blindIndex).toBe(1);
    expect(state.score).toBe(0);
    state = nextBlind({ ...state, phase: "shop" as const });
    state = nextBlind({ ...state, phase: "shop" as const }); //boss cleared
    expect(state.ante).toBe(2);
    expect(state.blindIndex).toBe(0);
  });

  it("rerollShop costs gold and bumps the counter", () => {
    let state = startRun({
      seed: 7,
      language: "english",
      wordSourceId: "en-1k",
    });
    state = { ...state, phase: "shop" as const, gold: 10 };
    state = rerollShop(state);
    expect(state.gold).toBe(8);
    expect(state.rerolls).toBe(1);
    //too poor: refused
    const poor = { ...state, gold: 1 };
    expect(rerollShop(poor).rerolls).toBe(state.rerolls);
  });
});
