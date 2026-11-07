import { describe, it, expect } from "vitest";

import {
  backspace,
  effectiveWordLengths,
  goldEarned,
  skipWord,
  startRound,
  submitWord,
  typeChar,
} from "../../../src/ts/utils/deck-runner/round-engine";
import type {
  BlindConfig,
  RoundState,
  WordEvent,
} from "../../../src/ts/utils/deck-runner/round-engine";
import type { WordSource } from "../../../src/ts/utils/deck-runner/words-source";

function sourceFrom(words: string[]): WordSource & { queue: string[] } {
  const queue = [...words];
  return {
    queue,
    id: "test-src",
    nextWord: () => queue.shift() ?? "spare",
  };
}

function config(overrides: Partial<BlindConfig> = {}): BlindConfig {
  return {
    quota: 100000, //default: never won unless overridden
    wordBudget: 50,
    wordSourceId: "test-src",
    isBoss: false,
    ...overrides,
  };
}

function typeWord(
  state: RoundState,
  cfg: BlindConfig,
  src: ReturnType<typeof sourceFrom>,
  typed: string,
): RoundState {
  return submitWord(state, cfg, src, { typed, elapsedMs: 400 });
}

describe("deck-runner round engine (G24)", () => {
  it("startRound pulls the first word and sets budget", () => {
    const src = sourceFrom(["abc", "def"]);
    const state = startRound(config(), src);
    expect(state.currentWord).toBe("abc");
    expect(state.wordsLeft).toBe(50);
    expect(state.finished).toBe(false);
    expect(state.combo).toBe(0);
  });

  it("a correct word scores, grows the combo and advances", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    let state = startRound(config(), src);
    state = typeWord(state, config(), src, "abc");
    expect(state.score).toBe(15); //3 chars × 5, mult 1
    expect(state.combo).toBe(1);
    expect(state.wordsLeft).toBe(49);
    expect(state.currentWord).toBe("def");
    expect(state.events[0]?.correct).toBe(true);
  });

  it("an incorrect word breaks the combo, counts errors and burns budget", () => {
    const src = sourceFrom(["abc", "abd", "abe"]);
    let state = startRound(config({ quota: 999999 }), src);
    state = typeWord(state, config({ quota: 999999 }), src, "abc");
    state = typeWord(state, config({ quota: 999999 }), src, "abd");
    state = typeWord(state, config({ quota: 999999 }), src, "abx"); //1 error vs abe
    expect(state.combo).toBe(0); //broken
    expect(state.events[2]?.correct).toBe(false);
    expect(state.events[2]?.errors).toBe(1);
    expect(state.events[2]?.accuracy).toBeCloseTo(2 / 3, 6);
    expect(state.wordsLeft).toBe(47);
  });

  it("skip burns budget but preserves the combo", () => {
    const src = sourceFrom(["abc", "skipme", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "abc");
    expect(state.combo).toBe(1);
    state = submitWord(state, cfg, src, { skipped: true });
    expect(state.combo).toBe(1); //survived
    expect(state.events[1]?.skipped).toBe(true);
    expect(state.wordsLeft).toBe(48);
  });

  it("crossing the quota finishes the round as won, immediately", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    let state = startRound(config({ quota: 10, wordBudget: 10 }), src);
    state = typeWord(state, config({ quota: 10, wordBudget: 10 }), src, "abc");
    expect(state.finished).toBe(true);
    expect(state.won).toBe(true);
    expect(state.score).toBe(15);
    //currentWord frozen after finish
    expect(state.currentWord).toBe("abc");
  });

  it("exhausting the budget without the quota loses", () => {
    const src = sourceFrom(["abc"]);
    let state = startRound(config({ quota: 100, wordBudget: 1 }), src);
    state = typeWord(state, config({ quota: 100, wordBudget: 1 }), src, "abc");
    expect(state.finished).toBe(true);
    expect(state.won).toBe(false);
  });

  it("errorPenalty boss subtracts chips and floors at zero", () => {
    const src = sourceFrom(["abc", "xyz"]);
    const cfg = config({
      quota: 999999,
      wordBudget: 10,
      isBoss: true,
      bossRule: { kind: "errorPenalty", chips: 50 },
    });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "xyz"); //wrong: score 15 then -50 -> floor 0
    expect(state.score).toBe(0);
  });

  it("perfectComboOnly freezes the combo on imperfect words", () => {
    const src = sourceFrom(["abc", "def", "abz", "ghi"]);
    const cfg = config({
      quota: 999999,
      isBoss: true,
      bossRule: { kind: "perfectComboOnly" },
    });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "abc"); //combo 1
    state = typeWord(state, cfg, src, "def"); //combo 2
    state = typeWord(state, cfg, src, "abx"); //imperfect: frozen at 2
    expect(state.combo).toBe(2);
  });

  it("without the boss rule an imperfect word resets the combo", () => {
    const src = sourceFrom(["abc", "abd", "abe", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeWord(state, cfg, src, "abc");
    state = typeWord(state, cfg, src, "abd");
    state = typeWord(state, cfg, src, "abx"); //1 error vs abd
    expect(state.combo).toBe(0);
  });

  it("gold: won small = 3, won boss = 5, loss = 0", () => {
    const wonState = {
      score: 10,
      wordsLeft: 0,
      combo: 0,
      events: [],
      finished: true,
      won: true,
      currentWord: "",
      buffer: "",
      errorsThisWord: 0,
      refundCredit: 0,
    };
    const lostState = { ...wonState, won: false };
    expect(goldEarned(config(), wonState)).toBe(3);
    expect(goldEarned(config({ isBoss: true }), wonState)).toBe(5);
    expect(goldEarned(config(), lostState)).toBe(0);
  });

  it("longWords boss raises the source minimum length", () => {
    expect(
      effectiveWordLengths(
        config({ isBoss: true, bossRule: { kind: "longWords", minLength: 6 } }),
      ),
    ).toEqual({ minLength: 6, maxLength: 10 });
    expect(effectiveWordLengths(config())).toEqual({
      minLength: 3,
      maxLength: 10,
    });
  });
});

describe("deck-runner typing buffer (G24 phase 3)", () => {
  it("typeChar grows the buffer on a match and auto-commits the word", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeChar(state, cfg, src, "a");
    state = typeChar(state, cfg, src, "b");
    expect(state.buffer).toBe("ab");
    expect(state.combo).toBe(0); //grows on completion, not per char
    state = typeChar(state, cfg, src, "c");
    expect(state.buffer).toBe(""); //committed
    expect(state.events[0]?.typed).toBe("abc");
    expect(state.combo).toBe(1);
    expect(state.currentWord).toBe("def");
  });

  it("a mismatch breaks the combo immediately and counts the error", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeChar(state, cfg, src, "a");
    state = typeChar(state, cfg, src, "x"); //wrong
    expect(state.buffer).toBe("a"); //wrong char does not advance
    expect(state.combo).toBe(0); //broken immediately
    expect(state.errorsThisWord).toBe(1);
    state = typeChar(state, cfg, src, "b");
    state = typeChar(state, cfg, src, "c");
    expect(state.events[0]?.errors).toBe(1); //carried into the word event
    expect(state.events[0]?.accuracy).toBeCloseTo(3 / 4, 6);
  });

  it("accuracyShield keeps the combo through a mismatch", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    const runtime = {
      comboFloor: 0,
      accuracyShield: true,
      goldPerWord: 0,
      rewardMult: 1,
    };
    state = typeChar(state, cfg, src, "a", runtime);
    state = typeChar(state, cfg, src, "x", runtime);
    expect(state.combo).toBe(0); //was 0 anyway
    state = typeChar(state, cfg, src, "b", runtime);
    state = typeChar(state, cfg, src, "c", runtime); //committed, combo 1
    state = typeChar(state, cfg, src, "d", runtime);
    state = typeChar(state, cfg, src, "x", runtime); //wrong with combo 1
    expect(state.combo).toBe(1); //shield kept it
    expect(state.errorsThisWord).toBe(1);
  });

  it("comboFloor lifts the combo after a break", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    const runtime = {
      comboFloor: 10,
      accuracyShield: false,
      goldPerWord: 0,
      rewardMult: 1,
    };
    state = typeChar(state, cfg, src, "a", runtime);
    state = typeChar(state, cfg, src, "x", runtime); //break -> floor 10
    expect(state.combo).toBe(10);
  });

  it("backspace shrinks the buffer without touching the combo", () => {
    const src = sourceFrom(["abc", "def", "ghi"]);
    const cfg = config({ quota: 999999 });
    let state = startRound(cfg, src);
    state = typeChar(state, cfg, src, "a");
    state = backspace(state);
    expect(state.buffer).toBe("");
    state = typeChar(state, cfg, src, "a");
    state = typeChar(state, cfg, src, "b");
    state = backspace(state);
    expect(state.buffer).toBe("a");
    expect(state.combo).toBe(0);
  });

  it("skipWord refunds budget with ruleSkipRefund and spares the combo", () => {
    const src = sourceFrom(["abc", "skipme", "def", "ghi"]);
    const cfg = config({ quota: 999999, wordBudget: 10 });
    let state = startRound(cfg, src);
    const runtime = {
      comboFloor: 0,
      accuracyShield: false,
      skipRefundRatio: 0.5,
      goldPerWord: 0,
      rewardMult: 1,
    };
    state = typeChar(state, cfg, src, "a", runtime);
    state = skipWord(state, cfg, src, runtime);
    expect(state.combo).toBe(0); //no word completed yet
    expect(state.wordsLeft).toBe(9); //one burned; the half refund rolls over
    expect(state.refundCredit).toBeCloseTo(0.5, 6);
    expect(state.events[0]?.skipped).toBe(true);
    //a second skip completes the credit: a whole word comes back
    state = skipWord(state, cfg, src, runtime);
    expect(state.wordsLeft).toBe(9); //burned 1, refunded 1
    expect(state.refundCredit).toBe(0);
  });

  it("perfectComboOnly freezes the combo per keystroke and blocks growth on imperfect words", () => {
    const src = sourceFrom(["abc", "def", "ghi", "jkl"]);
    const bossCfg = config({
      quota: 999999,
      isBoss: true,
      bossRule: { kind: "perfectComboOnly" },
    });
    let state = startRound(bossCfg, src);
    for (const ch of "abc") state = typeChar(state, bossCfg, src, ch);
    for (const ch of "def") state = typeChar(state, bossCfg, src, ch);
    expect(state.combo).toBe(2);
    state = typeChar(state, bossCfg, src, "x"); //mismatch: frozen, not reset
    expect(state.combo).toBe(2);
    for (const ch of "ghi") state = typeChar(state, bossCfg, src, ch); //imperfect commit
    expect(state.combo).toBe(2); //no growth on an imperfect word
    for (const ch of "jkl") state = typeChar(state, bossCfg, src, ch); //perfect
    expect(state.combo).toBe(3);
  });
});

describe("deck-runner score joker wiring (G24 phase 5)", () => {
  const wiredCfg = (overrides: Partial<BlindConfig> = {}): BlindConfig => ({
    quota: 999999,
    wordBudget: 10,
    wordSourceId: "test-src",
    language: "english",
    isBoss: false,
    ...overrides,
  });

  function runtimeWith(
    pipeline: {
      (
        acc: { chips: number; mult: number },
        evt: WordEvent,
        ctx: {
          combo: number;
          wordIndex?: number;
          language?: string;
          sourceId: string;
        },
      ): { chips: number; mult: number };
    }[],
  ): Parameters<typeof typeChar>[4] {
    return {
      comboFloor: 0,
      accuracyShield: false,
      goldPerWord: 0,
      rewardMult: 1,
      scorePipeline: pipeline,
    };
  }

  it("a flatChips joker in the runtime pipeline adds its chips via typeChar", () => {
    const src = sourceFrom(["abc", "def"]);
    const runtime = runtimeWith([(acc) => ({ ...acc, chips: acc.chips + 25 })]);
    let state = startRound(wiredCfg(), src);
    for (const ch of "abc") {
      state = typeChar(state, wiredCfg(), src, ch, runtime);
    }
    expect(state.score).toBe(15 + 25); //3 chars x 5 + joker 25, mult 1
  });

  it("everyNthWord counts words from 0 through the engine (wordIndex wired)", () => {
    //rare-char-free words so the only delta is the joker (+100 on words 0/5)
    const words = ["abc", "def", "ghi", "abc", "def", "ghi"];
    const src = sourceFrom(words);
    const runtime = runtimeWith([
      (acc, evt, ctx) =>
        (ctx.wordIndex ?? -1) % 5 === 0
          ? { ...acc, chips: acc.chips + 100 }
          : acc,
    ]);
    let state = startRound(wiredCfg(), src);
    for (const word of words) {
      for (const ch of word) {
        state = typeChar(state, wiredCfg(), src, ch, runtime);
      }
    }
    //word 0: (15+100)x1 = 115; words 1-3: 15 each; word 4: 15x1.2 = 18
    //(streak 5 tier); word 5: (15+100)x1.2 = 138 -> total 316
    expect(state.score).toBe(316);
  });

  it("languageIs receives the run language through the engine", () => {
    const src = sourceFrom(["abc"]);
    const runtime = runtimeWith([
      (acc, evt, ctx) =>
        ctx.language === "persian" ? { ...acc, mult: acc.mult * 2 } : acc,
    ]);
    let state = startRound(wiredCfg({ language: "persian" }), src);
    for (const ch of "abc") {
      state = typeChar(
        state,
        wiredCfg({ language: "persian" }),
        src,
        ch,
        runtime,
      );
    }
    expect(state.score).toBe(30); //15 chips x joker 2
  });

  it("submitWord honors the pipeline too", () => {
    const src = sourceFrom(["abc"]);
    const runtime = runtimeWith([(acc) => ({ ...acc, chips: acc.chips + 25 })]);
    let state = startRound(wiredCfg(), src);
    state = submitWord(state, wiredCfg(), src, { typed: "abc" }, runtime);
    expect(state.score).toBe(40);
  });
});
