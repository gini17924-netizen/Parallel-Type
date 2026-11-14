import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(async () => undefined),
}));
vi.mock("../../src/ts/router/navigate", () => ({
  navigate: navigateMock,
}));

import {
  _resetLanMatchForTests,
  armLanMatch,
  clearLanMatch,
  getLanMatch,
  getLanRoomClients,
  getRemoteFinished,
  getRemoteProgress,
  getRematchAsked,
  handleLanPeerMessage,
  sendLanMatchFinished,
  sendLanMatchProgress,
  sendLanMatchRematch,
  sendLanMatchStart,
} from "../../src/ts/states/lan-match";
import {
  _resetLanStateForTests,
  lanJoin,
  lanStartHost,
} from "../../src/ts/states/lan";
import { type LanStartPayload } from "../../src/ts/utils/games/lan-registry";

function botDuelStart(words: string[], length = words.length): LanStartPayload {
  return { gameId: "bot-duel", params: { length }, words };
}

describe("lan match state (online wave, phase 2 — registry-routed)", () => {
  beforeEach(() => {
    _resetLanMatchForTests();
    navigateMock.mockClear();
  });

  it("a registry-known start arms the match and navigates to its route", () => {
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      params: { length: 2 },
      words: ["alpha", "beta"],
      from: "HOST9",
    });
    const match = getLanMatch();
    expect(match?.role).toBe("client"); //no lan role set -> not the host
    expect(match?.peerName).toBe("HOST9");
    expect(match?.gameId).toBe("bot-duel");
    expect(match?.start.words).toEqual(["alpha", "beta"]);
    expect(match?.start.params).toEqual({ length: 2 });
    expect(match?.seq).toBe(1);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/games/bot-duel" });
  });

  it("unknown games and invalid starts never arm", () => {
    handleLanPeerMessage({
      type: "start",
      gameId: "someone-elses-game",
      params: {},
      words: ["a"],
    });
    expect(getLanMatch()).toBeUndefined();
    expect(navigateMock).not.toHaveBeenCalled();
    //a bot-duel start without its required params is dropped
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      params: {},
      words: ["a"],
    });
    expect(getLanMatch()).toBeUndefined();
    //non-string words are filtered, not trusted
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      params: { length: 2 },
      words: ["a", 42, "c"],
    });
    expect(getLanMatch()?.start.words).toEqual(["a", "c"]);
  });

  it("progress and finished are ignored without a live match", () => {
    handleLanPeerMessage({
      type: "progress",
      gameId: "bot-duel",
      state: { wordIndex: 3, correctChars: 5 },
    });
    expect(getRemoteProgress()).toBeUndefined();
    handleLanPeerMessage({ type: "finished", finishMs: 100, acc: 90 });
    expect(getRemoteFinished()).toBeUndefined();
  });

  it("progress lands decoded once a match is armed — foreign or malformed is dropped", () => {
    armLanMatch({ role: "host", peerName: "P2", start: botDuelStart(["x"]) });
    handleLanPeerMessage({
      type: "progress",
      gameId: "bot-duel",
      state: { wordIndex: 3, correctChars: 10 },
    });
    const progress = getRemoteProgress();
    expect(progress?.state).toEqual({ wordIndex: 3, correctChars: 10 });
    expect(typeof progress?.arrivalPerf).toBe("number");
    //a different gameId's progress never lands in this match
    handleLanPeerMessage({
      type: "progress",
      gameId: "sprint",
      state: { wordIndex: 9 },
    });
    expect(getRemoteProgress()?.state).toEqual({
      wordIndex: 3,
      correctChars: 10,
    });
    //untrusted state shapes are rejected by the game's decode
    handleLanPeerMessage({
      type: "progress",
      gameId: "bot-duel",
      state: { wordIndex: "nine" },
    });
    expect(getRemoteProgress()?.state).toEqual({
      wordIndex: 3,
      correctChars: 10,
    });
    handleLanPeerMessage({ type: "finished", finishMs: 1234, acc: 90 });
    expect(getRemoteFinished()?.finishMs).toBe(1234);
    expect(getRemoteFinished()?.acc).toBe(90);
    expect(typeof getRemoteFinished()?.arrivalPerf).toBe("number");
    //malformed fields degrade instead of crashing
    handleLanPeerMessage({ type: "finished", finishMs: "late", acc: "high" });
    expect(getRemoteFinished()?.finishMs).toBeNull();
    expect(getRemoteFinished()?.acc).toBe(0);
  });

  it("a rematch ask sets the flag; a re-arm resets the derived state", () => {
    armLanMatch({ role: "host", peerName: "P2", start: botDuelStart(["x"]) });
    handleLanPeerMessage({
      type: "progress",
      gameId: "bot-duel",
      state: { wordIndex: 1 },
    });
    handleLanPeerMessage({ type: "rematch" });
    expect(getRematchAsked()).toBe(true);
    armLanMatch({ role: "host", peerName: "P2", start: botDuelStart(["x"]) });
    expect(getRematchAsked()).toBe(false);
    expect(getRemoteProgress()).toBeUndefined();
    expect(getLanMatch()?.seq).toBe(2);
  });

  it("armLanMatch refuses an invalid start", () => {
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: { gameId: "bot-duel", params: { length: 2 }, words: [] },
    });
    expect(getLanMatch()).toBeUndefined();
  });

  it("clearing disarms everything", () => {
    armLanMatch({
      role: "client",
      peerName: "HOST1",
      start: botDuelStart(["x"]),
    });
    clearLanMatch();
    expect(getLanMatch()).toBeUndefined();
    expect(getRemoteFinished()).toBeUndefined();
  });

  it("the senders are safe without the tauri backend", () => {
    expect(() => sendLanMatchStart(botDuelStart(["a"]), "P1")).not.toThrow();
    expect(() => sendLanMatchProgress({ wordIndex: 1 })).not.toThrow();
    expect(() => sendLanMatchFinished(100, 90)).not.toThrow();
    expect(() => sendLanMatchRematch()).not.toThrow();
  });

  it("sendLanMatchStart ships only registry-valid starts", async () => {
    //the tauri fake records the invokes; the host role routes the send
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
    try {
      await lanStartHost("P1");
      //an invalid start never reaches the wire
      sendLanMatchStart(
        { gameId: "bot-duel", params: { length: 0 }, words: [] },
        "P1",
      );
      expect(invokes.some((e) => e.cmd === "lan_send_message")).toBe(false);
      //a valid start ships with the type + from
      sendLanMatchStart(botDuelStart(["a", "b"]), "P1");
      const send = invokes.find((e) => e.cmd === "lan_send_message");
      const message = send?.args?.["message"] as Record<string, unknown>;
      expect(message["type"]).toBe("start");
      expect(message["gameId"]).toBe("bot-duel");
      expect(message["from"]).toBe("P1");
    } finally {
      delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
      _resetLanStateForTests();
    }
  });
});

describe("phase 77 — the room map (clientId-aware)", () => {
  beforeEach(() => {
    _resetLanMatchForTests();
    navigateMock.mockClear();
  });

  function armAsHost(): void {
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: botDuelStart(["a", "b", "c"]),
    });
  }

  it("a room member's progress lands in the clients map, not the primary slot", () => {
    armAsHost();
    handleLanPeerMessage(
      { type: "progress", gameId: "bot-duel", state: { wordIndex: 3, correctChars: 10 } },
      1,
    );
    expect(getRemoteProgress()).toBeUndefined();
    expect(getLanRoomClients()[1]?.progress).toEqual({ wordIndex: 3, correctChars: 10 });
  });

  it("a room member's finished lands in the clients map", () => {
    armAsHost();
    handleLanPeerMessage({ type: "finished", finishMs: 12_000, acc: 97 }, 2);
    expect(getRemoteFinished()).toBeUndefined();
    expect(getLanRoomClients()[2]?.finished).toEqual({
      finishMs: 12_000,
      acc: 97,
    });
  });

  it("an id-less message still feeds the primary flow (v1 compat)", () => {
    armAsHost();
    handleLanPeerMessage({ type: "progress", gameId: "bot-duel", state: { wordIndex: 1, correctChars: 5 } });
    expect(getRemoteProgress()?.state).toEqual({ wordIndex: 1, correctChars: 5 });
    expect(getLanRoomClients()).toEqual({});
  });

  it("a room member's progress for another game never lands", () => {
    armAsHost();
    handleLanPeerMessage({ type: "progress", gameId: "other", state: {} }, 1);
    expect(getLanRoomClients()).toEqual({});
  });

  it("re-arming the match forgets the per-client states", () => {
    armAsHost();
    handleLanPeerMessage(
      { type: "progress", gameId: "bot-duel", state: { wordIndex: 3, correctChars: 10 } },
      1,
    );
    expect(getLanRoomClients()[1]?.progress).toBeDefined();
    armAsHost();
    expect(getLanRoomClients()).toEqual({});
  });
});

describe("phase 79 — the spectator seat", () => {
  beforeEach(() => {
    _resetLanMatchForTests();
    navigateMock.mockClear();
  });

  /** joins as a client with a v2 room ack so the device owns clientId 9 */
  async function joinAsClient9(): Promise<void> {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === "lan_connect_client") {
            return { connected: true, addr: "1.2.3.4:1", clientId: 9 };
          }
          return {};
        },
      },
      event: {
        listen: async () => () => undefined,
      },
    };
    const error = await lanJoin("1.2.3.4:1", "CODE", "P9");
    expect(error).toBeUndefined();
  }

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    _resetLanStateForTests();
  });

  it("a start listing OTHER playerIds arms the receiver as a spectator", async () => {
    await joinAsClient9();
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      params: { length: 2 },
      words: ["a", "b"],
      from: "HOST",
      players: [1, 2],
    });
    expect(getLanMatch()?.role).toBe("spectator");
    //the match still armed and navigated — the spectator watches
    expect(getLanMatch()?.gameId).toBe("bot-duel");
    expect(navigateMock).toHaveBeenCalled();
  });

  it("a start listing MY id arms me as a player", async () => {
    await joinAsClient9();
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      params: { length: 2 },
      words: ["a", "b"],
      from: "HOST",
      players: [1, 9],
    });
    expect(getLanMatch()?.role).toBe("client");
  });

  it("a v1 start without a players list arms as a player (compat)", async () => {
    await joinAsClient9();
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      params: { length: 2 },
      words: ["a", "b"],
      from: "HOST",
    });
    expect(getLanMatch()?.role).toBe("client");
  });
});
