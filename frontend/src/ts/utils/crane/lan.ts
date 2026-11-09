import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { createSeededRng } from "../daily-gauntlet/seeded-rng";
import { BALANCE } from "./balance";

/**
 * Crane Stack's LanPlayable (online wave, phase 39 — pattern S #11): both
 * players stack the SAME seeded tower stream (the key sequences AND the
 * zone shifts derive from one shared seeded stream — identical sequences
 * and an identical zone evolution; only the release timing diverges)
 * inside the shared window from params. The horn fires for both (within
 * one RTT) and a run can end early only by the third miss — the horn
 * verdict: the HIGHER SCORE wins, the exact parity is a draw (both sides
 * ran the same clock — no time tiebreak, the word-blast family rule). A
 * peer without a finish loses.
 *
 * The unlocked letters do NOT travel (the learn-stats vary per machine):
 * the LAN sequences always come from the fixed home-row set, the same
 * letters the offline fallback uses.
 *
 * Pure — the lobby passes the language in settings; the page (phase B)
 * builds the seeded stream.
 */

export type CraneRemoteState = {
  /** the peer's live score */
  score: number;
  /** the peer's perfect releases so far (the release quality, cumulative) */
  perfectCount: number;
};

export type CraneVerdict = "won" | "lost" | "draw";

/** the horn verdict: the higher score wins, the exact parity is a draw
 * (both sides ran the same window — no time tiebreak) */
export function resolveCraneVerdict(
  mine: { score: number },
  theirs: { score: number },
): CraneVerdict {
  if (mine.score !== theirs.score) {
    return mine.score > theirs.score ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LANGUAGE = "english";
const DEFAULT_DURATION_MS = 90_000;
/** the fixed home-row key set for the LAN sequences (the offline page's
 * own fallback — deterministic on both machines, nothing personal) */
const LAN_KEYS = "fjdksla".split("");

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

/** the seeded tower stream: ONE rng drives the key sequences AND the
 * zone shifts — the same interleaved call order on both machines stacks
 * the identical tower (length rides the level like the page's buildSeq) */
export function craneLanStream(seed: number): {
  seqFor: (level: number) => string[];
  rng: () => number;
} {
  const rng = createSeededRng(seed);
  return {
    rng,
    seqFor: (level) => {
      const len = Math.min(
        BALANCE.seqMaxLen,
        BALANCE.seqMinLen + Math.floor((level - 1) / 3),
      );
      const seq: string[] = [];
      for (let i = 0; i < len; i++) {
        seq.push(LAN_KEYS[Math.floor(rng() * LAN_KEYS.length)] ?? "f");
      }
      return seq;
    },
  };
}

export const lanCrane: LanPlayable = {
  gameId: "crane",
  route: "/games/crane",
  label: "crane stack",
  icon: "fa-anchor",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "crane",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        durationMs: coerceCount(settings["durationMs"], DEFAULT_DURATION_MS),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "crane") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    return isPositiveInt(start.params["durationMs"]);
  },
  encodeProgress(state) {
    return {
      score: coerceCount(state["score"], 0),
      perfectCount: coerceCount(state["perfectCount"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const score = record["score"];
    const perfectCount = record["perfectCount"];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      typeof perfectCount !== "number" ||
      !Number.isFinite(perfectCount) ||
      perfectCount < 0
    ) {
      return undefined;
    }
    const state: CraneRemoteState = {
      score: Math.floor(score),
      perfectCount: Math.floor(perfectCount),
    };
    return { ...state };
  },
};
