import { createSignal } from "solid-js";
import { z } from "zod";

import { getLanClients, lanSendToPeer } from "../../states/lan";
import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * The LAN leaderboard + the daily-gauntlet comparison board (phase 84):
 * the guests' results arrive through the room pipe (the lan-match router
 * delegates the `gauntlet-result` type here) and the HOST persists them
 * through the tauri shell so they outlive the session. The local board
 * mirrors everything so the gauntlet page's comparison table works
 * offline, too.
 *
 * The daily gauntlet's seed is date-derived (dayKeyOf) — every machine
 * builds the same challenge for the same day, which is what makes the
 * comparison table fair.
 */

type TauriInvoke = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

function getInvoke(): TauriInvoke | undefined {
  const tauri = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: TauriInvoke } };
    }
  ).__TAURI__;
  return tauri?.core?.invoke;
}

/** a gauntlet result for the comparison board */
export type GauntletResult = {
  /** the player's display name */
  name: string;
  /** the day the run belongs to (dayKeyOf — the shared seed's key) */
  dayKey: string;
  /** the stages completed (0..3) */
  stages: number;
  /** the run's composite score */
  score: number;
  timestamp: number;
};

type BoardRow = { stages: number; score: number; timestamp: number };
type Board = Record<string, Record<string, BoardRow>>;

const boardStore = new LocalStorageWithSchema({
  key: "mtDesktopGauntletBoard",
  schema: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        stages: z.number().min(0).max(3),
        score: z.number().nonnegative(),
        timestamp: z.number().nonnegative(),
      }),
    ),
  ),
  fallback: {},
});

/** keeps each name's BEST run per dayKey */
function mergeBest(board: Board, entry: GauntletResult): void {
  const day = (board[entry.dayKey] ??= {});
  const existing = day[entry.name];
  if (existing === undefined || entry.score > existing.score) {
    day[entry.name] = {
      stages: entry.stages,
      score: entry.score,
      timestamp: entry.timestamp,
    };
  }
}

const [boardSignal, setBoardSignal] = createSignal<Board>({});

/** hydrates the signal from the persisted local board — safe to call
 * often (a cheap read) and it re-syncs after a storage clear */
export function hydrateGauntletBoard(): void {
  setBoardSignal(ghostBoardFromStorage());
}

/** wipes the comparison board (the specs' reset; the prod flows never
 * call it — the history is the point) */
export function resetGauntletBoard(): void {
  boardStore.clear();
  setBoardSignal({});
}

function ghostBoardFromStorage(): Board {
  try {
    return boardStore.get();
  } catch {
    return {};
  }
}

/**
 * records a gauntlet result: the LOCAL board always updates (best per
 * name per day), and the HOST additionally persists it through the
 * tauri shell so the guests' results outlive the session
 */
export function recordGauntletResult(entry: GauntletResult): void {
  const board = ghostBoardFromStorage();
  mergeBest(board, entry);
  boardStore.set(board);
  setBoardSignal(board);
  const invoke = getInvoke();
  if (invoke !== undefined) {
    void invoke("lan_leaderboard_write", { entry });
  }
}

/** the comparison table for one day: name → best result, strongest first */
export function gauntletBoardFor(
  dayKey: string,
): { name: string; stages: number; score: number }[] {
  const day = currentBoard()[dayKey] ?? {};
  return Object.entries(day)
    .map(([name, row]) => ({
      name,
      stages: row.stages,
      score: row.score,
    }))
    .sort((a, b) => b.score - a.score);
}

/** the signal read (the live board) */
function currentBoard(): Board {
  return boardSignal();
}

/** the host's persistent copy of the guests' results (the tauri shell) */
export async function loadLanLeaderboard(): Promise<
  GauntletResult[] | undefined
> {
  const invoke = getInvoke();
  if (invoke === undefined) return undefined;
  try {
    const entries = await invoke<Record<string, unknown>[]>(
      "lan_leaderboard_read",
    );
    return entries.flatMap((row) => {
      const parsed = GauntletEntrySchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  } catch (error) {
    console.error("lan leaderboard: read failed", error);
    return undefined;
  }
}

const GauntletEntrySchema = z.object({
  name: z.string(),
  dayKey: z.string(),
  stages: z.number().min(0).max(3),
  score: z.number(),
  timestamp: z.number(),
});

/** sends a gauntlet result over the room pipe (a guest announcing their
 * run to the host) — the raw passthrough shape */
export function sendGauntletResult(entry: GauntletResult): void {
  lanSendToPeer({ type: "gauntlet-result", ...entry });
}

/** receives a gauntlet result from the pipe (the lan-match router
 * delegates here): the wire row gains the sender's name from the roster */
export function receiveGauntletResult(
  message: Record<string, unknown>,
  clientId?: number,
): void {
  const dayKey = message["dayKey"];
  const score = message["score"];
  const stages = message["stages"];
  if (typeof dayKey !== "string" || typeof score !== "number") return;
  const rosterName =
    clientId !== undefined ? getLanClients()[clientId]?.name : undefined;
  const claimed = typeof message["name"] === "string" ? message["name"] : undefined;
  recordGauntletResult({
    name: rosterName ?? claimed ?? `client ${clientId ?? "?"}`,
    dayKey,
    stages: typeof stages === "number" ? Math.min(3, Math.max(0, Math.floor(stages))) : 0,
    score,
    timestamp:
      typeof message["timestamp"] === "number" ? message["timestamp"] : Date.now(),
  });
}


