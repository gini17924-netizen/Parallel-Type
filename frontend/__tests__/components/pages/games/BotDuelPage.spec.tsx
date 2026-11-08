import { fireEvent } from "@solidjs/testing-library";
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
  _resetBotDuelStatsForTests,
  BOT_DUEL_STATS_KEY,
} from "../../../../src/ts/utils/bot-duel/duel-store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openBotDuel(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/bot-duel" });
  await app.settle();
  return app;
}

function currentWord(app: App): string {
  return (
    app.container.querySelector('[data-testid="bd-word"]')?.textContent ?? ""
  );
}

/** the already-typed head of the current word (the main-colored span) */
function typedPart(app: App): string {
  return (
    app.container.querySelector('[data-testid="bd-word"] > .text-main')
      ?.textContent ?? ""
  );
}

async function startRace(app: App): Promise<void> {
  vi.useFakeTimers();
  button(app, "start race")?.click();
  await vi.advanceTimersByTimeAsync(50); //the word list resolves (fallback)
  await vi.advanceTimersByTimeAsync(2800); //countdown 3-2-1 -> the duel
}

describe("bot duel page (idea G2 phase 3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetBotDuelStatsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupApp();
  });

  it("picker renders the bot tiers and the race lengths", async () => {
    const app = await openBotDuel();
    const text = pageText(app);
    expect(text).toContain("bot speed (wpm)");
    expect(text).toContain("140 is endgame");
    expect(text).toContain("start race");
    for (const tier of ["40", "60", "80", "100", "120", "140"]) {
      expect(text).toContain(tier);
    }
    for (const length of ["quick", "standard", "long"]) {
      expect(text).toContain(length);
    }
  });

  it("a race won by typing ends in the result overlay and records stats", async () => {
    const app = await openBotDuel();
    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    //type whatever the current word shows until the race is won
    for (let guard = 0; guard < 400; guard++) {
      if (pageText(app).includes("you win!")) break;
      const word = currentWord(app);
      const done = typedPart(app).length;
      if (word !== "" && done < word.length) {
        fireEvent.keyDown(window, { key: word[done] });
      } else {
        await vi.advanceTimersByTimeAsync(50);
      }
    }
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("rematch (same words)");

    //the result reached the store: a won race on the 60wpm tier
    const raw = JSON.parse(
      window.localStorage.getItem(BOT_DUEL_STATS_KEY) ?? "{}",
    ) as {
      history: { result: string }[];
      byTier: Record<string, { wins: number }>;
    };
    expect(raw.history).toHaveLength(1);
    expect(raw.history[0]?.result).toBe("won");
    expect(raw.byTier["60"]?.wins).toBe(1);
  });

  it("a window blur during the duel voids the race without recording", async () => {
    const app = await openBotDuel();
    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pageText(app)).toContain("race void");
    expect(pageText(app)).toContain("start race"); //back at the picker
    expect(window.localStorage.getItem(BOT_DUEL_STATS_KEY)).toBeNull();
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
            name: (args?.["name"] as string) ?? "P1",
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

const ONLINE_WORDS = ["ab", "cd", "ef", "gh", "ij"];

/** arms a host-side match against P2 and returns the recorded invokes */
async function armOnlineMatch(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" }); //connected
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/bot-duel" });
  await app.settle();
  vi.useFakeTimers();
  armLanMatch({
    role: "host",
    peerName: "P2",
    gameId: "bot-duel",
    words: ONLINE_WORDS,
  });
  await vi.advanceTimersByTimeAsync(0); //the match effect -> countdown
  await vi.advanceTimersByTimeAsync(2800); //countdown -> duel
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

describe("bot duel online (LAN phase 4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetBotDuelStatsForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races the peer: banner, progress relay, awaiting", async () => {
    const { app, invokes } = await armOnlineMatch();
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

    //the peer finishes much later -> I win, with a margin cell shown
    handleLanPeerMessage({ type: "finished", finishMs: 9_999_999, acc: 88 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("margin");
    //online matches never touch the local duel stats
    expect(window.localStorage.getItem(BOT_DUEL_STATS_KEY)).toBeNull();
  });

  it("the peer crossing first ends the race as a loss", async () => {
    const { app, invokes } = await armOnlineMatch();
    expect(currentWord(app)).not.toBe("");

    //finishMs 0: the engine judges at >= finishMs on the very next tick
    //(elapsed is never negative), regardless of the clock
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

  it("the host's rematch re-arms both sides with the same words", async () => {
    const { app, invokes } = await armOnlineMatch();
    await typeOnlineRace(app);
    expect(pageText(app)).toContain("waiting for P2");
    handleLanPeerMessage({ type: "finished", finishMs: 9_999_999, acc: 88 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pageText(app)).toContain("you win!");

    const rematchBtn = [...app.container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("rematch"),
    );
    rematchBtn?.click();
    await vi.advanceTimersByTimeAsync(0);
    //the host re-sent the start (the original arm was a local call) and
    //the countdown runs again
    const starts = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] === "start",
    );
    expect(starts).toHaveLength(1);
    const rematchStart = starts[0]?.args["message"] as
      | Record<string, unknown>
      | undefined;
    expect(rematchStart?.["words"]).toEqual(ONLINE_WORDS);
    expect(pageText(app)).toContain("get ready");
    await vi.advanceTimersByTimeAsync(2800);
    expect(currentWord(app)).not.toBe("");
  });

  it("a disconnect during the race voids it", async () => {
    const { app, fire } = await armOnlineMatch();
    expect(currentWord(app)).not.toBe("");

    fire("lan://peer-left", { reason: "disconnected" });
    await vi.advanceTimersByTimeAsync(0);

    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start race"); //back at the picker
  });
});
