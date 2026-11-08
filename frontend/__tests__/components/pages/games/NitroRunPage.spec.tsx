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
  NITRO_RUN_STATS_KEY,
  _resetNitroRunStatsForTests,
} from "../../../../src/ts/utils/nitro-run/store";
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
    '[data-testid="nr-word"]',
  );
  return {
    text: el?.textContent ?? "",
    typed: el?.querySelector(".text-main")?.textContent ?? "",
  };
}

async function openNitroRun(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/nitro-run" });
  await app.settle();
  return app;
}

describe("nitro run page (idea G23 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetNitroRunStatsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the menu renders the bests and the how-to", async () => {
    const app = await openNitroRun();
    const text = pageText(app);
    expect(text).toContain("best rank score");
    expect(text).toContain("best distance");
    expect(text).toContain("start race");
    expect(text).toContain("Enter burns it");
  });

  it("a started race shows the cars, the stream and the gap line", async () => {
    const app = await openNitroRun();
    vi.useFakeTimers();
    button(app, "start race")?.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(
      app.container.querySelector('[data-testid="nr-player-car"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelectorAll('[data-testid="nr-ai-car"]').length,
    ).toBeGreaterThan(0);
    expect(
      app.container.querySelector('[data-testid="nr-gap-line"]'),
    ).not.toBeNull();
    const word = currentWord(app);
    expect(word.text.length).toBeGreaterThan(0);
  });

  it("typing the stream advances the distance", async () => {
    const app = await openNitroRun();
    vi.useFakeTimers();
    button(app, "start race")?.click();
    await vi.advanceTimersByTimeAsync(300);
    const word = currentWord(app)?.text ?? "";
    for (const ch of word) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(80);
    const text = pageText(app);
    const distance = Number(/(\d+)m\s*distance/.exec(text)?.[1] ?? 0);
    expect(distance).toBeGreaterThan(0); //the distance moved off zero
  });

  it("an idle race ends with the result screen and records it", async () => {
    const app = await openNitroRun();
    vi.useFakeTimers();
    button(app, "start race")?.click();
    await vi.advanceTimersByTimeAsync(300);
    let guard = 0;
    while (!pageText(app).includes("race over") && guard++ < 200) {
      await vi.advanceTimersByTimeAsync(250);
    }
    const text = pageText(app);
    expect(text).toContain("race over");
    expect(text).toContain("place #5 of 5"); //idle: behind all four AI
    const raw = JSON.parse(
      window.localStorage.getItem(NITRO_RUN_STATS_KEY) ?? "{}",
    ) as { history: unknown[] };
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

/** types the displayed word's chars (repeats until the target is crossed) */
async function raceToLine(app: App): Promise<void> {
  for (let guard = 0; guard < 2000; guard++) {
    //the banner says "first to Nm wins" — the guard must match the
    //verdict element, not the substring
    if (
      pageText(app).includes("waiting for") ||
      app.container.querySelector('[data-testid="nr-verdict"]') !== null
    ) {
      return;
    }
    const main = app.container.querySelector(
      '[data-testid="nr-word"] > span > .text-main',
    );
    const rest = app.container.querySelector(
      '[data-testid="nr-word"] > span > span:not(.text-main)',
    );
    const word = main?.textContent ?? "";
    const typedLen = main?.textContent?.length ?? 0;
    const full = word + (rest?.textContent ?? "");
    const ch = full[typedLen] ?? "a";
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ch,
        code: `Key${ch.toUpperCase()}`,
      }),
    );
    await new Promise((r) => setTimeout(r, 12));
  }
}

describe("nitro run online (online wave, phase 14)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetNitroRunStatsForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races to the line: banner, relay, awaiting, win", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/nitro-run" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "nitro-run",
        seed: 42,
        params: { lang: "english", meters: 200 }, //a short test target
      },
    });
    await new Promise((r) => setTimeout(r, 150)); //the stream builds
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("first to 200m");

    await raceToLine(app);
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer crosses later -> I win; nothing touched the local stats
    handleLanPeerMessage({ type: "finished", finishMs: 999_999, acc: 100 });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("you win!");
    expect(window.localStorage.getItem(NITRO_RUN_STATS_KEY)).toBeNull();
  });

  it("the peer's earlier finish resolves my crossing as a loss", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/nitro-run" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "nitro-run",
        seed: 42,
        params: { lang: "english", meters: 200 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    handleLanPeerMessage({ type: "finished", finishMs: 100, acc: 100 });
    await new Promise((r) => setTimeout(r, 60));

    await raceToLine(app);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the race voids it", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/nitro-run" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "nitro-run",
        seed: 42,
        params: { lang: "english", meters: 200 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    tauri.fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start race"); //back at the menu
  });
});
