import "fake-indexeddb/auto";
import { fireEvent } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSprintStatsForTests,
  SPRINT_STATS_KEY,
} from "../../../../src/ts/utils/sprint/sprint-stats";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openSprint(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/sprint" });
  await app.settle();
  return app;
}

function currentWord(app: App): string {
  return (
    app.container.querySelector('[data-testid="sp-word"]')?.textContent ?? ""
  );
}

/** the already-typed head of the current word (the main-colored span) */
function typedPart(app: App): string {
  return (
    app.container.querySelector('[data-testid="sp-word"] > .text-main')
      ?.textContent ?? ""
  );
}

/** a real-clock wait: the page's own tick interval runs on real timers */
async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("sprint page (idea G5 phase 2)", () => {
  //the controlled clock: the page measures elapsed time with
  //performance.now(), so the spy IS the test's time machine
  let fakeNow: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSprintStatsForTests();
    fakeNow = 1000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    (nowSpy as { mockRestore: () => void }).mockRestore();
    cleanupApp();
  });

  it("idle screen renders the modes, the best and the false-start warning", async () => {
    const app = await openSprint();
    const text = pageText(app);
    expect(text).toContain("start attempt");
    expect(text).toContain("daily sprint");
    expect(text).toContain("a key before GO voids the attempt");
    expect(text).toContain("best (english): —");
  });

  it("a completed sprint shows the exact metrics and records them", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120); //the word list resolves (fallback) and the engine arms

    //past any arming delay (max 3000): the race is running
    fakeNow = 5000;
    await waitMs(120);
    expect(currentWord(app), `diag: ${pageText(app).slice(0, 260)}`).not.toBe(
      "",
    );

    //85 correct characters at a steady 50ms cadence: the doc's exact metric
    for (let i = 0; i < 85; i++) {
      fakeNow += 50;
      const word = currentWord(app);
      const done = typedPart(app).length;
      if (done < word.length) {
        fireEvent.keyDown(window, { key: word[done] });
      } else {
        fireEvent.keyDown(window, { key: word[0] });
      }
    }
    //flip the clock past the window: the tick finishes and records
    fakeNow += 11000;
    await waitMs(150);
    expect(pageText(app)).toContain("wpm");

    //the doc's exact math: 85 characters -> wpm 102
    expect(pageText(app)).toContain("102");
    const raw = JSON.parse(
      window.localStorage.getItem(SPRINT_STATS_KEY) ?? "{}",
    ) as {
      history: { wpm: number }[];
      bestByLang: Record<string, { wpm: number }>;
    };
    expect(raw.history).toHaveLength(1);
    expect(raw.history[0]?.wpm).toBe(102);
    expect(raw.bestByLang["english"]?.wpm).toBe(102);
  });

  it("a pre-GO key is a false start and voids the attempt", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120); //armed; GO is at least 800ms away (fakeNow 1000+1200)

    fireEvent.keyDown(window, { key: "a" }); //before GO: false start
    expect(pageText(app)).toContain("false start! attempt void");
    expect(pageText(app)).toContain("start attempt"); //back at the idle screen
    expect(window.localStorage.getItem(SPRINT_STATS_KEY)).toBeNull();
  });

  it("a window blur during the sprint voids the attempt", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120);
    fakeNow = 5000; //past any arming delay: the race is running
    await waitMs(120);
    expect(currentWord(app)).not.toBe("");

    window.dispatchEvent(new Event("blur"));
    await waitMs(60);

    expect(pageText(app)).toContain("attempt void — the window lost focus");
    expect(pageText(app)).toContain("start attempt"); //back at the idle screen
    expect(window.localStorage.getItem(SPRINT_STATS_KEY)).toBeNull();
  });
});
