import "fake-indexeddb/auto";
import type { Mode } from "@monkeytype/schemas/shared";

import { fireEvent } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SnapshotResult } from "../../../../src/ts/constants/default-snapshot";

import {
  _resetLanStateForTests,
  lanStartHost,
} from "../../../../src/ts/states/lan";
import {
  _resetLanMatchForTests,
  armLanMatch,
  handleLanPeerMessage,
} from "../../../../src/ts/states/lan-match";
import { setLastResult } from "../../../../src/ts/states/snapshot";
import {
  _resetGhostGpStatsForTests,
  GHOST_GP_STATS_KEY,
} from "../../../../src/ts/utils/ghost-gp/gp-store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openGhostGp(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/ghost-gp" });
  await app.settle();
  return app;
}

function currentWord(app: App): string {
  return (
    app.container.querySelector('[data-testid="gp-word"]')?.textContent ?? ""
  );
}

/** the already-typed head of the current word (the main-colored span) */
function typedPart(app: App): string {
  return (
    app.container.querySelector('[data-testid="gp-word"] > .text-main')
      ?.textContent ?? ""
  );
}

function makeResult(
  overrides: Partial<SnapshotResult<Mode>> = {},
): SnapshotResult<Mode> {
  return {
    _id: "ghost_seed_1",
    wpm: 60,
    rawWpm: 70,
    charStats: { correct: 300, incorrect: 5, extra: 0, missed: 2 },
    acc: 95,
    mode: "words",
    mode2: "10",
    timestamp: Date.now(),
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    testDuration: 30,
    language: "english",
    ...overrides,
  } as unknown as SnapshotResult<Mode>;
}

async function startRace(app: App): Promise<void> {
  vi.useFakeTimers();
  button(app, "start race")?.click();
  await vi.advanceTimersByTimeAsync(50); //the word list resolves (fallback)
  await vi.advanceTimersByTimeAsync(2800); //countdown 3-2-1 -> the race
}

describe("ghost gp page (idea G3 phase 2)", () => {
  beforeEach(() => {
    //startRace reads the heavy store (the curve attempt): fake-indexeddb
    //with a fresh factory per test (the cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetGhostGpStatsForTests();
    setLastResult(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    setLastResult(undefined);
    //leave a clean shared factory behind (cross-file leakage vaccination)
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("picker renders both ghost sources and the race lengths", async () => {
    const app = await openGhostGp();
    const text = pageText(app);
    expect(text).toContain("your ghost");
    expect(text).toContain("last run (—)"); //no result yet
    expect(text).toContain("personal best");
    expect(text).toContain("start race");
    for (const length of ["quick", "standard", "long"]) {
      expect(text).toContain(length);
    }
  });

  it("a race against the last-run ghost ends won and records stats", async () => {
    setLastResult(makeResult({ wpm: 60, language: "english" }));
    const app = await openGhostGp();
    expect(pageText(app)).toContain("last run (60wpm)");

    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    for (let guard = 0; guard < 400; guard++) {
      if (pageText(app).includes("you beat the ghost!")) break;
      const word = currentWord(app);
      const done = typedPart(app).length;
      if (word !== "" && done < word.length) {
        fireEvent.keyDown(window, { key: word[done] });
      } else {
        await vi.advanceTimersByTimeAsync(50);
      }
    }
    expect(pageText(app)).toContain("you beat the ghost!");

    const raw = JSON.parse(
      window.localStorage.getItem(GHOST_GP_STATS_KEY) ?? "{}",
    ) as { races: number; winsVsGhost: number; ghostsRaced: { wpm: number }[] };
    expect(raw.races).toBe(1);
    expect(raw.winsVsGhost).toBe(1);
    expect(raw.ghostsRaced[0]?.wpm).toBe(60);
  });

  it("starting without any record stays on the picker with a clear message", async () => {
    const app = await openGhostGp();
    await startRace(app);

    expect(pageText(app)).toContain(
      "run a test first — the ghost needs a record",
    );
    expect(pageText(app)).toContain("start race"); //still the picker
    expect(window.localStorage.getItem(GHOST_GP_STATS_KEY)).toBeNull();
  });

  it("a window blur during the race voids it without recording", async () => {
    setLastResult(makeResult({ wpm: 60, language: "english" }));
    const app = await openGhostGp();
    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pageText(app)).toContain("race void");
    expect(pageText(app)).toContain("start race"); //back at the picker
    expect(window.localStorage.getItem(GHOST_GP_STATS_KEY)).toBeNull();
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

const GP_SEED = 42;
const GP_WORDS = ["ab", "cd", "ef", "gh", "ij"];

/** arms a host-side ghost-gp match against P2 and starts the countdown */
async function armOnlineGp(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/ghost-gp" });
  await app.settle();
  vi.useFakeTimers();
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "ghost-gp",
      seed: GP_SEED,
      params: { lang: "english", words: GP_WORDS.length },
    },
  });
  await vi.advanceTimersByTimeAsync(50); //the stream builds (fallback pool)
  await vi.advanceTimersByTimeAsync(2800); //countdown 3-2-1 -> the race
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}

/** types the whole online race word by word */
async function typeOnlineRace(app: App): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    if (pageText(app).includes("waiting for P2")) break;
    const word = currentWord(app);
    const done = typedPart(app).length;
    if (word !== "" && done < word.length) {
      fireEvent.keyDown(window, { key: word[done] });
    } else {
      await vi.advanceTimersByTimeAsync(50);
    }
  }
}

describe("ghost gp online (online wave, phase 8)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetGhostGpStatsForTests();
    setLastResult(undefined);
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races the peer: banner, relay, awaiting, win", async () => {
    const { app, invokes } = await armOnlineGp();
    expect(pageText(app)).toContain("online vs P2");
    expect(currentWord(app)).not.toBe("");

    await typeOnlineRace(app);
    //the finish was relayed and the verdict waits for the peer
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
    const winFinish = finishes[0]?.args["message"] as
      | Record<string, unknown>
      | undefined;
    expect(winFinish?.["finishMs"]).not.toBeNull();
    const progresses = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "progress",
    );
    expect(progresses.length).toBeGreaterThanOrEqual(1);

    //the peer finished much later -> I win, with a margin cell shown
    handleLanPeerMessage({ type: "finished", finishMs: 9_999_999, acc: 88 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("margin");
    //online matches never touch the local ghost stats
    expect(window.localStorage.getItem(GHOST_GP_STATS_KEY)).toBeNull();
  });

  it("the peer crossing first ends the race as a loss", async () => {
    const { app, invokes } = await armOnlineGp();
    expect(currentWord(app)).not.toBe("");

    //finishMs 0: the engine judges at >= finishMs on the very next tick
    handleLanPeerMessage({ type: "finished", finishMs: 0, acc: 90 });
    await vi.advanceTimersByTimeAsync(60); //a tick judges the crossing

    expect(pageText(app)).toContain("P2 wins");
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

  it("a disconnect during the race voids it", async () => {
    const { app, fire } = await armOnlineGp();
    expect(currentWord(app)).not.toBe("");

    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(0);

    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start race"); //back at the picker
  });
});
