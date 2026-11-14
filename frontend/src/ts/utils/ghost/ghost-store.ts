import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * Ghost racing (phase 82): your own previous BEST run becomes the
 * opponent — the store keeps, per game, the best run's progress timeline
 * (sampled per tick) and the wiring asks it two questions: is this run's
 * final score a new ghost (save), and what had the ghost scored by tick
 * t (the overlay).
 *
 * The timeline's t is the TICK INDEX — the games tick uniformly, so the
 * index is the honest clock and no startedAt bookkeeping is needed. The
 * score is the game's progress number (words for sprint, score for the
 * rest — the wiring decides).
 */

export type GhostSample = { t: number; score: number };

export type GhostRun = {
  /** the best final score this ghost ever achieved */
  score: number;
  /** the progress timeline, one sample per recorded tick (capped) */
  samples: GhostSample[];
};

const ghostStore = new LocalStorageWithSchema({
  key: "mtDesktopGhosts",
  schema: z.record(
    z.string(),
    z.object({
      score: z.number(),
      samples: z.array(
        z.object({ t: z.number().nonnegative(), score: z.number() }),
      ),
    }),
  ),
  fallback: {},
});

/** the sample cap: a 15-minute run at 20 ticks/second is 18k samples —
 * the store keeps a stride that fits, preserving the shape of the curve */
const SAMPLE_BUDGET = 2_000;

function compress(samples: GhostSample[]): GhostSample[] {
  if (samples.length <= SAMPLE_BUDGET) return samples;
  const stride = Math.ceil(samples.length / SAMPLE_BUDGET);
  const out: GhostSample[] = [];
  for (let i = samples.length - 1; i >= 0; i -= stride) {
    out.unshift(samples[i] as GhostSample);
  }
  //always keep the first sample (the run's opening)
  if (out[0] !== samples[0]) out.unshift(samples[0] as GhostSample);
  return out;
}

export function getGhostRun(gameId: string): GhostRun | undefined {
  const store = ghostStore.get();
  return store[gameId];
}

/** starts (or restarts) the live run — the caller calls it at every run
 * start so a previous run's samples can never leak into the next */
export function ghostStart(gameId: string): void {
  liveRuns[gameId] = { startScore: 0, samples: [] };
}

/**
 * samples one tick of the live run — the caller calls this every tick
 * with the game's current progress number
 */
export function ghostSample(gameId: string, score: number): void {
  const live = liveRuns[gameId] ?? { startScore: 0, samples: [] };
  live.samples.push({ t: live.samples.length, score });
  liveRuns[gameId] = live;
}

/** the live runs (per session, per game) that ghostSample feeds */
const liveRuns: Record<string, { startScore: number; samples: GhostSample[] }> =
  {};

/** closes the live run: a new ghost when the final score beats the stored
 * one (or no ghost exists yet). Returns whether the run became the ghost. */
export function ghostFinish(gameId: string, finalScore: number): boolean {
  const live = liveRuns[gameId];
  liveRuns[gameId] = undefined as never;
  if (live === undefined) return false;
  const best = ghostStore.get()[gameId];
  if (best !== undefined && finalScore <= best.score) return false;
  ghostStore.set({
    ...ghostStore.get(),
    [gameId]: {
      score: finalScore,
      samples: compress(live.samples),
    },
  });
  return true;
}

/** abandons the live run (a voided match, a leave) */
export function ghostAbandon(gameId: string): void {
  liveRuns[gameId] = undefined as never;
}

/**
 * the ghost's score by tick t — step interpolation over the stored
 * timeline (the last sample at or before t); undefined when no ghost or
 * before its first sample
 */
export function ghostScoreAt(
  ghost: GhostRun | undefined,
  t: number,
): number | undefined {
  if (ghost === undefined || ghost.samples.length === 0) return undefined;
  let value: number | undefined;
  for (const sample of ghost.samples) {
    if (sample.t <= t) value = sample.score;
    else break;
  }
  return value;
}
