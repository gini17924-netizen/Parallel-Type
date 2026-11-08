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
  MAZE_SCORES_KEY,
  _resetMazeScoresForTests,
} from "../../../../src/ts/utils/maze-runner/store";
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
  return app.container.querySelectorAll('[data-testid="mz-cell"]').length;
}

function gates(app: App): HTMLElement[] {
  return [
    ...app.container.querySelectorAll<HTMLElement>('[data-testid="mz-gate"]'),
  ];
}

function activeWord(app: App): string {
  return (
    app.container
      .querySelector('[data-testid="mz-word"]')
      ?.getAttribute("data-word") ?? ""
  );
}

async function openMaze(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/maze-runner" });
  await app.settle();
  return app;
}

describe("maze runner page (idea G14 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetMazeScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the levels and the how-to", async () => {
    const app = await openMaze();
    const text = pageText(app);
    expect(text).toContain("level 1");
    expect(text).toContain("best L1");
    expect(text).toContain("clean runs");
    expect(text).toContain("enter the maze");
  });

  it("a started run shows the full 15x11 grid, the gates and the runner", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(cells(app)).toBe(15 * 11);
    expect(gates(app).length).toBeGreaterThan(2);
    expect(
      app.container.querySelector('[data-testid="mz-runner"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="mz-minimap"]'),
    ).not.toBeNull();
    expect(activeWord(app).length).toBeGreaterThanOrEqual(3);
  });

  it("typing the active gate's word opens it (the partial bar moves)", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const word = activeWord(app);
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(100);
    const opened = gates(app).find(
      (gate) => gate.getAttribute("data-open") === "true",
    );
    expect(opened).toBeDefined();
    expect(opened?.getAttribute("data-word")).toBe(word);
  });

  it("a wrong key dents the errors HUD and the penalty", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Ω" }));
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("penalty");
    //the errors cell shows 1
    const errorsCell = [...app.container.querySelectorAll(".text-xs")].find(
      (el) => el.textContent === "errors",
    );
    expect(errorsCell?.previousElementSibling?.textContent).toBe("1");
  });

  it("a full run conquers the maze and records the time", async () => {
    const app = await openMaze();
    vi.useFakeTimers();
    button(app, "enter the maze")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //type every gate in order (the active word panel always shows the
    //current target), ticking the walk between words
    let guard = 0;
    while (!pageText(app).includes("conquered") && guard++ < 60) {
      const word = activeWord(app);
      if (word.length === 0) {
        await vi.advanceTimersByTimeAsync(200);
        continue;
      }
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
        await vi.advanceTimersByTimeAsync(15);
      }
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(pageText(app)).toContain("conquered");
    const raw = JSON.parse(
      window.localStorage.getItem(MAZE_SCORES_KEY) ?? "{}",
    ) as { history?: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
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

const MAZE_SEED = 42;

async function armOnlineMaze(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/maze-runner" });
  await app.settle();
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "maze-runner",
      seed: MAZE_SEED,
      params: { lang: "english", level: 1 },
    },
  });
  await vi.waitFor(() => {
    expect(
      app.container.querySelector('[data-testid="mz-maze"]'),
    ).not.toBeNull();
  });
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}

/** types the active gate's word repeatedly until the run finishes */
async function finishMaze(app: App): Promise<void> {
  for (let guard = 0; guard < 600; guard++) {
    const text = pageText(app);
    if (
      text.includes("waiting for") ||
      text.includes("you win!") ||
      text.includes("wins")
    ) {
      return;
    }
    const gate = app.container.querySelector(
      '[data-testid="mz-gate"][data-open="false"][data-active="true"]',
    );
    const word = gate?.getAttribute("data-word") ?? "";
    if (word !== "") {
      const typedLen =
        app.container.querySelector('[data-testid="mz-word"] > .text-main')
          ?.textContent?.length ?? 0;
      const ch = word[typedLen] ?? word[0] ?? "a";
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe("maze runner online (online wave, phase 12)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetMazeScoresForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races the peer: banner, relay, awaiting, win", async () => {
    const { app, invokes } = await armOnlineMaze();
    expect(pageText(app)).toContain("online vs P2");

    await finishMaze(app);
    //the horn: the finish shipped and the verdict waits for the peer
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer exits later -> I win; nothing touched the local maze stats
    handleLanPeerMessage({ type: "finished", finishMs: 999_999, acc: 100 });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("P2"); //the peer's time cell
    expect(window.localStorage.getItem(MAZE_SCORES_KEY)).toBeNull();
  });

  it("the peer's earlier exit resolves my exit immediately as a loss", async () => {
    const { app, invokes } = await armOnlineMaze();
    //the peer exits before me: their finish + a final progress position
    handleLanPeerMessage({
      type: "progress",
      gameId: "maze-runner",
      state: { runner: 999, gates: 999 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 100, acc: 100 });
    await new Promise((r) => setTimeout(r, 60));

    await finishMaze(app);
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
    const { app, fire } = await armOnlineMaze();
    fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("enter the maze"); //back at the menu
  });
});
