import { getFunbox } from "@monkeytype/funbox";
import type { Mode, PersonalBest } from "@monkeytype/schemas/shared";

import type { Snapshot, SnapshotResult } from "../constants/default-snapshot";
import { computeStreakFromResults } from "./local-streak";
import { Config } from "../config/store";

/**
 * Pure maintenance computations for deleting one local result (desktop
 * offline build, idea #2). No storage access: callers apply the returned
 * values through the established snapshot patterns.
 *
 * Decisions (documented in the feature commit):
 * - XP is retained unchanged (the stored total also depends on results
 *   older than the storage cap and on streak-at-save-time; replaying it
 *   would drift).
 * - streak is recomputed from the remaining results; maxStreak stays (a
 *   historical record) and the offline testActivity calendar is not
 *   synthesized.
 * - PB timestamp policy: the promoted replacement result carries its own
 *   timestamp (more truthful than Date.now()).
 */

type TypingStats = NonNullable<Snapshot["typingStats"]>;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampZero(value: number): number {
  return Math.max(0, value);
}

/**
 * Reverses the deleted result's contribution to typingStats. Defensive
 * against legacy rows whose counters were stored as strings; every counter
 * clamps at zero.
 */
export function reverseTypingStats(
  typingStats: TypingStats,
  deleted: {
    testDuration: number;
    afkDuration: number;
    incompleteTestSeconds: number;
    restartCount: number;
  },
): TypingStats {
  const contributedSeconds =
    Math.max(
      0,
      toNumber(deleted.testDuration) + toNumber(deleted.incompleteTestSeconds),
    ) - toNumber(deleted.afkDuration);

  return {
    timeTyping: clampZero(
      toNumber(typingStats.timeTyping) - contributedSeconds,
    ),
    startedTests: clampZero(
      toNumber(typingStats.startedTests) - (toNumber(deleted.restartCount) + 1),
    ),
    completedTests: clampZero(toNumber(typingStats.completedTests) - 1),
  };
}

/** streak recomputed from the remaining results, plus the last-result
 * pointer for streak continuation (0 when nothing remains) */
export function recomputeStreak(
  remaining: readonly SnapshotResult<Mode>[],
  now = Date.now(),
): { streak: number; streakLastResultTimestamp: number } {
  return {
    streak: computeStreakFromResults(remaining, now),
    streakLastResultTimestamp:
      remaining.length > 0
        ? Math.max(...remaining.map((result) => result.timestamp))
        : 0,
  };
}

/** PB eligibility, mirroring the save path (test-logic offline branch). */
function canBePersonalBest(result: SnapshotResult<Mode>): boolean {
  if (result.mode === "quote") return false;
  if (result.bailedOut) return false;
  //stopOnLetter exists on stored rows (cloned from the completed event) but
  //not on the SnapshotResult type
  const stopOnLetter = (
    result as SnapshotResult<Mode> & { stopOnLetter?: boolean }
  ).stopOnLetter;
  if (stopOnLetter === true && result.acc < 100) return false;
  return getFunbox(result.funbox ?? []).every((f) => f.canGetPb);
}

/** the punctuation identity a stored result belongs to: new rows record the
 * effective set at save time (audit Y5); legacy rows without the field fall
 * back to the raw live config - the pre-Y5 matching key */
function resultPunctuationIdentity(result: SnapshotResult<Mode>): string {
  return result.customPunctuation ?? Config.customPunctuation;
}

function matchesPbIdentity(
  pb: {
    punctuation?: boolean;
    numbers?: boolean;
    difficulty: string;
    language: string;
    lazyMode?: boolean;
    customPunctuation?: string;
  },
  result: SnapshotResult<Mode>,
): boolean {
  return (
    (pb.punctuation ?? false) === (result.punctuation ?? false) &&
    (pb.numbers ?? false) === (result.numbers ?? false) &&
    pb.difficulty === result.difficulty &&
    pb.language === result.language &&
    (pb.lazyMode ?? false) === (result.lazyMode ?? false) &&
    //PB entries are per punctuation set (idea #4): only the matching set's
    //entry is maintained — other sets' entries belong to their own buckets
    (pb.customPunctuation ?? "") === resultPunctuationIdentity(result)
  );
}

/**
 * Recomputes the PB bucket of the deleted result from the remaining
 * eligible results, mutating the passed structure. Only a deleted PB row
 * changes anything (legacy rows with isPb undefined are treated as false).
 * The bucket entry is replaced with the new best (promoting its result id)
 * or removed when nothing eligible remains. All other buckets are
 * untouched.
 */
export function recomputePersonalBestsAfterDelete(
  personalBests: Snapshot["personalBests"],
  deleted: SnapshotResult<Mode>,
  remaining: readonly SnapshotResult<Mode>[],
): { promotedId: string | undefined } {
  const modeBucket = personalBests[deleted.mode] as
    | Record<string, PersonalBest[]>
    | undefined;
  if (modeBucket === undefined) return { promotedId: undefined };
  const bucketList = modeBucket[deleted.mode2];
  if (bucketList === undefined) return { promotedId: undefined };
  const entry = bucketList.find((pb) => matchesPbIdentity(pb, deleted));
  if (entry === undefined) return { promotedId: undefined };
  if (deleted.isPb !== true) return { promotedId: undefined };

  const eligible = remaining.filter(
    (result) =>
      result.mode === deleted.mode &&
      result.mode2 === deleted.mode2 &&
      matchesPbIdentity(entry, result) &&
      canBePersonalBest(result),
  );

  if (eligible.length === 0) {
    //the bucket identity has no representative left: remove the entry
    modeBucket[deleted.mode2] = bucketList.filter(
      (pb) => !matchesPbIdentity(pb, deleted),
    );
    return { promotedId: undefined };
  }

  const promoted = eligible.reduce((best, result) =>
    result.wpm > best.wpm ? result : best,
  );
  entry.wpm = promoted.wpm;
  entry.acc = promoted.acc;
  entry.raw = promoted.rawWpm;
  entry.consistency = promoted.consistency;
  entry.timestamp = promoted.timestamp; //source-result timestamp policy
  return { promotedId: promoted._id };
}

/**
 * Applies every snapshot side effect of deleting `deleted` on the passed
 * snapshot object (mutated in place, mirroring saveLocalResult's pattern).
 * XP is retained, maxStreak is a historical record, the offline
 * testActivity calendar is not synthesized. Returns the promoted result id
 * for the collection's isPb flag, if another result became the PB.
 */
export function applyDeleteSnapshotSideEffects(
  snapshot: Snapshot,
  deleted: SnapshotResult<Mode>,
  remaining: readonly SnapshotResult<Mode>[],
  now = Date.now(),
): { promotedId: string | undefined } {
  if (snapshot.typingStats !== undefined) {
    snapshot.typingStats = reverseTypingStats(snapshot.typingStats, deleted);
  }
  const streak = recomputeStreak(remaining, now);
  snapshot.streak = streak.streak;
  snapshot.streakLastResultTimestamp = streak.streakLastResultTimestamp;

  const pbResult = recomputePersonalBestsAfterDelete(
    snapshot.personalBests,
    deleted,
    remaining,
  );
  //XP intentionally retained unchanged; daily goal and activity derivations
  //read the live collection and self-correct
  return { promotedId: pbResult.promotedId };
}
