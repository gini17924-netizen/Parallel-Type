import { BALANCE } from "./balance";

/**
 * Beat Keys chart (idea G21, phase 1): a pure beat→ms chart with no
 * music files — a fixed BPM per difficulty and seeded 4-beat repeating
 * lane patterns for feel (doc §۰.۳). The calibration offset is applied
 * by the ENGINE at judge time, never baked into the chart. PURE: the
 * rng is injected.
 */

export type BeatNote = { tMs: number; lane: number; key: string };

export type BeatChart = {
  bpm: number;
  beatMs: number;
  durationBeats: number;
  notes: BeatNote[];
};

export function beatMs(bpm: number): number {
  return 60000 / bpm;
}

/** one bar's lane plan: a lane per beat, a seeded rest on the 4th beat */
function buildPattern(rng: () => number, laneCount: number): number[] {
  const pattern: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i === 3 && rng() < 0.5) {
      pattern.push(-1); //a rest beat keeps the feel
      continue;
    }
    pattern.push(Math.floor(rng() * laneCount) % laneCount);
  }
  //an all-rest bar would stall the chart — force a lane-0 hit instead
  if (pattern.every((lane) => lane === -1)) {
    return [0, -1, -1, -1];
  }
  return pattern;
}

export function generateChart(options: {
  bpm: number;
  durationBeats?: number;
  /** one key per lane; defaults to BALANCE.laneKeys */
  keys?: string[];
  rng: () => number;
}): BeatChart {
  const durationBeats = options.durationBeats ?? BALANCE.durationBeats;
  const keys = options.keys ?? BALANCE.laneKeys;
  const step = beatMs(options.bpm);
  const notes: BeatNote[] = [];
  const lastTByKey = new Map<string, number>();
  let pattern = buildPattern(options.rng, keys.length);
  for (let beat = 0; beat < durationBeats; beat++) {
    //re-roll the 4-beat pattern every 2 bars (seed-adjacent variety)
    if (beat % 8 === 0) pattern = buildPattern(options.rng, keys.length);
    if (beat < BALANCE.leadInBeats) continue; //a lead-in before the first note
    const lane = pattern[beat % 4] ?? -1;
    if (lane === -1) continue;
    const key = keys[lane] ?? "d";
    const tMs = Math.round(beat * step);
    //the doc guarantee: no two same-key notes inside the judge window
    const last = lastTByKey.get(key);
    if (last !== undefined && tMs - last < BALANCE.windowPoorMs) continue;
    lastTByKey.set(key, tMs);
    notes.push({ tMs, lane, key });
  }
  return { bpm: options.bpm, beatMs: step, durationBeats, notes };
}
