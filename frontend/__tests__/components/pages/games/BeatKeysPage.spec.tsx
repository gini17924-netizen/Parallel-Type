import "fake-indexeddb/auto";
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

/** taps every visible note's key — each tap judges the nearest same-key
 * note inside the ±300ms window, so a steady tap cadence clears the
 * chart (the offline tests use the same loop shape) */
async function playTheChart(app: App): Promise<void> {
  let guard = 0;
  while (
    app.container.querySelector('[data-testid="bk-verdict"]') === null &&
    guard++ < 400
  ) {
    for (const el of [
      ...app.container.querySelectorAll('[data-testid="bk-note"]'),
    ]) {
      const key = el.getAttribute("data-key");
      if (key !== null && key !== "") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      }
    }
    await vi.advanceTimersByTimeAsync(200);
  }
}

describe("beat keys online (online wave, phase 42)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetBeatKeysForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded chart: banner, relay, panel", async () => {
    const { app, invokes, fire } = await armOnlineBeat();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same chart, the higher score wins");

    //the first tick relays the starting numbers (score 0, acc 100)
    const initial = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return state["score"] === 0;
    });
    expect(initial.length).toBeGreaterThanOrEqual(1);

    //the peer's relay lands decoded on the live panel
    handleLanPeerMessage({
      type: "progress",
      gameId: "beat-keys",
      state: { score: 450, acc: 96, maxCombo: 12 },
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(pageText(app)).toContain("450 score");

    //a disconnect during the chart voids it (driven from the same arm)
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(40);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("calibrate offset"); //back at setup
    expect(window.localStorage.getItem(BEAT_KEYS_SCORES_KEY)).toBeNull();
  });

  it("my played chart beats the peer's empty one at the score verdict", async () => {
    const { app, invokes } = await armOnlineBeat();
    //the peer finished early with nothing: my cleared chart scores > 0
    handleLanPeerMessage({
      type: "progress",
      gameId: "beat-keys",
      state: { score: 0, acc: 0, maxCombo: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    await playTheChart(app);
    expect(pageText(app)).toContain("you win!");
    const finishes = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      return message["type"] === "finished";
    });
    expect(finishes).toHaveLength(1);
    //online never touches the local beat records
    expect(window.localStorage.getItem(BEAT_KEYS_SCORES_KEY)).toBeNull();
  }, 120_000);

  it("the peer's big score wins the chart race", async () => {
    const { app } = await armOnlineBeat();
    //the peer finished with a huge score: my idle run (all notes miss)
    //can never catch it — score 0 < 9999
    handleLanPeerMessage({
      type: "progress",
      gameId: "beat-keys",
      state: { score: 9999, acc: 100, maxCombo: 90 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    let guard = 0;
    while (
      app.container.querySelector('[data-testid="bk-verdict"]') === null &&
      guard++ < 150
    ) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(BEAT_KEYS_SCORES_KEY)).toBeNull();
  }, 120_000);
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

async function armOnlineBeat(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/beat-keys" });
  await app.settle();
  vi.useFakeTimers(); //the chart clock (performance.now) runs on fakes
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "beat-keys",
      seed: 42,
      params: { lang: "english", difficulty: "normal" },
    },
  });
  await vi.advanceTimersByTimeAsync(60); //the match effect opens the chart
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
