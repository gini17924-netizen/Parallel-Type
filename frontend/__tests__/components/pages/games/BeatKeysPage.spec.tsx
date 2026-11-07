import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BEAT_KEYS_SCORES_KEY,
  _resetBeatKeysForTests,
} from "../../../../src/ts/utils/beat-keys/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function notes(app: App): { key: string }[] {
  return [...app.container.querySelectorAll('[data-testid="bk-note"]')].map(
    (el) => ({ key: el.getAttribute("data-key") ?? "" }),
  );
}

function hudValue(app: App, testId: string): number {
  const el = app.container.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  const parsed = Number.parseInt(el?.textContent ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function openBeatKeys(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/beat-keys" });
  await app.settle();
  return app;
}

describe("beat keys page (idea G21 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetBeatKeysForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the setup renders the difficulties, the offset and the how-to", async () => {
    const app = await openBeatKeys();
    const text = pageText(app);
    expect(text).toContain("easy · 70 bpm");
    expect(text).toContain("normal · 100 bpm");
    expect(text).toContain("hard · 130 bpm");
    expect(text).toContain("calibration offset");
    expect(text).toContain("start");
  });

  it("a started run shows 4 lane keys and falling notes", async () => {
    const app = await openBeatKeys();
    vi.useFakeTimers();
    button(app, "start")?.click();
    await vi.advanceTimersByTimeAsync(400);
    const text = pageText(app);
    expect(
      app.container.querySelector('[data-testid="bk-hitline"]'),
    ).not.toBeNull();
    for (const key of ["d", "f", "j", "k"]) {
      expect(text).toContain(key);
    }
    expect(notes(app).length).toBeGreaterThan(0); //notes on the lanes
    expect(hudValue(app, "bk-score")).toBe(0);
  });

  it("typing the lane key when a note crosses scores it", async () => {
    const app = await openBeatKeys();
    vi.useFakeTimers();
    button(app, "start")?.click();
    //sweep several beats tapping ALL 4 lane keys: the chart's lane mix is
    //random per run, so key-agnostic spam guarantees every note in the
    //window gets judged
    for (let i = 0; i < 90; i++) {
      for (const key of ["d", "f", "j", "k"]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      }
      await vi.advanceTimersByTimeAsync(33);
    }
    expect(hudValue(app, "bk-score")).toBeGreaterThan(0);
  });

  it("notes past the window auto-miss on the HUD", async () => {
    const app = await openBeatKeys();
    vi.useFakeTimers();
    button(app, "start")?.click();
    //let several beats pass without typing anything
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(hudValue(app, "bk-misses")).toBeGreaterThan(0);
  });

  it("a tab switch voids the round without recording", async () => {
    const app = await openBeatKeys();
    vi.useFakeTimers();
    button(app, "start")?.click();
    await vi.advanceTimersByTimeAsync(300);
    //sneak in a score first
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      await vi.advanceTimersByTimeAsync(33);
    }
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(50);
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    expect(pageText(app)).toContain("voided");
    const raw = JSON.parse(
      window.localStorage.getItem(BEAT_KEYS_SCORES_KEY) ?? "{}",
    ) as { history?: unknown[] };
    expect(raw.history ?? []).toHaveLength(0); //nothing recorded
  });

  it("8 on-beat taps complete the calibration and save the offset", async () => {
    const app = await openBeatKeys();
    button(app, "calibrate offset")?.click();
    await app.settle();
    expect(pageText(app)).toContain("tap SPACE on the beat — 0/8");
    for (let i = 0; i < 8; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await app.settle();
    //the calibration panel closed (all 8 taps counted)
    expect(pageText(app)).not.toContain("tap SPACE on the beat");
    const offset = JSON.parse(
      window.localStorage.getItem(BEAT_KEYS_SCORES_KEY) ?? "{}",
    ) as { settings?: { offsetMs?: number } };
    expect(typeof offset.settings?.offsetMs).toBe("number");
  });
});
