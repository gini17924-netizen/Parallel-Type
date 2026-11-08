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

function platforms(app: App): HTMLElement[] {
  return [
    ...app.container.querySelectorAll<HTMLElement>(
      '[data-testid="cl-platform"]',
    ),
  ];
}

function activeWord(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="cl-word"]')
      ?.getAttribute("data-word") ?? ""
  );
}

function runnerBottom(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="cl-runner"]')
      ?.getAttribute("style")
      ?.match(/bottom:\s*([\d.]+)px/)?.[1] ?? "0"
  );
}

async function openClimber(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/climber" });
  await app.settle();
  return app;
}

async function startRun(app: App): Promise<void> {
  button(app, "start climbing")?.click();
  await vi.advanceTimersByTimeAsync(100);
}

describe("sky climber page (idea G15 phase 2, mode A)", () => {
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

  it("the menu renders the bests and the how-to", async () => {
    const app = await openClimber();
    const text = pageText(app);
    expect(text).toContain("best height");
    expect(text).toContain("best score");
    expect(text).toContain("start climbing");
  });

  it("a started run shows the platform stack, the word and the ring", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    expect(platforms(app).length).toBeGreaterThanOrEqual(6);
    expect(
      app.container.querySelector('[data-testid="cl-ring"]'),
    ).not.toBeNull();
    expect(activeWord(app).length).toBeGreaterThanOrEqual(3);
  });

  it("typing the word jumps: the runner slides and the score grows", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    const before = runnerBottom(app);
    const word = activeWord(app);
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(parseFloat(runnerBottom(app))).toBeGreaterThan(parseFloat(before));
    expect(pageText(app)).toContain("height1");
  });

  it("idling drains the ring and a fall increments the falls HUD", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    //climb out of the ground first, then idle past the timer
    for (let i = 0; i < 2; i++) {
      const word = activeWord(app);
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
        await vi.advanceTimersByTimeAsync(10);
      }
    }
    const fallsText = (): string =>
      app.container.querySelector('[data-testid="cl-falls"]')?.textContent ??
      "0";
    expect(fallsText()).toBe("0");
    await vi.advanceTimersByTimeAsync(8500); //past the 8s platform timer
    expect(fallsText()).toBe("1");
  });

  it("a window blur pauses the pressure until the focus returns", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(50);
    expect(
      app.container.querySelector('[data-testid="cl-paused"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(50);
    expect(app.container.querySelector('[data-testid="cl-paused"]')).toBeNull();
  });

  it("a ground fall ends the run and records the height", async () => {
    const app = await openClimber();
    vi.useFakeTimers();
    await startRun(app);
    //idle from the ground: one fall = death
    await vi.advanceTimersByTimeAsync(8500);
    expect(pageText(app)).toContain("the climb is over");
    const raw = JSON.parse(
      window.localStorage.getItem(SKY_SCORES_KEY) ?? "{}",
    ) as { climber?: { games?: number } };
    expect(raw.climber?.games ?? 0).toBe(1);
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

/** types the active platform's word repeatedly until the target or death */
async function climbToTarget(app: App): Promise<void> {
  for (let guard = 0; guard < 3000; guard++) {
    if (
      pageText(app).includes("waiting for") ||
      app.container.querySelector('[data-testid="cl-verdict"]') !== null
    ) {
      return;
    }
    const word =
      app.container
        .querySelector('[data-testid="cl-word"]')
        ?.getAttribute("data-word") ?? "";
    const typedLen =
      app.container.querySelector('[data-testid="cl-word"] > .text-main')
        ?.textContent?.length ?? 0;
    const ch = word[typedLen] ?? word[0] ?? "a";
    if (ch !== "") {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("climber online (online wave, phase 16)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSkyScoresForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races to the target: banner, relay, awaiting, win", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/climber" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "climber",
        seed: 42,
        params: { lang: "english", height: 5 }, //a short test target
      },
    });
    await new Promise((r) => setTimeout(r, 150)); //the platforms build
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("first to 5 platforms");

    await climbToTarget(app);
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer reaches the target later -> I win; no local records
    handleLanPeerMessage({ type: "finished", finishMs: 999_999, acc: 100 });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("you win!");
    expect(window.localStorage.getItem(SKY_SCORES_KEY)).toBeNull();
  });

  it("my death before the target loses the race immediately", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/climber" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "climber",
        seed: 42,
        params: { lang: "english", height: 99 }, //an unreachable target
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    //the peer reports a finish so my death can resolve
    handleLanPeerMessage({ type: "finished", finishMs: 60_000, acc: 100 });
    await new Promise((r) => setTimeout(r, 60));

    //never type: the timers drain — at the ground the first fall kills
    //never type: the timers drain — at the ground the first fall kills
    //(the arming fetch delays the start ~1.5s, so the 8s timer lands ~10s)
    let waited = 0;
    for (const at of [9000, 10500, 11500]) {
      await new Promise((r) => setTimeout(r, at - waited));
      waited = at;
      if (app.container.querySelector('[data-testid="cl-verdict"]') !== null) {
        return;
      }
    }
    expect(
      app.container.querySelector('[data-testid="cl-verdict"]'),
    ).not.toBeNull();
    expect(pageText(app)).toContain("P2 takes it");
    expect(window.localStorage.getItem(SKY_SCORES_KEY)).toBeNull();
  });

  it("a disconnect during the climb voids it", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/climber" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "climber",
        seed: 42,
        params: { lang: "english", height: 30 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    tauri.fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start climbing"); //back at the menu
  });
});
