import {
  For,
  JSXElement,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../../config/store";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { navigate } from "../../../../router/navigate";
import { isLanConnected, lanPreFillName } from "../../../../states/lan";
import {
  armLanMatch,
  clearLanMatch,
  getLanMatch,
  getRemoteFinished,
  getRemoteProgress,
  getRematchAsked,
  sendLanMatchFinished,
  sendLanMatchProgress,
  sendLanMatchRematch,
  sendLanMatchStart,
  type LanMatch,
} from "../../../../states/lan-match";
import { cn } from "../../../../utils/cn";
import { createSeededRng } from "../../../../utils/daily-gauntlet/seeded-rng";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/maze-runner/balance";
import {
  createMazeRunnerEngine,
  type MazeRunnerEngine,
  type MazeRunnerState,
} from "../../../../utils/maze-runner/engine";
import {
  lanMaze,
  resolveMazeVerdict,
  type MazeRemoteState,
  type MazeVerdict,
} from "../../../../utils/maze-runner/lan";
import {
  getMazeBestTime,
  getMazeHistory,
  getMazeNoErrorRuns,
  recordMazeRun,
} from "../../../../utils/maze-runner/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the on-screen maze cell size (px) and the minimap's downscale */
const CELL = 28;
const MINI_CELL = 7;
const FALLBACK_WORDS = [
  "cat",
  "sun",
  "map",
  "fox",
  "day",
  "ring",
  "mesh",
  "task",
  "wolf",
  "pine",
  "gust",
  "clay",
  "fern",
  "bolt",
  "damp",
  "lark",
  "mist",
  "vens",
];

type Level = 1 | 2 | 3;
type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both runners have reported */
type MazeOnlineResult = {
  verdict: MazeVerdict;
  theirTimeMs: number | null;
};

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Maze Runner (idea G14, phase 2): the runner slides along the BFS path
 * by itself and halts at every closed gate; typing the gate's word opens
 * it. The maze renders as an inline grid (walls = borders), the runner
 * is a sliding circle, and a 4× minimap tracks the progress. The pure
 * engine owns the rules; this page owns the word pool and the timers.
 */
export function MazeRunnerPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [level, setLevel] = createSignal<Level>(1);
  const [engineState, setEngineState] = createSignal<
    MazeRunnerState | undefined
  >(undefined);
  const [newRecord, setNewRecord] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer's runner on the same maze
  const [remoteState, setRemoteState] = createSignal<
    MazeRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    MazeOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: MazeRunnerEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let runStart = 0;
  let myFinal: { timeMs: number } | undefined;
  let myFinishSent = false;
  let lastSentRunner = -1;
  let lastSentGates = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-run (header back, route change) tells the peer the race
  //ended without a completion and disarms — they are never left waiting
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "maze-runner") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    sendLanMatchFinished(null, 0);
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "maze-runner";

  /** the one tick loop both the offline run and the online race share:
   * the auto-walk, the online progress relay and the horn */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(Date.now() - runStart);
      setEngineState(state);
      //online: relay the runner's progress when it moved
      if (lanMode()) {
        const gates = state.gates.filter((gate) => gate.open).length;
        if (state.runnerIndex !== lastSentRunner || gates !== lastSentGates) {
          lastSentRunner = state.runnerIndex;
          lastSentGates = gates;
          sendLanMatchProgress(
            lanMaze.encodeProgress({ runner: state.runnerIndex, gates }),
          );
        }
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const startRun = async (): Promise<void> => {
    setMessage(undefined);
    setNewRecord(false);
    let words: string[] = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      const pool = [
        ...new Set(data.words.map((word) => word.toLowerCase())),
      ].filter((word) => /^\p{L}{3,7}$/u.test(word));
      if (pool.length >= 30) words = pool;
    } catch {
      //offline fallback list
    }
    engine = createMazeRunnerEngine({
      level: level(),
      words,
      rng: Math.random,
    });
    runStart = Date.now();
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined || myFinal === undefined) return;
    //a null finish means the peer never exited — they lose
    setOnlineResult({
      verdict: resolveMazeVerdict(myFinal, {
        timeMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
      }),
      theirTimeMs: finished.finishMs,
    });
    setPagePhase("result");
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      if (state?.result !== undefined && !myFinishSent) {
        myFinishSent = true;
        myFinal = { timeMs: state.result.timeMs };
        sendLanMatchProgress(
          lanMaze.encodeProgress({
            runner: state.runnerIndex,
            gates: state.gates.filter((gate) => gate.open).length,
          }),
        );
        sendLanMatchFinished(myFinal.timeMs, 100);
      }
      if (getRemoteFinished() !== undefined) {
        resolveOnlineResult();
      } else {
        setPagePhase("awaiting");
      }
      return;
    }
    if (state?.result !== undefined) {
      const { isNewBestTime } = recordMazeRun({
        level: state.level,
        timeMs: state.result.timeMs,
        score: state.result.score,
        errors: state.result.errors,
      });
      setNewRecord(isNewBestTime);
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing" || engine === undefined) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine.state();
    const state = engine.feedKey(
      latinCharFromEvent(event.key, event.code),
      Date.now() - runStart,
    );
    setEngineState(state);
    const activeBefore = before.gates[before.activeGateIndex];
    if (state.errors > before.errors) {
      void playError();
    } else if (
      activeBefore !== undefined &&
      state.gates[state.activeGateIndex - 1]?.open === true
    ) {
      void playClick();
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const hostRematch = (match: LanMatch): void => {
    //arm first: a refused start never reaches the wire
    armLanMatch({
      role: "host",
      peerName: match.peerName,
      start: match.start,
    });
    if (getLanMatch() === undefined) return;
    sendLanMatchStart(match.start, lanPreFillName() || "P1");
  };

  //an armed (or re-armed) maze match IS the online start: the seed + lang
  //build the identical maze and gates on both machines, the run begins
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "maze-runner") return;
    void (async () => {
      const lang =
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english";
      const matchLevel = match.start.params["level"];
      let words: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${lang}.json`,
        );
        const pool = [
          ...new Set(data.words.map((word) => word.toLowerCase())),
        ].filter((word) => /^\p{L}{3,7}$/u.test(word));
        if (pool.length >= 30) words = pool;
      } catch {
        //offline fallback list
      }
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setNewRecord(false);
      myFinal = undefined;
      myFinishSent = false;
      lastSentRunner = -1;
      lastSentGates = -1;
      engine = createMazeRunnerEngine({
        level:
          typeof matchLevel === "number" && matchLevel >= 1 && matchLevel <= 3
            ? matchLevel
            : 1,
        words,
        rng: createSeededRng(match.start.seed ?? 1),
      });
      runStart = Date.now();
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  //the relayed peer progress lands decoded — the minimap reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as MazeRemoteState);
  });

  //the peer's finish resolves the held verdict (or arrived before mine)
  createEffect(() => {
    if (pagePhase() !== "awaiting") return;
    if (getRemoteFinished() === undefined) return;
    resolveOnlineResult();
  });

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "maze-runner") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the run voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "maze-runner") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  const backToMenu = (): void => {
    if (lanMode()) {
      //leaving online: the same clean leave
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchFinished(null, 0);
      }
      clearLanMatch();
    }
    stopTimers();
    engine = undefined;
    setEngineState(undefined);
    setPagePhase("menu");
  };

  /** the wall border classes for one cell (KI-34: reads stay inline) */
  const wallClasses = (x: number, y: number): string => {
    const st = engineState();
    const maze = st?.maze;
    if (maze === undefined) return "border border-sub";
    const top = y === 0 || (maze.h[y - 1]?.[x] ?? true);
    const bottom = y === maze.rows - 1 || (maze.h[y]?.[x] ?? true);
    const left = x === 0 || (maze.v[y]?.[x - 1] ?? true);
    const right = x === maze.cols - 1 || (maze.v[y]?.[x] ?? true);
    return cn(
      "border-sub",
      top ? "border-t" : "border-t-0",
      bottom ? "border-b" : "border-b-0",
      left ? "border-l" : "border-l-0",
      right ? "border-r" : "border-r-0",
    );
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-3 gap-2" role="group" aria-label="level">
          <For each={[1, 2, 3] as Level[]}>
            {(lv) => (
              <Button
                text={`level ${lv}`}
                class={cn(level() === lv && "bg-main text-bg")}
                onClick={() => setLevel(lv)}
              />
            )}
          </For>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {((getMazeBestTime(1) ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">best L1</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getMazeNoErrorRuns()}
            </div>
            <div class="text-xs text-sub">clean runs</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getMazeHistory().length}
            </div>
            <div class="text-xs text-sub">runs</div>
          </div>
        </div>
        <Button
          text="enter the maze"
          fa={{ icon: "fa-dungeon" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          the runner walks the maze by itself — you open the gates. each gate
          shows a word; type it and the door swings open (a wrong key only costs
          +{BALANCE.errorPenaltyMs}ms). beat par×2 for the score and keep it
          clean for the bonus. every level is a bigger maze with longer words.
        </div>
      </section>
    );
  };

  const MazeGrid = (): JSXElement => {
    const st = engineState();
    const cols = st?.maze.cols ?? 15;
    const rows = st?.maze.rows ?? 11;
    return (
      <div
        class="relative"
        style={{ width: `${cols * CELL}px`, height: `${rows * CELL}px` }}
        data-testid="mz-maze"
      >
        <div
          class="grid"
          style={{
            "grid-template-columns": `repeat(${cols}, ${CELL}px)`,
            "grid-template-rows": `repeat(${rows}, ${CELL}px)`,
          }}
        >
          <For each={Array.from({ length: cols * rows }, (_, i) => i)}>
            {(i) => {
              const x = i % cols;
              const y = Math.floor(i / cols);
              return (
                <div
                  class={cn("box-border bg-bg", wallClasses(x, y))}
                  data-testid="mz-cell"
                  data-x={x}
                  data-y={y}
                ></div>
              );
            }}
          </For>
        </div>
        {/*the gates: word + the partial bar (KI-34: inline reads)*/}
        <For each={engineState()?.gates ?? []}>
          {(gate) => (
            <div
              class={cn(
                "absolute grid place-items-center rounded-sm",
                gate.open ? "bg-main/15" : "bg-error/15",
              )}
              style={{
                left: `${gate.cell.x * CELL}px`,
                top: `${gate.cell.y * CELL}px`,
                width: `${CELL}px`,
                height: `${CELL}px`,
              }}
              data-testid="mz-gate"
              data-word={gate.word}
              data-open={gate.open ? "true" : "false"}
              data-active={
                engineState()?.gates[engineState()?.activeGateIndex ?? -1]
                  ?.word === gate.word
                  ? "true"
                  : "false"
              }
            >
              <span
                class={cn(
                  "px-0.5 text-center text-[8px] leading-tight",
                  gate.open ? "text-main line-through" : "text-error",
                )}
                dir="auto"
              >
                {gate.word}
              </span>
              <div
                class="absolute bottom-0 left-0 h-0.5 bg-main"
                style={{
                  width: `${(gate.typed / Math.max(1, gate.word.length)) * 100}%`,
                }}
              ></div>
            </div>
          )}
        </For>
        {/*the sliding runner circle*/}
        <div
          class="absolute rounded-full border-2 border-main bg-main/40"
          style={{
            width: `${CELL - 10}px`,
            height: `${CELL - 10}px`,
            left: `${((engineState()?.path[engineState()?.runnerIndex ?? 0]?.x ?? 0) + 0.5) * CELL}px`,
            top: `${((engineState()?.path[engineState()?.runnerIndex ?? 0]?.y ?? 0) + 0.5) * CELL}px`,
            transform: "translate(-50%, -50%)",
            transition: `left ${BALANCE.walkMsPerCell}ms linear, top ${BALANCE.walkMsPerCell}ms linear`,
          }}
          data-testid="mz-runner"
        ></div>
      </div>
    );
  };

  /** the 4× minimap: tiny cells with the walked path highlighted — online
   * it also carries the peer's runner dot on the same maze */
  const MiniMap = (): JSXElement => {
    const st = engineState();
    const cols = st?.maze.cols ?? 15;
    const rows = st?.maze.rows ?? 11;
    const visited = new Set<string>();
    const runner = st?.runnerIndex ?? 0;
    for (let i = 0; i <= runner; i++) {
      const cell = st?.path[i];
      if (cell !== undefined) visited.add(`${cell.x},${cell.y}`);
    }
    //the peer's cell (KI-34: the remote read stays inline)
    const peerCell = (): { x: number; y: number } | undefined => {
      if (!lanMode()) return undefined;
      const index = remoteState()?.runner ?? 0;
      return st?.path[index];
    };
    const peer = peerCell();
    return (
      <div
        class="relative grid rounded bg-bg p-1"
        style={{
          "grid-template-columns": `repeat(${cols}, ${MINI_CELL}px)`,
          "grid-template-rows": `repeat(${rows}, ${MINI_CELL}px)`,
        }}
        data-testid="mz-minimap"
      >
        <For each={Array.from({ length: cols * rows }, (_, i) => i)}>
          {(i) => {
            const x = i % cols;
            const y = Math.floor(i / cols);
            return (
              <div
                class={cn(visited.has(`${x},${y}`) ? "bg-main" : "bg-sub-alt")}
                style={{ width: `${MINI_CELL}px`, height: `${MINI_CELL}px` }}
              ></div>
            );
          }}
        </For>
        <Show when={peer !== undefined}>
          <div
            class="absolute rounded-full bg-error"
            style={{
              width: `${MINI_CELL}px`,
              height: `${MINI_CELL}px`,
              left: `${((peer?.x ?? 0) + 0.5) * MINI_CELL + 4}px`,
              top: `${((peer?.y ?? 0) + 0.5) * MINI_CELL + 4}px`,
              transform: "translate(-50%, -50%)",
            }}
            data-testid="mz-peer-dot"
          ></div>
        </Show>
      </div>
    );
  };

  const ActiveWord = (): JSXElement => {
    return (
      <div class="grid place-items-center gap-1">
        <div
          class="text-4xl font-bold tracking-widest"
          dir="auto"
          data-testid="mz-word"
          data-word={
            engineState()?.gates[engineState()?.activeGateIndex ?? -1]?.word ??
            ""
          }
        >
          <Show
            when={
              engineState()?.activeGateIndex !== undefined &&
              engineState()?.activeGateIndex !== -1
            }
            fallback={<span class="text-sub">the way out is open — run!</span>}
          >
            {(() => {
              const gate =
                engineState()?.gates[engineState()?.activeGateIndex ?? -1];
              const word = gate?.word ?? "";
              const typed = gate?.typed ?? 0;
              return (
                <>
                  <span class="text-main">{word.slice(0, typed)}</span>
                  <span class="text-sub">{word.slice(typed)}</span>
                </>
              );
            })()}
          </Show>
        </div>
        <div class="text-xs text-sub">type the word to open its gate</div>
      </div>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="mz-awaiting">
          you exited in {((myFinal?.timeMs ?? 0) / 1000).toFixed(1)}s — waiting
          for {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    const online = (): MazeOnlineResult | undefined => onlineResult();
    const verdict = online()?.verdict;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <Show when={online() === undefined} fallback={<div></div>}>
          <Show when={newRecord()}>
            <div class="text-lg font-bold text-main" data-testid="mz-record">
              new best time!
            </div>
          </Show>
        </Show>
        <Show
          when={online() !== undefined}
          fallback={
            <div class="text-3xl font-bold text-main">
              the maze is conquered
            </div>
          }
        >
          <div
            class={cn(
              "text-3xl font-bold",
              verdict === "won"
                ? "text-main"
                : verdict === "draw"
                  ? "text-sub"
                  : "text-error",
            )}
            data-testid="mz-verdict"
          >
            {verdict === "won"
              ? "you win!"
              : verdict === "draw"
                ? "draw"
                : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
          </div>
        </Show>
        <Show when={online() === undefined && result?.noError}>
          <div class="text-sm font-bold text-main">
            flawless — +{BALANCE.noErrorBonus} bonus
          </div>
        </Show>
        <div
          class={cn(
            "grid gap-2",
            online() !== undefined ? "grid-cols-3" : "grid-cols-4",
          )}
        >
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {((result?.timeMs ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">time</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {((engine?.state().parMs ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">par</div>
          </div>
          <Show
            when={online() === undefined}
            fallback={
              <div class="rounded bg-bg p-3">
                <div class="text-xl font-bold text-main tabular-nums">
                  {online()?.theirTimeMs === null
                    ? "—"
                    : `${((online()?.theirTimeMs ?? 0) / 1000).toFixed(1)}s`}
                </div>
                <div class="text-xs text-sub">
                  {getLanMatch()?.peerName ?? "the opponent"}
                </div>
              </div>
            }
          >
            <div class="rounded bg-bg p-3">
              <div class="text-xl font-bold text-main tabular-nums">
                {result?.score ?? 0}
              </div>
              <div class="text-xs text-sub">score</div>
            </div>
            <div class="rounded bg-bg p-3">
              <div class="text-xl font-bold text-main tabular-nums">
                {result?.errors ?? 0}
              </div>
              <div class="text-xs text-sub">errors</div>
            </div>
          </Show>
        </div>
        <Show when={online() === undefined}>
          <div class="text-xs text-sub">
            best level {level()}:{" "}
            {((getMazeBestTime(level()) ?? 0) / 1000).toFixed(1)}s ·{" "}
            {getMazeNoErrorRuns()} clean runs total
          </div>
        </Show>
        <Show
          when={online() === undefined}
          fallback={
            <div class="grid grid-cols-2 gap-2">
              <Button
                text={
                  rematchSent() ? "rematch requested — waiting…" : "rematch"
                }
                fa={{ icon: "fa-redo" }}
                class="w-full"
                onClick={() => {
                  const match = getLanMatch();
                  if (match === undefined || rematchSent()) return;
                  if (match.role === "host") {
                    hostRematch(match);
                  } else {
                    sendLanMatchRematch();
                    setRematchSent(true);
                  }
                }}
              />
              <Button
                text="leave to lobby"
                fa={{ icon: "fa-arrow-left" }}
                class="w-full"
                onClick={() => {
                  clearLanMatch();
                  void navigate({ to: "/games/online" });
                }}
              />
            </div>
          }
        >
          <div class="grid grid-cols-2 gap-2">
            <Button
              text="run again"
              fa={{ icon: "fa-redo" }}
              class="w-full"
              onClick={() => void startRun()}
            />
            <Button
              text="back to menu"
              fa={{ icon: "fa-home" }}
              class="w-full"
              onClick={backToMenu}
            />
          </div>
        </Show>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-dungeon" }} text="maze runner" />
        <p class="text-sub">
          a maze of locked gates — the runner slides on its own, you type the
          words to open the doors. speed against par, accuracy for the bonus.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="mz-online-vs"
        >
          <i class="fas fa-dungeon"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same maze, race to the exit
        </div>
      </Show>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show
          when={pagePhase() === "playing"}
          fallback={
            <Show when={pagePhase() === "awaiting"} fallback={<ResultScreen />}>
              <AwaitingScreen />
            </Show>
          }
        >
          <div class="grid grid-cols-4 gap-2" aria-label="maze runner hud">
            <HudCell
              label="time"
              value={`${(((engineState()?.elapsedMs ?? 0) + (engineState()?.penaltyMs ?? 0)) / 1000).toFixed(1)}s`}
            />
            <HudCell
              label="par"
              value={`${((engineState()?.parMs ?? 0) / 1000).toFixed(0)}s`}
            />
            <HudCell
              label="penalty"
              value={`${((engineState()?.penaltyMs ?? 0) / 1000).toFixed(1)}s`}
            />
            <HudCell label="errors" value={`${engineState()?.errors ?? 0}`} />
          </div>
          <div class="flex items-start justify-center gap-4">
            <MazeGrid />
            <div class="grid gap-2">
              <MiniMap />
              <ActiveWord />
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
