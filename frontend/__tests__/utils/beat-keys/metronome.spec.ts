import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMetronome,
  type MetronomeAudioCtx,
} from "../../../src/ts/utils/beat-keys/metronome";

type StartedOsc = { at: number };

function makeCtx(): MetronomeAudioCtx & { started: StartedOsc[] } {
  const started: StartedOsc[] = [];
  return {
    currentTime: 0,
    destination: {},
    started,
    createOscillator: () => ({
      type: "",
      frequency: { setValueAtTime: () => undefined },
      connect: () => undefined,
      start: (when?: number) => {
        started.push({ at: when ?? -1 });
      },
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("beat-keys metronome (idea G21 phase 1)", () => {
  it("the lookahead pass registers clicks only within 100ms ahead", () => {
    const ctx = makeCtx();
    const m = createMetronome({ audioCtx: ctx, bpm: 100 }); //beat = 0.6s
    //the beat grid anchors at creation (0 + 0.1s lookahead)
    ctx.currentTime = 0.05;
    m.schedulePass();
    //click at 0.1 is inside the window (0.05..0.15); the next (0.7) is not
    expect(m.clickCount()).toBe(1);
    expect(ctx.started[0]?.at).toBeCloseTo(0.1, 6);
    expect(m.nextClickSec()).toBeCloseTo(0.7, 6);
  });

  it("the scheduled clicks keep the exact beat gap", () => {
    const ctx = makeCtx();
    const m = createMetronome({ audioCtx: ctx, bpm: 130 }); //beat ≈ 0.4615s
    ctx.currentTime = 0.5;
    m.schedulePass();
    ctx.currentTime = 1.4;
    m.schedulePass();
    expect(m.clickCount()).toBeGreaterThanOrEqual(2);
    const gap = (ctx.started[1]?.at ?? 0) - (ctx.started[0]?.at ?? 0);
    expect(gap).toBeCloseTo(60 / 130, 6);
  });

  it("start() runs the 25ms scheduler until stopped", () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const m = createMetronome({ audioCtx: ctx, bpm: 100 });
    m.start();
    for (let i = 0; i < 6; i++) {
      ctx.currentTime += 0.03;
      vi.advanceTimersByTime(25);
    }
    expect(m.clickCount()).toBeGreaterThan(0);
    m.stop();
    const before = m.clickCount();
    for (let i = 0; i < 6; i++) {
      ctx.currentTime += 0.03;
      vi.advanceTimersByTime(25);
    }
    expect(m.clickCount()).toBe(before); //the interval is gone
  });
});
