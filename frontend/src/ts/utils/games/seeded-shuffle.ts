/**
 * The shared seeded LCG shuffle (the daily/GP/sprint word order): the
 * same algorithm the sprint page's seededShuffle uses, seeded by a match
 * seed — both machines rebuild the identical sequence locally, so LAN
 * matches ship a seed instead of a word list.
 */
export function shuffleWithSeed(pool: string[], seed: number): string[] {
  let state = String(seed)
    .split("")
    .reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  if (state <= 0) state += 2147483646;
  const rand = (): number => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
}
