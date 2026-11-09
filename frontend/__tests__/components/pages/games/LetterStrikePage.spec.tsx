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
  LETTER_STRIKE_SCORES_KEY,
  _resetLetterStrikeScoresForTests,
} from "../../../../src/ts/utils/letter-strike/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function ships(app: App): { text: string; typed: string }[] {
  return [...app.container.querySelectorAll('[data-testid="ls-ship"]')].map(
    (el) => ({
      text: el.textContent ?? "",
      typed: el.querySelector(".text-main")?.textContent ?? "",
    }),
  );
}

async function openLetterStrike(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/letter-strike" });
  await app.settle();
  return app;
}

describe("letter strike page (idea G8 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLetterStrikeScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openLetterStrike();
    const text = pageText(app);
    expect(text).toContain("best score");
    expect(text).toContain("best wave");
    expect(text).toContain("start run");
    expect(text).toContain("Backspace unwinds the lock");
  });

  it("a started run shows ships, locks and destroys by typing", async () => {
    const app = await openLetterStrike();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);

    const field = ships(app);
    expect(
      field.length,
      `diag: ${pageText(app).slice(0, 240)}`,
    ).toBeGreaterThan(0);
    expect(pageText(app)).toContain("❤❤❤");

    //type the first ship's word: the prefix grows then the ship explodes
    const target = field[0]?.text ?? "";
    for (const ch of target) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(60);
    const text = pageText(app);
    expect(text).toMatch(/x1/); //the combo moved
    //the destroyed ship is gone; the next wave replaced the screen with
    //fresh untyped ships (a repeat of the same word is possible, so the
    //typed prefixes are what prove the destruction)
    expect(ships(app).every((s) => s.typed === "")).toBe(true);
  });

  it("Space fires the EMP only when charged; Escape is swallowed", async () => {
    const app = await openLetterStrike();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    const before = ships(app).length;

    //Space without a charge: nothing clears
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await vi.advanceTimersByTimeAsync(60);
    expect(ships(app).length).toBe(before);

    //a document-level bubble listener must never see Escape mid-run
    let escapeSeen = false;
    const spy = (): void => {
      escapeSeen = true;
    };
    document.addEventListener("keydown", spy);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(60);
    document.removeEventListener("keydown", spy);
    expect(escapeSeen).toBe(false); //swallowed in the capture phase
    expect(ships(app).length).toBe(before); //the run continues
  });

  it("a finished run records the bests and shows the result", async () => {
    const app = await openLetterStrike();
    vi.useFakeTimers();
    button(app, "start run")?.click();
    await vi.advanceTimersByTimeAsync(200);
    //idle: ships reach the floor until the lives run out
    let guard = 0;
    while (!pageText(app).includes("run over") && guard++ < 90) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("run over");
    expect(pageText(app)).toContain("wave reached");
    const raw = JSON.parse(
      window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY) ?? "{}",
    ) as { history: unknown[] };
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("letter strike online (online wave, phase 32)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    _resetLetterStrikeScoresForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match streams the seeded waves: banner, relay, panel", async () => {
    const { app, invokes, fire } = await armOnlineStrike();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same waves, the higher score wins");

    //the first tick relays the starting numbers (score 0, lives 3)
    const initial = invokes.filter((entry) => {
      if (entry.cmd !== "lan_send_message") return false;
      const message = entry.args["message"] as Record<string, unknown>;
      if (message["type"] !== "progress") return false;
      const state = message["state"] as Record<string, unknown>;
      return state["lives"] === 3;
    });
    expect(initial.length).toBeGreaterThanOrEqual(1);

    //the peer's relay lands decoded on the live panel
    handleLanPeerMessage({
      type: "progress",
      gameId: "letter-strike",
      state: { score: 450, lives: 2 },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("450 score");

    //a disconnect during the run voids it (driven from the same arm)
    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(100);
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start run"); //back at the menu
    expect(window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY)).toBeNull();
  });

  it("the peer's early weak finish loses to my longer stand", async () => {
    const { app, invokes } = await armOnlineStrike();
    //the peer died fast with nothing: my longer stand with equal score wins
    handleLanPeerMessage({
      type: "progress",
      gameId: "letter-strike",
      state: { score: 0, lives: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    //idle: wave 1's ships reach the floor, three lives drain, the run ends
    let guard = 0;
    while (
      app.container.querySelector('[data-testid="ls-verdict"]') === null &&
      guard++ < 60
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
    //online never touches the local strike scores
    expect(window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY)).toBeNull();
  });

  it("the peer's big score wins the death race", async () => {
    const { app } = await armOnlineStrike();
    //the peer died early with a huge score: my run can never catch it
    handleLanPeerMessage({
      type: "progress",
      gameId: "letter-strike",
      state: { score: 9999, lives: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });

    let guard = 0;
    while (
      app.container.querySelector('[data-testid="ls-verdict"]') === null &&
      guard++ < 60
    ) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(pageText(app)).toContain("P2 wins");
    expect(window.localStorage.getItem(LETTER_STRIKE_SCORES_KEY)).toBeNull();
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

async function armOnlineStrike(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/letter-strike" });
  await app.settle();
  vi.useFakeTimers(); //the death race runs on the fake tick loop
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "letter-strike",
      seed: 42,
      params: { lang: "english" },
    },
  });
  await vi.advanceTimersByTimeAsync(150); //the pool falls back, the race starts
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
