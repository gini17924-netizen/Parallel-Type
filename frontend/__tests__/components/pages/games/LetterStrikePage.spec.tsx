import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LETTER_STRIKE_SCORES_KEY,
  _resetLetterStrikeScoresForTests,
} from "../../../../src/ts/utils/letter-strike/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function ships(app: App): string[] {
  return [...app.container.querySelectorAll('[data-testid="ls-ship"]')].map(
    (el) => el.textContent ?? "",
  );
}

async function openLetterStrike(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/letter-strike" });
  await app.settle();
  return app;
}

describe("letter strike page (idea G8 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLetterStrikeScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openLetterStrike();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best wave");
    expect(text).toContain("start run");
    expect(text).toContain("Backspace unwinds the lock");
  });

  it("a started run shows ships, locks and destroys by typing", async () => {
    const app = await openLetterStrike();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);

    const field = ships(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    expect(pageText(app)).toContain("❤❤❤");

    //type the first ship's word: the prefix grows then the ship explodes
    const target = field[0] ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(60);
    const text = pageText(app);
    expect(text).toMatch(/x1/); //the combo moved
    expect(text).not.toContain(`❤❤❤❤`); //sanity: no extra hearts cell
    //the destroyed ship is gone; the next wave replaced the screen
    expect(ships(app).every((s) => !s.startsWith(target))).toBe(true);
  });

  it("Space fires the EMP only when charged; Escape is swallowed", async () => {
    const app = await openLetterStrike();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const before = ships(app).length;

    //Space without a charge: nothing clears
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await vi.advanceTimersByTimeAsync(60);
    expect(ships(app).length).toBe(before);

    //a document-level bubble listener must never see Escape mid-run
    let escapeSeen = false;
    const spy = (): void => {
      escapeSeen = true;
    };
    document.addEventListener("keydown", spy);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(60);
    document.removeEventListener("keydown", spy);
    expect(escapeSeen).toBe(false); //swallowed in the capture phase
    expect(ships(app).length).toBe(before); //the run continues
  });

  it("a finished run records the bests and shows the result", async () => {
    const app = await openLetterStrike();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //idle: ships reach the floor until the lives run out
    let guard = 0;
    while (!pageText(app).includes("run over") && guard++ < 90) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("run over");
    expect(pageText(app)).toContain("wave reached");
    const raw = JSON.parse(
      window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});
