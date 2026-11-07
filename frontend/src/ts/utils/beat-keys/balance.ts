/**
 * Beat Keys balance (idea G21, phase 1): every tunable in one file —
 * the engine modules import from here; nothing else hardcodes values.
 */

export const BALANCE = {
  /** four lanes, one latin key per lane (v1 latin-only — doc §۱) */
  laneCount: 4,
  laneKeys: ["d", "f", "j", "k"],
  /** the fixed BPM per difficulty (doc §۰.۳ — no music files in v1) */
  bpmByDifficulty: { easy: 70, normal: 100, hard: 130 },
  durationBeats: 96,
  leadInBeats: 4,
  /** the judge windows (doc §۰.۲, deterministic) */
  windowPerfectMs: 80,
  windowGoodMs: 160,
  windowPoorMs: 300,
  perfectScore: 300,
  goodScore: 150,
  poorScore: 50,
  /** the acc% floors per rank; S also demands zero misses (doc §۰.۵) */
  rankSAcc: 95,
  rankAAcc: 90,
  rankBAcc: 75,
  /** notes render only when this close to their hit line (doc §۵) */
  visibleLeadMs: 2200,
  /** the WebAudio lookahead scheduler (doc §۲ — the industry pattern) */
  schedulerIntervalMs: 25,
  lookaheadMs: 100,
} as const;
