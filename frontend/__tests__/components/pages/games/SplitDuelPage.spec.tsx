import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DUEL_LOCAL_STATS_KEY,
  _resetDuelStatsForTests,
} from "../../../../src/ts/utils/split-duel/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function typeWord(
  app: App,
  slot: 1 | 2,
  code: string,
  t: { v: number },
): number {
  //reads the CURRENT word off the arena and types it char by char;
  //returns how many keys were sent
  const el = app.container.querySelector(`[data-testid="sd-word-${slot}"]`);
  if (el === null) return 0;
  const word = el.getAttribute("data-word") ?? "";
  let sent = 0;
  for (const ch of word) {
    t.v += 40;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ch, code }));
    sent += 1;
  }
  return sent;
}

async function openDuel(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/split-duel" });
  await app.settle();
  return app;
}

async function startCountdown(app: App): Promise<void> {
  button(app, "start showdown")?.click();
  await vi.advanceTimersByTimeAsync(100);
  expect(
    app.container.querySelector('[data-testid="sd-countdown"]'),
  ).not.toBeNull();
  await vi.advanceTimersByTimeAsync(3300); //past the 3s countdown
  expect(pageText(app)).not.toContain("start showdown");
}

describe("split duel page (idea G19 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetDuelStatsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the setup renders the names, the modes and the fallback note", async () => {
    const app = await openDuel();
    const text = pageText(app);
    expect(text).toContain("A · turn-based");
    expect(text).toContain("B · simultaneous");
    expect(text).toContain("20 words");
    expect(text).toContain("non-ANSI layout");
    expect(text).toContain("start showdown");
  });

  it("mode B routes keys per side: each half advances only itself", async () => {
    const app = await openDuel();
    vi.useFakeTimers();
    await startCountdown(app);
    const t = { v: Date.now() };
    //P1 (left half codes) types 2 words
    typeWord(app, 1, "KeyD", t);
    typeWord(app, 1, "KeyD", t);
    //P2 (right half codes) types 1 word
    typeWord(app, 2, "KeyJ", t);
    const p1 = app.container
      .querySelector('[data-testid="sd-word-1"]')
      ?.getAttribute("data-word");
    const p2 = app.container
      .querySelector('[data-testid="sd-word-2"]')
      ?.getAttribute("data-word");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    //the halves' streams use disjoint letter sets (left vs right half)
    const leftOnly = (p1 ?? "")
      .split("")
      .every((ch) => "qwertasdfgzxcvb".includes(ch));
    const rightOnly = (p2 ?? "")
      .split("")
      .every((ch) => "yuiophjklnm".includes(ch));
    expect(leftOnly).toBe(true);
    expect(rightOnly).toBe(true);
  });

  it("mode A: the swap overlay appears, then P2 finishes and records", async () => {
    const app = await openDuel();
    vi.useFakeTimers();
    button(app, "A · turn-based")?.click();
    await startCountdown(app);
    const t = { v: Date.now() };
    //P1 types the whole 20-word stream (the fallback pool cycles)
    let guard = 0;
    while (guard++ < 60 && pageText(app).includes("words")) {
      if (pageText(app).includes("ready?")) break;
      const sent = typeWord(app, 1, "KeyD", t);
      if (sent === 0) break;
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(
      app.container.querySelector('[data-testid="sd-swap"]'),
    ).not.toBeNull();
    expect(pageText(app)).toContain("ready?");
    button(app, "start my run")?.click();
    await vi.advanceTimersByTimeAsync(50);
    guard = 0;
    while (guard++ < 60 && !pageText(app).includes("wins!")) {
      const sent = typeWord(app, 2, "KeyJ", t);
      if (sent === 0) {
        await vi.advanceTimersByTimeAsync(50);
      }
    }
    expect(pageText(app)).toContain("wins!");
    const raw = JSON.parse(
      window.localStorage.getItem(DUEL_LOCAL_STATS_KEY) ?? "{}",
    ) as { matches?: number };
    expect(raw.matches ?? 0).toBe(1);
  });

  it("Esc leaves mid-run without recording", async () => {
    const app = await openDuel();
    vi.useFakeTimers();
    await startCountdown(app);
    const t = { v: Date.now() };
    typeWord(app, 1, "KeyD", t);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.advanceTimersByTimeAsync(50);
    expect(pageText(app)).toContain("start showdown"); //back at the setup
    const raw = JSON.parse(
      window.localStorage.getItem(DUEL_LOCAL_STATS_KEY) ?? "{}",
    ) as { matches?: number };
    expect(raw.matches ?? 0).toBe(0);
  });

  it("the countdown shows 3-2-1 before both modes", async () => {
    const app = await openDuel();
    vi.useFakeTimers();
    button(app, "start showdown")?.click();
    await vi.advanceTimersByTimeAsync(100);
    const el = app.container.querySelector('[data-testid="sd-countdown"]');
    expect(el?.textContent).toMatch(/[321]/);
    await vi.advanceTimersByTimeAsync(3300);
    expect(
      app.container.querySelector('[data-testid="sd-countdown"]'),
    ).toBeNull(); //the countdown is over
  });
});
