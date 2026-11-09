import "fake-indexeddb/auto";
import { fireEvent } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  computeWordlePools,
  pickAnswer,
} from "../../../../src/ts/utils/wordle/wordle-engine";
import {
  _resetWordleStoresForTests,
  wordleDayKey,
  WORDLE_LANGS,
  wordleStatsKey,
  wordleStateKey,
} from "../../../../src/ts/utils/wordle/wordle-store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

const FALLBACK_WORDS = ["crane", "apple", "level", "eeler", "brine", "adobe"];

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openWordle(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/wordle" });
  await app.settle();
  await new Promise((resolve) => setTimeout(resolve, 60)); //the pools load
  return app;
}

function typeGuess(app: App, word: string): void {
  for (const ch of word) {
    fireEvent.keyDown(window, { key: ch });
  }
  fireEvent.keyDown(window, { key: "Enter" });
}

describe("wordle page (idea G4 phase 2)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetWordleStoresForTests();
  });

  afterEach(() => {
    cleanupApp();
  });

  it("renders the grid, the keyboard and the language picker", async () => {
    const app = await openWordle();
    const text = pageText(app);
    expect(text).toContain("one daily 5-letter puzzle per language");
    expect(text).toContain("فارسی");
    expect(text).toContain("english");
    //the virtual keyboard renders letter keys
    expect(
      app.container.querySelectorAll('[aria-label="wordle keyboard"] button')
        .length,
    ).toBeGreaterThan(20);
  });

  it("a winning guess fills the grid, the stats and offers the share", async () => {
    const app = await openWordle();

    //the answer is the pure pick over the page's fallback pool — the test
    //replicates it (the same dayKey convention and the same fallback list)
    const pools = computeWordlePools(FALLBACK_WORDS, FALLBACK_WORDS);
    const answer = pickAnswer(
      pools.answers,
      wordleDayKey(Date.now()),
      "en",
    ) as string;

    typeGuess(app, answer);

    const text = pageText(app);
    expect(text).toContain("solved!");
    expect(text).toContain("share result");
    //KI-29: the stats line must reflect the just-recorded win immediately —
    //the raw keydown listener renders synchronously, so the record has to
    //land before the result section reads the store
    expect(text).toMatch(/played 1 · won 1 · streak 1 \(max 1\)/);

    const raw = JSON.parse(
      window.localStorage.getItem(wordleStateKey("en")) ?? "{}",
    ) as { guesses: string[]; finished: string };
    expect(raw.guesses).toEqual([answer]);
    expect(raw.finished).toBe("won");
  });

  it("rejects a guess that is not in the word list", async () => {
    const app = await openWordle();
    typeGuess(app, "zzzzz");
    expect(pageText(app)).toContain("not in word list");
    //the rejected guess never entered the puzzle state
    const raw = JSON.parse(
      window.localStorage.getItem(wordleStateKey("en")) ?? "{}",
    ) as { guesses: string[] };
    expect(raw.guesses ?? []).toHaveLength(0);
  });

  it("switching to فارسی loads its own isolated state", async () => {
    const app = await openWordle();
    button(app, "فارسی")?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    //the fa keyboard renders Persian letter keys
    const text = pageText(app);
    expect(text).toContain("فارسی");
    //the en state stays where it was (nothing recorded: both empty)
    for (const lang of WORDLE_LANGS) {
      expect(window.localStorage.getItem(wordleStateKey(lang))).toBeNull();
    }
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

async function armOnlineWordle(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/wordle" });
  await app.settle();
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "wordle",
      seed: 42,
      params: { lang: "english", mode: "en" },
    },
  });
  await new Promise((r) => setTimeout(r, 120)); //the pools load, the answer locks
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}

/** submits guesses (Enter after each word) until the verdict appears */
async function submitGuesses(app: App, words: string[]): Promise<void> {
  for (const word of words) {
    if (app.container.querySelector('[data-testid="wd-verdict"]') !== null) {
      return;
    }
    for (const ch of word) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ch,
          code: `Key${ch.toUpperCase()}`,
        }),
      );
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await new Promise((r) => setTimeout(r, 40));
  }
  //wait for the verdict (the horn-less race ends when both report)
  for (let guard = 0; guard < 100; guard++) {
    if (app.container.querySelector('[data-testid="wd-verdict"]') !== null) {
      return;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("wordle online (online wave, phase 28)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races the answer: banner, relay, awaiting", async () => {
    const { app, invokes } = await armOnlineWordle();
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("fewer guesses wins");
    //the online guesses are session-only: the daily state is untouched
    expect(pageText(app)).toContain("0 guesses");

    //submit two wrong guesses (the valid list needs real words) — the
    //relay fires per guess
    await submitGuesses(app, ["crane", "apple"]);
    const progresses = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "progress",
    );
    expect(progresses.length).toBeGreaterThanOrEqual(1);
    expect(pageText(app)).toContain("2 guesses");

    //my finish: the answer lives in this pool, so the six words solve or
    //exhaust it either way — the finish ships either way
    await submitGuesses(app, ["level", "eeler", "brine", "adobe"]);
    expect(
      app.container.querySelector('[data-testid="wd-awaiting"]'),
    ).not.toBeNull();
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer's horn: a weaker result (more guesses) -> I win
    handleLanPeerMessage({
      type: "progress",
      gameId: "wordle",
      state: { guesses: 6, solved: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 999_999, acc: 100 });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("guesses · solved");
    //online never touches the local wordle stats
    expect(window.localStorage.getItem(wordleStatsKey("en"))).toBeNull();
  });

  it("the peer's earlier finish resolves my solve as a loss", async () => {
    const { app, invokes } = await armOnlineWordle();
    //the peer solved in 2 guesses while I am still on the board
    handleLanPeerMessage({
      type: "progress",
      gameId: "wordle",
      state: { guesses: 2, solved: 1 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 60_000, acc: 100 });
    await new Promise((r) => setTimeout(r, 60));

    //my solve exhausts the guesses -> fewer peer guesses wins
    await submitGuesses(app, [
      "crane",
      "apple",
      "level",
      "eeler",
      "brine",
      "adobe",
    ]);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the solve voids it", async () => {
    const { app, fire } = await armOnlineWordle();
    fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    //the puzzle stays playable — the board and keyboard still render
    expect(
      app.container.querySelectorAll('[aria-label="wordle keyboard"] button')
        .length,
    ).toBeGreaterThan(20);
    expect(window.localStorage.getItem(wordleStatsKey("en"))).toBeNull();
  });
});
