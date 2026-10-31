import { loadLocalResults } from "./local-persistence";
import { showSuccessNotification } from "../states/notifications";

/**
 * Daily typing goal for the desktop offline build.
 *
 * The goal is minutes of active typing per local day. Progress is derived
 * from the persisted results (testDuration - afkDuration of today's results),
 * so it survives restarts without its own storage. Reaching the goal notifies
 * once per day.
 */

const GOAL_KEY = "mtDesktopDailyGoalMinutes";
const NOTIFIED_KEY = "mtDesktopGoalNotifiedDay";
export const DEFAULT_GOAL_MINUTES = 10;

/** the local day (midnight-to-midnight) a timestamp belongs to, as y/m/d */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function getDailyGoalMinutes(): number {
  const raw = Number(window.localStorage.getItem(GOAL_KEY));
  return Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_GOAL_MINUTES;
}

export function setDailyGoalMinutes(minutes: number): void {
  const safe = Math.max(1, Math.min(240, Math.round(minutes)));
  window.localStorage.setItem(GOAL_KEY, String(safe));
}

/** active typing seconds of the local day of `now` (default: today) */
export function todayTypingSeconds(
  results: { timestamp: number; testDuration: number; afkDuration: number }[],
  now = Date.now(),
): number {
  const today = dayKey(now);
  return results
    .filter((r) => dayKey(r.timestamp) === today)
    .reduce((sum, r) => sum + Math.max(0, r.testDuration - r.afkDuration), 0);
}

/** the streak counts a day once a result exists on it (existing rule) */
export async function todayGoalProgress(): Promise<{
  goalMinutes: number;
  seconds: number;
  reached: boolean;
}> {
  const results = await loadLocalResults();
  const seconds = todayTypingSeconds(results);
  const goalMinutes = getDailyGoalMinutes();
  return {
    goalMinutes,
    seconds,
    reached: seconds >= goalMinutes * 60,
  };
}

/**
 * After a saved result: notifies once per local day when the goal is reached.
 * Safe to call on every save — the day flag keeps it to one notification.
 */
export async function maybeNotifyDailyGoal(): Promise<void> {
  try {
    const { seconds, reached } = await todayGoalProgress();
    if (!reached) return;
    const today = dayKey(Date.now());
    if (window.localStorage.getItem(NOTIFIED_KEY) === today) return;
    window.localStorage.setItem(NOTIFIED_KEY, today);
    const minutes = Math.round(seconds / 60);
    showSuccessNotification(
      `Daily goal reached — ${minutes} minute${minutes === 1 ? "" : "s"} of typing today`,
      { durationMs: 6000 },
    );
  } catch (error) {
    console.error("daily goal notification failed", error);
  }
}
