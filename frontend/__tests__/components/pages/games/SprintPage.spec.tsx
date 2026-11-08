import "fake-indexeddb/auto";
import { fireEvent } from "@solidjs/testing-library";
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
  _resetSprintStatsForTests,
  SPRINT_STATS_KEY,
} from "../../../../src/ts/utils/sprint/sprint-stats";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openSprint(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/sprint" });
  await app.settle();
  return app;
}

function currentWord(app: App): string {
  return (
    app.container.querySelector('[data-testid="sp-word"]')?.textContent ?? ""
  );
}

/** the already-typed head of the current word (the main-colored span) */
function typedPart(app: App): string {
  return (
    app.container.querySelector('[data-testid="sp-word"] > .text-main')
      ?.textContent ?? ""
  );
}

/** a real-clock wait: the page's own tick interval runs on real timers */
async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

//the controlled clock: the page measures elapsed time with
//performance.now(), so the spy IS the test's time machine (shared by
//the offline and the online describes — module scope for the helpers)
let fakeNow: number;
let nowSpy: ReturnType<typeof vi.spyOn>;

describe("sprint page (idea G5 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSprintStatsForTests();
    fakeNow = 1000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    (nowSpy as { mockRestore: () => void }).mockRestore();
    cleanupApp();
  });

  it("idle screen renders the modes, the best and the false-start warning", async () => {
    const app = await openSprint();
    const text = pageText(app);
    expect(text).toContain("start attempt");
    expect(text).toContain("daily sprint");
    expect(text).toContain("a key before GO voids the attempt");
    expect(text).toContain("best (english): —");
  });

  it("a completed sprint shows the exact metrics and records them", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120); //the word list resolves (fallback) and the engine arms

    //past any arming delay (max 3000): the race is running
    fakeNow = 5000;
    await waitMs(120);
    expect(currentWord(app), `diag: ${pageText(app).slice(0, 260)}`).not.toBe(
      "",
    );

    //85 correct characters at a steady 50ms cadence: the doc's exact metric
    for (let i = 0; i < 85; i++) {
      fakeNow += 50;
      const word = currentWord(app);
      const done = typedPart(app).length;
      if (done < word.length) {
        fireEvent.keyDown(window, { key: word[done] });
      } else {
        fireEvent.keyDown(window, { key: word[0] });
      }
    }
    //flip the clock past the window: the tick finishes and records
    fakeNow += 11000;
    await waitMs(150);
    expect(pageText(app)).toContain("wpm");

    //the doc's exact math: 85 characters -> wpm 102
    expect(pageText(app)).toContain("102");
    const raw = JSON.parse(
      window.localStorage.getItem(SPRINT_STATS_KEY) ?? "{}",
    ) as {
      history: { wpm: number }[];
      bestByLang: Record<string, { wpm: number }>;
    };
    expect(raw.history).toHaveLength(1);
    expect(raw.history[0]?.wpm).toBe(102);
    expect(raw.bestByLang["english"]?.wpm).toBe(102);
  });

  it("the result screen offers the doc's simple share to the clipboard (KI-31)", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => undefined,
    );
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeText },
      configurable: true,
    });
    try {
      const app = await openSprint();
      button(app, "start attempt")?.click();
      await waitMs(120);
      fakeNow = 5000;
      await waitMs(120);
      //85 correct characters: the same exact-metric flow as the test above
      for (let i = 0; i < 85; i++) {
        fakeNow += 50;
        const word = currentWord(app);
        const done = typedPart(app).length;
        if (done < word.length) {
          fireEvent.keyDown(window, { key: word[done] });
        } else {
          fireEvent.keyDown(window, { key: word[0] });
        }
      }
      fakeNow += 11000;
      await waitMs(150);

      expect(pageText(app)).toContain("share result");
      button(app, "share result")?.click();
      await waitMs(40);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]?.[0] ?? "").toMatch(
        /^ParallelType ten-second sprint: 102 wpm · raw 85 · acc 100% · \d+ words · english$/,
      );
      expect(pageText(app)).toContain("copied!");
    } finally {
      if (original) {
        Object.defineProperty(navigator, "clipboard", original);
      } else {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it("typing the displayed word grows the typed prefix (KI-35/KI-36)", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120);
    fakeNow = 5000;
    await waitMs(120);
    //KI-35: the displayed word must BE the engine's expected word
    const word = currentWord(app);
    expect(word).not.toBe("");
    for (const ch of word.slice(0, 3)) {
      fakeNow += 50;
      fireEvent.keyDown(window, { key: ch });
    }
    await waitMs(60);
    //KI-36: the typed prefix is rendered from a live snapshot, not a
    //mount-time capture
    expect(typedPart(app)).toBe(word.slice(0, 3));
  });

  it("a pre-GO key is a false start and voids the attempt", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120); //armed; GO is at least 800ms away (fakeNow 1000+1200)

    fireEvent.keyDown(window, { key: "a" }); //before GO: false start
    expect(pageText(app)).toContain("false start! attempt void");
    expect(pageText(app)).toContain("start attempt"); //back at the idle screen
    expect(window.localStorage.getItem(SPRINT_STATS_KEY)).toBeNull();
  });

  it("a window blur during the sprint voids the attempt", async () => {
    const app = await openSprint();
    button(app, "start attempt")?.click();
    await waitMs(120);
    fakeNow = 5000; //past any arming delay: the race is running
    await waitMs(120);
    expect(currentWord(app)).not.toBe("");

    window.dispatchEvent(new Event("blur"));
    await waitMs(60);

    expect(pageText(app)).toContain("attempt void — the window lost focus");
    expect(pageText(app)).toContain("start attempt"); //back at the idle screen
    expect(window.localStorage.getItem(SPRINT_STATS_KEY)).toBeNull();
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

const SPRINT_SEED = 42;

/** arms a host-side sprint match against P2 and returns the recorded invokes */
async function armOnlineSprint(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = await openSprint();
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "sprint",
      seed: SPRINT_SEED,
      params: { lang: "english", words: 60 },
    },
  });
  await waitMs(200); //the stream builds (fallback pool) and the engine arms
  fakeNow = 5000; //past any arming delay: the race is running
  await waitMs(120);
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}

/** types `count` correct characters at a steady cadence */
async function typeChars(app: App, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    fakeNow += 50;
    const word = currentWord(app);
    const done = typedPart(app).length;
    if (word !== "" && done < word.length) {
      fireEvent.keyDown(window, { key: word[done] });
    } else {
      fireEvent.keyDown(window, { key: word[0] ?? "a" });
    }
  }
}

describe("sprint online (online wave, phase 6)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetSprintStatsForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
    fakeNow = 1000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    (nowSpy as { mockRestore: () => void }).mockRestore();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races the peer: banner, live relay, awaiting, win", async () => {
    const { app, invokes } = await armOnlineSprint();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("wait for GO");
    expect(currentWord(app)).not.toBe("");

    await typeChars(app, 85);
    //the live progress was relayed while running
    const progresses = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "progress",
    );
    expect(progresses.length).toBeGreaterThanOrEqual(1);

    //the horn: the finish lands and the verdict waits for the peer
    fakeNow += 11000;
    await waitMs(150);
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
    expect(winFinish?.["finishMs"]).toBe(10000);

    //the peer finished weaker -> I win; nothing touched the local stats
    handleLanPeerMessage({ type: "finished", finishMs: 10000, acc: 80 });
    await waitMs(80);
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("opponent words");
    expect(window.localStorage.getItem(SPRINT_STATS_KEY)).toBeNull();
  });

  it("the peer's earlier finish resolves the horn immediately as a loss", async () => {
    const { app, invokes } = await armOnlineSprint();
    expect(currentWord(app)).not.toBe("");

    //the peer finished first (their final state + the generic finish)
    handleLanPeerMessage({
      type: "progress",
      gameId: "sprint",
      state: { words: 999, chars: 4999 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 10000, acc: 90 });
    await waitMs(80);

    fakeNow += 11000; //my horn: their finish is already known
    await waitMs(150);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the race voids it", async () => {
    const { app, fire } = await armOnlineSprint();
    expect(currentWord(app)).not.toBe("");

    fire("lan://peer-left", { reason: "disconnected" });
    await waitMs(80);

    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start attempt"); //back at the idle screen
  });

  it("a false start online tells the peer the race ended", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openSprint();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "sprint",
        seed: SPRINT_SEED,
        params: { lang: "english", words: 60 },
      },
    });
    await waitMs(200); //armed at fakeNow 1000 — GO is at least 800ms away
    fireEvent.keyDown(window, { key: "a" }); //before GO: false start

    expect(pageText(app)).toContain("the opponent takes the win");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
    const voidFinish = finishes[0]?.args["message"] as
      | Record<string, unknown>
      | undefined;
    expect(voidFinish?.["finishMs"]).toBeNull();
  });

  it("the host's rematch re-arms both sides with the same seed", async () => {
    const { app, invokes } = await armOnlineSprint();
    await typeChars(app, 85);
    fakeNow += 11000;
    await waitMs(150);
    expect(pageText(app)).toContain("waiting for P2");
    handleLanPeerMessage({ type: "finished", finishMs: 10000, acc: 80 });
    await waitMs(80);
    expect(pageText(app)).toContain("you win!");

    button(app, "rematch")?.click();
    await waitMs(250);
    //the host re-sent the same start (one start invoke — the arm was local)
    const starts = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] === "start",
    );
    expect(starts).toHaveLength(1);
    const message = starts[0]?.args["message"] as Record<string, unknown>;
    expect(message["seed"]).toBe(SPRINT_SEED);
    expect(pageText(app)).toContain("wait for GO");
  });
});
