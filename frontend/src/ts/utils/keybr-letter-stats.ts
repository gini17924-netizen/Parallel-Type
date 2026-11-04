/**
 * Read-only bridge from the keybr engine's per-character histograms
 * (V3 of the keybr port: the /drills weak-key view sees both engines).
 *
 * Storage schema owner: keybr/session.ts — `mtKeybrResults:<language>` holds
 * an array of {timeStamp, length, time, errors, histogram} where histogram
 * samples carry {codePoint, hitCount, missCount, timeToType}. This module
 * only READS those keys and never writes them; the learn state
 * (mtDesktopLearnState) stays untouched too, so review scheduling keeps
 * its monkeytype-driven semantics.
 *
 * Persian and English letters do not overlap, so aggregating every
 * mtKeybrResults:* key is safe — a drill for one script can only match
 * letters of that script.
 */

export type KeybrLetterStat = {
  correct: number;
  incorrect: number;
  /** summed timeToType over the samples (idea #7 latency signal); 0 when
   * the stored sessions predate the field */
  totalTimeToType: number;
};

const KEYBR_RESULTS_PREFIX = "mtKeybrResults:";

/** skipped characters: keybr histograms include the spacebar, learn-stats
 * never counts it (see computeLetterStats) */
function isSkippable(char: string): boolean {
  return char === " " || char === "";
}

type StoredHistogramSample = {
  codePoint: number;
  hitCount: number;
  missCount: number;
  timeToType?: number;
};
type StoredStats = { histogram?: StoredHistogramSample[] };

export function loadKeybrLetterStats(): Record<string, KeybrLetterStat> {
  const stats: Record<string, KeybrLetterStat> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key === null || !key.startsWith(KEYBR_RESULTS_PREFIX)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(window.localStorage.getItem(key) ?? "null");
      } catch {
        continue; //corrupt payload: skip this language
      }
      if (!Array.isArray(parsed)) continue;
      for (const session of parsed as StoredStats[]) {
        if (session === null || typeof session !== "object") continue;
        for (const sample of session.histogram ?? []) {
          if (
            sample === null ||
            typeof sample !== "object" ||
            typeof sample.codePoint !== "number" ||
            typeof sample.hitCount !== "number" ||
            typeof sample.missCount !== "number"
          ) {
            continue;
          }
          const char = String.fromCodePoint(sample.codePoint).toLowerCase();
          if (isSkippable(char)) continue;
          const stat = stats[char] ?? {
            correct: 0,
            incorrect: 0,
            totalTimeToType: 0,
          };
          stat.correct += sample.hitCount;
          stat.incorrect += sample.missCount;
          //latency signal (idea #7): old rows may lack the field
          if (typeof sample.timeToType === "number") {
            stat.totalTimeToType += sample.timeToType;
          }
          stats[char] = stat;
        }
      }
    }
  } catch {
    //localStorage unavailable: report no keybr stats rather than fail
    return stats;
  }
  return stats;
}
