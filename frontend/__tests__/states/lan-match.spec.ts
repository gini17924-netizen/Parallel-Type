import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getRemoteFinished,
  getRemoteProgress,
  getRematchAsked,
  handleLanPeerMessage,
  sendLanMatchFinished,
  sendLanMatchProgress,
  sendLanMatchRematch,
  sendLanMatchStart,
} from "../../src/ts/states/lan-match";

describe("lan match state (online bot-duel, LAN phase 4)", () => {
  beforeEach(() => {
    _resetLanMatchForTests();
    navigateMock.mockClear();
  });

  it("a start message arms the match and navigates to the duel", () => {
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      words: ["alpha", "beta"],
      from: "HOST9",
    });
    const match = getLanMatch();
    expect(match?.role).toBe("client"); //no lan role set -> not the host
    expect(match?.peerName).toBe("HOST9");
    expect(match?.gameId).toBe("bot-duel");
    expect(match?.words).toEqual(["alpha", "beta"]);
    expect(match?.seq).toBe(1);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/games/bot-duel" });
  });

  it("foreign games and malformed words never arm", () => {
    handleLanPeerMessage({ type: "start", gameId: "other", words: ["a"] });
    expect(getLanMatch()).toBeUndefined();
    expect(navigateMock).not.toHaveBeenCalled();
    //non-string words are filtered, not trusted
    handleLanPeerMessage({
      type: "start",
      gameId: "bot-duel",
      words: ["a", 42, "c"],
    });
    expect(getLanMatch()?.words).toEqual(["a", "c"]);
  });

  it("progress and finished are ignored without a live match", () => {
    handleLanPeerMessage({ type: "progress", wordIndex: 3 });
    expect(getRemoteProgress()).toBeUndefined();
    handleLanPeerMessage({ type: "finished", finishMs: 100, acc: 90 });
    expect(getRemoteFinished()).toBeUndefined();
  });

  it("progress and finished land once a match is armed", () => {
    armLanMatch({
      role: "host",
      peerName: "P2",
      gameId: "bot-duel",
      words: ["x"],
    });
    handleLanPeerMessage({ type: "progress", wordIndex: 3 });
    const progress = getRemoteProgress();
    expect(progress?.wordIndex).toBe(3);
    expect(typeof progress?.arrivalPerf).toBe("number");
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
    armLanMatch({
      role: "host",
      peerName: "P2",
      gameId: "bot-duel",
      words: ["x"],
    });
    handleLanPeerMessage({ type: "progress", wordIndex: 1 });
    handleLanPeerMessage({ type: "rematch" });
    expect(getRematchAsked()).toBe(true);
    armLanMatch({
      role: "host",
      peerName: "P2",
      gameId: "bot-duel",
      words: ["x"],
    });
    expect(getRematchAsked()).toBe(false);
    expect(getRemoteProgress()).toBeUndefined();
    expect(getLanMatch()?.seq).toBe(2);
  });

  it("clearing disarms everything", () => {
    armLanMatch({
      role: "client",
      peerName: "HOST1",
      gameId: "bot-duel",
      words: ["x"],
    });
    clearLanMatch();
    expect(getLanMatch()).toBeUndefined();
    expect(getRemoteFinished()).toBeUndefined();
  });

  it("the senders are safe without the tauri backend", () => {
    expect(() => sendLanMatchStart(["a"], "P1")).not.toThrow();
    expect(() => sendLanMatchProgress(1, 2)).not.toThrow();
    expect(() => sendLanMatchFinished(100, 90)).not.toThrow();
    expect(() => sendLanMatchRematch()).not.toThrow();
  });
});
