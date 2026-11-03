/**
 * Local streak tracking for the desktop offline build, mirroring the upstream
 * server logic (backend `UserDAL.updateStreak`, backend/src/dal/user.ts):
 * a consecutive run of days with a saved result. The day reference is the
 * incoming result's day — upstream also evaluates at save time, where the
 * result timestamp is effectively "now".
 *
 * Documented deviation from upstream (COUNCIL_ARCHITECTURE_REVIEW.md, P1):
 * days are LOCAL calendar days, not UTC buckets with an hour offset — for an
 * offline desktop app the user's wall clock is the only meaningful boundary,
 * and this matches the display derivation that previously lived on the
 * account page.
 */

export type LocalStreakState = {
  /** timestamp of the most recent saved result */
  lastResultTimestamp: number;
  /** current streak length in days */
  length: number;
  /** longest streak ever reached */
  maxLength: number;
};

export type LocalStreakUpdate = LocalStreakState & {
  /** true when a missed day reset a previously running streak */
  streakLost: boolean;
};

const MILLISECONDS_IN_DAY = 86400000;

/** start of the local calendar day for a timestamp (DST-safe) */
function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** whole local calendar days from `from` to `to` */
function dayDistance(from: number, to: number): number {
  return Math.round(
    (startOfLocalDay(to) - startOfLocalDay(from)) / MILLISECONDS_IN_DAY,
  );
}

/**
 * Apply one saved result to the streak, upstream `updateStreak` semantics:
 * result yesterday → +1; result today → unchanged; anything older (or the
 * first-ever result) → reset to 1. `maxLength` never decreases.
 */
export function updateLocalStreak(
  current: LocalStreakState,
  resultTimestamp: number,
): LocalStreakUpdate {
  const distance = dayDistance(current.lastResultTimestamp, resultTimestamp);

  let length = current.length;
  let streakLost = false;
  if (distance === 1) {
    length = current.length + 1;
  } else if (distance !== 0) {
    //covers the first-ever result (lastResultTimestamp 0) and missed days,
    //like upstream's "not yesterday and not today" branch
    length = 1;
    streakLost = current.length > 0;
  }
  //distance === 0 (second result on the same day): unchanged

  return {
    lastResultTimestamp: resultTimestamp,
    length,
    maxLength: Math.max(length, current.maxLength),
    streakLost,
  };
}

/**
 * Display streak: consecutive local days with a result, counting today
 * (or yesterday, if today has no result yet) backwards. Semantic twin of
 * the incremental update above — right after every save, both agree.
 */
export function computeStreakFromResults(
  results: readonly { timestamp: number }[],
  now: number = Date.now(),
): number {
  const daySet = new Set(
    results.map((result) => startOfLocalDay(result.timestamp)),
  );
  let streak = 0;
  let cursor = startOfLocalDay(now);
  if (!daySet.has(cursor)) {
    cursor -= MILLISECONDS_IN_DAY;
  }
  while (daySet.has(cursor)) {
    streak++;
    cursor -= MILLISECONDS_IN_DAY;
  }
  return streak;
}
