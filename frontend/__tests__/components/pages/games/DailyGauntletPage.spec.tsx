import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerDailyBotDuel } from "../../../../src/ts/utils/bot-duel/daily";
import {
  advanceGauntlet,
  createGauntlet,
} from "../../../../src/ts/utils/daily-gauntlet/engine";
import {
  getGauntletStats,
  loadGauntletState,
  recordGauntletCompletion,
  saveGauntletState,
  _resetGauntletStoresForTests,
} from "../../../../src/ts/utils/daily-gauntlet/store";
import { _resetDailyRegistryForTests } from "../../../../src/ts/utils/games/game-registry";
import { registerDailySprint } from "../../../../src/ts/utils/sprint/daily";
import { registerDailyWordBlast } from "../../../../src/ts/utils/word-blast/daily";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function stage(app: App, gameId: string): HTMLElement | undefined {
  return [
    ...app.container.querySelectorAll<HTMLElement>('[data-testid="dg-stage"]'),
  ].find((el) => el.getAttribute("data-game") === gameId);
}

async function openGauntlet(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/daily-gauntlet" });
  await app.settle();
  return app;
}

describe("daily gauntlet page (idea G22 phase 4)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetDailyRegistryForTests();
    _resetGauntletStoresForTests();
    registerDailyWordBlast();
    registerDailySprint();
    registerDailyBotDuel();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu shows the streak, the best and the how-to", async () => {
    const app = await openGauntlet();
    const text = pageText(app);
    expect(text).toContain("streak");
    expect(text).toContain("best total");
    expect(text).toContain("start today's gauntlet");
  });

  it("starting the day composes 3 distinct stages and saves the state", async () => {
    const app = await openGauntlet();
    button(app, "start today's gauntlet")?.click();
    await app.settle();
    const games = [
      ...app.container.querySelectorAll<HTMLElement>(
        '[data-testid="dg-stage"]',
      ),
    ].map((el) => el.getAttribute("data-game"));
    expect(games).toHaveLength(3);
    expect(new Set(games).size).toBe(3);
    const saved = loadGauntletState();
    expect(saved?.dayKey.length).toBe(10);
    const next = stage(app, games[1] ?? "");
    expect(next?.getAttribute("data-status")).toBe("pending"); //none run yet
  });

  it("completing all three stages stamps the calendar and locks the day", async () => {
    //simulate the full daily flow through the store (the games resolve
    //their stages from their own pages)
    const app = await openGauntlet();
    void app;
    button(app, "start today's gauntlet")?.click();
    await app.settle();
    const saved = loadGauntletState();
    expect(saved).toBeDefined();
    const dayKey = saved?.dayKey ?? "";
    const stages = saved?.stages ?? [];
    let state = createGauntlet(dayKey, stages);
    for (const s of stages) {
      state = advanceGauntlet(state, {
        gameId: s.gameId,
        normalized: 700,
        raw: {},
        won: true,
      });
    }
    saveGauntletState(state);
    //reload the page: the completion records and the day locks
    const app2 = await openGauntlet();
    const text = pageText(app2);
    expect(text).toContain("gauntlet complete");
    expect(text).toContain("2100");
    expect(text).toContain("🔥 1");
    expect(button(app2, "start today's gauntlet")).toBeUndefined(); //locked
    //the calendar is stamped
    const days = [
      ...app2.container.querySelectorAll<HTMLElement>('[data-testid="dg-day"]'),
    ];
    expect(days.some((d) => d.textContent === "🔥")).toBe(true);
    //the stats survived the clear
    expect(getGauntletStats().streak).toBe(1);
    expect(getGauntletStats().bestTotal).toBe(2100);
  });

  it("a mid-run state resumes from the next stage (the close-app rule)", async () => {
    //stage 1 done, then the app "closed" — the store holds the state
    const saved = loadGauntletState();
    void saved;
    const fresh = createGauntlet(new Date().toLocaleDateString("en-CA"), [
      { gameId: "word-blast", title: "word blast", seed: 1, params: {} },
      { gameId: "sprint", title: "10s sprint", seed: 2, params: {} },
      { gameId: "bot-duel", title: "bot duel", seed: 3, params: {} },
    ]);
    saveGauntletState(
      advanceGauntlet(fresh, {
        gameId: "word-blast",
        normalized: 600,
        raw: {},
        won: true,
      }),
    );
    const app = await openGauntlet();
    const blast = stage(app, "word-blast");
    expect(blast?.getAttribute("data-status")).toBe("done");
    const sprint = stage(app, "sprint");
    expect(sprint?.getAttribute("data-status")).toBe("next"); //resume here
    expect(pageText(app)).toContain("600"); //the running total
  });

  it("a stale day's state frees the slot and shows a fresh menu", async () => {
    recordGauntletCompletion({
      dayKey: "2020-01-01",
      total: 900,
      stagesWon: 1,
    });
    saveGauntletState(
      createGauntlet("2020-01-01", [
        { gameId: "word-blast", title: "word blast", seed: 1, params: {} },
        { gameId: "sprint", title: "10s sprint", seed: 2, params: {} },
        { gameId: "bot-duel", title: "bot duel", seed: 3, params: {} },
      ]),
    );
    const app = await openGauntlet();
    //today has no stamp → the fresh menu
    expect(pageText(app)).toContain("start today's gauntlet");
    expect(loadGauntletState()?.dayKey ?? "").not.toBe("2020-01-01");
  });
});
