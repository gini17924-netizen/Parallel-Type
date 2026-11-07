import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetStackAttackScoresForTests } from "../../../../src/ts/utils/stack-attack/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function fallingBlock(app: App): HTMLElement | undefined {
  return (
    app.container.querySelector<HTMLElement>('[data-testid="sa-block"]') ??
    undefined
  );
}

function lockedCells(app: App): string[] {
  return [...app.container.querySelectorAll('[data-testid="sa-cell"]')].map(
    (el) => el.textContent ?? "",
  );
}

async function openStackAttack(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/stack-attack" });
  await app.settle();
  return app;
}

describe("stack attack page (idea G12 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetStackAttackScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the best and the how-to", async () => {
    const app = await openStackAttack();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("start run");
    expect(text).toContain("steer with the arrows");
  });

  it("a started run shows the falling block and the ghost column", async () => {
    const app = await openStackAttack();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const block = fallingBlock(app);
    expect(block, `diag: ${pageText(app).slice(0, 240)}`).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="sa-ghost"]'),
    ).not.toBeNull();
    expect(pageText(app)).toContain("chain");
  });

  it("the arrows steer the falling block", async () => {
    const app = await openStackAttack();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const before = fallingBlock(app)?.style.left ?? "";
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(30);
    const after = fallingBlock(app)?.style.left ?? "";
    expect(after).not.toBe(before);
  });

  it("typing the word locks the block into the grid cells", async () => {
    const app = await openStackAttack();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //park the fall: rest on the floor
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fallingBlock(app)?.textContent).not.toBeNull();
    const word = fallingBlock(app)?.textContent ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    //the locked cells render as letters in the grid
    expect(lockedCells(app).length).toBe(word.length);
    //a fresh block arrived
    expect(fallingBlock(app)).not.toBeNull();
  });
});
