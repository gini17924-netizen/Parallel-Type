import {
  createLanSeed,
  type LanPlayable,
  type LanStartPayload,
} from "../games/lan-registry";
import { BALANCE } from "./balance";

/**
 * Maze Runner's LanPlayable (online wave, phase 11 — pattern R, seeded):
 * both machines build the IDENTICAL maze + gates locally — the engine is
 * fully deterministic given (level, word pool, seed), so nothing ships
 * but the seed + params. The progress relays the runner's path position
 * and the gates opened; the verdict is the race to the exit: the lower
 * total time (penalties included) wins, the exact tie is a draw. Pure —
 * the lobby passes the language in settings.
 */

export type MazeRemoteState = {
  /** the peer's runner index along the BFS path */
  runner: number;
  /** the gates the peer has opened */
  gates: number;
};

export type MazeVerdict = "won" | "lost" | "draw";

/** the race to the exit: the lower total time wins (penalties included) */
export function resolveMazeVerdict(
  mine: { timeMs: number },
  theirs: { timeMs: number },
): MazeVerdict {
  if (mine.timeMs !== theirs.timeMs) {
    return mine.timeMs < theirs.timeMs ? "won" : "lost";
  }
  return "draw";
}

const DEFAULT_LEVEL = 1;
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

export const lanMaze: LanPlayable = {
  gameId: "maze-runner",
  route: "/games/maze-runner",
  label: "maze runner",
  icon: "fa-dungeon",
  buildStart(settings) {
    const lang = settings["lang"];
    const start: LanStartPayload = {
      gameId: "maze-runner",
      seed: createLanSeed(),
      params: {
        lang:
          typeof lang === "string" && lang.length > 0 ? lang : DEFAULT_LANGUAGE,
        level: Math.max(
          1,
          Math.min(
            BALANCE.maxLevel,
            coerceCount(settings["level"], DEFAULT_LEVEL),
          ),
        ),
      },
    };
    return start;
  },
  validateStart(start) {
    if (start.gameId !== "maze-runner") return false;
    if (!isPositiveInt(start.seed)) return false;
    const lang = start.params["lang"];
    if (typeof lang !== "string" || lang.length === 0) return false;
    const level = start.params["level"];
    return (
      typeof level === "number" &&
      Number.isInteger(level) &&
      level >= 1 &&
      level <= BALANCE.maxLevel
    );
  },
  encodeProgress(state) {
    return {
      runner: coerceCount(state["runner"], 0),
      gates: coerceCount(state["gates"], 0),
    };
  },
  decodeProgress(payload) {
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const runner = record["runner"];
    const gates = record["gates"];
    if (
      typeof runner !== "number" ||
      !Number.isFinite(runner) ||
      runner < 0 ||
      typeof gates !== "number" ||
      !Number.isFinite(gates) ||
      gates < 0
    ) {
      return undefined;
    }
    const state: MazeRemoteState = {
      runner: Math.floor(runner),
      gates: Math.floor(gates),
    };
    return { ...state };
  },
};
