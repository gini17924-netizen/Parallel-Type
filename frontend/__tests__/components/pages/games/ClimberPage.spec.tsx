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

function platforms(app: App): HTMLElement[] {
  return [
    ...app.container.querySelectorAll<HTMLElement>(
      '[data-testid="cl-platform"]',
    ),
  ];
}

function activeWord(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="cl-word"]')
      ?.getAttribute("data-word") ?? ""
  );
}

function runnerBottom(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="cl-runner"]')
      ?.getAttribute("style")
      ?.match(/bottom:\s*([\d.]+)px/)?.[1] ?? "0"
  );
}

async function openClimber(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/climber" });
  await app.settle();
  return app;
}

async function startRun(app: App): Promise<void> {
  button(app, "start climbing")?.click();
  await vi.advanceTimersByTimeAsync(100);
}

describe("sky climber page (idea G15 phase 2, mode A)", () => {
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

  it("the menu renders the bests and the how-to", async () => {
    const app = await openClimber();
    const text = pageText(app);
    expect(text).toContain("best height");
    expect(text).toContain("best score");
    expect(text).toContain("start climbing");
  });

  it("a started run shows the platform stack, the word and the ring", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    expect(platforms(app).length).toBeGreaterThanOrEqual(6);
    expect(
      app.container.querySelector('[data-testid="cl-ring"]'),
    ).not.toBeNull();
    expect(activeWord(app).length).toBeGreaterThanOrEqual(3);
  });

  it("typing the word jumps: the runner slides and the score grows", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    const before = runnerBottom(app);
    const word = activeWord(app);
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(parseFloat(runnerBottom(app))).toBeGreaterThan(parseFloat(before));
    expect(pageText(app)).toContain("height1");
  });

  it("idling drains the ring and a fall increments the falls HUD", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    //climb out of the ground first, then idle past the timer
    for (let i = 0; i < 2; i++) {
      const word = activeWord(app);
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
        await vi.advanceTimersByTimeAsync(10);
      }
    }
    const fallsText = (): string =>
      app.container.querySelector('[data-testid="cl-falls"]')?.textContent ??
      "0";
    expect(fallsText()).toBe("0");
    await vi.advanceTimersByTimeAsync(8500); //past the 8s platform timer
    expect(fallsText()).toBe("1");
  });

  it("a window blur pauses the pressure until the focus returns", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(50);
    expect(
      app.container.querySelector('[data-testid="cl-paused"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(50);
    expect(app.container.querySelector('[data-testid="cl-paused"]')).toBeNull();
  });

  it("a ground fall ends the run and records the height", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    //idle from the ground: one fall = death
    await vi.advanceTimersByTimeAsync(8500);
    expect(pageText(app)).toContain("the climb is over");
    const raw = JSON.parse(
      window.localStorage.getItem(SKY_SCORES_KEY) ?? "{}",
    ) as { climber?: { games?: number } };
    expect(raw.climber?.games ?? 0).toBe(1);
  });
});
