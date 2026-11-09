import { beforeEach, describe, expect, it } from "vitest";

import {
  createLanPongHost,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  INPUT_BATCH_MAX,
  lanTypePong,
  pongLanWordStream,
  type LanPongState,
  SNAPSHOT_MAX_BYTES,
  snapshotByteLength,
  type PongSnapshot,
} from "../../../src/ts/utils/type-pong/lan";
import { createSeededRng } from "../../../src/ts/utils/daily-gauntlet/seeded-rng";
import {
  _resetLanMatchForTests,
  armLanMatch,
  handleLanPeerMessage,
  getLanRawMessage,
} from "../../../src/ts/states/lan-match";
import {
  _resetLanRegistryForTests,
  getLanGame,
  getLanGames,
  registerLanGame,
} from "../../../src/ts/utils/games/lan-registry";

const POOL = [
  "return",
  "volley",
  "smash",
  "rally",
  "serve",
  "spin",
  "backhand",
  "topspin",
];

describe("type-pong LanPlayable + the authoritative host (phase 43 — pattern V)", () => {
  beforeEach(() => {
    _resetLanRegistryForTests();
    registerLanGame(lanTypePong);
    _resetLanMatchForTests();
  });

  it("is a registry member with the type-pong route and card", () => {
    expect(getLanGames().map((game) => game.gameId)).toContain("type-pong");
    const game = getLanGame("type-pong");
    expect(game?.route).toBe("/games/type-pong");
    expect(game?.label).toBe("type pong");
    expect(game?.icon).toBe("fa-table-tennis");
  });

  it("buildStart seeds the versus and carries lang + targetScore", () => {
    const start = lanTypePong.buildStart({ lang: "farsi", targetScore: 3 });
    expect(start.gameId).toBe("type-pong");
    expect(start.seed).toBeGreaterThanOrEqual(1);
    expect(start.seed).toBeLessThanOrEqual(2147483647);
    expect(start.params).toEqual({ lang: "farsi", targetScore: 3 });
  });

  it("buildStart applies the documented defaults", () => {
    expect(lanTypePong.buildStart({}).params).toEqual({
      lang: "english",
      targetScore: 5,
    });
  });

  it("validateStart accepts a good start and rejects bad shapes", () => {
    const good = lanTypePong.buildStart({});
    expect(lanTypePong.validateStart(good)).toBe(true);
    expect(lanTypePong.validateStart({ ...good, seed: 0 })).toBe(false);
    expect(
      lanTypePong.validateStart({ ...good, params: { lang: "english" } }),
    ).toBe(false);
    expect(
      lanTypePong.validateStart({
        ...good,
        params: { lang: "english", targetScore: 0 },
      }),
    ).toBe(false);
    expect(
      lanTypePong.validateStart({
        ...good,
        params: { lang: "", targetScore: 5 },
      }),
    ).toBe(false);
  });

  it("the authoritative sim is deterministic under the same seed + inputs", () => {
    const runHost = (): LanPongState => {
      const rng = createSeededRng(43);
      const nextWord = pongLanWordStream(POOL, 43);
      const host = createLanPongHost({ nextWord, rng });
      for (let i = 0; i < 200; i++) {
        host.tick(50);
        const state = host.state();
        if (i % 3 === 0) {
          //each side types one char of its own word
          const hostCh = state.hostWord[state.hostTyped] ?? "x";
          const clientCh = state.clientWord[state.clientTyped] ?? "x";
          host.hostKey(hostCh);
          host.clientKey(clientCh);
        }
        if (state.phase === "done") break;
      }
      return host.state();
    };
    const a = runHost();
    const b = runHost();
    expect(a).toEqual(b);
  });

  it("the client paddle responds to the relayed chars (authoritative)", () => {
    const host = createLanPongHost({
      nextWord: pongLanWordStream(POOL, 43),
      rng: createSeededRng(43),
    });
    const before = host.state();
    expect(before.clientTyped).toBe(0);
    //type the client's whole word: the paddle snaps onto the ball
    const word = before.clientWord;
    for (const ch of word) {
      host.clientKey(ch);
    }
    const after = host.state();
    expect(after.clientTyped).toBe(0); //the next word began
    expect(after.clientWord).not.toBe(word); //the stream moved
    expect(after.clientX).toBeCloseTo(after.ball.x, 0); //the snap
  });

  it("a wrong char is inert (the paddle stalls)", () => {
    const host = createLanPongHost({
      nextWord: pongLanWordStream(POOL, 43),
      rng: createSeededRng(43),
    });
    const before = host.state();
    const wrong = before.hostWord.startsWith("z") ? "q" : "z";
    host.hostKey(wrong);
    const after = host.state();
    expect(after.hostTyped).toBe(0);
    expect(after.hostWord).toBe(before.hostWord);
  });

  it("both paddles draw the same word per serve", () => {
    const host = createLanPongHost({
      nextWord: pongLanWordStream(POOL, 43),
      rng: createSeededRng(43),
    });
    expect(host.state().hostWord).toBe(host.state().clientWord);
  });

  it("the idle ball scores and the match ends at the target (authoritative)", () => {
    const host = createLanPongHost({
      nextWord: pongLanWordStream(POOL, 43),
      rng: createSeededRng(43),
      targetScore: 3,
    });
    let guard = 0;
    while (host.state().phase !== "done" && guard++ < 20_000) {
      host.tick(50);
    }
    const state = host.state();
    expect(state.phase).toBe("done");
    expect(state.winner).toBeDefined();
    expect(state.hostScore + state.clientScore).toBe(3);
    expect(state.winner === "host" || state.winner === "client").toBe(true);
  });

  it("the snapshot round-trips through the codec", () => {
    const snap: PongSnapshot = {
      seq: 7,
      phase: "running",
      winner: undefined,
      ball: { x: 42.13, y: 88.07, vx: -21.44, vy: 55.5 },
      hostX: 33.33,
      clientX: 61.61,
      hostScore: 2,
      clientScore: 1,
      hostWord: "volley",
      hostTyped: 3,
      clientWord: "volley",
      clientTyped: 1,
      rally: 4,
      bestRally: 9,
    };
    const decoded = decodeSnapshot(encodeSnapshot(snap));
    expect(decoded).toEqual(snap);
  });

  it("decodeSnapshot trusts only well-formed snapshots", () => {
    const good = encodeSnapshot({
      seq: 1,
      phase: "running",
      winner: undefined,
      ball: { x: 50, y: 50, vx: 10, vy: 10 },
      hostX: 50,
      clientX: 50,
      hostScore: 0,
      clientScore: 0,
      hostWord: "serve",
      hostTyped: 0,
      clientWord: "serve",
      clientTyped: 0,
      rally: 0,
      bestRally: 0,
    });
    expect(decodeSnapshot(good)).toBeDefined();
    expect(decodeSnapshot({ ...good, seq: -1 })).toBeUndefined();
    expect(decodeSnapshot({ ...good, phase: "paused" })).toBeUndefined();
    expect(
      decodeSnapshot({ ...good, ball: { x: 1, y: 2, vx: 3 } }),
    ).toBeUndefined();
    expect(decodeSnapshot({ ...good, hostWord: 42 })).toBeUndefined();
    expect(decodeSnapshot({ ...good, rally: "many" })).toBeUndefined();
    expect(decodeSnapshot("garbage")).toBeUndefined();
    expect(decodeSnapshot(undefined)).toBeUndefined();
  });

  it("a realistic snapshot stays far under the 64KB ceiling", () => {
    const snap: PongSnapshot = {
      seq: 12_345,
      phase: "running",
      winner: undefined,
      ball: { x: 42.13, y: 88.07, vx: -21.44, vy: 55.5 },
      hostX: 33.33,
      clientX: 61.61,
      hostScore: 2,
      clientScore: 1,
      hostWord: "backhand",
      hostTyped: 3,
      clientWord: "backhand",
      clientTyped: 5,
      rally: 4,
      bestRally: 9,
    };
    expect(snapshotByteLength(snap)).toBeLessThan(SNAPSHOT_MAX_BYTES);
    expect(snapshotByteLength(snap)).toBeLessThan(512); //~300 bytes
  });

  it("the input codec filters garbage and enforces the batch cap", () => {
    expect(decodeInput(encodeInput(["d", "f", "j"]))).toEqual(["d", "f", "j"]);
    //encode drops non-single-char entries
    expect(decodeInput(encodeInput(["d", "abc", "", "k"]))).toEqual(["d", "k"]);
    //decode rejects a malformed batch
    expect(decodeInput({ chars: ["d", 42] })).toBeUndefined();
    expect(decodeInput({ chars: "dfjk" })).toBeUndefined();
    expect(
      decodeInput({ chars: [...Array(INPUT_BATCH_MAX + 1)].fill("d") }),
    ).toBeUndefined();
    expect(decodeInput("garbage")).toBeUndefined();
  });

  it("the raw passthrough hands the V messages to the page", () => {
    //arm a live type-pong match so the router routes at all
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: lanTypePong.buildStart({}),
    });
    handleLanPeerMessage({
      type: "pong-input",
      gameId: "type-pong",
      chars: ["d", "f"],
    });
    const raw = getLanRawMessage();
    expect(raw).toBeDefined();
    expect(raw?.message["type"]).toBe("pong-input");
    expect(raw?.message["chars"]).toEqual(["d", "f"]);
    //a known type never lands in the raw channel
    handleLanPeerMessage({ type: "finished", finishMs: 100, acc: 100 });
    expect(getLanRawMessage()?.message["type"]).toBe("pong-input");
  });

  it("the seeded word stream is deterministic and cycles the pool", () => {
    const a = pongLanWordStream(POOL, 43);
    const b = pongLanWordStream(POOL, 43);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
    //the served words stay 4-8 letters from the filtered pool
    const c = pongLanWordStream(POOL, 7);
    for (let i = 0; i < 10; i++) {
      expect(c()).toMatch(/^\p{L}{4,8}$/u);
    }
    //a pool with no 4-8 letter words falls back
    const d = pongLanWordStream(["ax", "be"], 5);
    expect(d()).toBe("return");
  });
});
