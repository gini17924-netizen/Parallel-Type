/**
 * Year Wrapped — the "your year in typing" recap, computed entirely from
 * local results (desktop offline build).
 *
 * Concept and metric inspiration: MonkeytypeWrapped by Vibhor7-7 (MIT) —
 * this is an independent TypeScript implementation for the local results
 * store, not a port of its Python/React code.
 *
 * Window: the last 365 days from `now` (results outside are ignored).
 * Persona clustering: fixed k=3 k-means over (wpm, accuracy, consistency)
 * with deterministic seeding, named by rank patterns — the upstream tool
 * searches k via silhouette; that needs much more data than a desktop
 * store reliably has.
 */

import type { Mode } from "@monkeytype/schemas/shared";

import type { SnapshotResult } from "../constants/default-snapshot";

export type WrappedResult = SnapshotResult<Mode>;

const WINDOW_DAYS = 365;
/** a "session" = tests taken within 30 minutes of each other */
const SESSION_GAP_MINUTES = 30;
const MIN_HOUR_SAMPLES = 5;

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

export type WrappedInput = {
  wpm: number;
  acc: number;
  consistency: number;
  restartCount: number;
  testDuration: number;
  afkDuration: number;
  incompleteTestSeconds: number;
  /** [correct, incorrect, extra, missed] */
  charStats: number[];
  mode: string;
  timestamp: number;
};

export type WrappedStats = {
  windowStart: number;
  windowEnd: number;
  hook: {
    totalTests: number;
    totalSeconds: number;
    totalWords: number;
    /** words as a share of The Great Gatsby (≈47,094 words) */
    gatsbyPct: number;
    avgWpm: number;
    avgAcc: number;
  };
  yearInNumbers: {
    activeDays: number;
    activeDaysPct: number;
    totalCharacters: number;
    longestDayStreak: number;
  };
  peak: {
    bestWpm: number;
    bestWpmDate: number;
    pbsHit: number;
    perfectAccCount: number;
    thresholds: { wpm: number; count: number }[];
  };
  quirks: {
    avgRestarts: number;
    maxRestarts: number;
    firstTryPct: number;
    restartedTests: number;
    wastedMinutes: number;
    favoriteMode: string;
    favoriteModeCount: number;
    restartLevel: "casual" | "moderate" | "perfectionist" | "extreme";
  };
  accuracy: {
    overall: number;
    totalErrors: number;
    wrongKeyPct: number;
    extraPct: number;
    missedPct: number;
    /** accuracy on the fastest 10% of tests minus the slowest 10% */
    clutchDelta: number;
  };
  journey: {
    months: { month: string; avgWpm: number; testCount: number }[];
    firstMonthAvgWpm: number;
    lastMonthAvgWpm: number;
    improvement: number;
    bestMonth: string;
    biggestJump: { month: string; amount: number } | undefined;
  };
  timing: {
    bestHour: number;
    bestHourWpm: number;
    worstHour: number;
    worstHourWpm: number;
    bestDay: string;
    timePreference: "night owl" | "early bird" | "balanced";
    hourlyCounts: number[];
  };
  warmup: {
    sessions: number;
    coldStartWpm: number;
    warmedUpWpm: number;
    improvement: number;
    testsUntilPeak: number;
    longestSession: number;
    curve: { testNumber: number; avgWpm: number }[];
  };
  personas: {
    label: string;
    description: string;
    share: number;
    avgWpm: number;
    avgAcc: number;
    avgConsistency: number;
    isUser?: boolean;
  }[];
};

const GATSBY_WORDS = 47_094;
const DAY_MS = 86_400_000;

function dayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(fraction * sorted.length)),
  );
  return sorted[index] ?? 0;
}

/** deterministic k-means (k=3) over (wpm, acc, consistency), seeded from the
 * three most spread-out samples; enough for playful personas on ≤1000 rows */
function kMeans3(
  points: { wpm: number; acc: number; consistency: number }[],
): number[] {
  if (points.length < 3) return points.map(() => 0);
  //scale each feature to [0,1] so no axis dominates
  const bounds = {
    wpm: { min: Infinity, max: -Infinity },
    acc: { min: Infinity, max: -Infinity },
    consistency: { min: Infinity, max: -Infinity },
  };
  for (const point of points) {
    bounds.wpm.min = Math.min(bounds.wpm.min, point.wpm);
    bounds.wpm.max = Math.max(bounds.wpm.max, point.wpm);
    bounds.acc.min = Math.min(bounds.acc.min, point.acc);
    bounds.acc.max = Math.max(bounds.acc.max, point.acc);
    bounds.consistency.min = Math.min(
      bounds.consistency.min,
      point.consistency,
    );
    bounds.consistency.max = Math.max(
      bounds.consistency.max,
      point.consistency,
    );
  }
  const scale = (
    value: number,
    feature: { min: number; max: number },
  ): number =>
    feature.max - feature.min === 0
      ? 0.5
      : (value - feature.min) / (feature.max - feature.min);
  const scaled = points.map((point) => [
    scale(point.wpm, bounds.wpm),
    scale(point.acc, bounds.acc),
    scale(point.consistency, bounds.consistency),
  ]);
  //seed: lowest-wpm, highest-wpm and lowest-consistency samples (spread out)
  const seeds: number[][] = [];
  const byWpm = [...scaled].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  seeds.push(byWpm[0] ?? [0, 0, 0]);
  seeds.push(byWpm[byWpm.length - 1] ?? [0, 0, 0]);
  const byConsistency = [...scaled].sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0));
  seeds.push(byConsistency[0] ?? [0, 0, 0]);

  let assignments = new Array<number>(scaled.length).fill(0);
  let centroids = seeds.map((seed) => [...seed]);
  for (let iteration = 0; iteration < 12; iteration++) {
    assignments = scaled.map((point) => {
      let best = 0;
      let bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const distance =
          (point[0] ?? 0) ** 2 +
          (point[1] ?? 0) ** 2 +
          (point[2] ?? 0) ** 2 -
          2 *
            ((point[0] ?? 0) * (centroid[0] ?? 0) +
              (point[1] ?? 0) * (centroid[1] ?? 0) +
              (point[2] ?? 0) * (centroid[2] ?? 0)) +
          (centroid[0] ?? 0) ** 2 +
          (centroid[1] ?? 0) ** 2 +
          (centroid[2] ?? 0) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    });
    centroids = centroids.map((centroid, cluster) => {
      const members = scaled.filter(
        (_, index) => assignments[index] === cluster,
      );
      if (members.length === 0) return centroid;
      return [0, 1, 2].map((axis) =>
        mean(members.map((point) => point[axis] ?? 0)),
      );
    });
  }
  return assignments;
}

/**
 * Computes the full wrapped dataset from local results within the last 365
 * days. Results are assumed pre-filtered (saved results only).
 */
export function computeWrappedStats(
  results: readonly WrappedResult[],
  now: number = Date.now(),
): WrappedStats {
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const window: WrappedInput[] = results
    .filter(
      (result) => result.timestamp >= windowStart && result.timestamp <= now,
    )
    .filter((result) => result.wpm > 0 && result.acc >= 0 && result.acc <= 100)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((result) => ({
      wpm: result.wpm,
      acc: result.acc,
      consistency: result.consistency ?? 0,
      restartCount: result.restartCount ?? 0,
      testDuration: result.testDuration ?? 0,
      afkDuration: result.afkDuration ?? 0,
      incompleteTestSeconds: result.incompleteTestSeconds ?? 0,
      charStats: Array.isArray(result.charStats)
        ? result.charStats
        : [0, 0, 0, 0],
      mode: result.mode,
      timestamp: result.timestamp,
    }));

  const empty: WrappedStats = {
    windowStart,
    windowEnd: now,
    hook: {
      totalTests: 0,
      totalSeconds: 0,
      totalWords: 0,
      gatsbyPct: 0,
      avgWpm: 0,
      avgAcc: 0,
    },
    yearInNumbers: {
      activeDays: 0,
      activeDaysPct: 0,
      totalCharacters: 0,
      longestDayStreak: 0,
    },
    peak: {
      bestWpm: 0,
      bestWpmDate: now,
      pbsHit: 0,
      perfectAccCount: 0,
      thresholds: [],
    },
    quirks: {
      avgRestarts: 0,
      maxRestarts: 0,
      firstTryPct: 0,
      restartedTests: 0,
      wastedMinutes: 0,
      favoriteMode: "—",
      favoriteModeCount: 0,
      restartLevel: "casual",
    },
    accuracy: {
      overall: 0,
      totalErrors: 0,
      wrongKeyPct: 0,
      extraPct: 0,
      missedPct: 0,
      clutchDelta: 0,
    },
    journey: {
      months: [],
      firstMonthAvgWpm: 0,
      lastMonthAvgWpm: 0,
      improvement: 0,
      bestMonth: "—",
      biggestJump: undefined,
    },
    timing: {
      bestHour: 0,
      bestHourWpm: 0,
      worstHour: 0,
      worstHourWpm: 0,
      bestDay: "—",
      timePreference: "balanced",
      hourlyCounts: [],
    },
    warmup: {
      sessions: 0,
      coldStartWpm: 0,
      warmedUpWpm: 0,
      improvement: 0,
      testsUntilPeak: 0,
      longestSession: 0,
      curve: [],
    },
    personas: [],
  };
  if (window.length === 0) return empty;

  //--- hook ---------------------------------------------------------------
  const totalSeconds = window.reduce(
    (sum, result) =>
      sum + Math.max(0, result.testDuration - result.afkDuration),
    0,
  );
  const totalWords = Math.round(
    window.reduce(
      (sum, result) =>
        sum +
        (result.wpm * Math.max(0, result.testDuration - result.afkDuration)) /
          60,
      0,
    ),
  );
  const hook = {
    totalTests: window.length,
    totalSeconds: Math.round(totalSeconds),
    totalWords,
    gatsbyPct: round1((totalWords / GATSBY_WORDS) * 100),
    avgWpm: round1(mean(window.map((result) => result.wpm))),
    avgAcc: round1(mean(window.map((result) => result.acc))),
  };

  //--- year in numbers ----------------------------------------------------
  const daySet = new Set(window.map((result) => dayStart(result.timestamp)));
  const sortedDays = [...daySet].sort((a, b) => a - b);
  const firstDay = sortedDays[0];
  const lastDay = sortedDays[sortedDays.length - 1];
  const spanDays =
    firstDay === undefined || lastDay === undefined
      ? 1
      : Math.round((lastDay - firstDay) / DAY_MS) + 1;
  let longestDayStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    const gap = Math.round(
      ((sortedDays[i] ?? 0) - (sortedDays[i - 1] ?? 0)) / DAY_MS,
    );
    currentStreak = gap === 1 ? currentStreak + 1 : 1;
    longestDayStreak = Math.max(longestDayStreak, currentStreak);
  }
  const totalCharacters = window.reduce(
    (sum, result) =>
      sum +
      (result.charStats[0] ?? 0) +
      (result.charStats[1] ?? 0) +
      (result.charStats[2] ?? 0),
    0,
  );
  const yearInNumbers = {
    activeDays: daySet.size,
    activeDaysPct: round1((daySet.size / spanDays) * 100),
    totalCharacters,
    longestDayStreak,
  };

  //--- peak ---------------------------------------------------------------
  const firstResult = window[0];
  if (firstResult === undefined) return empty;
  let best: WrappedInput = firstResult;
  let runningMax = 0;
  let pbsHit = 0;
  for (const result of window) {
    if (result.wpm > runningMax) {
      runningMax = result.wpm;
      pbsHit++;
    }
    if (result.wpm > best.wpm) best = result;
  }
  const thresholds = [60, 80, 100, 120].map((wpm) => ({
    wpm,
    count: window.filter((result) => result.wpm >= wpm).length,
  }));
  const peak = {
    bestWpm: round2(best.wpm),
    bestWpmDate: best.timestamp,
    pbsHit,
    perfectAccCount: window.filter((result) => result.acc === 100).length,
    thresholds,
  };

  //--- quirks -------------------------------------------------------------
  const avgRestarts = mean(window.map((result) => result.restartCount));
  const modeCounts = new Map<string, number>();
  for (const result of window) {
    modeCounts.set(result.mode, (modeCounts.get(result.mode) ?? 0) + 1);
  }
  let favoriteMode = "—";
  let favoriteModeCount = 0;
  for (const [mode, count] of modeCounts) {
    if (count > favoriteModeCount) {
      favoriteMode = mode;
      favoriteModeCount = count;
    }
  }
  const restartLevel: WrappedStats["quirks"]["restartLevel"] =
    avgRestarts < 0.5
      ? "casual"
      : avgRestarts < 1.5
        ? "moderate"
        : avgRestarts < 3
          ? "perfectionist"
          : "extreme";
  const quirks = {
    avgRestarts: round2(avgRestarts),
    maxRestarts: Math.max(...window.map((result) => result.restartCount)),
    firstTryPct: round1(
      (window.filter((result) => result.restartCount === 0).length /
        window.length) *
        100,
    ),
    restartedTests: window.filter((result) => result.restartCount > 0).length,
    wastedMinutes: round1(
      (window.reduce((sum, result) => sum + result.incompleteTestSeconds, 0) +
        window.reduce((sum, result) => sum + result.restartCount * 3, 0)) /
        60,
    ),
    favoriteMode,
    favoriteModeCount,
    restartLevel,
  };

  //--- accuracy -----------------------------------------------------------
  const wrongKey = window.reduce(
    (sum, result) => sum + (result.charStats[1] ?? 0),
    0,
  );
  const extra = window.reduce(
    (sum, result) => sum + (result.charStats[2] ?? 0),
    0,
  );
  const missed = window.reduce(
    (sum, result) => sum + (result.charStats[3] ?? 0),
    0,
  );
  const totalErrors = wrongKey + extra + missed;
  const wpms = window.map((result) => result.wpm);
  const fastCut = percentile(wpms, 0.9);
  const slowCut = percentile(wpms, 0.1);
  const fastAcc = mean(
    window
      .filter((result) => result.wpm >= fastCut)
      .map((result) => result.acc),
  );
  const slowAcc = mean(
    window
      .filter((result) => result.wpm <= slowCut)
      .map((result) => result.acc),
  );
  const accuracy = {
    overall: round2(mean(window.map((result) => result.acc))),
    totalErrors,
    wrongKeyPct: totalErrors === 0 ? 0 : round1((wrongKey / totalErrors) * 100),
    extraPct: totalErrors === 0 ? 0 : round1((extra / totalErrors) * 100),
    missedPct: totalErrors === 0 ? 0 : round1((missed / totalErrors) * 100),
    clutchDelta: round2(fastAcc - slowAcc),
  };

  //--- journey (monthly) --------------------------------------------------
  const monthMap = new Map<string, { wpms: number[]; accs: number[] }>();
  for (const result of window) {
    const key = monthKey(result.timestamp);
    const bucket = monthMap.get(key) ?? { wpms: [], accs: [] };
    bucket.wpms.push(result.wpm);
    bucket.accs.push(result.acc);
    monthMap.set(key, bucket);
  }
  const months = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      avgWpm: round1(mean(bucket.wpms)),
      testCount: bucket.wpms.length,
    }));
  const firstMonthAvgWpm = months[0]?.avgWpm ?? 0;
  const lastMonthAvgWpm = months[months.length - 1]?.avgWpm ?? 0;
  let biggestJump: { month: string; amount: number } | undefined;
  for (let i = 1; i < months.length; i++) {
    const amount = (months[i]?.avgWpm ?? 0) - (months[i - 1]?.avgWpm ?? 0);
    if (biggestJump === undefined || amount > biggestJump.amount) {
      biggestJump = { month: months[i]?.month ?? "—", amount: round1(amount) };
    }
  }
  const bestMonthEntry = [...months].sort((a, b) => b.avgWpm - a.avgWpm)[0];
  const journey = {
    months,
    firstMonthAvgWpm,
    lastMonthAvgWpm,
    improvement: round1(lastMonthAvgWpm - firstMonthAvgWpm),
    bestMonth: bestMonthEntry?.month ?? "—",
    biggestJump,
  };

  //--- timing -------------------------------------------------------------
  const hourBuckets: { wpms: number[] }[] = Array.from({ length: 24 }, () => ({
    wpms: [],
  }));
  const dayBuckets = new Map<string, number[]>();
  const earlyBird = new Set([5, 6, 7, 8, 9, 10]);
  const nightOwl = new Set([22, 23, 0, 1]);
  let earlyCount = 0;
  let nightCount = 0;
  for (const result of window) {
    const date = new Date(result.timestamp);
    hourBuckets[date.getHours()]?.wpms.push(result.wpm);
    const dayName = DAY_NAMES[date.getDay()] ?? "—";
    dayBuckets.set(dayName, [...(dayBuckets.get(dayName) ?? []), result.wpm]);
    if (earlyBird.has(date.getHours())) earlyCount++;
    if (nightOwl.has(date.getHours())) nightCount++;
  }
  const significantHours = hourBuckets
    .map((bucket, hour) => ({
      hour,
      count: bucket.wpms.length,
      avgWpm: mean(bucket.wpms),
    }))
    .filter((bucket) => bucket.count >= MIN_HOUR_SAMPLES);
  const pool =
    significantHours.length > 0
      ? significantHours
      : hourBuckets
          .map((bucket, hour) => ({
            hour,
            count: bucket.wpms.length,
            avgWpm: mean(bucket.wpms),
          }))
          .filter((bucket) => bucket.count > 0);
  const bestHour = [...pool].sort((a, b) => b.avgWpm - a.avgWpm)[0];
  const worstHour = [...pool].sort((a, b) => a.avgWpm - b.avgWpm)[0];
  let bestDay = "—";
  let bestDayWpm = 0;
  for (const [day, wpms] of dayBuckets) {
    const avg = mean(wpms);
    if (avg > bestDayWpm) {
      bestDayWpm = avg;
      bestDay = day;
    }
  }
  const timing: WrappedStats["timing"] = {
    bestHour: bestHour?.hour ?? 0,
    bestHourWpm: round1(bestHour?.avgWpm ?? 0),
    worstHour: worstHour?.hour ?? 0,
    worstHourWpm: round1(worstHour?.avgWpm ?? 0),
    bestDay,
    timePreference:
      nightCount > earlyCount * 1.5
        ? "night owl"
        : earlyCount > nightCount * 1.5
          ? "early bird"
          : "balanced",
    hourlyCounts: hourBuckets.map((bucket) => bucket.wpms.length),
  };

  //--- warmup (sessions = gap > 30 min) ------------------------------------
  const sessions: WrappedInput[][] = [];
  let currentSession: WrappedInput[] = [];
  for (const result of window) {
    const previous = currentSession[currentSession.length - 1];
    const gapMinutes =
      previous === undefined
        ? Infinity
        : (result.timestamp - previous.timestamp) / 60_000;
    if (gapMinutes > SESSION_GAP_MINUTES) {
      if (currentSession.length > 0) sessions.push(currentSession);
      currentSession = [result];
    } else {
      currentSession.push(result);
    }
  }
  if (currentSession.length > 0) sessions.push(currentSession);
  const coldStartWpm = mean(sessions.map((session) => session[0]?.wpm ?? 0));
  const warmedUp = sessions.flatMap((session) => session.slice(3));
  const warmedUpWpm =
    warmedUp.length > 0
      ? mean(warmedUp.map((result) => result.wpm))
      : coldStartWpm;
  const peakPositions = sessions
    .filter((session) => session.length >= 3)
    .map((session) => {
      let bestIndex = 0;
      session.forEach((result, index) => {
        if (result.wpm > (session[bestIndex]?.wpm ?? 0)) bestIndex = index;
      });
      return bestIndex + 1;
    });
  const curveMap = new Map<number, number[]>();
  for (const session of sessions) {
    session.slice(0, 10).forEach((result, index) => {
      curveMap.set(index + 1, [...(curveMap.get(index + 1) ?? []), result.wpm]);
    });
  }
  const warmup = {
    sessions: sessions.length,
    coldStartWpm: round1(coldStartWpm),
    warmedUpWpm: round1(warmedUpWpm),
    improvement: round1(warmedUpWpm - coldStartWpm),
    testsUntilPeak: round1(mean(peakPositions)),
    longestSession: sessions.reduce(
      (max, session) => Math.max(max, session.length),
      0,
    ),
    curve: [...curveMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([testNumber, wpms]) => ({
        testNumber,
        avgWpm: round1(mean(wpms)),
      })),
  };

  //--- personas (k-means k=3 over wpm/acc/consistency) ----------------------
  const assignments = kMeans3(
    window.map((result) => ({
      wpm: result.wpm,
      acc: result.acc,
      consistency: result.consistency,
    })),
  );
  const personaCatalog = [
    {
      label: "flow state",
      description: "high speed with exceptional accuracy and consistency",
    },
    { label: "speed demon", description: "racing for wpm, accuracy be damned" },
    {
      label: "steady hand",
      description: "reliable and consistent — the tortoise that wins",
    },
  ];
  const clusters = [0, 1, 2].map((cluster) => {
    const members = window.filter((_, index) => assignments[index] === cluster);
    return {
      members,
      avgWpm: mean(members.map((result) => result.wpm)),
      avgAcc: mean(members.map((result) => result.acc)),
      avgConsistency: mean(members.map((result) => result.consistency)),
    };
  });
  const wpmRank = [...clusters.keys()].sort(
    (a, b) => (clusters[b]?.avgWpm ?? 0) - (clusters[a]?.avgWpm ?? 0),
  );
  const accRank = [...clusters.keys()].sort(
    (a, b) => (clusters[b]?.avgAcc ?? 0) - (clusters[a]?.avgAcc ?? 0),
  );
  const consRank = [...clusters.keys()].sort(
    (a, b) =>
      (clusters[b]?.avgConsistency ?? 0) - (clusters[a]?.avgConsistency ?? 0),
  );
  const totalRank = (cluster: number): number =>
    (wpmRank.indexOf(cluster) ?? 0) +
    (accRank.indexOf(cluster) ?? 0) +
    (consRank.indexOf(cluster) ?? 0);
  const assigned = new Set<string>();
  const personas: WrappedStats["personas"] = [];
  const lastResult = window[window.length - 1];
  const lastIndex = window.indexOf(lastResult ?? ({} as WrappedInput));
  for (const cluster of [0, 1, 2]) {
    const clusterData = clusters[cluster];
    if (clusterData === undefined || clusterData.members.length === 0) continue;
    let personaIndex: number;
    if (totalRank(cluster) <= 2 && !assigned.has("flow state")) {
      personaIndex = 0;
    } else if (
      wpmRank[0] === cluster &&
      accRank.indexOf(cluster) >= 2 &&
      !assigned.has("speed demon")
    ) {
      personaIndex = 1;
    } else if (consRank[0] === cluster && !assigned.has("steady hand")) {
      personaIndex = 2;
    } else {
      personaIndex =
        [0, 1, 2].find(
          (candidate) => !assigned.has(personaCatalog[candidate]?.label ?? ""),
        ) ?? 0;
    }
    const persona = personaCatalog[personaIndex];
    if (persona === undefined) continue;
    assigned.add(persona.label);
    personas.push({
      label: persona.label,
      description: persona.description,
      share: round1((clusterData.members.length / window.length) * 100),
      avgWpm: round1(clusterData.avgWpm),
      avgAcc: round1(clusterData.avgAcc),
      avgConsistency: round1(clusterData.avgConsistency),
      isUser: assignments[lastIndex] === cluster,
    });
  }
  personas.sort((a, b) => b.share - a.share);

  return {
    windowStart,
    windowEnd: now,
    hook,
    yearInNumbers,
    peak,
    quirks,
    accuracy,
    journey,
    timing,
    warmup,
    personas,
  };
}
