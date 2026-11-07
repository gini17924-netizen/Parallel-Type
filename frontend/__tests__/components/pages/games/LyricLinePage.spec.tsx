import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LYRIC_SESSIONS_KEY,
  _resetLyricSessionsForTests,
} from "../../../../src/ts/utils/lyric-line/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

const TIMED_LRC = "[00:01.00]first line\n[00:02.00]second line";
const PLAIN_TXT = "alpha line\nbeta line";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function pickFile(
  app: App,
  testId: string,
  name: string,
  content: string,
  type: string,
): Promise<void> {
  const input = app.container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLInputElement;
  const file = new File([content], name, { type });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(50);
}

function audioOf(app: App): HTMLAudioElement {
  void app;
  //the LAST audio on the page — earlier sessions can leak between tests
  const el = [...document.querySelectorAll("audio")].at(-1);
  if (el === null || el === undefined) throw new Error("no audio element");
  return el;
}

/** walks the audio clock in 1s steps (never tripping the seek void) */
async function playTo(app: App, sec: number): Promise<void> {
  const audio = audioOf(app);
  let t = audio.currentTime;
  while (t < sec) {
    t = Math.min(sec, t + 1);
    audio.currentTime = t;
    await vi.advanceTimersByTimeAsync(60);
  }
}

async function openLyric(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/lyric-line" });
  await app.settle();
  return app;
}

describe("lyric line page (idea G20 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLyricSessionsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the setup renders the file inputs and the privacy note", async () => {
    const app = await openLyric();
    const text = pageText(app);
    expect(text).toContain("audio file");
    expect(text).toContain("lyrics file");
    expect(text).toContain("never saved");
    expect(text).toContain("start session");
  });

  it("the karaoke activates lines with the song clock and scores sync", async () => {
    const app = await openLyric();
    vi.useFakeTimers();
    await pickFile(app, "ll-audio-input", "song.mp3", "x", "audio/mpeg");
    await pickFile(app, "ll-lyrics-input", "song.lrc", TIMED_LRC, "text/plain");
    button(app, "start session")?.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(
      app.container.querySelector('[data-testid="ll-karaoke"]'),
    ).not.toBeNull();
    await playTo(app, 1.2); //line 0's cue (1s) passed
    const state0 = app.container.querySelectorAll('[data-testid="ll-line"]')[0];
    expect(state0?.getAttribute("data-state")).toBe("active");
    //type the active line → done
    for (const ch of "first line") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    const doneLine = app.container.querySelectorAll(
      '[data-testid="ll-line"]',
    )[0];
    expect(doneLine?.getAttribute("data-state")).toBe("done");
  });

  it("plain lyrics end with an accuracy-only summary", async () => {
    const app = await openLyric();
    vi.useFakeTimers();
    await pickFile(app, "ll-audio-input", "song.mp3", "x", "audio/mpeg");
    await pickFile(
      app,
      "ll-lyrics-input",
      "lyrics.txt",
      PLAIN_TXT,
      "text/plain",
    );
    button(app, "start session")?.click();
    await vi.advanceTimersByTimeAsync(100);
    //no LRC: both lines type immediately (manual advance)
    for (const ch of "alpha line") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    for (const ch of "beta line") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    audioOf(app).dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("session complete");
    expect(pageText(app)).toContain("accuracy only");
    const raw = JSON.parse(
      window.localStorage.getItem(LYRIC_SESSIONS_KEY) ?? "{}",
    ) as { sessions?: { syncScore?: number }[] };
    expect(raw.sessions?.length ?? 0).toBe(1);
    expect(raw.sessions?.[0]?.syncScore).toBeUndefined();
  });

  it("Enter skips the active line (marked, unscored)", async () => {
    const app = await openLyric();
    vi.useFakeTimers();
    await pickFile(app, "ll-audio-input", "song.mp3", "x", "audio/mpeg");
    await pickFile(app, "ll-lyrics-input", "song.lrc", TIMED_LRC, "text/plain");
    button(app, "start session")?.click();
    await vi.advanceTimersByTimeAsync(100);
    await playTo(app, 1.2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.advanceTimersByTimeAsync(50);
    const skipped = app.container.querySelectorAll(
      '[data-testid="ll-line"]',
    )[0];
    expect(skipped?.getAttribute("data-state")).toBe("skipped");
  });

  it("the audio ended event produces the summary and the record", async () => {
    const app = await openLyric();
    vi.useFakeTimers();
    await pickFile(app, "ll-audio-input", "song.mp3", "x", "audio/mpeg");
    await pickFile(app, "ll-lyrics-input", "song.lrc", TIMED_LRC, "text/plain");
    button(app, "start session")?.click();
    await vi.advanceTimersByTimeAsync(100);
    audioOf(app).dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("session complete");
    expect(pageText(app)).toContain("sync score");
  });
});
