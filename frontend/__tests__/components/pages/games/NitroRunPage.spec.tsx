import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NITRO_RUN_STATS_KEY,
  _resetNitroRunStatsForTests,
} from "../../../../src/ts/utils/nitro-run/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function currentWord(app: App): { text: string; typed: string } {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="nr-word"]',
  );
  return {
    text: el?.textContent ?? "",
    typed: el?.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openNitroRun(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/nitro-run" });
  await app.settle();
  return app;
}

describe("nitro run page (idea G23 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetNitroRunStatsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openNitroRun();
    const text = pageText(app);
    expect(text).toContain("best rank score");
    expect(text).toContain("best distance");
    expect(text).toContain("start race");
    expect(text).toContain("Enter burns it");
  });

  it("a started race shows the cars, the stream and the gap line", async () => {
    const app = await openNitroRun();
    vi.useFakeTimers();
    button(app, "start race")?.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(
      app.container.querySelector('[data-testid="nr-player-car"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelectorAll('[data-testid="nr-ai-car"]').length,
    ).toBeGreaterThan(0);
    expect(
      app.container.querySelector('[data-testid="nr-gap-line"]'),
    ).not.toBeNull();
    const word = currentWord(app);
    expect(word.text.length).toBeGreaterThan(0);
  });

  it("typing the stream advances the distance", async () => {
    const app = await openNitroRun();
    vi.useFakeTimers();
    button(app, "start race")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const word = currentWord(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    const distance = Number(/(\d+)m\s*distance/.exec(text)?.[1] ?? 0);
    expect(distance).toBeGreaterThan(0); //the distance moved off zero
  });

  it("an idle race ends with the result screen and records it", async () => {
    const app = await openNitroRun();
    vi.useFakeTimers();
    button(app, "start race")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (!pageText(app).includes("race over") && guard++ < 200) {
      await vi.advanceTimersByTimeAsync(250);
    }
    const text = pageText(app);
    expect(text).toContain("race over");
    expect(text).toContain("place #5 of 5"); //idle: behind all four AI
    const raw = JSON.parse(
      window.localStorage.getItem(NITRO_RUN_STATS_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
