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
  SKY_SCORES_KEY,
  _resetSkyScoresForTests,
} from "../../../../src/ts/utils/climber/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function activeWord(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="rn-word"]')
      ?.getAttribute("data-word") ?? ""
  );
}

function livesText(app: App): string {
  return (
    app.container.querySelector('[data-testid="rn-lives"]')?.textContent ?? ""
  );
}

async function openRunner(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/runner" });
  await app.settle();
  return app;
}

async function startRun(app: App): Promise<void> {
  button(app, "start running")?.click();
  await vi.advanceTimersByTimeAsync(100);
}

describe("endless runner page (idea G15 phase 2, mode B)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSkyScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the best distance and the how-to", async () => {
    const app = await openRunner();
    const text = pageText(app);
    expect(text).toContain("best distance");
    expect(text).toContain("start running");
    expect(text).toContain("three lives");
  });

  it("a started run shows the arena, the obstacles and the lives", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    expect(
      app.container.querySelector('[data-testid="rn-parallax-far"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelectorAll('[data-testid="rn-obstacle"]').length,
    ).toBeGreaterThan(0);
    expect(
      app.container.querySelectorAll('[data-testid="rn-life"]').length,
    ).toBe(3);
  });

  it("typing the nearest obstacle's word clears it (combo grows)", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    let guard = 0;
    while (activeWord(app).length === 0 && guard++ < 60) {
      await vi.advanceTimersByTimeAsync(50);
    }
    const word = activeWord(app);
    expect(word.length).toBeGreaterThanOrEqual(3);
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(pageText(app)).toContain("x1");
    expect(livesText(app)).toBe("3/3");
  });

  it("never typing drains the lives to a recorded game over", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    let guard = 0;
    while (!pageText(app).includes("down the road") && guard++ < 400) {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(pageText(app)).toContain("down the road");
    expect(pageText(app)).toContain("hits taken");
    const raw = JSON.parse(
      window.localStorage.getItem(SKY_SCORES_KEY) ?? "{}",
    ) as { runner?: { games?: number } };
    expect(raw.runner?.games ?? 0).toBe(1);
  });

  it("a window blur pauses the run until the focus returns", async () => {
    const app = await openRunner();
    vi.useFakeTimers();
    await startRun(app);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(50);
    expect(
      app.container.querySelector('[data-testid="rn-paused"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(50);
    expect(app.container.querySelector('[data-testid="rn-paused"]')).toBeNull();
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

async function armOnlineRunner(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = await openRunner();
  vi.useFakeTimers();
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "runner",
      seed: 42,
      params: { lang: "english", meters: 60 }, //a short test target
    },
  });
  await vi.advanceTimersByTimeAsync(60); //the pool builds
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}

/** types the active obstacle's word repeatedly until the line or death */
async function raceToLine(app: App): Promise<void> {
  for (let guard = 0; guard < 4000; guard++) {
    if (
      pageText(app).includes("waiting for") ||
      app.container.querySelector('[data-testid="rn-verdict"]') !== null
    ) {
      return;
    }
    const main = app.container.querySelector(
      '[data-testid="rn-word"] > .text-main',
    );
    const word =
      app.container
        .querySelector('[data-testid="rn-word"]')
        ?.getAttribute("data-word") ?? "";
    if (word !== "") {
      const ch = word[main?.textContent?.length ?? 0] ?? word[0] ?? "a";
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(30);
  }
}

describe("runner online (online wave, phase 18)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSkyScoresForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races to the line: banner, relay, awaiting, win", async () => {
    const { app, invokes } = await armOnlineRunner();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("first to 60m");

    await raceToLine(app);
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
    const progresses = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "progress",
    );
    expect(progresses.length).toBeGreaterThanOrEqual(1);

    //the peer crosses later -> I win; nothing touched the local stats
    handleLanPeerMessage({ type: "finished", finishMs: 999_999, acc: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pageText(app)).toContain("you win!");
    expect(window.localStorage.getItem(SKY_SCORES_KEY)).toBeNull();
  });

  it("my death before the line loses the race immediately", async () => {
    const { app, invokes } = await armOnlineRunner();
    expect(pageText(app)).toContain("online vs P2");
    //never type: three obstacles pass, three hits, dead — the peer wins
    await vi.advanceTimersByTimeAsync(60000);
    expect(
      app.container.querySelector('[data-testid="rn-verdict"]'),
    ).not.toBeNull();
    expect(pageText(app)).toContain("P2 takes it");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
    const lossFinish = finishes[0]?.args["message"] as
      | Record<string, unknown>
      | undefined;
    expect(lossFinish?.["finishMs"]).toBeNull();
  });

  it("a disconnect during the run voids it", async () => {
    const { app, fire } = await armOnlineRunner();
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(0);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start running"); //back at the menu
  });
});
