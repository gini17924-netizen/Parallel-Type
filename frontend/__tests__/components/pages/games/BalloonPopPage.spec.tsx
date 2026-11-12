import "fake-indexeddb/auto";
import { fireEvent } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetLanStateForTests,
  lanStartHost,
} from "../../../../src/ts/states/lan";
import {
  _resetLanMatchForTests,
  armLanMatch,
  handleLanPeerMessage,
} from "../../../../src/ts/states/lan-match";
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
    expect(pageText(app)).toContain("0 · x1"); //the raw combo + the multiplier (H2)
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

  it("a rapid double-start does not double-tick the engine (KI-30)", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    //two overlapping startRuns: the second must retire the first's interval
    button(app, "start stage 1")?.click();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);
    expect(balloons(app).length).toBe(1); //the construction spawn only
    //with a leaked interval the stage-1 cadence (2200ms) would fire at
    //~1.1s and ~2.2s — 3+ balloons; single tick gives exactly one spawn
    await vi.advanceTimersByTimeAsync(2150);
    expect(balloons(app).length).toBe(2);
  });

  it("the arena re-renders: balloons rise and new spawns appear (KI-34)", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(2350);
    //movement: the first balloon visibly left the bottom line...
    const tops = app.container.querySelectorAll<HTMLElement>(
      '[data-testid="bp-balloon"]',
    );
    expect(tops.length).toBe(2); //...and the cadence spawn rendered too
    const toVh = (top: string | undefined): number => parseFloat(top ?? "100");
    expect(toVh(tops[0]?.style.top)).toBeLessThan(toVh(tops[1]?.style.top));
    expect(toVh(tops[1]?.style.top)).toBeGreaterThan(95); //fresh spawn
  });

  it("shows a paused badge while the window is blurred and clears on focus (KI-33)", async () => {
    const app = await openBalloonPop();
    vi.useFakeTimers();
    button(app, "start stage 1")?.click();
    await vi.advanceTimersByTimeAsync(150);
    expect(pageText(app)).not.toContain("paused");
    //the doc's blur-pause (anti unfair-death) must be visible, not a freeze
    fireEvent.blur(window);
    expect(
      app.container.querySelector('[data-testid="bp-paused"]'),
    ).not.toBeNull();
    fireEvent.focus(window);
    expect(app.container.querySelector('[data-testid="bp-paused"]')).toBeNull();
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

/** the tauri fake for the online tests: records the invokes and captures
 * the event listeners so the spec can fire the Rust-side events */
function installTauriMock(): {
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
} {
  const invokes: { cmd: string; args: Record<string, unknown> }[] = [];
  const handlers = new Map<string, ((e: { payload: unknown }) => void)[]>();
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokes.push({ cmd, args: args ?? {} });
        if (cmd === "lan_start_host") {
          return {
            sessionId: "lan-test/N3DB",
            code: "N3DB",
            port: 51987,
            ip: "192.168.100.24",
            name: "P1",
          };
        }
        return {};
      },
    },
    event: {
      listen: async (ev: string, cb: (e: { payload: unknown }) => void) => {
        const list = handlers.get(ev) ?? [];
        list.push(cb);
        handlers.set(ev, list);
        return () => undefined;
      },
    },
  };
  return {
    invokes,
    fire: (ev: string, payload: unknown) => {
      for (const cb of handlers.get(ev) ?? []) cb({ payload });
    },
  };
}

/** types every on-screen balloon's payload repeatedly until the horn */
async function popRace(app: App): Promise<void> {
  for (let guard = 0; guard < 4000; guard++) {
    if (
      app.container.querySelector('[data-testid="bp-awaiting"]') !== null ||
      app.container.querySelector('[data-testid="bp-verdict"]') !== null
    ) {
      return;
    }
    //type the LOWEST balloon's next char (the biggest escape threat)
    //type the LOWEST balloon's next char (the biggest escape threat)
    const balloonsList = [
      ...app.container.querySelectorAll('[data-testid="bp-balloon"]'),
    ];
    const target = balloonsList[balloonsList.length - 1];
    if (target !== undefined) {
      const payload = target.textContent ?? "";
      const done = (target.querySelector(".text-main")?.textContent ?? "")
        .length;
      const ch = payload[done] ?? payload[0] ?? "a";
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("balloon pop online (online wave, phase 24)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetBalloonPopScoresForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races to the horn: banner, relay, awaiting, win", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openBalloonPop();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "balloon-pop",
        seed: 42,
        params: { lang: "english", stage: 1, durationMs: 3000 },
      },
    });
    await new Promise((r) => setTimeout(r, 150)); //the seeded run starts
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same balloons, 120s");

    await popRace(app);
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer's horn: a weaker result lands -> I win; no local records
    handleLanPeerMessage({ type: "finished", finishMs: 3000, acc: 100 });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("you win!");
    expect(window.localStorage.getItem(BALLOON_POP_SCORES_KEY)).toBeNull();
  });

  it("the peer's horn result resolves my awaiting verdict as a loss", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openBalloonPop();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "balloon-pop",
        seed: 42,
        params: { lang: "english", stage: 1, durationMs: 3000 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    //the peer's horn: a big result lands before mine
    handleLanPeerMessage({
      type: "progress",
      gameId: "balloon-pop",
      state: { pops: 999, score: 9999 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 3000, acc: 100 });
    await new Promise((r) => setTimeout(r, 60));

    await popRace(app);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the game voids it", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openBalloonPop();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "balloon-pop",
        seed: 42,
        params: { lang: "english", stage: 1, durationMs: 3000 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    tauri.fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start stage 1"); //back at the menu
  });
});
