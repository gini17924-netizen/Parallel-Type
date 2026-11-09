import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRUIT_SLASH_SCORES_KEY,
  _resetFruitSlashScoresForTests,
} from "../../../../src/ts/utils/fruit-slash/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function fruits(app: App): { text: string; typed: string }[] {
  return [...app.container.querySelectorAll('[data-testid="fs-fruit"]')].map(
    (el) => ({
      text: el.textContent ?? "",
      typed: el.querySelector(".text-main")?.textContent ?? "",
    }),
  );
}

/** the typable fruits only — typing a bomb's word is the penalty path */
function nonBombTargets(app: App): string[] {
  return [...app.container.querySelectorAll('[data-testid="fs-fruit"]')]
    .filter((el) => el.querySelector('[data-testid="fs-bomb"]') === null)
    .map((el) => el.textContent ?? "");
}

async function openFruitSlash(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/fruit-slash" });
  await app.settle();
  return app;
}

describe("fruit slash page (idea G10 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetFruitSlashScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openFruitSlash();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best slashed");
    expect(text).toContain("start run");
    expect(text).toContain("never type the bombs");
  });

  it("a started run shows flying fruits that slash by typing", async () => {
    const app = await openFruitSlash();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const field = fruits(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the fruit rises: its position moves up over the ticks
    expect(pageText(app)).toContain("time");

    //slash a NON-BOMB fruit by typing its whole word (typing a bomb is
    //the penalty path and the bomb mix is random per run — keep ticking
    //until a typable fruit is on the field)
    let targets = nonBombTargets(app);
    let guard = 0;
    while (targets.length === 0 && guard++ < 40) {
      await vi.advanceTimersByTimeAsync(200);
      targets = nonBombTargets(app);
    }
    expect(
      targets.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the LAST match is the newest spawn — the most airtime left
    const target = targets[targets.length - 1] ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    //the combo moved (two same-word launches can complete together -> x2)
    expect(text).toMatch(/x[1-9]/);
    //the target left the field (the slash happened). The OTHER fruits may
    //hold partials: the word-oriented matcher consumes matching prefixes
    //on every visible fruit (doc G10's per-fruit partial map) — the old
    //"every typed is empty" assert was the recurring suite flake
    expect(nonBombTargets(app)).not.toContain(target);
  });

  it("the 90-second window ends the run and records it", async () => {
    const app = await openFruitSlash();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (!pageText(app).includes("time!") && guard++ < 100) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    const text = pageText(app);
    expect(text).toContain("time!");
    expect(text).toContain("slashed");
    const raw = JSON.parse(
      window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
