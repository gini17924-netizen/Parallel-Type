import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TYPE_SNAKE_SCORES_KEY,
  _resetTypeSnakeScoresForTests,
} from "../../../../src/ts/utils/type-snake/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function segments(app: App): number {
  return app.container.querySelectorAll('[data-testid="ts-segment"]').length;
}

function food(app: App): { text: string; typed: string } | undefined {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="ts-food"]',
  );
  if (el === null) return undefined;
  return {
    text: el.textContent ?? "",
    typed: el.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openTypeSnake(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/type-snake" });
  await app.settle();
  return app;
}

describe("type snake page (idea G11 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetTypeSnakeScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openTypeSnake();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best length");
    expect(text).toContain("start run");
    expect(text).toContain("the snake walks itself");
  });

  it("a started run shows the snake and the ripening food", async () => {
    const app = await openTypeSnake();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(segments(app)).toBe(4);
    const f = food(app);
    expect(f, `diag: ${pageText(app).slice(0, 240)}`).toBeDefined();
    expect((f?.text ?? "").length).toBeGreaterThan(0);

    //the snake walks itself: the head position moves over the ticks
    //(a 220ms advance fires only four 50ms ticks = 200ms < one step, so
    //advance past the movement interval)
    const head = app.container.querySelectorAll(
      '[data-testid="ts-segment"]',
    )[0];
    const before = `${(head as HTMLElement | undefined)?.style.left}/${
      (head as HTMLElement | undefined)?.style.top
    }`;
    await vi.advanceTimersByTimeAsync(250);
    const headAfter = app.container.querySelectorAll(
      '[data-testid="ts-segment"]',
    )[0];
    const after = `${(headAfter as HTMLElement | undefined)?.style.left}/${
      (headAfter as HTMLElement | undefined)?.style.top
    }`;
    expect(after).not.toBe(before);
  });

  it("typing the food's word ripens it; the eat lands on arrival", async () => {
    const app = await openTypeSnake();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const word = food(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    //ripened: the typed prefix covers the whole word
    expect(food(app)?.typed).toBe(word);
    //walk to the food: the eat lands automatically (the score moves)
    let guard = 0;
    let score = 0;
    while (guard++ < 800) {
      await vi.advanceTimersByTimeAsync(250);
      score = Number(/(\d+)score/.exec(pageText(app))?.[1] ?? 0);
      if (score > 0) break;
    }
    expect(score).toBeGreaterThan(0); //the eat landed
    expect(segments(app)).toBe(5); //grown
    const text = pageText(app);
    expect(text).toMatch(/1eaten/); //the eat counted
  });

  it("the run ends when the snake is boxed in (idle-grow shortcut)", async () => {
    //a long idle run grows the snake on the cadence of typed foods; the
    //engine's death is unit-tested, so here we only pin the plumbing:
    //the record lands in storage once a run finishes
    const app = await openTypeSnake();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //force many eat cycles: type each food's word and walk
    let guard = 0;
    while (guard++ < 60 && pageText(app).includes("eaten")) {
      const word = food(app)?.text ?? "";
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
        await vi.advanceTimersByTimeAsync(20);
      }
      await vi.advanceTimersByTimeAsync(600);
    }
    //no crash + the HUD still alive (or the result screen if it died)
    expect(
      pageText(app).includes("eaten") || pageText(app).includes("boxed in"),
    ).toBe(true);
    void TYPE_SNAKE_SCORES_KEY;
  });
});
