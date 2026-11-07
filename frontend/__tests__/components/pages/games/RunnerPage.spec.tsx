import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SKY_SCORES_KEY,
  _resetSkyScoresForTests,
} from "../../../../src/ts/utils/climber/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function activeWord(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="rn-word"]')
      ?.getAttribute("data-word") ?? ""
  );
}

function livesText(app: App): string {
  return (
    app.container.querySelector('[data-testid="rn-lives"]')?.textContent ?? ""
  );
}

async function openRunner(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/runner" });
  await app.settle();
  return app;
}

async function startRun(app: App): Promise<void> {
  button(app, "start running")?.click();
  await vi.advanceTimersByTimeAsync(100);
}

describe("endless runner page (idea G15 phase 2, mode B)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSkyScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the best distance and the how-to", async () => {
    const app = await openRunner();
    const text = pageText(app);
    expect(text).toContain("best distance");
    expect(text).toContain("start running");
    expect(text).toContain("three lives");
  });

  it("a started run shows the arena, the obstacles and the lives", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    expect(
      app.container.querySelector('[data-testid="rn-parallax-far"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelectorAll('[data-testid="rn-obstacle"]').length,
    ).toBeGreaterThan(0);
    expect(
      app.container.querySelectorAll('[data-testid="rn-life"]').length,
    ).toBe(3);
  });

  it("typing the nearest obstacle's word clears it (combo grows)", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    let guard = 0;
    while (activeWord(app).length === 0 && guard++ < 60) {
      await vi.advanceTimersByTimeAsync(50);
    }
    const word = activeWord(app);
    expect(word.length).toBeGreaterThanOrEqual(3);
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(pageText(app)).toContain("x1");
    expect(livesText(app)).toBe("3/3");
  });

  it("never typing drains the lives to a recorded game over", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    let guard = 0;
    while (!pageText(app).includes("down the road") && guard++ < 400) {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(pageText(app)).toContain("down the road");
    expect(pageText(app)).toContain("hits taken");
    const raw = JSON.parse(
      window.localStorage.getItem(SKY_SCORES_KEY) ?? "{}",
    ) as { runner?: { games?: number } };
    expect(raw.runner?.games ?? 0).toBe(1);
  });

  it("a window blur pauses the run until the focus returns", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(50);
    expect(
      app.container.querySelector('[data-testid="rn-paused"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(50);
    expect(app.container.querySelector('[data-testid="rn-paused"]')).toBeNull();
  });
});
