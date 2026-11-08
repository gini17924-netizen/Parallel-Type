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
import { BALANCE } from "../../../../utils/type-snake/balance";
import {
  createTypeSnakeEngine,
  type TypeSnakeEngine,
  type TypeSnakeState,
} from "../../../../utils/type-snake/engine";
import {
  getTypeSnakeBestLength,
  getTypeSnakeBestScore,
  recordTypeSnakeRun,
} from "../../../../utils/type-snake/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const CELL_PX = 22;
const FALLBACK_WORDS = ["hi", "run", "key", "tap", "win", "ace"];

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
 * Type Snake (idea G11, phase 2): the snake walks itself toward the food —
 * you type the 2-3 letter word riding the food to ripen it; the eat lands
 * when the head arrives. Death = boxed in. The pure engine owns the rules;
 * this page owns the food words and the timers.
 */
export function TypeSnakePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    TypeSnakeState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: TypeSnakeEngine | undefined;
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
    const shortWords = [
      ...new Set(
        pool
          .filter(
            (word) =>
              word.length >= BALANCE.foodWordMinLen &&
              word.length <= BALANCE.foodWordMaxLen &&
              /^\p{L}+$/u.test(word),
          )
          .map((word) => word.toLowerCase()),
      ),
    ];
    const source = shortWords.length > 0 ? shortWords : FALLBACK_WORDS;
    engine = createTypeSnakeEngine({
      foodWord: () => source[Math.floor(Math.random() * source.length)] ?? "go",
      rng: Math.random,
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
      recordTypeSnakeRun({
        score: state.result.score,
        length: state.result.length,
        eaten: state.result.eaten,
        maxCombo: state.result.maxCombo,
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after === undefined) return;
    if (before !== undefined && after.eaten > before.eaten) {
      void playClick();
    } else if (
      after.food !== undefined &&
      before?.food !== undefined &&
      after.food.typed > before.food.typed
    ) {
      void playClick();
    } else {
      void playError();
    }
    setEngineState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getTypeSnakeBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getTypeSnakeBestLength()}
            </div>
            <div class="text-xs text-sub">best length</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          the snake walks itself toward the food — type the food&apos;s word to
          ripen it; the eat lands when the head arrives. Wrong letters do
          nothing; getting boxed in ends the run.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: read the signal inline — a local const would freeze
    //the snake on the mount-time snapshot
    return (
      <section class="grid place-items-center" aria-label="type snake arena">
        <div
          class="relative rounded bg-bg"
          style={{
            width: `${BALANCE.cols * CELL_PX}px`,
            height: `${BALANCE.rows * CELL_PX}px`,
            //KI-48: faint cell lines so the board reads as a grid
            "background-image":
              "linear-gradient(color-mix(in srgb, var(--sub-color) 35%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--sub-color) 35%, transparent) 1px, transparent 1px)",
            "background-size": `${CELL_PX}px ${CELL_PX}px`,
          }}
        >
          <For each={engineState()?.snake ?? []}>
            {(segment, i) => (
              <div
                class={cn(
                  "absolute rounded-sm",
                  i() === 0 ? "bg-main" : "bg-sub",
                )}
                style={{
                  left: `${segment.x * CELL_PX}px`,
                  top: `${segment.y * CELL_PX}px`,
                  width: `${CELL_PX - 2}px`,
                  height: `${CELL_PX - 2}px`,
                  opacity: i() === 0 ? 1 : Math.max(0.35, 1 - i() * 0.03),
                }}
                data-testid="ts-segment"
              ></div>
            )}
          </For>
          <Show when={engineState()?.food !== undefined}>
            <div
              class="absolute grid place-items-center rounded-full border-2 border-main bg-bg font-bold"
              style={{
                left: `${(engineState()?.food?.x ?? 0) * CELL_PX - 4}px`,
                top: `${(engineState()?.food?.y ?? 0) * CELL_PX - 4}px`,
                "min-width": `${CELL_PX + 18}px`,
                padding: "0.1rem 0.3rem",
              }}
              dir="auto"
              data-testid="ts-food"
            >
              <span class="text-main">
                {(engineState()?.food?.word ?? "").slice(
                  0,
                  engineState()?.food?.typed ?? 0,
                )}
              </span>
              <span>
                {(engineState()?.food?.word ?? "").slice(
                  engineState()?.food?.typed ?? 0,
                )}
              </span>
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
        <div class="text-3xl font-bold text-error">boxed in!</div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.length ?? 0}
            </div>
            <div class="text-xs text-sub">length</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.eaten ?? 0}
            </div>
            <div class="text-xs text-sub">eaten</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getTypeSnakeBestScore()} · best length{" "}
          {getTypeSnakeBestLength()}
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
        <H2 fa={{ icon: "fa-dragon" }} text="type snake" />
        <p class="text-sub">
          the snake walks itself — your typing ripens the word on the food; grow
          long without getting boxed in.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="type snake hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell
              label="length"
              value={String(engineState()?.snake.length ?? 0)}
            />
            <HudCell label="eaten" value={String(engineState()?.eaten ?? 0)} />
            <HudCell
              label="speed"
              value={`${(BALANCE.startIntervalMs / (engineState()?.intervalMs ?? BALANCE.startIntervalMs)).toFixed(1)}x`}
            />
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
