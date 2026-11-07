import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../../config/store";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/maze-runner/balance";
import {
  createMazeRunnerEngine,
  type MazeRunnerEngine,
  type MazeRunnerState,
} from "../../../../utils/maze-runner/engine";
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
type PagePhase = "menu" | "playing" | "result";

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

  let engine: MazeRunnerEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let runStart = 0;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

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
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(Date.now() - runStart);
      setEngineState(state);
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
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
    const state = engine.feedKey(event.key, Date.now() - runStart);
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

  const backToMenu = (): void => {
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

  /** the 4× minimap: tiny cells with the walked path highlighted */
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
    return (
      <div
        class="grid rounded bg-bg p-1"
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

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <Show when={newRecord()}>
          <div class="text-lg font-bold text-main" data-testid="mz-record">
            new best time!
          </div>
        </Show>
        <div class="text-3xl font-bold text-main">the maze is conquered</div>
        <Show when={result?.noError}>
          <div class="text-sm font-bold text-main">
            flawless — +{BALANCE.noErrorBonus} bonus
          </div>
        </Show>
        <div class="grid grid-cols-4 gap-2">
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
        </div>
        <div class="text-xs text-sub">
          best level {level()}:{" "}
          {((getMazeBestTime(level()) ?? 0) / 1000).toFixed(1)}s ·{" "}
          {getMazeNoErrorRuns()} clean runs total
        </div>
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
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
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
