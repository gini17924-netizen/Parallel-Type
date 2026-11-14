import { getSection } from "../../constants/app-structure";

/**
 * The Games section taxonomy (the owner-approved categories): every
 * offline game belongs to EXACTLY ONE category by its dominant skill —
 * no game appears twice, none is left out (24/24: 23 categorized + the
 * Daily Gauntlet pinned separately above the categories).
 *
 * UI/menu text is ENGLISH ONLY — Persian belongs to practice content
 * (word pools, lyrics, learn groups), never to menus (the owner's rule).
 * The per-game display data (title/description/icon/route) lives in
 * app-structure.ts; this module only defines the grouping.
 */

export type GameCategoryId =
  | "speed-race"
  | "precision-timing"
  | "reflex-survival"
  | "memory-deduction"
  | "movement-spatial"
  | "two-players";

export type GameCategory = {
  id: GameCategoryId;
  title: string;
  description: string;
  icon: string;
  gameIds: string[];
};

/** the Daily Gauntlet is a meta-entry pinned above the categories */
export const PINNED_DAILY_GAME_ID = "daily-gauntlet";

export const GAME_CATEGORIES: GameCategory[] = [
  {
    id: "speed-race",
    title: "Speed & Race",
    description: "outrun the clock and the rivals",
    icon: "fa-flag-checkered",
    gameIds: ["word-blast", "bot-duel", "ghost-gp", "sprint", "nitro-run"],
  },
  {
    id: "precision-timing",
    title: "Precision & Timing",
    description: "hit the exact moment",
    icon: "fa-crosshairs",
    gameIds: ["type-pong", "crane", "beat-keys", "lyric-line"],
  },
  {
    id: "reflex-survival",
    title: "Reflex & Survival",
    description: "react before it reaches you",
    icon: "fa-bolt",
    gameIds: [
      "letter-strike",
      "lane-defense",
      "tower-defense",
      "fruit-slash",
      "firefight",
      "climber",
      "runner",
    ],
  },
  {
    id: "memory-deduction",
    title: "Memory & Deduction",
    description: "remember, infer, deduce",
    icon: "fa-brain",
    gameIds: ["pair-keys", "wordle", "deck-runner", "balloon-pop"],
  },
  {
    id: "movement-spatial",
    title: "Movement & Spatial",
    description: "navigate while you type",
    icon: "fa-map",
    gameIds: ["type-snake", "stack-attack", "maze-runner"],
  },
  {
    id: "two-players",
    title: "Two Players",
    description: "one keyboard, head to head",
    icon: "fa-users",
    gameIds: ["split-duel"],
  },
];

/** the category a game belongs to (undefined for the pinned daily) */
export function categoryOfGame(gameId: string): GameCategory | undefined {
  return GAME_CATEGORIES.find((category) => category.gameIds.includes(gameId));
}

/** every categorized game card from app-structure, in category order */
export function gamesOfCategory(categoryId: GameCategoryId): {
  id: string;
  title: string;
  description: string;
  icon: string;
  route: string;
}[] {
  const category = GAME_CATEGORIES.find((it) => it.id === categoryId);
  if (category === undefined) return [];
  const gamesSection = getSection("games");
  const cards = gamesSection?.subSections ?? [];
  return category.gameIds
    .map((gameId) => cards.find((card) => card.id === gameId))
    .filter((card) => card !== undefined)
    .map((card) => ({
      id: card.id,
      title: card.title,
      description: card.description,
      icon: card.icon,
      route: card.route ?? "",
    }));
}
