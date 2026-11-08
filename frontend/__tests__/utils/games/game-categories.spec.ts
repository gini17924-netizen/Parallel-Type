import { describe, expect, it } from "vitest";

import { getSection } from "../../../src/ts/constants/app-structure";
import {
  GAME_CATEGORIES,
  PINNED_DAILY_GAME_ID,
  categoryOfGame,
  gamesOfCategory,
} from "../../../src/ts/utils/games/game-categories";

describe("game categories taxonomy (games section reorg, phase 1)", () => {
  it("defines exactly 6 categories with English-only text", () => {
    expect(GAME_CATEGORIES).toHaveLength(6);
    for (const category of GAME_CATEGORIES) {
      expect(category.title).toMatch(/^[A-Za-z0-9 &,'-]+$/);
      expect(category.description).toMatch(/^[a-z0-9 ,'-]+$/);
      //no Persian anywhere in the menu text (the owner's rule)
      expect(category.title).not.toMatch(/[\u0600-\u06FF]/);
      expect(category.description).not.toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("covers every registered game exactly once (24/24)", () => {
    const gamesSection = getSection("games");
    const registered = (gamesSection?.subSections ?? []).map((sub) => sub.id);
    const categorized = GAME_CATEGORIES.flatMap((c) => c.gameIds);
    //every categorized id is a real registered game
    for (const id of categorized) {
      expect(registered).toContain(id);
    }
    //no repeats across categories
    expect(new Set(categorized).size).toBe(categorized.length);
    //every registered game EXCEPT the pinned daily is categorized
    const uncategorized = registered.filter(
      (id) => id !== PINNED_DAILY_GAME_ID && !categorized.includes(id),
    );
    expect(uncategorized).toEqual([]);
    expect(categorized.length).toBe(registered.length - 1);
  });

  it("the Daily Gauntlet is pinned, never categorized", () => {
    for (const category of GAME_CATEGORIES) {
      expect(category.gameIds).not.toContain(PINNED_DAILY_GAME_ID);
    }
    expect(categoryOfGame(PINNED_DAILY_GAME_ID)).toBeUndefined();
    expect(categoryOfGame("sprint")?.id).toBe("speed-race");
    expect(categoryOfGame("nonexistent")).toBeUndefined();
  });

  it("each category resolves real cards from app-structure", () => {
    for (const category of GAME_CATEGORIES) {
      const cards = gamesOfCategory(category.id);
      expect(cards.length).toBe(category.gameIds.length);
      for (const card of cards) {
        expect(card.title.length).toBeGreaterThan(0);
        expect(card.route).toMatch(/^\/games\//);
      }
    }
  });

  it("no category is empty and the two-players category holds only the duel", () => {
    for (const category of GAME_CATEGORIES) {
      expect(category.gameIds.length).toBeGreaterThan(0);
    }
    const duo = GAME_CATEGORIES.find((c) => c.id === "two-players");
    expect(duo?.gameIds).toEqual(["split-duel"]);
  });
});
