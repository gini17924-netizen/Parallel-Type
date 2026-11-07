import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/beat-keys/balance";
import { beatMs, generateChart } from "../../../src/ts/utils/beat-keys/chart";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("beat-keys chart (idea G21 phase 1)", () => {
  it("the beat→ms mapping is regular per bpm", () => {
    for (const bpm of [70, 100, 130]) {
      const chart = generateChart({ bpm, rng: makeRng(7) });
      expect(chart.beatMs).toBeCloseTo(beatMs(bpm), 6);
      for (const note of chart.notes) {
        //every note sits on its beat boundary within the ms-rounding
        //bound (tMs is stored rounded to whole milliseconds)
        const k = Math.round(note.tMs / chart.beatMs);
        expect(Math.abs(note.tMs - k * chart.beatMs)).toBeLessThanOrEqual(
          0.5000001,
        );
      }
    }
  });

  it("the lanes stay 0..3 and each lane's key maps to it", () => {
    const chart = generateChart({ bpm: 100, rng: makeRng(11) });
    expect(chart.notes.length).toBeGreaterThan(20);
    for (const note of chart.notes) {
      expect(note.lane).toBeGreaterThanOrEqual(0);
      expect(note.lane).toBeLessThanOrEqual(BALANCE.laneCount - 1);
      expect(note.key).toBe(BALANCE.laneKeys[note.lane]);
    }
  });

  it("the same seed produces the same chart (deterministic)", () => {
    const a = generateChart({ bpm: 100, rng: makeRng(42) });
    const b = generateChart({ bpm: 100, rng: makeRng(42) });
    expect(a.notes).toEqual(b.notes);
  });

  it("no two same-key notes sit inside the judge window", () => {
    const chart = generateChart({ bpm: 130, rng: makeRng(5) });
    for (let i = 1; i < chart.notes.length; i++) {
      const note = chart.notes[i];
      if (note === undefined) continue;
      for (let j = Math.max(0, i - 4); j < i; j++) {
        const prev = chart.notes[j];
        if (prev === undefined) continue;
        if (prev.key === note.key) {
          expect(note.tMs - prev.tMs).toBeGreaterThanOrEqual(
            BALANCE.windowPoorMs,
          );
        }
      }
    }
  });

  it("the chart leads in before the first note", () => {
    const chart = generateChart({ bpm: 100, rng: makeRng(3) });
    const first = chart.notes[0];
    expect(first?.tMs ?? 0).toBeGreaterThanOrEqual(
      BALANCE.leadInBeats * chart.beatMs,
    );
  });
});
