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
  LANE_DEFENSE_SCORES_KEY,
  _resetLaneDefenseScoresForTests,
} from "../../../../src/ts/utils/lane-defense/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function enemies(app: App): { text: string; typed: string }[] {
  return [...app.container.querySelectorAll('[data-testid="ld-enemy"]')].map(
    (el) => ({
      text: el.textContent ?? "",
      typed: el.querySelector(".text-main")?.textContent ?? "",
    }),
  );
}

async function openLaneDefense(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/lane-defense" });
  await app.settle();
  return app;
}

describe("lane defense page (idea G9 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLaneDefenseScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the zone picker and the bests", async () => {
    const app = await openLaneDefense();
    const text = pageText(app);
    expect(text).toContain("keyboard zone");
    expect(text).toContain("free");
    expect(text).toContain("fj"); //the first english group
    expect(text).toContain("best score");
    expect(text).toContain("zone best");
  });

  it("the default zone (fj) spawns ONLY f/j words (the DoD zone check)", async () => {
    const app = await openLaneDefense();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const field = enemies(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the educational preset: every enemy word is built from f/j alone
    for (const enemy of field) {
      for (const ch of enemy.text) {
        expect(["f", "j"]).toContain(ch);
      }
    }
    expect(pageText(app)).toContain("wall");
  });

  it("typing the nearest enemy's word kills it and moves the combo", async () => {
    const app = await openLaneDefense();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const target = enemies(app)[0]?.text ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    expect(text).toMatch(/x1/); //the combo moved
    //fresh enemies have empty typed prefixes (a repeat word is possible)
    expect(enemies(app).every((e) => e.typed === "")).toBe(true);
  });

  it("breaches drain the wall; wall 0 ends the run and records it", async () => {
    const app = await openLaneDefense();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    //idle: walkers cross the wall until it falls
    let guard = 0;
    while (!pageText(app).includes("the wall has fallen") && guard++ < 90) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    const text = pageText(app);
    expect(text).toContain("the wall has fallen");
    expect(text).toContain("wave reached");
    const raw = JSON.parse(
      window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("lane defense online (online wave, phase 34)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetLaneDefenseScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded waves: banner, relay, panel", async () => {
    const { app, invokes, fire } = await armOnlineLane();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same waves, the higher score wins");

    //the first tick relays the starting numbers (score 0, wall 10)
    const initial = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return state["wallHp"] === 10;
    });
    expect(initial.length).toBeGreaterThanOrEqual(1);

    //the peer's relay lands decoded on the live panel
    handleLanPeerMessage({
      type: "progress",
      gameId: "lane-defense",
      state: { score: 450, wallHp: 6 },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("450 score");

    //a disconnect during the run voids it (driven from the same arm)
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start run"); //back at the menu
    expect(window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY)).toBeNull();
  });

  it("the peer's early weak finish loses to my longer stand", async () => {
    const { app, invokes } = await armOnlineLane();
    //the peer died fast with nothing: my longer stand with equal score wins
    handleLanPeerMessage({
      type: "progress",
      gameId: "lane-defense",
      state: { score: 0, wallHp: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    //idle: the walkers breach until the wall falls and the verdict lands
    let guard = 0;
    while (
      app.container.querySelector('[data-testid="ld-verdict"]') === null &&
      guard++ < 150
    ) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("you win!");
    const finishes = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      return message["type"] === "finished";
    });
    expect(finishes).toHaveLength(1);
    //online never touches the local lane scores
    expect(window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY)).toBeNull();
  });

  it("the peer's big score wins the death race", async () => {
    const { app } = await armOnlineLane();
    //the peer died early with a huge score: my run can never catch it
    handleLanPeerMessage({
      type: "progress",
      gameId: "lane-defense",
      state: { score: 9999, wallHp: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    let guard = 0;
    while (
      app.container.querySelector('[data-testid="ld-verdict"]') === null &&
      guard++ < 150
    ) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(LANE_DEFENSE_SCORES_KEY)).toBeNull();
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

async function armOnlineLane(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/lane-defense" });
  await app.settle();
  vi.useFakeTimers(); //the death race runs on the fake tick loop
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "lane-defense",
      seed: 42,
      params: { lang: "english" },
    },
  });
  await vi.advanceTimersByTimeAsync(150); //the pool falls back, the race starts
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
