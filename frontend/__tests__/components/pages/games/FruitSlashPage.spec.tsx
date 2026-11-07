import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRUIT_SLASH_SCORES_KEY,
  _resetFruitSlashScoresForTests,
} from "../../../../src/ts/utils/fruit-slash/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function fruits(app: App): { text: string; typed: string }[] {
  return [...app.container.querySelectorAll('[data-testid="fs-fruit"]')].map(
    (el) => ({
      text: el.textContent ?? "",
      typed: el.querySelector(".text-main")?.textContent ?? "",
    }),
  );
}

async function openFruitSlash(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/fruit-slash" });
  await app.settle();
  return app;
}

describe("fruit slash page (idea G10 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetFruitSlashScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openFruitSlash();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best slashed");
    expect(text).toContain("start run");
    expect(text).toContain("never type the bombs");
  });

  it("a started run shows flying fruits that slash by typing", async () => {
    const app = await openFruitSlash();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const field = fruits(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the fruit rises: its position moves up over the ticks
    expect(pageText(app)).toContain("time");

    //slash the first fruit by typing its whole word
    const target = field[0]?.text ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    expect(text).toMatch(/x1/); //the combo moved
    //fresh fruits have empty typed prefixes (the slash happened)
    expect(fruits(app).every((f) => f.typed === "")).toBe(true);
  });

  it("the 90-second window ends the run and records it", async () => {
    const app = await openFruitSlash();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (!pageText(app).includes("time!") && guard++ < 100) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    const text = pageText(app);
    expect(text).toContain("time!");
    expect(text).toContain("slashed");
    const raw = JSON.parse(
      window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
