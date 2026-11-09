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
  TYPE_PONG_SCORES_KEY,
  _resetTypePongScoresForTests,
} from "../../../../src/ts/utils/type-pong/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function currentWord(app: App): { text: string; typed: string } {
  const el = app.container.querySelector<HTMLElement>(
    '[data-testid="tp-word"]',
  );
  return {
    text: el?.textContent ?? "",
    typed: el?.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openTypePong(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/type-pong" });
  await app.settle();
  return app;
}

describe("type pong page (idea G13 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetTypePongScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the stats and the how-to", async () => {
    const app = await openTypePong();
    const text = pageText(app);
    expect(text).toContain("wins");
    expect(text).toContain("losses");
    expect(text).toContain("best rally");
    expect(text).toContain("start match");
    expect(text).toContain("First to 5 wins");
  });

  it("a started match shows the court, the paddles and the ball", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(
      app.container.querySelector('[data-testid="tp-player-paddle"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="tp-ai-paddle"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="tp-ball"]'),
    ).not.toBeNull();
    const w = currentWord(app);
    expect(w.text.length).toBeGreaterThan(0);
  });

  it("typing the word moves the paddle (the typed prefix grows)", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const w = currentWord(app)?.text ?? "";
    //type the first 2 chars: the typed prefix grows
    expect(w.length).toBeGreaterThan(0); //sanity: the word is live
    for (const ch of w.slice(0, 2)) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(currentWord(app)?.typed).toBe(w.slice(0, 2));
  });

  it("the breaker mode: switching works and the word display lives", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "breaker")?.click();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    //the word display is live (the breaker engine issued the first brick's word)
    const wordEl = app.container.querySelector('[data-testid="tp-word"]');
    expect(wordEl, `diag: ${pageText(app).slice(0, 300)}`).not.toBeNull();
    const word = wordEl?.textContent ?? "";
    expect(word.length).toBeGreaterThan(0);
  });

  it("an idle match ends with the result screen and records it", async () => {
    const app = await openTypePong();
    vi.useFakeTimers();
    button(app, "start match")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (
      !pageText(app).includes("you win!") &&
      !pageText(app).includes("the AI wins") &&
      guard++ < 3000
    ) {
      await vi.advanceTimersByTimeAsync(50);
    }
    const text = pageText(app);
    expect(text.includes("you win!") || text.includes("the AI wins")).toBe(
      true,
    );
    const raw = JSON.parse(
      window.localStorage.getItem(TYPE_PONG_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

/** the last pong-snapshot the page shipped (the host's state on the wire) */
function lastSnapshot(
  invokes: { cmd: string; args: Record<string, unknown> }[],
): Record<string, unknown> | undefined {
  for (let i = invokes.length - 1; i >= 0; i--) {
    const entry = invokes[i];
    if (entry === undefined) continue;
    if (entry.cmd !== "lan_send_message") continue;
    const message = entry.args["message"] as Record<string, unknown>;
    if (message["type"] === "pong-snapshot") {
      return message["snap"] as Record<string, unknown>;
    }
  }
  return undefined;
}

describe("type pong online (online wave, phase 45 — the first real versus)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetTypePongScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("the host simulates and ships snapshots; the client's chars apply", async () => {
    const { app, invokes } = await armOnlinePong("host");
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("the first real versus");

    //the fixed-rate snapshots ride the raw passthrough
    await vi.advanceTimersByTimeAsync(200);
    const snap = lastSnapshot(invokes);
    expect(snap, "diag: no snapshot shipped").toBeDefined();
    expect(snap?.["phase"]).toBe("running");

    //the client's relayed chars move the client paddle authoritatively:
    //type the client word fully -> the next snapshot shows the snap
    const rawWord = snap?.["clientWord"];
    const word = typeof rawWord === "string" ? rawWord : "";
    for (const ch of word) {
      handleLanPeerMessage({
        type: "pong-input",
        gameId: "type-pong",
        chars: [ch],
      });
    }
    await vi.advanceTimersByTimeAsync(120);
    const after = lastSnapshot(invokes);
    //the paddle snapped onto the ball at the completion moment — the ball
    //keeps drifting after it, so they agree only within the drift band
    expect(
      Math.abs(
        Number(after?.["clientX"]) -
          Number((after?.["ball"] as Record<string, unknown>)?.["x"]),
      ),
    ).toBeLessThanOrEqual(8);
    //online never touches the local pong records
    expect(window.localStorage.getItem(TYPE_PONG_SCORES_KEY)).toBeNull();
  });

  it("the host's match ends at the target score (the score arbitration)", async () => {
    const { app } = await armOnlinePong("host", 1); //first point wins
    //idle: the ball passes an untyped paddle -> one point -> the match
    //ends (the winner is the seed's serve direction — either side)
    let guard = 0;
    while (
      app.container.querySelector('[data-testid="tp-verdict"]') === null &&
      guard++ < 400
    ) {
      await vi.advanceTimersByTimeAsync(50);
    }
    const text = pageText(app);
    expect(
      text.includes("you win!") || text.includes("P2 wins"),
      `diag: ${text.slice(0, 240)}`,
    ).toBe(true);
    expect(window.localStorage.getItem(TYPE_PONG_SCORES_KEY)).toBeNull();
  });

  it("the client never simulates: it relays inputs and renders snapshots", async () => {
    const { app, invokes } = await armOnlinePong("client");
    //the client ships NO snapshots
    await vi.advanceTimersByTimeAsync(200);
    expect(lastSnapshot(invokes)).toBeUndefined();

    //the typed chars relay as pong-input batches
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    await vi.advanceTimersByTimeAsync(120);
    const inputs = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      return message["type"] === "pong-input";
    });
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    const chars = inputs.flatMap(
      (entry) =>
        ((entry.args["message"] as Record<string, unknown>)["chars"] ??
          []) as string[],
    );
    expect(chars).toContain("d");

    //the snapshot renders: the ball lands where the host says it is
    handleLanPeerMessage({
      type: "pong-snapshot",
      gameId: "type-pong",
      snap: {
        seq: 1,
        phase: "running",
        ball: { x: 30, y: 40, vx: 0, vy: 0 },
        hostX: 20,
        clientX: 60,
        hostScore: 0,
        clientScore: 0,
        hostWord: "volley",
        hostTyped: 0,
        clientWord: "volley",
        clientTyped: 0,
        rally: 0,
        bestRally: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(60);
    const ball = app.container.querySelector<HTMLElement>(
      '[data-testid="tp-ball"]',
    );
    expect(ball?.style.left).toBe("30%");
    const topPaddle = app.container.querySelector<HTMLElement>(
      '[data-testid="tp-ai-paddle"]',
    );
    //the top paddle is the OPPONENT (the host) — interpolated toward 20
    expect(Number.parseFloat(topPaddle?.style.left ?? "50")).toBeLessThan(30);
    expect(window.localStorage.getItem(TYPE_PONG_SCORES_KEY)).toBeNull();
  });

  it("a disconnect during the rally voids it", async () => {
    const { app, fire } = await armOnlinePong("host");
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start match"); //back at the menu
    expect(window.localStorage.getItem(TYPE_PONG_SCORES_KEY)).toBeNull();
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

async function armOnlinePong(
  role: "host" | "client",
  targetScore = 5,
): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/type-pong" });
  await app.settle();
  vi.useFakeTimers(); //the sim clock runs on fakes
  armLanMatch({
    role,
    peerName: "P2",
    start: {
      gameId: "type-pong",
      seed: 42,
      params: { lang: "english", targetScore },
    },
  });
  await vi.advanceTimersByTimeAsync(150); //the pool falls back, the match opens
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
