import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LANE_DEFENSE_SCORES_KEY,
  _resetLaneDefenseScoresForTests,
} from "../../../../src/ts/utils/lane-defense/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function enemies(app: App): { text: string; typed: string }[] {
  return [...app.container.querySelectorAll('[data-testid="ld-enemy"]')].map(
    (el) => ({
      text: el.textContent ?? "",
      typed: el.querySelector(".text-main")?.textContent ?? "",
    }),
  );
}

async function openLaneDefense(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/lane-defense" });
  await app.settle();
  return app;
}

describe("lane defense page (idea G9 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLaneDefenseScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the zone picker and the bests", async () => {
    const app = await openLaneDefense();
    const text = pageText(app);
    expect(text).toContain("keyboard zone");
    expect(text).toContain("free");
    expect(text).toContain("fj"); //the first english group
    expect(text).toContain("best score");
    expect(text).toContain("zone best");
  });

  it("the default zone (fj) spawns ONLY f/j words (the DoD zone check)", async () => {
    const app = await openLaneDefense();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const field = enemies(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the educational preset: every enemy word is built from f/j alone
    for (const enemy of field) {
      for (const ch of enemy.text) {
        expect(["f", "j"]).toContain(ch);
      }
    }
    expect(pageText(app)).toContain("wall");
  });

  it("typing the nearest enemy's word kills it and moves the combo", async () => {
    const app = await openLaneDefense();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const target = enemies(app)[0]?.text ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    expect(text).toMatch(/x1/); //the combo moved
    //fresh enemies have empty typed prefixes (a repeat word is possible)
    expect(enemies(app).every((e) => e.typed === "")).toBe(true);
  });

  it("breaches drain the wall; wall 0 ends the run and records it", async () => {
    const app = await openLaneDefense();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    //idle: walkers cross the wall until it falls
    let guard = 0;
    while (!pageText(app).includes("the wall has fallen") && guard++ < 90) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    const text = pageText(app);
    expect(text).toContain("the wall has fallen");
    expect(text).toContain("wave reached");
    const raw = JSON.parse(
      window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
