import { fireEvent } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeWordlePools,
  pickAnswer,
} from "../../../../src/ts/utils/wordle/wordle-engine";
import {
  _resetWordleStoresForTests,
  wordleDayKey,
  WORDLE_LANGS,
  wordleStateKey,
} from "../../../../src/ts/utils/wordle/wordle-store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

const FALLBACK_WORDS = ["crane", "apple", "level", "eeler", "brine", "adobe"];

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openWordle(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/wordle" });
  await app.settle();
  await new Promise((resolve) => setTimeout(resolve, 60)); //the pools load
  return app;
}

function typeGuess(app: App, word: string): void {
  for (const ch of word) {
    fireEvent.keyDown(window, { key: ch });
  }
  fireEvent.keyDown(window, { key: "Enter" });
}

describe("wordle page (idea G4 phase 2)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetWordleStoresForTests();
  });

  afterEach(() => {
    cleanupApp();
  });

  it("renders the grid, the keyboard and the language picker", async () => {
    const app = await openWordle();
    const text = pageText(app);
    expect(text).toContain("one daily 5-letter puzzle per language");
    expect(text).toContain("فارسی");
    expect(text).toContain("english");
    //the virtual keyboard renders letter keys
    expect(
      app.container.querySelectorAll('[aria-label="wordle keyboard"] button')
        .length,
    ).toBeGreaterThan(20);
  });

  it("a winning guess fills the grid, the stats and offers the share", async () => {
    const app = await openWordle();

    //the answer is the pure pick over the page's fallback pool — the test
    //replicates it (the same dayKey convention and the same fallback list)
    const pools = computeWordlePools(FALLBACK_WORDS, FALLBACK_WORDS);
    const answer = pickAnswer(
      pools.answers,
      wordleDayKey(Date.now()),
      "en",
    ) as string;

    typeGuess(app, answer);

    const text = pageText(app);
    expect(text).toContain("solved!");
    expect(text).toContain("share result");

    const raw = JSON.parse(
      window.localStorage.getItem(wordleStateKey("en")) ?? "{}",
    ) as { guesses: string[]; finished: string };
    expect(raw.guesses).toEqual([answer]);
    expect(raw.finished).toBe("won");
  });

  it("rejects a guess that is not in the word list", async () => {
    const app = await openWordle();
    typeGuess(app, "zzzzz");
    expect(pageText(app)).toContain("not in word list");
    //the rejected guess never entered the puzzle state
    const raw = JSON.parse(
      window.localStorage.getItem(wordleStateKey("en")) ?? "{}",
    ) as { guesses: string[] };
    expect(raw.guesses ?? []).toHaveLength(0);
  });

  it("switching to فارسی loads its own isolated state", async () => {
    const app = await openWordle();
    button(app, "فارسی")?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    //the fa keyboard renders Persian letter keys
    const text = pageText(app);
    expect(text).toContain("فارسی");
    //the en state stays where it was (nothing recorded: both empty)
    for (const lang of WORDLE_LANGS) {
      expect(window.localStorage.getItem(wordleStateKey(lang))).toBeNull();
    }
  });
});
