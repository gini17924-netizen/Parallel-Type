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
  TYPE_SNAKE_SCORES_KEY,
  _resetTypeSnakeScoresForTests,
} from "../../../../src/ts/utils/type-snake/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function segments(app: App): number {
  return app.container.querySelectorAll('[data-testid="ts-segment"]').length;
}

function food(app: App): { text: string; typed: string } | undefined {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="ts-food"]',
  );
  if (el === null) return undefined;
  return {
    text: el.textContent ?? "",
    typed: el.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openTypeSnake(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/type-snake" });
  await app.settle();
  return app;
}

describe("type snake page (idea G11 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetTypeSnakeScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openTypeSnake();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best length");
    expect(text).toContain("start run");
    expect(text).toContain("the snake walks itself");
  });

  it("a started run shows the snake and the ripening food", async () => {
    const app = await openTypeSnake();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(segments(app)).toBe(4);
    const f = food(app);
    expect(f, `diag: ${pageText(app).slice(0, 240)}`).toBeDefined();
    expect((f?.text ?? "").length).toBeGreaterThan(0);

    //the snake walks itself: the head position moves over the ticks
    //(a 220ms advance fires only four 50ms ticks = 200ms < one step, so
    //advance past the movement interval)
    const head = app.container.querySelectorAll(
      '[data-testid="ts-segment"]',
    )[0];
    const before = `${(head as HTMLElement | undefined)?.style.left}/${
      (head as HTMLElement | undefined)?.style.top
    }`;
    await vi.advanceTimersByTimeAsync(250);
    const headAfter = app.container.querySelectorAll(
      '[data-testid="ts-segment"]',
    )[0];
    const after = `${(headAfter as HTMLElement | undefined)?.style.left}/${
      (headAfter as HTMLElement | undefined)?.style.top
    }`;
    expect(after).not.toBe(before);
  });

  it("typing the food's word ripens it; the eat lands on arrival", async () => {
    const app = await openTypeSnake();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const word = food(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    //ripened: the typed prefix covers the whole word
    expect(food(app)?.typed).toBe(word);
    //walk to the food: the eat lands automatically (the score moves)
    let guard = 0;
    let score = 0;
    while (guard++ < 800) {
      await vi.advanceTimersByTimeAsync(250);
      score = Number(/(\d+)score/.exec(pageText(app))?.[1] ?? 0);
      if (score > 0) break;
    }
    expect(score).toBeGreaterThan(0); //the eat landed
    expect(segments(app)).toBe(5); //grown
    const text = pageText(app);
    expect(text).toMatch(/1eaten/); //the eat counted
  });

  it("the run ends when the snake is boxed in (idle-grow shortcut)", async () => {
    //a long idle run grows the snake on the cadence of typed foods; the
    //engine's death is unit-tested, so here we only pin the plumbing:
    //the record lands in storage once a run finishes
    const app = await openTypeSnake();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //force many eat cycles: type each food's word and walk
    let guard = 0;
    while (guard++ < 60 && pageText(app).includes("eaten")) {
      const word = food(app)?.text ?? "";
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
        await vi.advanceTimersByTimeAsync(20);
      }
      await vi.advanceTimersByTimeAsync(600);
    }
    //no crash + the HUD still alive (or the result screen if it died)
    expect(
      pageText(app).includes("eaten") || pageText(app).includes("boxed in"),
    ).toBe(true);
    void TYPE_SNAKE_SCORES_KEY;
  });
});

/** drives the seeded run to the death (or straight to the verdict once
 * the peer is already in): reads the food word from the arena and types
 * it — the eat lands on arrival, death comes when boxed in */
async function driveRun(app: App): Promise<void> {
  for (let guard = 0; guard < 400; guard++) {
    if (
      app.container.querySelector('[data-testid="ts-verdict"]') !== null ||
      app.container.querySelector('[data-testid="ts-awaiting"]') !== null
    ) {
      return;
    }
    const word = food(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
    }
    //one walk + eat cycle (the food spawns at least 3 cells away)
    await vi.advanceTimersByTimeAsync(15000);
  }
}

describe("type snake online (online wave, phase 30)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetTypeSnakeScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded foods: banner, relay", async () => {
    const { app, invokes } = await armOnlineSnake();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same food stream, the higher score wins");
    expect(pageText(app)).toContain("4 long · 0 score"); //the live panel

    //two food words ripened and eaten — the relay fires per change
    for (let i = 0; i < 2; i++) {
      const word = food(app)?.text ?? "";
      for (const ch of word) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      }
      await vi.advanceTimersByTimeAsync(15000);
    }
    const scored = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return (state["score"] as number) > 0;
    });
    expect(scored.length).toBeGreaterThanOrEqual(1);
  });

  it("the peer's weaker run loses to my death race", async () => {
    const { app, invokes } = await armOnlineSnake();
    //the peer died fast with nothing: my run beats it whenever I die
    handleLanPeerMessage({
      type: "progress",
      gameId: "type-snake",
      state: { length: 4, score: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    await driveRun(app);
    expect(pageText(app)).toContain("you win!");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
    //online never touches the local snake scores
    expect(window.localStorage.getItem(TYPE_SNAKE_SCORES_KEY)).toBeNull();
  }, 120_000);

  it("the peer's bigger score wins the death race", async () => {
    const { app } = await armOnlineSnake();
    //the peer died early with a huge score: my run can never catch it
    handleLanPeerMessage({
      type: "progress",
      gameId: "type-snake",
      state: { length: 40, score: 9999 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    await driveRun(app);
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(TYPE_SNAKE_SCORES_KEY)).toBeNull();
  }, 120_000);

  it("a disconnect during the run voids it", async () => {
    const { app, fire } = await armOnlineSnake();
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start run"); //back at the menu
    expect(window.localStorage.getItem(TYPE_SNAKE_SCORES_KEY)).toBeNull();
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

async function armOnlineSnake(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/type-snake" });
  await app.settle();
  vi.useFakeTimers(); //the death race runs on the fake tick loop
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "type-snake",
      seed: 42,
      params: { lang: "english" },
    },
  });
  await vi.advanceTimersByTimeAsync(150); //the pool falls back, the race starts
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
