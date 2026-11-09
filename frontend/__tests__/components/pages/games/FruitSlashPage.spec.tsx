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
  FRUIT_SLASH_SCORES_KEY,
  _resetFruitSlashScoresForTests,
} from "../../../../src/ts/utils/fruit-slash/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function fruits(app: App): { text: string; typed: string }[] {
  return [...app.container.querySelectorAll('[data-testid="fs-fruit"]')].map(
    (el) => ({
      text: el.textContent ?? "",
      typed: el.querySelector(".text-main")?.textContent ?? "",
    }),
  );
}

/** the typable fruits only — typing a bomb's word is the penalty path */
function nonBombTargets(app: App): string[] {
  return [...app.container.querySelectorAll('[data-testid="fs-fruit"]')]
    .filter((el) => el.querySelector('[data-testid="fs-bomb"]') === null)
    .map((el) => el.textContent ?? "");
}

async function openFruitSlash(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/fruit-slash" });
  await app.settle();
  return app;
}

describe("fruit slash page (idea G10 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetFruitSlashScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openFruitSlash();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best slashed");
    expect(text).toContain("start run");
    expect(text).toContain("never type the bombs");
  });

  it("a started run shows flying fruits that slash by typing", async () => {
    const app = await openFruitSlash();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const field = fruits(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the fruit rises: its position moves up over the ticks
    expect(pageText(app)).toContain("time");

    //slash a NON-BOMB fruit by typing its whole word (typing a bomb is
    //the penalty path and the bomb mix is random per run — keep ticking
    //until a typable fruit is on the field)
    let targets = nonBombTargets(app);
    let guard = 0;
    while (targets.length === 0 && guard++ < 40) {
      await vi.advanceTimersByTimeAsync(200);
      targets = nonBombTargets(app);
    }
    expect(
      targets.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    //the LAST match is the newest spawn — the most airtime left
    const target = targets[targets.length - 1] ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    //the combo moved (two same-word launches can complete together -> x2)
    expect(text).toMatch(/x[1-9]/);
    //the target left the field (the slash happened). The OTHER fruits may
    //hold partials: the word-oriented matcher consumes matching prefixes
    //on every visible fruit (doc G10's per-fruit partial map) — the old
    //"every typed is empty" assert was the recurring suite flake
    expect(nonBombTargets(app)).not.toContain(target);
  });

  it("the 90-second window ends the run and records it", async () => {
    const app = await openFruitSlash();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (!pageText(app).includes("time!") && guard++ < 100) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    const text = pageText(app);
    expect(text).toContain("time!");
    expect(text).toContain("slashed");
    const raw = JSON.parse(
      window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

/** drives the shared window to the horn (durationMs 8000 in the armed
 * params) and returns once the verdict overlay is up */
async function idleToHorn(app: App): Promise<void> {
  let guard = 0;
  while (
    app.container.querySelector('[data-testid="fs-verdict"]') === null &&
    guard++ < 30
  ) {
    await vi.advanceTimersByTimeAsync(2000);
  }
}

describe("fruit slash online (online wave, phase 36)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetFruitSlashScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded launches: banner, relay, panel", async () => {
    const { app, invokes, fire } = await armOnlineFruit();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same stream, the higher score wins");

    //the first tick relays the starting numbers (score 0, bombs 0)
    const initial = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return state["bombs"] === 0;
    });
    expect(initial.length).toBeGreaterThanOrEqual(1);

    //the peer's relay lands decoded on the live panel
    handleLanPeerMessage({
      type: "progress",
      gameId: "fruit-slash",
      state: { score: 450, bombs: 1 },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("450 score");

    //a disconnect during the window voids it (driven from the same arm)
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start run"); //back at the menu
    expect(window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY)).toBeNull();
  });

  it("the horn resolves my slash ahead of the peer's empty window", async () => {
    const { app, invokes } = await armOnlineFruit();
    //the peer finished early with nothing: one slashed fruit decides it
    handleLanPeerMessage({
      type: "progress",
      gameId: "fruit-slash",
      state: { score: 0, bombs: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    //slash ONE non-bomb fruit (the newest — most airtime left)
    let targets = nonBombTargets(app);
    let guard = 0;
    while (targets.length === 0 && guard++ < 40) {
      await vi.advanceTimersByTimeAsync(200);
      targets = nonBombTargets(app);
    }
    const target = targets[targets.length - 1] ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
    }
    await idleToHorn(app);
    expect(pageText(app)).toContain("you win!");
    const finishes = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      return message["type"] === "finished";
    });
    expect(finishes).toHaveLength(1);
    //online never touches the local slash scores
    expect(window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY)).toBeNull();
  });

  it("the peer's big score wins at the shared horn", async () => {
    const { app } = await armOnlineFruit();
    //the peer finished with a huge score: my window can never catch it
    handleLanPeerMessage({
      type: "progress",
      gameId: "fruit-slash",
      state: { score: 9999, bombs: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    await idleToHorn(app);
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(FRUIT_SLASH_SCORES_KEY)).toBeNull();
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

async function armOnlineFruit(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/fruit-slash" });
  await app.settle();
  vi.useFakeTimers(); //the shared window runs on the fake tick loop
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "fruit-slash",
      seed: 42,
      params: { lang: "english", durationMs: 8000 },
    },
  });
  await vi.advanceTimersByTimeAsync(150); //the pool falls back, the window opens
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
