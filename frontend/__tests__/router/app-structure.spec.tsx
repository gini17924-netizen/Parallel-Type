import { describe, expect, it, afterEach } from "vitest";

import {
  type AppSection,
  APP_SECTIONS,
  getSection,
  sectionDestination,
  sectionHasPicker,
} from "../../src/ts/constants/app-structure";
import { getRoutePage } from "../../src/ts/states/router";
import { App, cleanupApp, renderApp } from "../__harness__/app-shell";

function pageText(app: App): string {
  //the page wrapper swaps with an exit fade: read the whole app container
  return app.container.textContent ?? "";
}

afterEach(() => {
  cleanupApp();
});

/** a section that must exist — throws instead of non-null assertions */
function must(id: string): AppSection {
  const section = getSection(id);
  if (section === undefined) throw new Error(`section ${id} is missing`);
  return section;
}

describe("app structure (home hub sections)", () => {
  it("declares exactly learning, practice and games", () => {
    expect(APP_SECTIONS.map((section) => section.id)).toEqual([
      "learning",
      "practice",
      "games",
    ]);
  });

  it("learning has two sub-sections (drills lives under practice)", () => {
    expect(must("learning").subSections?.map((sub) => sub.id)).toEqual([
      "learn",
      "keybr",
    ]);
    expect(sectionHasPicker(must("learning"))).toBe(true);
  });

  it("practice has typing test and drills behind a picker", () => {
    const practice = must("practice");
    expect(practice.subSections?.map((sub) => sub.id)).toEqual([
      "test",
      "drills",
    ]);
    expect(sectionHasPicker(practice)).toBe(true);
  });

  it("games has all twenty-four entries behind a picker (G24 + G2..G6 + G8..G15 + G20 + G22)", () => {
    const games = must("games");
    expect(games.route).toBeUndefined();
    expect(games.subSections?.map((sub) => sub.id)).toEqual([
      "word-blast",
      "bot-duel",
      "ghost-gp",
      "sprint",
      "wordle",
      "balloon-pop",
      "deck-runner",
      "letter-strike",
      "lane-defense",
      "fruit-slash",
      "stack-attack",
      "type-snake",
      "firefight",
      "nitro-run",
      "type-pong",
      "crane",
      "beat-keys",
      "pair-keys",
      "split-duel",
      "maze-runner",
      "climber",
      "runner",
      "lyric-line",
      "daily-gauntlet",
    ]);
    expect(sectionHasPicker(games)).toBe(true);
    expect(games.subSections?.[0]?.route).toBe("/games/word-blast");
    expect(games.subSections?.[1]?.route).toBe("/games/bot-duel");
    expect(games.subSections?.[2]?.route).toBe("/games/ghost-gp");
    expect(games.subSections?.[3]?.route).toBe("/games/sprint");
    expect(games.subSections?.[4]?.route).toBe("/games/wordle");
    expect(games.subSections?.[5]?.route).toBe("/games/balloon-pop");
    expect(games.subSections?.[6]?.route).toBe("/games/deck-runner");
  });

  it("picker sections link to /sections/<id>, direct ones to their route", () => {
    expect(sectionDestination(must("learning"))).toBe("/sections/learning");
    expect(sectionDestination(must("practice"))).toBe("/sections/practice");
    //games opens its CUSTOM landing (the Offline/Online blocks)
    expect(sectionDestination(must("games"))).toBe("/games");
  });
});

describe("home hub routing", () => {
  it("boots into the test page (existing behaviour preserved)", async () => {
    const app = renderApp();
    await app.settle();
    expect(getRoutePage()).toBe("test");
    expect(pageText(app)).toBeTruthy();
  });

  it("renders the home hub with all three section cards", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/home" });
    await app.settle();
    expect(getRoutePage()).toBe("home");
    const text = pageText(app);
    for (const section of APP_SECTIONS) {
      expect(text).toContain(section.title);
    }
  });

  it("the learning picker renders its sub-sections and links back home", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({
      to: "/sections/$sectionId",
      params: { sectionId: "learning" },
    });
    await app.settle();
    expect(getRoutePage()).toBe("sections");
    const text = pageText(app);
    expect(text).toContain("progressive learning");
    expect(text).toContain("keybr engine");
    expect(text).toContain("back to home");
  });

  it("the games picker (legacy direct URL) still renders its cards", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({
      to: "/sections/$sectionId",
      params: { sectionId: "games" },
    });
    await app.settle();
    expect(getRoutePage()).toBe("sections");
    const text = pageText(app);
    expect(text).toContain("word blast");
    expect(text).toContain("bot duel");
    expect(text).toContain("ghost gp");
    expect(text).toContain("ten-second sprint");
    expect(text).toContain("wordle");
    expect(text).toContain("balloon pop");
    expect(text).toContain("deck runner");
    expect(text).toContain("back to home");
  });

  it("the practice picker renders typing test and drills", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({
      to: "/sections/$sectionId",
      params: { sectionId: "practice" },
    });
    await app.settle();
    expect(getRoutePage()).toBe("sections");
    const text = pageText(app);
    expect(text).toContain("typing test");
    expect(text).toContain("drills");
  });

  it("the test page never stays in a perpetual loading state", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/home" });
    await app.settle();
    await app.router.navigate({ to: "/" });
    await app.settle();
    //a stuck page reports "loading" as its page name forever
    expect(getRoutePage()).toBe("test");
    expect(pageText(app)).not.toBe("");
  });

  it("the leaderboards page never stays in a perpetual loading state", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/leaderboards" });
    await app.settle();
    //desktop offline: the backend prefetches are skipped (routes.ts loader);
    //the route itself must still resolve to the page, not hang on loading
    expect(getRoutePage()).toBe("leaderboards");
    expect(pageText(app)).not.toBe("");
  });

  it("unknown section ids land back on the home hub", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({
      to: "/sections/$sectionId",
      params: { sectionId: "nonexistent" },
    });
    await app.settle();
    expect(getRoutePage()).toBe("home");
  });

  it("every declared destination resolves to a real page (never 404)", async () => {
    const app = renderApp();
    await app.settle();
    const destinations = new Set<string>([
      ...APP_SECTIONS.map((section) => sectionDestination(section)),
      ...APP_SECTIONS.flatMap((section) => section.subSections ?? []).map(
        (sub) => sub.route,
      ),
    ]);
    for (const destination of destinations) {
      //dynamic string: the structure data, not a literal route
      await app.router.navigate({ to: destination as never });
      await app.settle();
      expect(getRoutePage(), `destination ${destination}`).not.toBe("404");
    }
  });
});
