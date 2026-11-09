import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { shuffleWithSeed } from "../games/seeded-shuffle";
import { BALANCE } from "./balance";
import { capSpeed, enforceMinVx, stepBall, type Ball } from "./ball";

/**
 * Type Pong's LanPlayable + the authoritative host engine (online wave,
 * phase 43 — pattern V, the REAL versus): the ball simulation runs ONLY
 * on the host — both paddles are human-driven (the host's own keys and
 * the client's relayed chars) and the host ships a fixed-rate snapshot
 * of the whole match state to the client (the state-sync protocol, the
 * only one in the wave). The client renders the snapshot with
 * interpolation (phase B) and relays its typed chars back.
 *
 * The seeded word stream: both paddles draw from ONE shared stream (the
 * same 4-8 letter filter the page applies) — identical words in the
 * identical order; the timing divergence is the whole game.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * fetches that language's pool and builds the seeded stream.
 */

export type PongSide = "host" | "client";

export type LanPongPhase = "running" | "done";

export type LanPongState = {
  phase: LanPongPhase;
  winner: PongSide | undefined;
  ball: Ball;
  hostX: number;
  clientX: number;
  hostScore: number;
  clientScore: number;
  /** the host paddle's current word + typed progress */
  hostWord: string;
  hostTyped: number;
  /** the client paddle's current word + typed progress */
  clientWord: string;
  clientTyped: number;
  rally: number;
  bestRally: number;
};

export type LanPongHost = {
  state(): LanPongState;
  /** the ball only — both paddles move by typing, never by a clock */
  tick(dtMs: number): LanPongState;
  /** the host player's own key */
  hostKey(key: string): LanPongState;
  /** the client's relayed char (the host applies it authoritatively) */
  clientKey(key: string): LanPongState;
};

export function createLanPongHost(options: {
  nextWord: () => string;
  rng: () => number;
  targetScore?: number;
}): LanPongHost {
  const targetScore = options.targetScore ?? BALANCE.targetScore;
  const paddleHalf = BALANCE.paddleW / 2;
  const rng = options.rng;
  let phase: LanPongPhase = "running";
  let winner: PongSide | undefined;
  let hostScore = 0;
  let clientScore = 0;
  let rally = 0;
  let bestRally = 0;
  let ball: Ball = { x: 50, y: 50, vx: 0, vy: 0 };
  let hostX = 50;
  let clientX = 50;
  let hostWord = "";
  let hostTyped = 0;
  let clientWord = "";
  let clientTyped = 0;
  let hostWordStartX = 50;
  let clientWordStartX = 50;

  function serve(): void {
    ball = {
      x: 50,
      y: 50,
      vx:
        (rng() < 0.5 ? -1 : 1) *
        (BALANCE.serveVxMin +
          rng() * (BALANCE.serveVxMax - BALANCE.serveVxMin)),
      vy:
        (rng() < 0.5 ? -1 : 1) *
        (BALANCE.serveVyMin +
          rng() * (BALANCE.serveVyMax - BALANCE.serveVyMin)),
    };
    enforceMinVx(ball);
    capSpeed(ball);
    //both paddles draw the SAME word — identical typing load per serve
    const word = options.nextWord();
    hostWord = word;
    clientWord = word;
    hostTyped = 0;
    clientTyped = 0;
    hostWordStartX = hostX;
    clientWordStartX = clientX;
    rally = 0;
  }

  serve();

  function paddleXFor(startX: number, typed: number, word: string): number {
    const progress = Math.min(1, typed / Math.max(1, word.length));
    return startX + (ball.x - startX) * progress;
  }

  function pullPaddle(side: PongSide, key: string): void {
    const isHost = side === "host";
    const word = isHost ? hostWord : clientWord;
    const typed = isHost ? hostTyped : clientTyped;
    const ch = key.toLowerCase();
    const expected = word[typed]?.toLowerCase();
    if (expected !== ch) return; //inert: the paddle stalls
    const nextTyped = typed + 1;
    const startX = isHost ? hostWordStartX : clientWordStartX;
    if (nextTyped >= word.length) {
      //the word complete: snapped onto the ball, the next word arrives
      const snapped = ball.x;
      if (isHost) {
        hostX = snapped;
        hostWordStartX = snapped;
        hostWord = options.nextWord();
        hostTyped = 0;
      } else {
        clientX = snapped;
        clientWordStartX = snapped;
        clientWord = options.nextWord();
        clientTyped = 0;
      }
      return;
    }
    const pulled = paddleXFor(startX, nextTyped, word);
    if (isHost) {
      hostX = pulled;
      hostTyped = nextTyped;
    } else {
      clientX = pulled;
      clientTyped = nextTyped;
    }
  }

  function bouncePaddle(side: PongSide): void {
    const x = side === "host" ? hostX : clientX;
    const offset = (ball.x - x) / paddleHalf;
    if (side === "host") {
      ball.vy = -Math.abs(ball.vy);
      ball.y = BALANCE.playerZoneY - 0.5;
    } else {
      ball.vy = Math.abs(ball.vy);
      ball.y = BALANCE.aiZoneY + 0.5;
    }
    ball.vx = ball.vx + offset * 20;
    enforceMinVx(ball);
    capSpeed(ball);
    if (side === "host") {
      rally += 1;
      bestRally = Math.max(bestRally, rally);
    }
  }

  function score(side: PongSide): void {
    rally = 0;
    if (side === "host") {
      hostScore += 1;
      if (hostScore >= targetScore) {
        winner = "host";
        phase = "done";
        return; //the serve would overwrite the done state
      }
    } else {
      clientScore += 1;
      if (clientScore >= targetScore) {
        winner = "client";
        phase = "done";
        return;
      }
    }
    serve();
  }

  return {
    state: () => ({
      phase,
      winner,
      ball: { ...ball },
      hostX,
      clientX,
      hostScore,
      clientScore,
      hostWord,
      hostTyped,
      clientWord,
      clientTyped,
      rally,
      bestRally,
    }),
    tick(dtMs) {
      if (phase !== "running") return this.state();
      const seconds = dtMs / 1000;
      stepBall(ball, seconds, rng);
      //the host's paddle zone: y >= the zone line
      if (ball.y >= BALANCE.playerZoneY) {
        if (Math.abs(ball.x - hostX) <= paddleHalf) {
          bouncePaddle("host");
        } else if (ball.y >= BALANCE.courtH + 3) {
          score("client"); //passed the host's paddle
        }
      }
      //the client's paddle zone: y <= the zone line
      if (phase === "running" && ball.y <= BALANCE.aiZoneY) {
        if (Math.abs(ball.x - clientX) <= paddleHalf) {
          bouncePaddle("client");
        } else if (ball.y <= -3) {
          score("host"); //the client missed
        }
      }
      return this.state();
    },
    hostKey(key) {
      if (phase !== "running") return this.state();
      if (key.length !== 1) return this.state();
      pullPaddle("host", key);
      return this.state();
    },
    clientKey(key) {
      if (phase !== "running") return this.state();
      if (key.length !== 1) return this.state();
      pullPaddle("client", key);
      return this.state();
    },
  };
}

/** the seeded word stream: the pool's 4-8 letter words (the page's own
 * filter), shuffled under the shared seed and consumed one per word —
 * both paddles type the identical words in the identical order */
export function pongLanWordStream(pool: string[], seed: number): () => string {
  const pickable = [
    ...new Set(
      pool
        .filter((word) => word.length >= 4 && word.length <= 8)
        .filter((word) => /^\p{L}+$/u.test(word))
        .map((word) => word.toLowerCase()),
    ),
  ];
  const stream =
    pickable.length > 0 ? shuffleWithSeed(pickable, seed) : ["return"];
  let cursor = 0;
  return () => {
    const word = stream[cursor % stream.length] ?? "return";
    cursor += 1;
    return word;
  };
}

/**
 * The state-sync protocol (the wave's only one): the host ships the whole
 * match state at a fixed rate; the client relays its typed chars back.
 * Both directions ride the raw passthrough (the generic router never
 * interprets them) with a strict 64KB cap per message.
 */

export const SNAPSHOT_INTERVAL_MS = 50;
export const SNAPSHOT_MAX_BYTES = 64 * 1024;
export const INPUT_BATCH_MAX = 32;

export type PongSnapshot = {
  /** the host's monotonic snapshot counter (the client's stale-drop) */
  seq: number;
  phase: LanPongPhase;
  winner: PongSide | undefined;
  ball: Ball;
  hostX: number;
  clientX: number;
  hostScore: number;
  clientScore: number;
  hostWord: string;
  hostTyped: number;
  clientWord: string;
  clientTyped: number;
  rally: number;
  bestRally: number;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function encodeSnapshot(snap: PongSnapshot): Record<string, unknown> {
  return {
    seq: Math.max(0, Math.floor(snap.seq)),
    phase: snap.phase,
    winner: snap.winner,
    ball: {
      x: round2(snap.ball.x),
      y: round2(snap.ball.y),
      vx: round2(snap.ball.vx),
      vy: round2(snap.ball.vy),
    },
    hostX: round2(snap.hostX),
    clientX: round2(snap.clientX),
    hostScore: snap.hostScore,
    clientScore: snap.clientScore,
    hostWord: snap.hostWord,
    hostTyped: snap.hostTyped,
    clientWord: snap.clientWord,
    clientTyped: snap.clientTyped,
    rally: snap.rally,
    bestRally: snap.bestRally,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function decodeSnapshot(raw: unknown): PongSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const seq = record["seq"];
  const phase = record["phase"];
  if (!isFiniteNumber(seq) || seq < 0) return undefined;
  if (phase !== "running" && phase !== "done") return undefined;
  const ball = record["ball"];
  if (typeof ball !== "object" || ball === null) return undefined;
  const b = ball as Record<string, unknown>;
  if (
    !isFiniteNumber(b["x"]) ||
    !isFiniteNumber(b["y"]) ||
    !isFiniteNumber(b["vx"]) ||
    !isFiniteNumber(b["vy"])
  ) {
    return undefined;
  }
  const num = (key: string): number | undefined => {
    const value = record[key];
    return isFiniteNumber(value) ? value : undefined;
  };
  const str = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === "string" ? value : undefined;
  };
  const hostX = num("hostX");
  const clientX = num("clientX");
  const hostScore = num("hostScore");
  const clientScore = num("clientScore");
  const hostTyped = num("hostTyped");
  const clientTyped = num("clientTyped");
  const rally = num("rally");
  const bestRally = num("bestRally");
  const hostWord = str("hostWord");
  const clientWord = str("clientWord");
  if (
    hostX === undefined ||
    clientX === undefined ||
    hostScore === undefined ||
    clientScore === undefined ||
    hostTyped === undefined ||
    clientTyped === undefined ||
    rally === undefined ||
    bestRally === undefined ||
    hostWord === undefined ||
    clientWord === undefined
  ) {
    return undefined;
  }
  const winner = record["winner"];
  return {
    seq: Math.floor(seq),
    phase,
    winner: winner === "host" || winner === "client" ? winner : undefined,
    ball: { x: b["x"], y: b["y"], vx: b["vx"], vy: b["vy"] },
    hostX,
    clientX,
    hostScore: Math.floor(hostScore),
    clientScore: Math.floor(clientScore),
    hostWord,
    hostTyped: Math.floor(hostTyped),
    clientWord,
    clientTyped: Math.floor(clientTyped),
    rally: Math.floor(rally),
    bestRally: Math.floor(bestRally),
  };
}

/** the wire size of one snapshot (the doc's 64KB ceiling) */
export function snapshotByteLength(snap: PongSnapshot): number {
  return JSON.stringify(encodeSnapshot(snap)).length;
}

export function encodeInput(chars: string[]): Record<string, unknown> {
  const clean = chars
    .filter((ch) => typeof ch === "string" && ch.length === 1)
    .slice(0, INPUT_BATCH_MAX);
  return { chars: clean };
}

export function decodeInput(raw: unknown): string[] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const chars = record["chars"];
  if (!Array.isArray(chars)) return undefined;
  if (chars.length > INPUT_BATCH_MAX) return undefined;
  const out: string[] = [];
  for (const ch of chars) {
    if (typeof ch !== "string" || ch.length !== 1) return undefined;
    out.push(ch);
  }
  return out;
}

const DEFAULT_LANGUAGE = "english";

function coerceCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2147483647
  );
}

export const lanTypePong: LanPlayable = {
  gameId: "type-pong",
  route: "/games/type-pong",
  label: "type pong",
  icon: "fa-table-tennis",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "type-pong",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        targetScore: coerceCount(settings["targetScore"], BALANCE.targetScore),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "type-pong") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["targetScore"]);
  },
  /** the V pattern rides the raw passthrough — this progress line stays
   * minimal (the score line) for the interface's sake */
  encodeProgress(state) {
    return {
      hostScore: coerceCount(state["hostScore"], 0),
      clientScore: coerceCount(state["clientScore"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const hostScore = record["hostScore"];
    const clientScore = record["clientScore"];
    if (
      typeof hostScore !== "number" ||
      !Number.isFinite(hostScore) ||
      hostScore < 0 ||
      typeof clientScore !== "number" ||
      !Number.isFinite(clientScore) ||
      clientScore < 0
    ) {
      return undefined;
    }
    return {
      hostScore: Math.floor(hostScore),
      clientScore: Math.floor(clientScore),
    };
  },
};
