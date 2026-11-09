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
  FIREFIGHT_SCORES_KEY,
  _resetFirefightScoresForTests,
} from "../../../../src/ts/utils/firefight/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function cells(app: App): number {
  return app.container.querySelectorAll('[data-testid="ff-cell"]').length;
}

function activeWord(app: App): { text: string; typed: string } | undefined {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="ff-word"]',
  );
  if (el === null) return undefined;
  return {
    text: el.textContent ?? "",
    typed: el.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openFirefight(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/firefight" });
  await app.settle();
  return app;
}

describe("firefight page (idea G16 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetFirefightScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openFirefight();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("wins");
    expect(text).toContain("start run");
    expect(text).toContain("35% ashes loses");
  });

  it("a started run shows the grid, the burning cells and the active word", async () => {
    const app = await openFirefight();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(cells(app)).toBe(108); //the full 12x9 building
    const word = activeWord(app);
    expect(word?.text.length).toBeGreaterThan(0); //one fire, one word
    expect(pageText(app)).toContain("the most critical burning cell");
  });

  it("typing the active word extinguishes it (the score moves)", async () => {
    const app = await openFirefight();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const word = activeWord(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    expect(text).toContain("1saved"); //the extinguish counter moved
    expect(text).toContain("no fire to fight"); //the hose idles
  });

  it("an idle run ends lost and records the result", async () => {
    const app = await openFirefight();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (
      !pageText(app).includes("the building is lost") &&
      !pageText(app).includes("the building survived") &&
      guard++ < 1600
    ) {
      await vi.advanceTimersByTimeAsync(250);
    }
    const text = pageText(app);
    expect(text).toContain("the building is lost");
    const raw = JSON.parse(
      window.localStorage.getItem(FIREFIGHT_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

/** drives the shared survival window to its end (surviveMs 8000 in the
 * armed params — the idle fire cannot ash 35% inside 8s, so the idle run
 * survives) and returns once the verdict overlay is up */
async function idleToVerdict(app: App): Promise<void> {
  let guard = 0;
  while (
    app.container.querySelector('[data-testid="ff-verdict"]') === null &&
    guard++ < 20
  ) {
    await vi.advanceTimersByTimeAsync(2000);
  }
}

describe("firefight online (online wave, phase 38)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetFirefightScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded fire: banner, relay, panel", async () => {
    const { app, invokes, fire } = await armOnlineFire();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same fire, survive or score more");

    //the first tick relays the starting numbers (score 0, saved 0)
    const initial = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return state["extinguished"] === 0;
    });
    expect(initial.length).toBeGreaterThanOrEqual(1);

    //the peer's relay lands decoded on the live panel
    handleLanPeerMessage({
      type: "progress",
      gameId: "firefight",
      state: { score: 450, extinguished: 3 },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(pageText(app)).toContain("450 score");

    //a disconnect during the fire voids it (driven from the same arm)
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(300);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start run"); //back at the menu
    expect(window.localStorage.getItem(FIREFIGHT_SCORES_KEY)).toBeNull();
  });

  it("my survival beats the peer's early collapse", async () => {
    const { app, invokes } = await armOnlineFire();
    //the peer's run ended at 5s (< the 8s window) = a collapse, score 0:
    //the outcome comes first — my idle survival wins even at score 0
    handleLanPeerMessage({
      type: "progress",
      gameId: "firefight",
      state: { score: 0, extinguished: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    await idleToVerdict(app);
    expect(pageText(app)).toContain("you win!");
    const finishes = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      return message["type"] === "finished";
    });
    expect(finishes).toHaveLength(1);
    //online never touches the local firefight records
    expect(window.localStorage.getItem(FIREFIGHT_SCORES_KEY)).toBeNull();
  });

  it("the peer's survival with a big score wins", async () => {
    const { app } = await armOnlineFire();
    //the peer finished AT the window (= survived) with a huge score:
    //same outcome, the raw score decides — my idle 0 can never catch it
    handleLanPeerMessage({
      type: "progress",
      gameId: "firefight",
      state: { score: 9999, extinguished: 50 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 8_000, acc: 100 });

    await idleToVerdict(app);
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(FIREFIGHT_SCORES_KEY)).toBeNull();
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

async function armOnlineFire(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/firefight" });
  await app.settle();
  vi.useFakeTimers(); //the survival window runs on the fake tick loop
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "firefight",
      seed: 42,
      params: { lang: "english", surviveMs: 8000 },
    },
  });
  await vi.advanceTimersByTimeAsync(300); //the pool falls back, the fire starts
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
