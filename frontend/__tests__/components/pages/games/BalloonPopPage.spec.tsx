import "fake-indexeddb/auto";
import { fireEvent } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetBalloonPopScoresForTests,
  BALLOON_POP_SCORES_KEY,
} from "../../../../src/ts/utils/balloon-pop/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

//the hear-it toggle speaks through the fork's TTS wrapper: mocked so the
//tests assert the calls without a speech stack
const speakWord = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../../../src/ts/utils/tts-speech", () => ({
  speakWord: speakWord,
}));

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function balloons(app: App): string[] {
  return [...app.container.querySelectorAll('[data-testid="bp-balloon"]')].map(
    (el) => el.textContent ?? "",
  );
}

async function openBalloonPop(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/balloon-pop" });
  await app.settle();
  return app;
}

describe("balloon pop page (idea G6 phase 2)", () => {
  beforeEach(() => {
    speakWord.mockClear();
    //the letter unlocks and the weakness map read storage; fresh IndexedDB
    //per test (the cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetBalloonPopScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("menu renders the stages, the language picker and the how-to", async () => {
    const app = await openBalloonPop();
    const text = pageText(app);
    expect(text).toContain("start at stage");
    expect(text).toContain("start stage 1");
    expect(text).toContain("فارسی");
    expect(text).toContain("your weak letters come first");
  });

  it("a started run shows the arena, the HUD and poppable letter balloons", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);

    expect(pageText(app), `A-diag: ${pageText(app).slice(0, 240)}`).toContain(
      "danger line",
    );
    const field = balloons(app);
    expect(field.length).toBeGreaterThan(0);
    //stage 1: single letters only
    for (const payload of field) {
      expect(payload).toHaveLength(1);
    }
    //the HUD: three lives, zeroed combo, stage cell
    expect(pageText(app)).toContain("❤❤❤");
    expect(pageText(app)).toContain("x0");
  });

  it("typing a balloon's letter pops it and moves the combo", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);

    const field = balloons(app);
    expect(
      field.length,
      `B-diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: field[0] }); //pop the first balloon
    await vi.advanceTimersByTimeAsync(60);

    const text = pageText(app);
    expect(text).toContain("x1"); //the combo meter moved
    expect(text).toContain("1"); //the score left zero
  });

  it("the run records the stage best and the history when it ends", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);

    //idle: the balloons escape one after another until the lives run out
    for (let i = 0; i < 60; i++) {
      if (pageText(app).includes("run over")) break;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(pageText(app)).toContain("run over");
    const raw = JSON.parse(
      window.localStorage.getItem(BALLOON_POP_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("balloon pop hear-it mode (idea G6 phase 3)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetBalloonPopScoresForTests();
    speakWord.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the toggle flips and a running race speaks freshly spawned balloons", async () => {
    const app = await openBalloonPop();
    expect(pageText(app)).toContain("hear it (speak each balloon)");
    button(app, "off")?.click();
    expect(pageText(app)).toContain("on");

    vi.useFakeTimers();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);
    expect(balloons(app).length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2300); //the stage-1 cadence spawns more

    expect(speakWord).toHaveBeenCalled();
    const spokenPayloads = speakWord.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    //the spoken payloads come from the allowed unlocked letters
    for (const payload of spokenPayloads) {
      expect(payload?.length).toBe(1);
    }
  });

  it("hear-it off: nothing is spoken", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    button(app, "start stage 1")?.click(); //hear-it stays off
    await vi.advanceTimersByTimeAsync(2500);

    expect(speakWord).not.toHaveBeenCalled();
  });
});
