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
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/stack-attack/balance";
import {
  createStackAttackEngine,
  type StackAttackEngine,
  type StackAttackState,
} from "../../../../utils/stack-attack/engine";
import {
  getStackAttackBestScore,
  recordStackAttackRun,
} from "../../../../utils/stack-attack/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const CELL_REM = 1.9; //the grid cell size
const FALLBACK_WORDS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "house",
  "garden",
  "water",
  "music",
];

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
 * Stack Attack (idea G12, phase 2): a word-block falls through a grid —
 * type its word to lock it, steer the column with the arrows, clear full
 * rows. The pure engine owns the rules; this page owns the word pool and
 * the timers. The arrows are swallowed mid-run so the page never scrolls
 * or navigates (doc G12 DoD).
 */
export function StackAttackPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    StackAttackState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: StackAttackEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  const startRun = async (): Promise<void> => {
    setMessage(undefined);
    let pool: string[] = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      pool = data.words;
    } catch {
      //offline fallback list
    }
    const pickable = [
      ...new Set(
        pool
          .filter((word) => /^\p{L}+$/u.test(word))
          .map((word) => word.toLowerCase()),
      ),
    ];
    engine = createStackAttackEngine({
      spawnWord: (level) => {
        //block length rides the level: 3 letters +1 per level, cap 6
        const maxLen = Math.min(
          BALANCE.maxWordLen,
          BALANCE.minWordLen + level - 1,
        );
        const window_ = pickable.filter(
          (word) => word.length >= BALANCE.minWordLen && word.length <= maxLen,
        );
        const source = window_.length > 0 ? window_ : pickable;
        return source[Math.floor(Math.random() * source.length)] ?? "cat";
      },
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      recordStackAttackRun({
        score: state.result.score,
        rowsCleared: state.result.rowsCleared,
        level: state.result.level,
        blocksLocked: state.result.blocksLocked,
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    //the arrows steer: swallowed so the page never scrolls or leaves
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const after = engine?.moveCol(-1);
      if (after !== undefined) setEngineState(after);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const after = engine?.moveCol(1);
      if (after !== undefined) setEngineState(after);
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after === undefined) return;
    if (before !== undefined) {
      if (after.blocksLocked > before.blocksLocked) {
        void playClick();
      } else if (!after.comboEligible && before.comboEligible) {
        void playError();
      }
    }
    setEngineState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  /** the occupied grid cells (inline signal read — the KI-34 lesson) */
  const occupiedCells = (): { row: number; col: number; letter: string }[] => {
    const cells: { row: number; col: number; letter: string }[] = [];
    (engineState()?.grid ?? []).forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell !== undefined) {
          cells.push({ row: r, col: c, letter: cell.letter });
        }
      });
    });
    return cells;
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="rounded bg-bg p-3 text-center">
          <div class="text-xl font-bold text-main tabular-nums">
            {getStackAttackBestScore()}
          </div>
          <div class="text-xs text-sub">best score</div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type the falling word to lock the block into the grid — steer with the
          arrows, fill a row to clear it. A lock poking above the grid ends the
          run.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson (hit a third time!): the signal must be read INLINE in
    //JSX — a local const froze the block on the mount-time snapshot
    const gridWidthRem = BALANCE.cols * CELL_REM;
    const gridHeightRem = BALANCE.rows * CELL_REM;
    return (
      <section class="grid place-items-center" aria-label="stack attack arena">
        <div
          class="relative rounded bg-bg"
          style={{
            width: `${gridWidthRem}rem`,
            height: `${gridHeightRem}rem`,
            "border-color": "var(--sub-color)",
          }}
        >
          <Show when={engineState()?.falling !== undefined}>
            <div
              class="absolute top-0 h-full"
              style={{
                left: `${(engineState()?.falling?.col ?? 0) * CELL_REM}rem`,
                width: `${(engineState()?.falling?.word.length ?? 0) * CELL_REM}rem`,
                background: "var(--sub-alt-color)",
                opacity: 0.55,
              }}
              data-testid="sa-ghost"
            ></div>
          </Show>
          <For each={occupiedCells()}>
            {(cell) => (
              <div
                class="absolute grid place-items-center rounded-sm bg-main font-bold text-bg"
                style={{
                  left: `${cell.col * CELL_REM}rem`,
                  top: `${cell.row * CELL_REM}rem`,
                  width: `${CELL_REM}rem`,
                  height: `${CELL_REM}rem`,
                }}
                data-testid="sa-cell"
              >
                {cell.letter}
              </div>
            )}
          </For>
          <Show when={engineState()?.falling !== undefined}>
            <div
              class={cn(
                "absolute grid grid-flow-col place-items-center rounded border-2 font-bold",
                engineState()?.falling?.resting === true
                  ? "border-main bg-sub-alt"
                  : "border-sub bg-bg",
              )}
              style={{
                left: `${(engineState()?.falling?.col ?? 0) * CELL_REM}rem`,
                top: `${(engineState()?.falling?.row ?? 0) * CELL_REM}rem`,
                width: `${(engineState()?.falling?.word.length ?? 0) * CELL_REM}rem`,
                height: `${CELL_REM}rem`,
              }}
              data-testid="sa-block"
            >
              <For each={[...(engineState()?.falling?.word ?? "")]}>
                {(letter, i) => (
                  <span
                    class={cn(
                      "grid h-full place-items-center",
                      i() < (engineState()?.falling?.typedIdx ?? 0)
                        ? "text-main"
                        : "text-sub",
                    )}
                    style={{ width: `${CELL_REM}rem` }}
                  >
                    {letter}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-error">
          the stack reached the top
        </div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.rowsCleared ?? 0}
            </div>
            <div class="text-xs text-sub">rows cleared</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.level ?? 1}
            </div>
            <div class="text-xs text-sub">level</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.blocksLocked ?? 0}
            </div>
            <div class="text-xs text-sub">blocks locked</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getStackAttackBestScore()}
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
            onClick={() => {
              engine = undefined;
              setPagePhase("menu");
            }}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-cubes" }} text="stack attack" />
        <p class="text-sub">
          wordtris: word-blocks fall — type them, steer the column, clear full
          rows before the stack reaches the top.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="stack attack hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell label="level" value={String(engineState()?.level ?? 1)} />
            <HudCell
              label="rows"
              value={String(engineState()?.rowsCleared ?? 0)}
            />
            <div class="rounded bg-bg p-2 text-center">
              <div
                class={cn(
                  "text-xl font-bold",
                  engineState()?.comboEligible === true
                    ? "text-main"
                    : "text-sub",
                )}
              >
                ×1.5
              </div>
              <div class="text-xs text-sub">chain</div>
            </div>
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
