import { beforeEach, describe, expect, it } from "vitest";

import {
  ghostAbandon,
  ghostFinish,
  ghostSample,
  ghostScoreAt,
  ghostStart,
  getGhostRun,
} from "../../src/ts/utils/ghost/ghost-store";

function runToScore(gameId: string, targetScore: number, ticks: number): void {
  ghostStart(gameId);
  const step = Math.max(1, Math.floor(targetScore / ticks));
  for (let t = 0; t < ticks; t++) {
    ghostSample(gameId, Math.min(targetScore, step * (t + 1)));
  }
  ghostFinish(gameId, targetScore);
}

describe("phase 82 — the ghost store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a run becomes the ghost when it beats the stored score", () => {
    runToScore("sprint", 40, 40);
    const ghost = getGhostRun("sprint");
    expect(ghost?.score).toBe(40);
    //a slower run does NOT replace it
    runToScore("sprint", 30, 40);
    expect(getGhostRun("sprint")?.score).toBe(40);
    //a faster run does
    runToScore("sprint", 55, 40);
    expect(getGhostRun("sprint")?.score).toBe(55);
  });

  it("ghostScoreAt steps through the timeline", () => {
    ghostStart("word-blast");
    ghostSample("word-blast", 0);
    ghostSample("word-blast", 10);
    ghostSample("word-blast", 20);
    ghostFinish("word-blast", 20);
    const ghost = getGhostRun("word-blast");
    expect(ghostScoreAt(ghost, 0)).toBe(0);
    expect(ghostScoreAt(ghost, 1)).toBe(10);
    expect(ghostScoreAt(ghost, 5)).toBe(20);
    //beyond the last sample: the final value holds
    expect(ghostScoreAt(ghost, 999)).toBe(20);
  });

  it("no ghost means no overlay value", () => {
    expect(ghostScoreAt(getGhostRun("stack-attack"), 0)).toBeUndefined();
    ghostStart("stack-attack");
    //a live run without a finish never becomes a ghost
    ghostSample("stack-attack", 15);
    expect(ghostScoreAt(getGhostRun("stack-attack"), 0)).toBeUndefined();
  });

  it("a restart at run start never leaks the previous samples", () => {
    runToScore("balloon-pop", 30, 30);
    //a fresh run samples a few ticks then abandons
    ghostStart("balloon-pop");
    ghostSample("balloon-pop", 5);
    ghostAbandon("balloon-pop");
    ghostStart("balloon-pop");
    ghostSample("balloon-pop", 2);
    //the finished run: only the fresh run's samples count
    ghostFinish("balloon-pop", 8);
    //the 8-run is worse than the 30 ghost: the ghost is untouched...
    expect(getGhostRun("balloon-pop")?.score).toBe(30);
    //...and the timeline is exactly the 30-run's 30 samples — the
    //abandoned run's stray sample (5) never appended to it
    expect(getGhostRun("balloon-pop")?.samples).toHaveLength(30);
    expect(getGhostRun("balloon-pop")?.samples[0]?.score).toBe(1);
    expect(getGhostRun("balloon-pop")?.samples[29]?.score).toBe(30);
  });

  it("the sample budget compresses long runs without losing the shape", () => {
    ghostStart("marathon-test");
    for (let t = 0; t < 5_000; t++) {
      ghostSample("marathon-test", Math.floor(t / 10));
    }
    ghostFinish("marathon-test", 499);
    const ghost = getGhostRun("marathon-test");
    expect(ghost?.samples.length ?? 0).toBeLessThanOrEqual(2_100);
    //the shape holds: the last sample carries the run's peak
    const last = ghost?.samples[ghost.samples.length - 1] as {
      t: number;
      score: number;
    };
    expect(last.score).toBe(499);
    //monotonic: each kept sample is at or after the previous
    const times = ghost?.samples.map((s) => s.t) as number[];
    for (let i = 1; i < times.length; i++) {
      expect(times[i] as number).toBeGreaterThan(times[i - 1] as number);
    }
  });
});
