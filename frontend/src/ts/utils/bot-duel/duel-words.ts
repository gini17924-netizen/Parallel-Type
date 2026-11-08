/**
 * Bot Duel word sequences (idea G2): the race length is filled by
 * cycling the language pool. Shared by the offline picker and the LAN
 * lobby — the host builds ONE sequence and ships it to the peer inside
 * the start message, so both sides type the exact same words.
 */

export const FALLBACK_WORDS = [
  "parallel",
  "typing",
  "speed",
  "focus",
  "rhythm",
  "words",
];

/** fills the race to the requested length by cycling the language pool */
export function buildRaceWords(pool: string[], raceWords: number): string[] {
  const source = pool.length > 0 ? pool : FALLBACK_WORDS;
  const out: string[] = [];
  for (let i = 0; i < raceWords; i++) {
    out.push(source[i % source.length] ?? "typo");
  }
  return out;
}
