import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAZE_SCORES_KEY,
  _resetMazeScoresForTests,
} from "../../../../src/ts/utils/maze-runner/store";
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
  return app.container.querySelectorAll('[data-testid="mz-cell"]').length;
}

function gates(app: App): HTMLElement[] {
  return [
    ...app.container.querySelectorAll<HTMLElement>('[data-testid="mz-gate"]'),
  ];
}

function activeWord(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="mz-word"]')
      ?.getAttribute("data-word") ?? ""
  );
}

async function openMaze(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/maze-runner" });
  await app.settle();
  return app;
}

describe("maze runner page (idea G14 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetMazeScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the levels and the how-to", async () => {
    const app = await openMaze();
    const text = pageText(app);
    expect(text).toContain("level 1");
    expect(text).toContain("best L1");
    expect(text).toContain("clean runs");
    expect(text).toContain("enter the maze");
  });

  it("a started run shows the full 15x11 grid, the gates and the runner", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(cells(app)).toBe(15 * 11);
    expect(gates(app).length).toBeGreaterThan(2);
    expect(
      app.container.querySelector('[data-testid="mz-runner"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="mz-minimap"]'),
    ).not.toBeNull();
    expect(activeWord(app).length).toBeGreaterThanOrEqual(3);
  });

  it("typing the active gate's word opens it (the partial bar moves)", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const word = activeWord(app);
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(100);
    const opened = gates(app).find(
      (gate) => gate.getAttribute("data-open") === "true",
    );
    expect(opened).toBeDefined();
    expect(opened?.getAttribute("data-word")).toBe(word);
  });

  it("a wrong key dents the errors HUD and the penalty", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Ω" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("penalty");
    //the errors cell shows 1
    const errorsCell = [...app.container.querySelectorAll(".text-xs")].find(
      (el) => el.textContent === "errors",
    );
    expect(errorsCell?.previousElementSibling?.textContent).toBe("1");
  });

  it("a full run conquers the maze and records the time", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //type every gate in order (the active word panel always shows the
    //current target), ticking the walk between words
    let guard = 0;
    while (!pageText(app).includes("conquered") && guard++ < 60) {
      const word = activeWord(app);
      if (word.length === 0) {
        await vi.advanceTimersByTimeAsync(200);
        continue;
      }
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
        await vi.advanceTimersByTimeAsync(15);
      }
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(pageText(app)).toContain("conquered");
    const raw = JSON.parse(
      window.localStorage.getItem(MAZE_SCORES_KEY) ?? "{}",
    ) as { history?: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
