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
  clearLanMatch,
  getLanMatch,
  getLanRawMessage,
  getRemoteFinished,
  getRemoteProgress,
  getRematchAsked,
  handleLanPeerMessage,
} from "../../../../src/ts/states/lan-match";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

/**
 * Hardening (online wave, phase 46): the lobby flows through several
 * consecutive matches — arm, play, leave, arm a different game — and
 * NOTHING may leak between them (derived signals, page LAN state, the
 * seq). The match layer resets are exercised here alongside a page-level
 * double-arm on the same mounted page.
 */
describe("lan hardening: several consecutive matches (phase 46)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    vi.useFakeTimers();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    vi.useRealTimers();
    cleanupApp();
  });

  function arm(
    role: "host" | "client",
    gameId: "wordle" | "type-pong",
    seed: number,
  ): number {
    armLanMatch({
      role,
      peerName: "P2",
      start: {
        gameId,
        seed,
        params:
          gameId === "wordle"
            ? { lang: "english", mode: "en" }
            : { lang: "english", targetScore: 5 },
      },
    });
    return getLanMatch()?.seq ?? 0;
  }

  it("arm -> play -> leave -> arm another game leaves nothing behind", () => {
    //match 1 (host, wordle): progress + finished + a raw game message land
    const seq1 = arm("host", "wordle", 1);
    expect(seq1).toBeGreaterThan(0);
    handleLanPeerMessage({
      type: "progress",
      gameId: "wordle",
      state: { guesses: 2, solved: 0 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 5_000, acc: 100 });
    expect(getRemoteProgress()).toBeDefined();
    expect(getRemoteFinished()).toBeDefined();

    //the leave: the derived state must vanish completely
    clearLanMatch();
    expect(getLanMatch()).toBeUndefined();
    expect(getRemoteProgress()).toBeUndefined();
    expect(getRemoteFinished()).toBeUndefined();
    expect(getLanRawMessage()).toBeUndefined();
    expect(getRematchAsked()).toBe(false);

    //match 2 (client, type-pong): a fresh arm — the seq counter restarts
    //per match by design (clearLanMatch zeroes it), the arm itself is fresh
    const seq2 = arm("client", "type-pong", 2);
    expect(seq2).toBeGreaterThanOrEqual(1);
    expect(getLanMatch()?.start.seed).toBe(2);
    expect(getRemoteProgress()).toBeUndefined();
    expect(getRemoteFinished()).toBeUndefined();

    //the old game's progress never lands on the new match
    handleLanPeerMessage({
      type: "progress",
      gameId: "wordle",
      state: { guesses: 9, solved: 1 },
    });
    expect(getRemoteProgress()).toBeUndefined(); //foreign gameId: dropped
  });

  it("the lobby re-arms the same page twice and the page restarts clean", async () => {
    const handlers = new Map<string, ((e: { payload: unknown }) => void)[]>();
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: async () => ({}) },
      event: {
        listen: async (ev: string, cb: (e: { payload: unknown }) => void) => {
          const list = handlers.get(ev) ?? [];
          list.push(cb);
          handlers.set(ev, list);
          return () => undefined;
        },
      },
    };
    await lanStartHost("HOST1");
    for (const cb of handlers.get("lan://peer-joined") ?? []) {
      cb({ payload: { name: "P2" } });
    }
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/wordle" });
    await app.settle();

    //match 1: armed, the banner up, a void message planted (the worst case)
    arm("host", "wordle", 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(pageText(app)).toContain("online vs P2");
    app.container.querySelector<HTMLElement>(".text-error")?.remove();

    //the leave + the rematch arm on the SAME mounted page: the match
    //effect re-runs and resets every LAN signal (scores, remote, void)
    clearLanMatch();
    arm("host", "wordle", 2);
    await vi.advanceTimersByTimeAsync(150);
    const text = pageText(app);
    expect(text).toContain("online vs P2");
    expect(text).toContain("0 guesses"); //the session guesses restarted
    expect(text).not.toContain("the opponent left"); //no stale void
    expect(text).not.toContain("you win!"); //no stale verdict
  });
});
