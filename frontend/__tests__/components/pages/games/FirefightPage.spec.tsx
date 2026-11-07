import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIREFIGHT_SCORES_KEY,
  _resetFirefightScoresForTests,
} from "../../../../src/ts/utils/firefight/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function cells(app: App): number {
  return app.container.querySelectorAll('[data-testid="ff-cell"]').length;
}

function activeWord(app: App): { text: string; typed: string } | undefined {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="ff-word"]',
  );
  if (el === null) return undefined;
  return {
    text: el.textContent ?? "",
    typed: el.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openFirefight(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/firefight" });
  await app.settle();
  return app;
}

describe("firefight page (idea G16 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetFirefightScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openFirefight();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("wins");
    expect(text).toContain("start run");
    expect(text).toContain("35% ashes loses");
  });

  it("a started run shows the grid, the burning cells and the active word", async () => {
    const app = await openFirefight();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(cells(app)).toBe(108); //the full 12x9 building
    const word = activeWord(app);
    expect(word?.text.length).toBeGreaterThan(0); //one fire, one word
    expect(pageText(app)).toContain("the most critical burning cell");
  });

  it("typing the active word extinguishes it (the score moves)", async () => {
    const app = await openFirefight();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const word = activeWord(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    expect(text).toContain("1saved"); //the extinguish counter moved
    expect(text).toContain("no fire to fight"); //the hose idles
  });

  it("an idle run ends lost and records the result", async () => {
    const app = await openFirefight();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (
      !pageText(app).includes("the building is lost") &&
      !pageText(app).includes("the building survived") &&
      guard++ < 1600
    ) {
      await vi.advanceTimersByTimeAsync(250);
    }
    const text = pageText(app);
    expect(text).toContain("the building is lost");
    const raw = JSON.parse(
      window.localStorage.getItem(FIREFIGHT_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
