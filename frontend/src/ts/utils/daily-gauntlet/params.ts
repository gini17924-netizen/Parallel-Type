/**
 * The Daily Gauntlet's fixed day parameters (idea G22, phase 2): ONE
 * documented table so every player's daily is identical and auditable
 * (doc §۳ — «عادلانه و قابل مستندسازی»). The normalizers read their
 * targets from here too.
 */

export const DAILY_PARAMS = {
  /** G1 Word Blast: the daily locks the difficulty; the normalizer
   * maps score/targetScore → 0..1000 */
  wordBlast: { difficulty: "normal", targetScore: 3000 },
  /** G5 Sprint: the 10-second sprint; wpm/targetWpm → 0..1000 */
  sprint: { targetWpm: 100 },
  /** G2 Bot Duel: one duel at the fixed tier and length */
  botDuel: { botWpm: 80, words: 20 },
} as const;
