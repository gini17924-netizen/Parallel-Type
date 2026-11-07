/**
 * Crane Stack balance (idea G17, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** the crane sweeps 0..100% of the court, ping-ponging at the edges */
  craneSpeedStart: 40,
  craneSpeedPerLevel: 8,
  /** the key sequence: 4-6 keys from the weak/unlocked letters */
  seqMinLen: 4,
  seqMaxLen: 6,
  /** the release quality windows (% distance from the zone center) */
  perfectPct: 4,
  goodPct: 10,
  poorPct: 20,
  perfectScore: 300,
  goodScore: 150,
  poorScore: 50,
  /** 3 misses = the run is over (doc G17 §۰.۳) */
  maxMisses: 3,
  /** level-up every 10 floors (doc G17 §۰.۶) */
  floorsPerLevel: 10,
  /** the zone shifts +-this % per level (seed-adjacent) */
  zoneShiftPct: 15,
  /** the perfect-streak bonus (doc G17 §۰.۶) */
  perfectStreakBonus: 50,
} as const;
