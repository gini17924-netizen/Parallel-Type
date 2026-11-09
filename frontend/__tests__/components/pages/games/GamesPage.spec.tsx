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
  _resetWordBlastScoresForTests,
  WORD_BLAST_SCORES_KEY,
} from "../../../../src/ts/utils/word-blast-scores";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

const SCORES_KEY = WORD_BLAST_SCORES_KEY;

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

async function openGames(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/word-blast" }); //moved to a sub-route when the games hub became a picker (idea G24)
  await app.settle();
  return app;
}

function startButton(app: App): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("start game"),
  );
}

/** the first falling word's full text (typed part + the rest) */
function spawnedWord(app: App): string | undefined {
  return (
    app.container.querySelector(
      '[aria-label="word blast arena"] .absolute.font-mono',
    )?.textContent ?? undefined
  );
}

/**
 * The word the game's handler would actually target: a started word first,
 * else the bottom-most one (largest top). Typing anything else desyncs from
 * the handler's selection once two words share the field.
 */
function handlerTarget(app: App): string | undefined {
  const words = [
    ...app.container.querySelectorAll(
      '[aria-label="word blast arena"] .absolute.font-mono',
    ),
  ];
  if (words.length === 0) return undefined;
  const started = words.find(
    (el) => (el.querySelector(".text-main")?.textContent ?? "") !== "",
  );
  if (started !== undefined) return started.textContent ?? undefined;
  let best: Element | undefined;
  let bestTop = -1;
  for (const el of words) {
    const top = parseFloat((el as HTMLElement).style.top);
    if (top > bestTop) {
      bestTop = top;
      best = el;
    }
  }
  return best?.textContent ?? undefined;
}

/** types one keystroke at the handler's target word's next position */
function typeHandlerTarget(app: App): void {
  const target = handlerTarget(app);
  if (target === undefined) return;
  const el = [
    ...app.container.querySelectorAll(
      '[aria-label="word blast arena"] .absolute.font-mono',
    ),
  ].find((candidate) => candidate.textContent === target);
  const done = el?.querySelector(".text-main")?.textContent?.length ?? 0;
  if (done < target.length) {
    fireEvent.keyDown(window, { key: target[done] });
  }
}

function typeText(app: App, text: string): void {
  for (const ch of text) {
    fireEvent.keyDown(window, { key: ch });
  }
}

function hud(app: App, testId: string): string {
  return (
    app.container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ""
  );
}

async function startGame(app: App): Promise<void> {
  vi.useFakeTimers();
  startButton(app)?.click();
  //flush start()'s async word-list fetch (it fails offline and falls back)
  await vi.advanceTimersByTimeAsync(50);
}

describe("GamesPage score persistence (KI-21)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    //drop the memoized store cache so every test reads fresh storage
    _resetWordBlastScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupApp();
  });

  it("shows the stored best beside the difficulty picker", async () => {
    window.localStorage.setItem(
      SCORES_KEY,
      JSON.stringify({
        best: { normal: { at: 1, difficulty: "normal", score: 500, wpm: 90 } },
        history: [],
      }),
    );
    const app = await openGames();
    expect(pageText(app)).toContain("best (normal): 500");
    //no game has been played: the seeded store is untouched
    expect(storedScores().history).toHaveLength(0);
  });

  it("records the finished game exactly once and announces the new record", async () => {
    const app = await openGames();

    const startBtn = startButton(app);
    expect(startBtn).toBeDefined();

    vi.useFakeTimers();
    startBtn?.click();
    //flush start()'s async word-list fetch (it fails offline and falls back)
    await vi.advanceTimersByTimeAsync(50);

    //let the game run (spawn/tick intervals) until all lives are gone —
    //no typing, so words reach the bottom and end() fires from the tick loop
    for (let i = 0; i < 400; i++) {
      if (pageText(app).includes("game over")) break;
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(pageText(app)).toContain("game over");
    expect(pageText(app)).toContain("new record!");
    //end() must record exactly once: a single history entry, one best
    const scores = storedScores();
    expect(scores.history).toHaveLength(1);
    expect(Object.keys(scores.best ?? {})).toContain("normal");
    //the overlay best reflects the recorded game
    expect(pageText(app)).toContain("best:");
  });

  it("switching difficulty refreshes the best badge", async () => {
    window.localStorage.setItem(
      SCORES_KEY,
      JSON.stringify({
        best: {
          easy: { at: 1, difficulty: "easy", score: 120, wpm: 40 },
          hard: { at: 2, difficulty: "hard", score: 700, wpm: 110 },
        },
        history: [],
      }),
    );
    const app = await openGames();
    expect(pageText(app)).toContain("best (normal): —");
    const hardButton = [...app.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "hard",
    );
    expect(hardButton).toBeDefined();
    hardButton?.click();
    expect(pageText(app)).toContain("best (hard): 700");
  });
});

describe("word blast v2 wiring (idea G1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetWordBlastScoresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupApp();
  });

  it("scores a completed word with the base multiplier and shows the combo", async () => {
    const app = await openGames();
    await startGame(app);

    const word = spawnedWord(app);
    expect(word).toBeDefined();
    typeText(app, word ?? "");

    //combo 1 -> mult 1: the word is worth len x 10, accuracy 100%
    expect(hud(app, "wb-score")).toBe(String((word ?? "").length * 10));
    expect(hud(app, "wb-combo")).toBe("x1");
    expect(hud(app, "wb-acc")).toBe("100%");
  });

  it("a wrong key breaks the combo and the accuracy drops", async () => {
    const app = await openGames();
    await startGame(app);

    const word = spawnedWord(app) ?? "";
    typeText(app, word.slice(0, 1)); //one correct char
    fireEvent.keyDown(window, { key: "!" }); //wrong: not the expected char
    expect(hud(app, "wb-combo")).toBe("x0");
    expect(hud(app, "wb-acc")).toBe("50%");

    //finish the word: the combo regrows, the score pays the base multiplier
    typeText(app, word.slice(1));
    expect(hud(app, "wb-score")).toBe(String(word.length * 10));
    expect(hud(app, "wb-combo")).toBe("x1");
  });

  it("crossing a level spawns the guaranteed boss word", async () => {
    const app = await openGames();
    await startGame(app);

    //type the handler's own target until the score crosses the levelStep
    //(500): the level-up must materialize as the guaranteed boss word
    for (let guard = 0; guard < 160; guard++) {
      if (app.container.querySelector('[data-testid="wb-boss"]') !== null) {
        break;
      }
      if (handlerTarget(app) !== undefined) {
        typeHandlerTarget(app);
      } else {
        await vi.advanceTimersByTimeAsync(300);
      }
      await vi.advanceTimersByTimeAsync(0);
    }
    const boss = app.container.querySelector('[data-testid="wb-boss"]');
    expect(boss).not.toBeNull();
    //the boss is a multi-word phrase on normal difficulty, falling slower
    expect(boss?.textContent).toContain(" ");
  });

  it("the HUD names the heart word while one is in the queue (KI-32)", async () => {
    //pin the rng to 0: every 40th-spawn window (the doc's
    //heartEveryNSpawns) then rolls a guaranteed heart; easy difficulty
    //keeps bosses single-word and the falls slow while the loop types
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const app = await openGames();
      const easy = [...app.container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("easy"),
      );
      easy?.click();
      await startGame(app);

      //keep the field clear by typing the handler's target AND advance the
      //clock every guard: the spawn windows live on the spawn timer's own
      //schedule (>=900ms apart), so typing alone never reaches the 40th
      for (let guard = 0; guard < 800; guard++) {
        if (
          app.container.querySelector('[data-testid="wb-heart-next"]') !== null
        ) {
          break;
        }
        if (handlerTarget(app) !== undefined) {
          typeHandlerTarget(app);
        }
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(0);
      }
      const heart = app.container.querySelector(
        '[data-testid="wb-heart-next"]',
      );
      expect(heart, `diag: ${pageText(app).slice(0, 240)}`).not.toBeNull();
      expect(heart?.textContent).toContain("heart word:");
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("records maxCombo and accuracy with the game (v2 history)", async () => {
    const app = await openGames();
    await startGame(app);

    const word = spawnedWord(app) ?? "";
    typeText(app, word.slice(0, -1)); //all but the last char
    fireEvent.keyDown(window, { key: "!" }); //wrong key while the word is live
    typeText(app, word.slice(-1)); //finish it: the combo regrows to 1

    //end the game: stop typing, let the words drain the lives
    for (let i = 0; i < 400; i++) {
      if (pageText(app).includes("game over")) break;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(pageText(app)).toContain("game over");
    const scores = storedScores();
    const entry = scores.history[0] as {
      maxCombo?: number;
      accuracy?: number;
    };
    expect(entry?.maxCombo).toBe(1);
    const correct = (word ?? "").length;
    expect(entry?.accuracy).toBe(Math.round((correct / (correct + 1)) * 100));
  });
});

function storedScores(): {
  best: Record<string, unknown>;
  history: unknown[];
} {
  return JSON.parse(window.localStorage.getItem(SCORES_KEY) ?? "{}") as {
    best: Record<string, unknown>;
    history: unknown[];
  };
}

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

/** types the displayed word's chars until the horn or the verdict */
async function raceToHorn(app: App): Promise<void> {
  for (let guard = 0; guard < 3000; guard++) {
    //the horn's awaiting overlay or the verdict both end the race
    if (
      app.container.querySelector('[data-testid="wb-awaiting"]') !== null ||
      app.container.querySelector('[data-testid="wb-verdict"]') !== null
    ) {
      return;
    }
    //the falling word: type the one with a typed prefix, else the lowest
    const words = [...app.container.querySelectorAll("div.absolute.font-mono")];
    const target =
      words.find(
        (el) => (el.querySelector(".text-main")?.textContent ?? "").length > 0,
      ) ?? words[0];
    if (target === undefined) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    const full = target.textContent ?? "";
    const done = (target.querySelector(".text-main")?.textContent ?? "").length;
    const ch = full[done] ?? "a";
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ch, code: `Key${ch.toUpperCase()}` }),
    );
    console.log("DISPATCHED", guard, JSON.stringify(ch));
    if (guard % 10 === 0 || guard < 8) {
      console.log(
        "RACE-DEBUG",
        guard,
        JSON.stringify({
          awaiting:
            app.container.querySelector('[data-testid="wb-awaiting"]') !== null,
          words: words.length,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 60));
    console.log("SLEPT", guard);
  }
  console.log("LOOP-EXITED");
}

describe("word blast online (online wave, phase 20)", () => {
  beforeEach(() => {
    vi.useRealTimers(); //the offline tests leave fake timers behind
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetWordBlastScoresForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races to the horn: banner, relay, verdict, win", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openGames();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "word-blast",
        seed: 42,
        params: { lang: "english", difficulty: "normal", durationMs: 3000 },
      },
    });
    await new Promise((r) => setTimeout(r, 150)); //the seeded run starts
    expect(pageText(app)).toContain("online vs P2");
    vi.useRealTimers(); //belt and braces: the horn must fire in real time
    await new Promise((r) => setTimeout(r, 60));
    expect(pageText(app)).toContain("same stream, 90s");

    //type until the horn fires (3s)
    await raceToHorn(app);
    expect(
      app.container.querySelector('[data-testid="wb-awaiting"]'),
    ).not.toBeNull(); //the score is locked — waiting for the peer's horn
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer's horn result lands -> the verdict compares the scores
    handleLanPeerMessage({ type: "finished", finishMs: 3000, acc: 95 });
    await new Promise((r) => setTimeout(r, 80));
    expect(
      app.container.querySelector('[data-testid="wb-verdict"]'),
    ).not.toBeNull();
    expect(window.localStorage.getItem(WORD_BLAST_SCORES_KEY)).toBeNull();
  });

  it("the peer's horn result resolves my awaiting verdict as a loss", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openGames();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "word-blast",
        seed: 42,
        params: { lang: "english", difficulty: "normal", durationMs: 3000 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    //the peer's horn: a big final score lands before mine
    handleLanPeerMessage({
      type: "progress",
      gameId: "word-blast",
      state: { score: 5000, combo: 20 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 3000, acc: 95 });
    await new Promise((r) => setTimeout(r, 60));

    await raceToHorn(app);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the game voids it", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = await openGames();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "word-blast",
        seed: 42,
        params: { lang: "english", difficulty: "normal", durationMs: 3000 },
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    tauri.fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    expect(window.localStorage.getItem(WORD_BLAST_SCORES_KEY)).toBeNull();
  });
});
