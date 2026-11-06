/**
 * Deck Runner RNG (idea G24) — seeded LCG, same family as learn-stats'
 * bigram generator but with an INJECTED seed: every random decision of a
 * run (word order, shop, rewards) flows from one stream, so a run is
 * reproducible from its seed (the base for daily runs and tests).
 * Lesson.rng (upstream static) is never used.
 */

export function createRng(seed: number): () => number {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return (): number => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

/** derives an independent seed from a base seed and a positional salt, so
 * each game position (shop/reward per ante+blind) has its own reproducible
 * stream without persisting rng state */
export function deriveSeed(base: number, salt: string): number {
  let hash = base ^ 0x9e3779b9;
  for (const ch of salt) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647;
  }
  if (hash <= 0) hash += 2147483646;
  return hash;
}
