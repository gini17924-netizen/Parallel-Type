import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetWordBlastScoresForTests,
  WORD_BLAST_SCORES_KEY,
} from "../../../../src/ts/utils/word-blast-scores";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

const SCORES_KEY = WORD_BLAST_SCORES_KEY;

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

async function openGames(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/word-blast" }); //moved to a sub-route when the games hub became a picker (idea G24)
  await app.settle();
  return app;
}

describe("GamesPage score persistence (KI-21)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    //drop the memoized store cache so every test reads fresh storage
    _resetWordBlastScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupApp();
  });

  it("shows the stored best beside the difficulty picker", async () => {
    window.localStorage.setItem(
      SCORES_KEY,
      JSON.stringify({
        best: { normal: { at: 1, difficulty: "normal", score: 500, wpm: 90 } },
        history: [],
      }),
    );
    const app = await openGames();
    expect(pageText(app)).toContain("best (normal): 500");
    //no game has been played: the seeded store is untouched
    expect(storedScores().history).toHaveLength(0);
  });

  it("records the finished game exactly once and announces the new record", async () => {
    const app = await openGames();

    const startButton = [...app.container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("start game"),
    );
    expect(startButton).toBeDefined();

    vi.useFakeTimers();
    startButton?.click();
    //flush start()'s async word-list fetch (it fails offline and falls back)
    await vi.advanceTimersByTimeAsync(50);

    //let the game run (spawn/tick intervals) until all lives are gone —
    //no typing, so words reach the bottom and end() fires from the tick loop
    for (let i = 0; i < 400; i++) {
      if (pageText(app).includes("game over")) break;
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(pageText(app)).toContain("game over");
    expect(pageText(app)).toContain("new record!");
    //end() must record exactly once: a single history entry, one best
    const scores = storedScores();
    expect(scores.history).toHaveLength(1);
    expect(Object.keys(scores.best ?? {})).toContain("normal");
    //the overlay best reflects the recorded game
    expect(pageText(app)).toContain("best:");
  });

  it("switching difficulty refreshes the best badge", async () => {
    window.localStorage.setItem(
      SCORES_KEY,
      JSON.stringify({
        best: {
          easy: { at: 1, difficulty: "easy", score: 120, wpm: 40 },
          hard: { at: 2, difficulty: "hard", score: 700, wpm: 110 },
        },
        history: [],
      }),
    );
    const app = await openGames();
    expect(pageText(app)).toContain("best (normal): —");
    const hardButton = [...app.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "hard",
    );
    expect(hardButton).toBeDefined();
    hardButton?.click();
    expect(pageText(app)).toContain("best (hard): 700");
  });
});

function storedScores(): {
  best: Record<string, unknown>;
  history: unknown[];
} {
  return JSON.parse(window.localStorage.getItem(SCORES_KEY) ?? "{}") as {
    best: Record<string, unknown>;
    history: unknown[];
  };
}
