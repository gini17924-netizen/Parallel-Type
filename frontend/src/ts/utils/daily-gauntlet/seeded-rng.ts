/**
 * The daily stage seeding (idea G22 v2 — closes KI-40): a stage's seed
 * drives a deterministic LCG so EVERY random decision in that stage's
 * run replays identically for every player on that day. The same
 * generator the engines use (chart.ts, learn-stats.ts).
 */

/** deterministic LCG: 1..(2^31-1), seeded by the stage's hash */
export function createSeededRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
