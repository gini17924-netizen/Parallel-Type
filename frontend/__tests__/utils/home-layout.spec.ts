import { beforeEach, describe, expect, it } from "vitest";

import { APP_SECTIONS } from "../../src/ts/constants/app-structure";
import {
  homeCards,
  moveSectionDown,
  moveSectionUp,
  resetHomeLayout,
  toggleSectionHidden,
} from "../../src/ts/utils/onboarding/home-layout";

const REGISTRY_IDS = APP_SECTIONS.map((s) => s.id);

describe("phase 96 — the home layout", () => {
  beforeEach(() => {
    resetHomeLayout();
  });

  it("a fresh install renders the registry order, nothing hidden", () => {
    const { visible, hidden } = homeCards();
    expect(visible.map((s) => s.id)).toEqual(REGISTRY_IDS);
    expect(hidden).toHaveLength(0);
  });

  it("move up/down reorders and survives a fresh read", () => {
    //registry: [learning, practice, games]
    moveSectionDown("learning");
    expect(homeCards().visible.map((s) => s.id)).toEqual([
      "practice",
      "learning",
      "games",
    ]);
    moveSectionUp("learning");
    expect(homeCards().visible.map((s) => s.id)).toEqual([
      "learning",
      "practice",
      "games",
    ]);
    moveSectionUp("learning");
    //already first — no-op
    expect(homeCards().visible.map((s) => s.id)).toEqual([
      "learning",
      "practice",
      "games",
    ]);
    moveSectionDown("games");
    //already last — no-op
    expect(homeCards().visible.map((s) => s.id)).toEqual([
      "learning",
      "practice",
      "games",
    ]);
  });

  it("hiding a card moves it out of visible and the chip list brings it back", () => {
    toggleSectionHidden("games");
    const { visible, hidden } = homeCards();
    expect(visible.map((s) => s.id)).toEqual(["learning", "practice"]);
    expect(hidden.map((s) => s.id)).toEqual(["games"]);
    toggleSectionHidden("games");
    expect(homeCards().hidden).toHaveLength(0);
  });

  it("an unknown id is ignored", () => {
    moveSectionUp("nope");
    toggleSectionHidden("nope");
    expect(homeCards().visible.map((s) => s.id)).toEqual(REGISTRY_IDS);
    expect(homeCards().hidden).toHaveLength(0);
  });

  it("reset restores the registry default", () => {
    toggleSectionHidden("learning");
    moveSectionUp("games");
    resetHomeLayout();
    const { visible, hidden } = homeCards();
    expect(visible.map((s) => s.id)).toEqual(REGISTRY_IDS);
    expect(hidden).toHaveLength(0);
  });
});
