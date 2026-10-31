import type { SnapshotResult } from "../constants/default-snapshot";
import type { Mode } from "@monkeytype/schemas/shared";

/**
 * Local XP calculation for the desktop offline build, mirroring the upstream
 * server formula (backend result controller `calculateXp`).
 *
 * Local defaults where the server reads its XP configuration: enabled with
 * gainMultiplier 1, no funbox bonus (server-configured), no daily bonus
 * (needs the running XP total of the account), streak modifier enabled with
 * the documented defaults (max 10 days → up to +0.5).
 */

const STREAK_MAX_DAYS = 10;
const STREAK_MAX_MULTIPLIER = 0.5;

/** linear map, clamped to the [outMin, outMax] range (upstream mapRange) */
function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax - inMin === 0) return outMin;
  const mapped =
    outMin + ((outMax - outMin) * (value - inMin)) / (inMax - inMin);
  const clamped = Math.min(
    Math.max(mapped, Math.min(outMin, outMax)),
    Math.max(outMin, outMax),
  );
  return Number(clamped.toFixed(1));
}

/**
 * XP gained by one completed result, upstream formula. `streak` is the
 * user's current streak at the time of the result.
 */
export function computeLocalXp(
  result: SnapshotResult<Mode>,
  streak: number,
): number {
  if (result.mode === "zen") return 0;

  const baseXp = Math.round((result.testDuration - result.afkDuration) * 2);

  let modifier = 1;
  //charStats: [correctWord, incorrect, extra, missed] — "corrected
  //everything" = nothing but correct word characters
  const charStats = result.charStats;
  const correctedEverything =
    Array.isArray(charStats) && charStats.slice(1).every((stat) => stat === 0);

  if (result.acc === 100) {
    modifier += 0.5;
  } else if (correctedEverything) {
    modifier += 0.25;
  }

  if (result.mode === "quote") {
    modifier += 0.5;
  } else {
    if (result.punctuation) modifier += 0.4;
    if (result.numbers) modifier += 0.1;
  }

  if (streak > 0) {
    const streakModifier = mapRange(
      streak,
      0,
      STREAK_MAX_DAYS,
      0,
      STREAK_MAX_MULTIPLIER,
    );
    if (streakModifier > 0) modifier += streakModifier;
  }

  let incompleteXp = 0;
  if (result.incompleteTestSeconds > 0) {
    incompleteXp = Math.round(result.incompleteTestSeconds);
  }

  const accuracyModifier = (result.acc - 50) / 50;
  const xpWithModifiers = Math.round(baseXp * modifier);
  const xpAfterAccuracy = Math.round(xpWithModifiers * accuracyModifier);

  return Math.round((xpAfterAccuracy + incompleteXp) * 1);
}
