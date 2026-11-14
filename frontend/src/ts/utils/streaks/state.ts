import { loadLocalResults } from "../local-persistence";
import { getGauntletStats } from "../daily-gauntlet/store";
import { getWordBlastHistory } from "../word-blast-scores";
import {
  computeDailyStreak,
  computeWeeklyStreak,
  dayKeyFromTimestamp,
  type StreakSummary,
} from "./engine";

/**
 * phase 98: assembles the unified streak view from the EXISTING stores.
 * daily and weekly feed off the local results' days; the per-game streaks
 * come from the games that actually record WHEN they were played (the
 * gauntlet's calendar and word blast's history) — games without history
 * simply have no streak row yet.
 */

export type GameStreak = {
  gameId: string;
  label: string;
  summary: StreakSummary;
};

export type StreakView = {
  daily: StreakSummary;
  weekly: StreakSummary;
  perGame: GameStreak[];
};

export async function buildStreakView(now: number): Promise<StreakView> {
  const results = await loadLocalResults();
  //the results' own timestamps; a missing/zero timestamp contributes nothing
  const typedAt = results.map((result) => result.timestamp);

  //the gauntlet's calendar keys ARE day keys ("YYYY-MM-DD" of each played day)
  const gauntletDays = Object.keys(getGauntletStats().calendar);
  const gauntletTimestamps = gauntletDays.map((dayKey) =>
    Date.parse(`${dayKey}T12:00:00`),
  );

  const wordBlastTimestamps = getWordBlastHistory(365).map((h) => h.at);

  return {
    daily: computeDailyStreak(typedAt, now),
    weekly: computeWeeklyStreak(typedAt, now),
    perGame: [
      {
        gameId: "daily-gauntlet",
        label: "daily gauntlet",
        summary: computeDailyStreak(gauntletTimestamps, now),
      },
      {
        gameId: "word-blast",
        label: "word blast",
        summary: computeDailyStreak(wordBlastTimestamps, now),
      },
    ],
  };
}

export { dayKeyFromTimestamp };
