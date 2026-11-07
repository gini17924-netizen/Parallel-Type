import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TYPE_PONG_SCORES_KEY,
  _resetTypePongScoresForTests,
} from "../../../../src/ts/utils/type-pong/store";
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
    '[data-testid="tp-word"]',
  );
  return {
    text: el?.textContent ?? "",
    typed: el?.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openTypePong(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/type-pong" });
  await app.settle();
  return app;
}

describe("type pong page (idea G13 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetTypePongScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the stats and the how-to", async () => {
    const app = await openTypePong();
    const text = pageText(app);
    expect(text).toContain("wins");
    expect(text).toContain("losses");
    expect(text).toContain("best rally");
    expect(text).toContain("start match");
    expect(text).toContain("First to 5 wins");
  });

  it("a started match shows the court, the paddles and the ball", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(
      app.container.querySelector('[data-testid="tp-player-paddle"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="tp-ai-paddle"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="tp-ball"]'),
    ).not.toBeNull();
    const w = currentWord(app);
    expect(w.text.length).toBeGreaterThan(0);
  });

  it("typing the word moves the paddle (the typed prefix grows)", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const w = currentWord(app)?.text ?? "";
    //type the first 2 chars: the typed prefix grows
    expect(w.length).toBeGreaterThan(0); //sanity: the word is live
    for (const ch of w.slice(0, 2)) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(currentWord(app)?.typed).toBe(w.slice(0, 2));
  });

  it("the breaker mode: switching works and the word display lives", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "breaker")?.click();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    //the word display is live (the breaker engine issued the first brick's word)
    const wordEl = app.container.querySelector('[data-testid="tp-word"]');
    expect(wordEl, `diag: ${pageText(app).slice(0, 300)}`).not.toBeNull();
    const word = wordEl?.textContent ?? "";
    expect(word.length).toBeGreaterThan(0);
  });

  it("an idle match ends with the result screen and records it", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (
      !pageText(app).includes("you win!") &&
      !pageText(app).includes("the AI wins") &&
      guard++ < 3000
    ) {
      await vi.advanceTimersByTimeAsync(50);
    }
    const text = pageText(app);
    expect(text.includes("you win!") || text.includes("the AI wins")).toBe(
      true,
    );
    const raw = JSON.parse(
      window.localStorage.getItem(TYPE_PONG_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
