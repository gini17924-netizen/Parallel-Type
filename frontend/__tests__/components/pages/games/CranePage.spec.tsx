import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function seqEl(app: App): HTMLElement | undefined {
  return (
    app.container.querySelector<HTMLElement>('[data-testid="cr-seq"]') ??
    undefined
  );
}

async function openCrane(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/crane" });
  await app.settle();
  return app;
}

describe("crane page (idea G17 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openCrane();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best height");
    expect(text).toContain("start stacking");
    expect(text).toContain("3 misses");
  });

  it("a started run shows the crane, the zone and the hanging sequence", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    expect(
      app.container.querySelector('[data-testid="cr-crane"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="cr-zone"]'),
    ).not.toBeNull();
    const seq = seqEl(app)?.textContent ?? "";
    expect(seq.length).toBeGreaterThanOrEqual(4); //the 4..6 key sequence
    expect(pageText(app)).toContain("misses");
  });

  it("a wrong key resets the partial prefix", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    const seq = seqEl(app)?.textContent ?? "";
    window.dispatchEvent(new KeyboardEvent("keydown", { key: seq[0] ?? "f" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(
      seqEl(app)?.querySelector(".text-main")?.textContent ?? "",
    ).toHaveLength(1);
    //"d" is outside the default unlocked group (fj)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(
      seqEl(app)?.querySelector(".text-main")?.textContent ?? "",
    ).toHaveLength(0);
  });

  it("completing the sequence releases the box (the fall plays)", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    const seq = seqEl(app)?.textContent ?? "";
    for (const ch of seq) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    //the release moment: the falling box is on screen
    expect(
      app.container.querySelector('[data-testid="cr-fallbox"]'),
    ).not.toBeNull();
    await vi.advanceTimersByTimeAsync(520);
    //after the landing: a tower segment OR the miss was counted (1/3)
    expect(
      app.container.querySelector('[data-testid="cr-seg"]') !== null ||
        pageText(app).includes("1/3"),
    ).toBe(true);
  });

  it("a window blur pauses the sweep until the focus returns", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(10);
    expect(
      app.container.querySelector('[data-testid="cr-paused"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10);
    expect(app.container.querySelector('[data-testid="cr-paused"]')).toBeNull();
  });
});
