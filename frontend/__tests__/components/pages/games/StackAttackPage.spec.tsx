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
  _resetStackAttackScoresForTests,
  STACK_ATTACK_SCORES_KEY,
} from "../../../../src/ts/utils/stack-attack/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function fallingBlock(app: App): HTMLElement | undefined {
  return (
    app.container.querySelector<HTMLElement>('[data-testid="sa-block"]') ??
    undefined
  );
}

function lockedCells(app: App): string[] {
  return [...app.container.querySelectorAll('[data-testid="sa-cell"]')].map(
    (el) => el.textContent ?? "",
  );
}

async function openStackAttack(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/stack-attack" });
  await app.settle();
  return app;
}

describe("stack attack page (idea G12 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetStackAttackScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the best and the how-to", async () => {
    const app = await openStackAttack();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("start run");
    expect(text).toContain("steer with the arrows");
  });

  it("a started run shows the falling block and the ghost column", async () => {
    const app = await openStackAttack();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const block = fallingBlock(app);
    expect(block, `diag: ${pageText(app).slice(0, 240)}`).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="sa-ghost"]'),
    ).not.toBeNull();
    expect(pageText(app)).toContain("chain");
  });

  it("the arrows steer the falling block", async () => {
    const app = await openStackAttack();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const before = fallingBlock(app)?.style.left ?? "";
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(30);
    const after = fallingBlock(app)?.style.left ?? "";
    expect(after).not.toBe(before);
  });

  it("typing the word locks the block into the grid cells", async () => {
    const app = await openStackAttack();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //park the fall: rest on the floor
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fallingBlock(app)?.textContent).not.toBeNull();
    const word = fallingBlock(app)?.textContent ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    //the locked cells render as letters in the grid
    expect(lockedCells(app).length).toBe(word.length);
    //a fresh block arrived
    expect(fallingBlock(app)).not.toBeNull();
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

async function armOnlineStack(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/stack-attack" });
  await app.settle();
  vi.useFakeTimers(); //the race runs in simulated time — CI-speed free
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "stack-attack",
      seed: 42,
      params: { lang: "english", durationMs: 4000 },
    },
  });
  await vi.advanceTimersByTimeAsync(150); //the seeded run starts
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}

/** plays like the game intends: types the falling word (the typed index
 * tracked LOCALLY — the DOM's data-typed only refreshes per engine tick,
 * so a faster loop reading the DOM re-dispatches stale letters), and
 * steers a few columns on every new word so the locks spread and the
 * tower never tops before the horn */
async function playUntilHorn(app: App): Promise<void> {
  let lastWord = "";
  let typedLocal = 0;
  let steerDir = -1;
  for (let guard = 0; guard < 4000; guard++) {
    if (
      app.container.querySelector('[data-testid="sa-awaiting"]') !== null ||
      app.container.querySelector('[data-testid="sa-verdict"]') !== null
    ) {
      return;
    }
    const block = app.container.querySelector('[data-testid="sa-block"]');
    const word = block?.getAttribute("data-word") ?? "";
    if (word !== lastWord) {
      //a fresh word = the previous block locked: steer the new one over
      const key = steerDir === -1 ? "ArrowLeft" : "ArrowRight";
      steerDir = -steerDir;
      for (let s = 0; s < 4; s++) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
        await vi.advanceTimersByTimeAsync(10);
      }
      lastWord = word;
      typedLocal = 0;
    }
    if (word !== "") {
      const ch = word[typedLocal] ?? word[0] ?? "a";
      typedLocal += 1;
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(25);
  }
}

describe("stack attack online (online wave, phase 22)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetStackAttackScoresForTests();
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
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/stack-attack" });
    await app.settle();
    vi.useFakeTimers(); //the race runs in simulated time — CI-speed free
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "stack-attack",
        seed: 42,
        params: { lang: "english", durationMs: 1500 }, //a short test horn
      },
    });
    await vi.advanceTimersByTimeAsync(150); //the seeded run starts
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same blocks, 120s");

    //the typing goes on; at 1.5s the horn locks my rows -> awaiting
    await playUntilHorn(app);
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer's horn: a weaker result lands -> I win
    handleLanPeerMessage({
      type: "progress",
      gameId: "stack-attack",
      state: { rows: 0, score: 10 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 1500, acc: 100 });
    await vi.advanceTimersByTimeAsync(80);
    expect(pageText(app)).toContain("you win!");
    expect(window.localStorage.getItem(STACK_ATTACK_SCORES_KEY)).toBeNull();
  });

  it("the peer's horn result resolves my awaiting verdict as a loss", async () => {
    const { app, invokes } = await armOnlineStack();
    //the peer's horn: a big final score lands before mine
    handleLanPeerMessage({
      type: "progress",
      gameId: "stack-attack",
      state: { rows: 99, score: 5000 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 4000, acc: 100 });
    await vi.advanceTimersByTimeAsync(60);

    //my horn: the verdict compares against the peer's big rows
    await vi.advanceTimersByTimeAsync(4500);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the run voids it", async () => {
    const { app, fire } = await armOnlineStack();
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(80);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start run"); //back at the menu
  });
});
