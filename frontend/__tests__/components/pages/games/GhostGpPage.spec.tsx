import "fake-indexeddb/auto";
import type { Mode } from "@monkeytype/schemas/shared";

import { fireEvent } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SnapshotResult } from "../../../../src/ts/constants/default-snapshot";

import { setLastResult } from "../../../../src/ts/states/snapshot";
import {
  _resetGhostGpStatsForTests,
  GHOST_GP_STATS_KEY,
} from "../../../../src/ts/utils/ghost-gp/gp-store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openGhostGp(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/ghost-gp" });
  await app.settle();
  return app;
}

function currentWord(app: App): string {
  return (
    app.container.querySelector('[data-testid="gp-word"]')?.textContent ?? ""
  );
}

/** the already-typed head of the current word (the main-colored span) */
function typedPart(app: App): string {
  return (
    app.container.querySelector('[data-testid="gp-word"] > .text-main')
      ?.textContent ?? ""
  );
}

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> = {},
): SnapshotResult<Mode> {
  return {
    _id: "ghost_seed_1",
    wpm: 60,
    rawWpm: 70,
    charStats: { correct: 300, incorrect: 5, extra: 0, missed: 2 },
    acc: 95,
    mode: "words",
    mode2: "10",
    timestamp: Date.now(),
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 30,
    language: "english",
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

async function startRace(app: App): Promise<void> {
  vi.useFakeTimers();
  button(app, "start race")?.click();
  await vi.advanceTimersByTimeAsync(50); //the word list resolves (fallback)
  await vi.advanceTimersByTimeAsync(2800); //countdown 3-2-1 -> the race
}

describe("ghost gp page (idea G3 phase 2)", () => {
  beforeEach(() => {
    //startRace reads the heavy store (the curve attempt): fake-indexeddb
    //with a fresh factory per test (the cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetGhostGpStatsForTests();
    setLastResult(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    setLastResult(undefined);
    //leave a clean shared factory behind (cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("picker renders both ghost sources and the race lengths", async () => {
    const app = await openGhostGp();
    const text = pageText(app);
    expect(text).toContain("your ghost");
    expect(text).toContain("last run (—)"); //no result yet
    expect(text).toContain("personal best");
    expect(text).toContain("start race");
    for (const length of ["quick", "standard", "long"]) {
      expect(text).toContain(length);
    }
  });

  it("a race against the last-run ghost ends won and records stats", async () => {
    setLastResult(makeResult({ wpm: 60, language: "english" }));
    const app = await openGhostGp();
    expect(pageText(app)).toContain("last run (60wpm)");

    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    for (let guard = 0; guard < 400; guard++) {
      if (pageText(app).includes("you beat the ghost!")) break;
      const word = currentWord(app);
      const done = typedPart(app).length;
      if (word !== "" && done < word.length) {
        fireEvent.keyDown(window, { key: word[done] });
      } else {
        await vi.advanceTimersByTimeAsync(50);
      }
    }
    expect(pageText(app)).toContain("you beat the ghost!");

    const raw = JSON.parse(
      window.localStorage.getItem(GHOST_GP_STATS_KEY) ?? "{}",
    ) as { races: number; winsVsGhost: number; ghostsRaced: { wpm: number }[] };
    expect(raw.races).toBe(1);
    expect(raw.winsVsGhost).toBe(1);
    expect(raw.ghostsRaced[0]?.wpm).toBe(60);
  });

  it("starting without any record stays on the picker with a clear message", async () => {
    const app = await openGhostGp();
    await startRace(app);

    expect(pageText(app)).toContain(
      "run a test first — the ghost needs a record",
    );
    expect(pageText(app)).toContain("start race"); //still the picker
    expect(window.localStorage.getItem(GHOST_GP_STATS_KEY)).toBeNull();
  });

  it("a window blur during the race voids it without recording", async () => {
    setLastResult(makeResult({ wpm: 60, language: "english" }));
    const app = await openGhostGp();
    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pageText(app)).toContain("race void");
    expect(pageText(app)).toContain("start race"); //back at the picker
    expect(window.localStorage.getItem(GHOST_GP_STATS_KEY)).toBeNull();
  });
});
