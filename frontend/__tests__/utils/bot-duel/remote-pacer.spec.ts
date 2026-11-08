import { describe, expect, it } from "vitest";

import { createRemotePacer } from "../../../src/ts/utils/bot-duel/remote-pacer";

// lengths 3, 2, 5 -> cumEnd [3, 6, 12], totalChars 12 (spaces included)
const WORDS = ["abc", "de", "fghij"];

describe("remote pacer (online bot-duel, LAN phase 4)", () => {
  it("starts at zero and waits for the first report", () => {
    const pacer = createRemotePacer(WORDS);
    expect(pacer.totalChars).toBe(12);
    expect(pacer.progressChars(1000)).toBe(0);
    expect(pacer.wordIndex(1000)).toBe(0);
    expect(pacer.finishMs).toBe(Number.POSITIVE_INFINITY);
    expect(pacer.finished(999_999)).toBe(false);
  });

  it("anchors a progress report and extrapolates with the observed speed", () => {
    const pacer = createRemotePacer(WORDS);
    //two completed words = cumEnd[1] + 1 separating space = 7 chars
    pacer.onProgress(2, 1000);
    expect(pacer.progressChars(1000)).toBe(7);
    expect(pacer.wordIndex(1000)).toBe(2);
    //between reports the line keeps moving at the observed rate
    expect(pacer.progressChars(1100)).toBeCloseTo(7.7, 5);
    expect(pacer.wordIndex(1100)).toBe(2); //still inside word 3
  });

  it("caps the extrapolation speed at 25 chars per second", () => {
    const pacer = createRemotePacer(WORDS);
    pacer.onProgress(1, 100); //4 chars in 100ms would be 40 cps
    //capped: 4 + 100ms * 0.025 chars/ms = 6.5
    expect(pacer.progressChars(200)).toBeCloseTo(6.5, 5);
  });

  it("the peer's finish pins the line and sets the finish time", () => {
    const pacer = createRemotePacer(WORDS);
    pacer.onProgress(2, 1000);
    pacer.onFinished(5000, 5200);
    expect(pacer.finishMs).toBe(5000);
    expect(pacer.finished(4999)).toBe(false);
    expect(pacer.finished(5000)).toBe(true);
    expect(pacer.progressChars(10_000)).toBe(12);
    expect(pacer.wordIndex(10_000)).toBe(3);
  });

  it("a null finish keeps their last progress with no finish time", () => {
    const pacer = createRemotePacer(WORDS);
    pacer.onProgress(2, 1000);
    pacer.onFinished(null, 1100);
    expect(pacer.finishMs).toBe(Number.POSITIVE_INFINITY);
    expect(pacer.progressChars(5000)).toBe(7); //pinned, no extrapolation
    expect(pacer.finished(999_999)).toBe(false);
  });

  it("wordIndex caps at the word count", () => {
    const pacer = createRemotePacer(WORDS);
    pacer.onProgress(99, 500);
    expect(pacer.wordIndex(500)).toBe(3);
  });
});
