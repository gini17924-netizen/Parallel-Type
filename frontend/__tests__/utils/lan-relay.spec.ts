import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRelay,
  currentWord as engineCurrentWord,
  feedKey,
  type RelayState,
} from "../../src/ts/utils/team-relay/engine";
import {
  HOST_PLAYER_ID,
  _resetLanRelayForTests,
  getMyRelaySeat,
  getRelayState,
  isMyRelayTurn,
  myCurrentWord,
  receiveRelayMessage,
  relayTypeKey,
  startTeamRelay,
} from "../../src/ts/states/lan-relay";
import { _resetLanStateForTests } from "../../src/ts/states/lan";

const WORDS = ["alpha", "beta", "gamma", "delta"];
const HOST = HOST_PLAYER_ID;
const P3 = "3"; //the client machine's pipe id

/** the CLIENT machine: a pure-engine state driven by the same broadcast
 * events the host emits (relay-start arms, relay-key replays) — this is
 * exactly what receiveRelayMessage does on the client's module */
function clientMachine(): RelayState {
  return createRelay(WORDS, [HOST, P3]);
}

describe("phase 111 — the team relay over the pipe (host machine)", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => undefined);
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    _resetLanStateForTests();
    _resetLanRelayForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetLanRelayForTests();
  });

  it("the host seats itself first and refuses a lone-wolf relay", () => {
    expect(startTeamRelay(WORDS, [])).toBe(false);
    expect(startTeamRelay(WORDS, [3])).toBe(true);
    expect(getRelayState()?.players.map((p) => p.playerId)).toEqual([HOST, P3]);
    expect(getMyRelaySeat()).toBe(HOST);
    expect(myCurrentWord()).toEqual({ word: "alpha", typed: 0 });
  });

  it("the typing player's keys advance the shared state", () => {
    hostStarts();
    relayTypeKey("a");
    relayTypeKey("l");
    const state = getRelayState();
    expect(state?.players[0]?.typed).toBe(2);
    expect(state?.phase).toBe("running");
  });

  it("a wrong key is ignored locally AND never reaches the wire", () => {
    hostStarts();
    relayTypeKey("x"); //wrong first char for alpha
    const relayKeys = invoke.mock.calls.filter(
      ([cmd, args]) =>
        cmd === "lan_send_message" &&
        (args as { message: { type: string } }).message.type === "relay-key",
    );
    expect(relayKeys).toHaveLength(0);
  });

  it("relay-start reaches the wire with words and the seats", () => {
    hostStarts();
    const starts = invoke.mock.calls.filter(
      ([cmd, args]) =>
        cmd === "lan_send_message" &&
        (args as { message: { type: string } }).message.type === "relay-start",
    );
    expect(starts).toHaveLength(1);
    const message = (starts[0]?.[1] as { message: Record<string, unknown> })
      .message;
    expect(message["words"]).toEqual(WORDS);
    expect(message["seats"]).toEqual([HOST, "3"]);
  });

  it("relay-key events reach the wire as the player types", () => {
    hostStarts();
    relayTypeKey("a");
    const relayKeys = invoke.mock.calls.filter(
      ([cmd, args]) =>
        cmd === "lan_send_message" &&
        (args as { message: { type: string } }).message.type === "relay-key",
    );
    expect(relayKeys).toHaveLength(1);
    const message = (relayKeys[0]?.[1] as { message: Record<string, unknown> })
      .message;
    expect(message["key"]).toBe("a");
    expect(message["by"]).toBe(HOST);
  });
});

describe("phase 111 — the CLIENT machine replays the same events", () => {
  beforeEach(() => {
    _resetLanRelayForTests();
  });

  it("relay-start arms the client seated by its pipe id", () => {
    receiveRelayMessage(
      { type: "relay-start", words: WORDS, seats: [HOST, P3] },
      3,
    );
    expect(getMyRelaySeat()).toBe(P3);
    expect(getRelayState()?.players.map((p) => p.playerId)).toEqual([HOST, P3]);
    //alpha belongs to the HOST — the client waits at its own first word
    expect(isMyRelayTurn()).toBe(false);
    expect(myCurrentWord()).toEqual({ word: "beta", typed: 0 });
  });

  it("replaying the host's key events converges the states", () => {
    //the HOST machine: what it typed (the module is the host here)
    hostStarts();
    for (const ch of "alpha") relayTypeKey(ch);
    const hostState = getRelayState() as RelayState;
    //the CLIENT machine: pure engine + the same broadcast events
    let clientState = clientMachine();
    for (const ch of "alpha") clientState = feedKey(clientState, HOST, ch);
    //CONVERGENCE: identical cursor, phase and active player
    expect(clientState.cursor).toBe(hostState.cursor);
    expect(clientState.phase).toBe(hostState.phase);
    expect(clientState.activePlayerId).toBe(hostState.activePlayerId);
    //the client machine, seated as P3, now holds beta
    const me = clientState.players.find((p) => p.playerId === P3);
    expect(me?.words[me.done]).toBe("beta");
  });

  it("a full relay completes identically on both machines", () => {
    hostStarts();
    //drive BOTH machines to completion: the host's keys through the
    //module, P3's keys through the relay-key path (the pipe), collecting
    //every accepted event IN ORDER
    const keys: { key: string; by: string }[] = [];
    let guard = 0;
    let state = getRelayState() as RelayState;
    while (state.phase !== "complete" && guard < 200) {
      guard++;
      const current = relayCurrent(state);
      if (current === undefined) break;
      if (current.playerId === HOST) {
        for (const ch of current.word) {
          relayTypeKey(ch);
          keys.push({ key: ch, by: HOST });
        }
      } else {
        for (const ch of current.word) {
          receiveRelayMessage(
            { type: "relay-key", key: ch, by: current.playerId },
            undefined,
          );
          keys.push({ key: ch, by: current.playerId });
        }
      }
      state = getRelayState() as RelayState;
    }
    expect(state.phase).toBe("complete");
    //the client machine replays the SAME collected sequence
    let clientState = clientMachine();
    for (const event of keys) {
      clientState = feedKey(clientState, event.by, event.key);
    }
    expect(clientState.phase).toBe("complete");
    expect(clientState.players.map((p) => p.done)).toEqual([2, 2]);
  });
});

// ---- the helpers ----
function hostStarts(): void {
  expect(startTeamRelay(WORDS, [3])).toBe(true);
}

function relayCurrent(state: RelayState): ReturnType<typeof engineCurrentWord> {
  return engineCurrentWord(state);
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetLanStateForTests();
  _resetLanRelayForTests();
});
