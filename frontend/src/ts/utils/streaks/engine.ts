/**
 * phase 98: the PURE streak engine — day/week keys, current/longest
 * streaks. no stores, no DOM: everything is a function of timestamps and
 * "now". the daily rule matches the house convention: a streak stays ALIVE
 * while its last day is today or yesterday (the user may simply not have
 * typed YET today), and only a full missed day breaks it. weeks use the
 * same rule with Monday-start weeks (absolute week index, no year seams).
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** 1970-01-05 was a Monday — the epoch for absolute week indexes */
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);

export function dayKeyFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** absolute Monday-start week index — stable across year boundaries */
export function weekIndexFromTimestamp(timestamp: number): number {
  return Math.floor((timestamp - MONDAY_EPOCH) / WEEK_MS);
}

export function weekKeyFromTimestamp(timestamp: number): string {
  return `week-${weekIndexFromTimestamp(timestamp)}`;
}

function previousDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return dayKeyFromTimestamp(Date.UTC(year, month - 1, day) - DAY_MS);
}

export type StreakSummary = { current: number; longest: number };

/** consecutive-run analysis over ALREADY-AGGREGATED period keys (day or
 * week keys), where consecutive means "the very next period". `lastKeys`
 * are the last two period keys whose absence kills the current streak. */
function analyzeRuns(
  keys: string[],
  aliveWindow: (lastKey: string, nowKey: string) => boolean,
  nowKey: string,
): StreakSummary {
  const unique = [...new Set(keys)].sort();
  if (unique.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (isNextPeriod(unique[i - 1] as string, unique[i] as string)) {
      run++;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  const last = unique[unique.length - 1] as string;
  const current = aliveWindow(last, nowKey) ? runAtEnd(unique) : 0;
  return { current, longest };
}

/** the run length ending at the LAST key (the streak still standing) */
function runAtEnd(keys: string[]): number {
  let run = 1;
  for (let i = keys.length - 1; i > 0; i--) {
    if (isNextPeriod(keys[i - 1] as string, keys[i] as string)) {
      run++;
    } else {
      break;
    }
  }
  return run;
}

/** daily keys are ISO dates — "next" means the calendar next day */
function isNextPeriod(previous: string, current: string): boolean {
  return previousDayKey(current) === previous;
}

export function computeDailyStreak(
  timestamps: number[],
  now: number,
): StreakSummary {
  const todayKey = dayKeyFromTimestamp(now);
  const yesterdayKey = previousDayKey(todayKey);
  const keys = timestamps.map(dayKeyFromTimestamp);
  return analyzeRuns(
    keys,
    (last) => last === todayKey || last === yesterdayKey,
    todayKey,
  );
}

export function computeWeeklyStreak(
  timestamps: number[],
  now: number,
): StreakSummary {
  const thisWeek = weekIndexFromTimestamp(now);
  const keys = [...new Set(timestamps.map(weekIndexFromTimestamp))].sort(
    (a, b) => a - b,
  );
  if (keys.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < keys.length; i++) {
    if ((keys[i] as number) - (keys[i - 1] as number) === 1) {
      run++;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }
  const last = keys[keys.length - 1] as number;
  const current =
    last === thisWeek || last === thisWeek - 1 ? runAtEndWeek(keys) : 0;
  return { current, longest };
}

function runAtEndWeek(weeks: number[]): number {
  let run = 1;
  for (let i = weeks.length - 1; i > 0; i--) {
    if ((weeks[i] as number) - (weeks[i - 1] as number) === 1) run++;
    else break;
  }
  return run;
}
