/**
 * phase 97: the achievements' PURE core — a snapshot of the user's stats
 * (built by state.ts from the existing stores) and every badge's criterion
 * as a plain function over that snapshot. NOTHING here touches a store or
 * the DOM: the whole cabinet logic is unit-testable without any backend.
 */

export type AchievementTier = "bronze" | "silver" | "gold";

export type AchievementSnapshot = {
  /** completed typing tests (the local results rows) */
  totalTests: number;
  /** the best wpm across the local results */
  bestWpm: number;
  /** the best accuracy across the local results */
  bestAcc: number;
  /** the gauntlet's best multi-day streak */
  gauntletMaxStreak: number;
  /** how many mini-games carry a personal best (score > 0) */
  gamesWithBest: number;
  /** how many LAN games have a champion recorded on this host */
  lanGamesChampioned: number;
  /** the user's saved custom themes (phase 92) */
  customThemesCount: number;
};

export type AchievementDefinition = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  check: (snapshot: AchievementSnapshot) => boolean;
};

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  // ---- the typing journey ----
  {
    id: "first-steps",
    title: "first steps",
    description: "complete your first typing test",
    icon: "fa-shoe-prints",
    tier: "bronze",
    check: (s) => s.totalTests >= 1,
  },
  {
    id: "ten-tests",
    title: "warmed up",
    description: "complete 10 typing tests",
    icon: "fa-fire",
    tier: "bronze",
    check: (s) => s.totalTests >= 10,
  },
  {
    id: "fifty-tests",
    title: "regular",
    description: "complete 50 typing tests",
    icon: "fa-dumbbell",
    tier: "silver",
    check: (s) => s.totalTests >= 50,
  },
  {
    id: "century",
    title: "century",
    description: "complete 100 typing tests",
    icon: "fa-medal",
    tier: "gold",
    check: (s) => s.totalTests >= 100,
  },
  // ---- speed ----
  {
    id: "speed-60",
    title: "cruising",
    description: "reach 60 wpm",
    icon: "fa-gauge-high",
    tier: "bronze",
    check: (s) => s.bestWpm >= 60,
  },
  {
    id: "speed-100",
    title: "fleet",
    description: "reach 100 wpm",
    icon: "fa-gauge-high",
    tier: "silver",
    check: (s) => s.bestWpm >= 100,
  },
  {
    id: "speed-150",
    title: "lightning",
    description: "reach 150 wpm",
    icon: "fa-bolt",
    tier: "gold",
    check: (s) => s.bestWpm >= 150,
  },
  // ---- accuracy ----
  {
    id: "sharp-eye",
    title: "sharp eye",
    description: "finish a test with 98% accuracy",
    icon: "fa-bullseye",
    tier: "silver",
    check: (s) => s.bestAcc >= 98,
  },
  // ---- the gauntlet streak ----
  {
    id: "streak-3",
    title: "on a roll",
    description: "keep a 3-day gauntlet streak",
    icon: "fa-link",
    tier: "bronze",
    check: (s) => s.gauntletMaxStreak >= 3,
  },
  {
    id: "streak-7",
    title: "week warrior",
    description: "keep a 7-day gauntlet streak",
    icon: "fa-calendar-check",
    tier: "gold",
    check: (s) => s.gauntletMaxStreak >= 7,
  },
  // ---- the games ----
  {
    id: "gamer",
    title: "gamer",
    description: "hold a personal best in 3 mini-games",
    icon: "fa-gamepad",
    tier: "bronze",
    check: (s) => s.gamesWithBest >= 3,
  },
  {
    id: "arcade-hero",
    title: "arcade hero",
    description: "hold a personal best in 8 mini-games",
    icon: "fa-crown",
    tier: "gold",
    check: (s) => s.gamesWithBest >= 8,
  },
  // ---- the LAN ----
  {
    id: "lan-champion",
    title: "room champion",
    description: "hold a champion record in a LAN game",
    icon: "fa-trophy",
    tier: "silver",
    check: (s) => s.lanGamesChampioned >= 1,
  },
  // ---- the maker ----
  {
    id: "theme-smith",
    title: "theme smith",
    description: "forge your own theme",
    icon: "fa-palette",
    tier: "bronze",
    check: (s) => s.customThemesCount >= 1,
  },
];

/** the ids whose criteria hold for the snapshot — the cabinet renders the
 * union of this and the unlocked store */
export function evaluateAchievements(
  snapshot: AchievementSnapshot,
): Set<string> {
  const earned = new Set<string>();
  for (const definition of ACHIEVEMENTS) {
    if (definition.check(snapshot)) earned.add(definition.id);
  }
  return earned;
}
