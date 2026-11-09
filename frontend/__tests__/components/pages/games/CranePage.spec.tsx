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
  CRANE_SCORES_KEY,
  _resetCraneScoresForTests,
} from "../../../../src/ts/utils/crane/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function seqEl(app: App): HTMLElement | undefined {
  return (
    app.container.querySelector<HTMLElement>('[data-testid="cr-seq"]') ??
    undefined
  );
}

async function openCrane(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/crane" });
  await app.settle();
  return app;
}

describe("crane page (idea G17 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openCrane();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best height");
    expect(text).toContain("start stacking");
    expect(text).toContain("3 misses");
  });

  it("a started run shows the crane, the zone and the hanging sequence", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    expect(
      app.container.querySelector('[data-testid="cr-crane"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="cr-zone"]'),
    ).not.toBeNull();
    const seq = seqEl(app)?.textContent ?? "";
    expect(seq.length).toBeGreaterThanOrEqual(4); //the 4..6 key sequence
    expect(pageText(app)).toContain("misses");
  });

  it("a wrong key resets the partial prefix", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    const seq = seqEl(app)?.textContent ?? "";
    window.dispatchEvent(new KeyboardEvent("keydown", { key: seq[0] ?? "f" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(
      seqEl(app)?.querySelector(".text-main")?.textContent ?? "",
    ).toHaveLength(1);
    //"d" is outside the default unlocked group (fj)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(
      seqEl(app)?.querySelector(".text-main")?.textContent ?? "",
    ).toHaveLength(0);
  });

  it("completing the sequence releases the box (the fall plays)", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    const seq = seqEl(app)?.textContent ?? "";
    for (const ch of seq) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(10);
    }
    //the release moment: the falling box is on screen
    expect(
      app.container.querySelector('[data-testid="cr-fallbox"]'),
    ).not.toBeNull();
    await vi.advanceTimersByTimeAsync(520);
    //after the landing: a tower segment OR the miss was counted (1/3)
    expect(
      app.container.querySelector('[data-testid="cr-seg"]') !== null ||
        pageText(app).includes("1/3"),
    ).toBe(true);
  });

  it("a window blur pauses the sweep until the focus returns", async () => {
    const app = await openCrane();
    vi.useFakeTimers();
    button(app, "start stacking")?.click();
    await vi.advanceTimersByTimeAsync(60);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(10);
    expect(
      app.container.querySelector('[data-testid="cr-paused"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10);
    expect(app.container.querySelector('[data-testid="cr-paused"]')).toBeNull();
  });
});

/** the crane's x (the hook's left %) and the zone center (the perfect
 * band's left + its width half) read from the arena */
function craneX(app: App): number {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="cr-crane"]',
  );
  return Number.parseFloat(el?.style.left ?? "50");
}

function zoneCenter(app: App): number {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="cr-zone"]',
  );
  return Number.parseFloat(el?.style.left ?? "46") + 4; //perfectPct
}

function sequence(app: App): string {
  return (
    app.container.querySelector('[data-testid="cr-seq"]')?.textContent ?? ""
  );
}

/** waits until the hook is well inside the poor band, then types the
 * hanging sequence — the release lands poor-or-better (a guaranteed
 * score, never a miss) and the relay moves */
async function stackOneBox(app: App): Promise<void> {
  for (let guard = 0; guard < 400; guard++) {
    const dist = Math.abs(craneX(app) - zoneCenter(app));
    if (dist <= 16) break;
    await vi.advanceTimersByTimeAsync(30);
  }
  for (const ch of sequence(app)) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
  }
  await vi.advanceTimersByTimeAsync(100);
}

describe("crane online (online wave, phase 40)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetCraneScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded tower: banner, relay, panel", async () => {
    const { app, invokes, fire } = await armOnlineCrane();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same tower, the higher score wins");

    //the first tick relays the starting numbers (score 0, perfect 0)
    const initial = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return state["perfectCount"] === 0;
    });
    expect(initial.length).toBeGreaterThanOrEqual(1);

    //the peer's relay lands decoded on the live panel
    handleLanPeerMessage({
      type: "progress",
      gameId: "crane",
      state: { score: 450, perfectCount: 2 },
    });
    await vi.advanceTimersByTimeAsync(60);
    expect(pageText(app)).toContain("450 score");

    //a disconnect during the window voids it (driven from the same arm)
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(60);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start stacking"); //back at the menu
    expect(window.localStorage.getItem(CRANE_SCORES_KEY)).toBeNull();
  });

  it("my stacked score beats the peer's empty window at the horn", async () => {
    const { app, invokes } = await armOnlineCrane();
    //the peer finished early with nothing: one guaranteed release decides it
    handleLanPeerMessage({
      type: "progress",
      gameId: "crane",
      state: { score: 0, perfectCount: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    await stackOneBox(app);
    //idle to the horn (durationMs 8000 in the armed params)
    let guard = 0;
    while (
      app.container.querySelector('[data-testid="cr-verdict"]') === null &&
      guard++ < 20
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
    //online never touches the local crane records
    expect(window.localStorage.getItem(CRANE_SCORES_KEY)).toBeNull();
  });

  it("the peer's big score wins at the shared horn", async () => {
    const { app } = await armOnlineCrane();
    //the peer finished with a huge score: my idle window can never catch it
    handleLanPeerMessage({
      type: "progress",
      gameId: "crane",
      state: { score: 9999, perfectCount: 20 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    let guard = 0;
    while (
      app.container.querySelector('[data-testid="cr-verdict"]') === null &&
      guard++ < 20
    ) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(CRANE_SCORES_KEY)).toBeNull();
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

async function armOnlineCrane(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/crane" });
  await app.settle();
  vi.useFakeTimers(); //the shared window runs on the fake tick loop
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "crane",
      seed: 42,
      params: { lang: "english", durationMs: 8000 },
    },
  });
  await vi.advanceTimersByTimeAsync(60); //the match effect starts the sweep
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
