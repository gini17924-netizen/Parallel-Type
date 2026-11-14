import { createSignal } from "solid-js";
import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

import { loadLocalResults } from "../local-persistence";
import { getGauntletStats } from "../daily-gauntlet/store";
import { getWordBlastBest } from "../word-blast-scores";
import { getCraneBestScore } from "../crane/store";
import { getClimberBestScore, getRunnerBestDistanceM } from "../climber/store";
import { getFirefightBestScore } from "../firefight/store";
import { getFruitSlashBestScore } from "../fruit-slash/store";
import { getLaneDefenseBestScore } from "../lane-defense/store";
import { getStackAttackBestScore } from "../stack-attack/store";
import { listLocalCustomThemes } from "../themes/custom-themes";
import { championsFor } from "../lan/champions";
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  type AchievementSnapshot,
  type AchievementTier,
} from "./definitions";

/**
 * phase 97: the unlocked-badges store (the independent-store house rule,
 * mtDesktopAchievements: achievement id -> unlock timestamp). sync is the
 * ONE write path: build a snapshot from the existing stores, evaluate the
 * pure criteria, and newly-earned badges get stamped. everything else
 * (the cabinet) only reads.
 */

const AchievementsSchema = z.record(z.string(), z.number().nonnegative());

const achievementsStore = new LocalStorageWithSchema({
  key: "mtDesktopAchievements",
  schema: AchievementsSchema,
  fallback: {},
});

const [unlocked, setUnlocked] = createSignal<Record<string, number>>(
  achievementsStore.get(),
);

/** the LAN games whose champions table is consulted for the room-champion
 * badge (the games the lobby hosts) */
const LAN_GAME_IDS = ["bot-duel", "tower-defense"] as const;

/** the mini-games whose best-score stores count for the gamesWithBest
 * metric — each getter answers "does this game have a personal best?" */
const GAME_BEST_PROBES: (() => boolean)[] = [
  () =>
    (["easy", "normal", "hard"] as const).some(
      (difficulty) => getWordBlastBest(difficulty) !== undefined,
    ),
  () => getCraneBestScore() > 0,
  () => getClimberBestScore() > 0,
  () => getFirefightBestScore() > 0,
  () => getFruitSlashBestScore() > 0,
  () => getLaneDefenseBestScore() > 0,
  () => getStackAttackBestScore() > 0,
  () => getRunnerBestDistanceM() > 0,
];

/** assembles the criteria snapshot from the existing stores (async: the
 * results live in indexedDB) */
async function buildAchievementSnapshot(): Promise<AchievementSnapshot> {
  const results = await loadLocalResults();
  let bestWpm = 0;
  let bestAcc = 0;
  for (const result of results) {
    if (typeof result.wpm === "number" && result.wpm > bestWpm) {
      bestWpm = result.wpm;
    }
    if (typeof result.acc === "number" && result.acc > bestAcc) {
      bestAcc = result.acc;
    }
  }
  return {
    totalTests: results.length,
    bestWpm,
    bestAcc,
    gauntletMaxStreak: getGauntletStats().maxStreak,
    gamesWithBest: GAME_BEST_PROBES.filter((probe) => probe()).length,
    lanGamesChampioned: LAN_GAME_IDS.filter((id) => championsFor(id).length > 0)
      .length,
    customThemesCount: listLocalCustomThemes().length,
  };
}

/** evaluates the snapshot and stamps every newly-earned badge; returns the
 * ids that were unlocked BY THIS CALL (empty when nothing new) */
export function syncAchievements(snapshot: AchievementSnapshot): string[] {
  const earned = evaluateAchievements(snapshot);
  const stored = unlocked();
  const fresh: string[] = [];
  for (const id of earned) {
    if (stored[id] === undefined) fresh.push(id);
  }
  if (fresh.length > 0) {
    const next = { ...stored };
    const now = Date.now();
    for (const id of fresh) next[id] = now;
    achievementsStore.set(next);
    setUnlocked(next);
  }
  return fresh;
}

/** runs the full cycle (build + sync); the boot/home refresh entry */
export async function refreshAchievements(): Promise<string[]> {
  return syncAchievements(await buildAchievementSnapshot());
}

export function unlockedAchievements(): Record<string, number> {
  return unlocked();
}

export function unlockedCount(): number {
  return Object.keys(unlocked()).length;
}

export function resetAchievements(): void {
  achievementsStore.clear();
  setUnlocked(achievementsStore.get());
}

export type CabinetBadge = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  unlockedAt: number | undefined;
};

/** the cabinet's rows: every definition with its unlock state. reads the
 * store signal so the UI re-renders on unlock */
export function cabinetBadges(): CabinetBadge[] {
  const stored = unlocked();
  return ACHIEVEMENTS.map((definition) => ({
    id: definition.id,
    title: definition.title,
    description: definition.description,
    icon: definition.icon,
    tier: definition.tier,
    unlockedAt: stored[definition.id],
  }));
}
