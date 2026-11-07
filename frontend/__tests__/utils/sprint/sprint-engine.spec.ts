import { describe, expect, it } from "vitest";

import { createSprintEngine } from "../../../src/ts/utils/sprint/sprint-engine";

/** a deterministic stream cycling the given words */
function stream(words: string[]): () => string {
  let i = 0;
  return () => words[i++ % words.length] ?? "typo";
}

/** a fixed rng: the arming delay lands on the minimum (800ms) */
const zeroRng = (): number => 0;

describe("sprint engine (idea G5 phase 1)", () => {
  it("arms with the minimum delay on a zero rng", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    const state = engine.state();
    expect(state.phase).toBe("arming");
    expect(state.goAt).toBe(1800); //1000 + 800 (min delay, rng 0)
  });

  it("a pre-GO character key is a false start and voids the attempt", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    const feed = engine.feedKey(1200, "a"); //before goAt 1800
    expect(feed).toEqual({ accepted: false, falseStart: true });
    expect(engine.state().phase).toBe("done");
    expect(engine.state().voided).toBe(true);
    expect(engine.state().result).toBeUndefined();
  });

  it("a pre-GO Backspace is not a false start", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    const feed = engine.feedKey(1200, "Backspace");
    expect(feed.accepted).toBe(false);
    expect(feed.falseStart).toBeUndefined();
    expect(engine.state().phase).toBe("arming");
  });

  it("starts exactly at goAt (a key at the GO moment begins the race)", () => {
    const engine = createSprintEngine({
      next: stream(["abc", "def"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    const feed = engine.feedKey(1800, "a"); //exactly goAt
    expect(feed.accepted).toBe(true);
    const state = engine.state();
    expect(state.phase).toBe("running");
    expect(state.startedAt).toBe(1800);
    expect(state.chars).toBe(1);
  });

  it("counts the doc's metric set: 85 chars -> wpm 102", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]), //words repeat; keystrokes are what matters
      durationMs: 10000,
      rng: zeroRng,
    });
    engine.arm(1000);
    //85 correct keystrokes inside the window: 3-char words keep completing
    for (let i = 0; i < 85; i++) {
      const word = engine.state().currentWord;
      const ch = word[engine.state().typed] ?? "a";
      engine.feedKey(1000 + 800 + i * 50, ch);
    }
    engine.tick(1000 + 800 + 10000);
    const result = engine.state().result;
    expect(result?.chars).toBe(85);
    expect(result?.wpm).toBe(102); //85 / 5 / (10000/60000)
    expect(result?.raw).toBe(85);
    expect(result?.accuracy).toBe(100);
    expect(result?.keystrokeIntervals.every((gap) => gap === 50)).toBe(true);
  });

  it("wrong keys count into chars and accuracy, not into raw", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    engine.feedKey(1800, "a"); //correct
    engine.feedKey(1850, "x"); //wrong (momentary)
    engine.feedKey(1900, "b"); //correct
    engine.tick(1000 + 800 + 10000);
    const result = engine.state().result;
    expect(result?.chars).toBe(3);
    expect(result?.raw).toBe(2);
    expect(result?.accuracy).toBe(67); //2/3, rounded
    expect(result?.wpm).toBe(Math.round((3 / 5) * 6));
  });

  it("locks the input once the duration has elapsed", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    engine.feedKey(1800, "a"); //elapsed 0
    const state = engine.feedKey(1000 + 800 + 10000, "b"); //elapsed exactly 10000
    expect(state.accepted).toBe(false);
    engine.tick(1000 + 800 + 10001);
    expect(engine.state().phase).toBe("done");
    expect(engine.state().result?.chars).toBe(1); //the late key never counted
  });

  it("a partial last word still counts its typed characters", () => {
    const engine = createSprintEngine({
      next: stream(["abcdefgh"]), //8 chars: only 5 will be typed
      rng: zeroRng,
    });
    engine.arm(1000);
    const longWord = "abcdefgh";
    for (let i = 0; i < 5; i++) {
      engine.feedKey(1800 + i * 50, longWord[i] ?? "a");
    }
    engine.tick(1000 + 800 + 10000);
    expect(engine.state().result?.chars).toBe(5);
    expect(engine.state().wordsComplete).toBe(0); //the word never completed
  });

  it("a window blur voids the attempt without a result", () => {
    const engine = createSprintEngine({
      next: stream(["abc"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    engine.feedKey(1800, "a");
    engine.voidRace();
    expect(engine.state().phase).toBe("done");
    expect(engine.state().voided).toBe(true);
    expect(engine.state().result).toBeUndefined();
  });

  it("keystroke intervals measure the gaps between character keys", () => {
    const engine = createSprintEngine({
      next: stream(["abcdef"]),
      rng: zeroRng,
    });
    engine.arm(1000);
    engine.feedKey(1800, "a"); //first key: no interval
    engine.feedKey(1900, "b"); //+100
    engine.feedKey(2050, "c"); //+150
    engine.tick(1000 + 800 + 10000);
    expect(engine.state().result?.keystrokeIntervals).toEqual([100, 150]);
  });
});
