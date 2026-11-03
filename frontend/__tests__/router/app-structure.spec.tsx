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

  it("learning has three sub-sections; practice and games are direct", () => {
    expect(must("learning").subSections?.map((sub) => sub.id)).toEqual([
      "learn",
      "keybr",
      "drills",
    ]);
    expect(sectionHasPicker(must("learning"))).toBe(true);
    expect(must("practice").route).toBe("/");
    expect(must("games").route).toBe("/games");
    expect(sectionHasPicker(must("practice"))).toBe(false);
    expect(sectionHasPicker(must("games"))).toBe(false);
  });

  it("picker sections link to /sections/<id>, direct ones to their route", () => {
    expect(sectionDestination(must("learning"))).toBe("/sections/learning");
    expect(sectionDestination(must("practice"))).toBe("/");
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

  it("the learning picker renders every sub-section and links back home", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({
      to: "/sections/$sectionId",
      params: { sectionId: "learning" },
    });
    await app.settle();
    expect(getRoutePage()).toBe("sections");
    const text = pageText(app);
    expect(text).toContain("learning course");
    expect(text).toContain("adaptive engine");
    expect(text).toContain("drills");
    expect(text).toContain("back to home");
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
