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
import {
  getRunnerBestDistanceM,
  recordRunnerRun,
} from "../../../../utils/climber/store";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/runner/balance";
import {
  createRunnerEngine,
  type RunnerEngine,
  type RunnerState,
} from "../../../../utils/runner/engine";
import { kindIcon, type ObstacleKind } from "../../../../utils/runner/gen";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the px→% mapping across the arena strip */
const STRIP_PX = 640;
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
];

type PagePhase = "menu" | "playing" | "result";

function HudCell(props: {
  label: string;
  value: string;
  testId?: string;
}): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div
        class="text-xl font-bold text-main tabular-nums"
        data-testid={props.testId}
      >
        {props.value}
      </div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Endless Runner (idea G15, phase 2 — mode B): the runner moves by
 * itself; obstacles stream in with a word and a direction icon (jump ↑
 * / slide ↓ / destroy ✕). Type the nearest obstacle's word to clear it;
 * one that passes untyped costs a life — three and the run is over.
 * Distance is the score. The background parallaxes on two layers.
 */
export function RunnerPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<RunnerState | undefined>(
    undefined,
  );
  const [paused, setPaused] = createSignal(false);
  const [newRecord, setNewRecord] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: RunnerEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  const startRun = async (): Promise<void> => {
    setMessage(undefined);
    setNewRecord(false);
    let pool = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      const filtered = [
        ...new Set(data.words.map((word) => word.toLowerCase())),
      ].filter((word) => /^\p{L}{3,6}$/u.test(word));
      if (filtered.length >= 30) pool = filtered;
    } catch {
      //offline fallback list
    }
    engine = createRunnerEngine({
      pickWord: (minLen, maxLen) => {
        const fitting = pool.filter(
          (word) => word.length >= minLen && word.length <= maxLen,
        );
        const source = fitting.length > 0 ? fitting : pool;
        return source[Math.floor(Math.random() * source.length)] ?? "cat";
      },
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined || paused()) return;
      const before = engine.state();
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (state.hits > before.hits) void playError();
      if (state.combo > before.combo) void playClick();
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      const { isNewRecord } = recordRunnerRun({
        distanceM: state.result.distanceM,
        hits: state.result.hits,
      });
      setNewRecord(isNewRecord);
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing" || paused()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const state = engine?.feedKey(event.key);
    if (state === undefined) return;
    setEngineState(state);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    const onBlur = (): void => {
      if (pagePhase() !== "playing") return;
      setPaused(true);
    };
    const onFocus = (): void => {
      setPaused(false);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    });
  });

  const backToMenu = (): void => {
    stopTimers();
    engine = undefined;
    setEngineState(undefined);
    setPaused(false);
    setPagePhase("menu");
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getRunnerBestDistanceM()}m
            </div>
            <div class="text-xs text-sub">best distance</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-lg font-bold text-main">
              {getRunnerBestDistanceM() > 0 ? "survivor" : "—"}
            </div>
            <div class="text-xs text-sub">status</div>
          </div>
        </div>
        <Button
          text="start running"
          fa={{ icon: "fa-running" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          the runner moves by itself — clear each obstacle by typing its word:
          ground words mean JUMP, air words mean SLIDE, drones get DESTROYED. an
          obstacle that passes you untyped costs one of your three lives. the
          gaps shrink as you speed up.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "38vh" }}
        aria-label="endless runner arena"
      >
        {/*the two-layer parallax (both keyed off the distance)*/}
        <div
          class="absolute inset-x-0 top-0 h-1/2 opacity-40"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--sub-alt-color) 0 40px, transparent 40px 80px)",
            "background-position-x": `${-(engineState()?.distancePx ?? 0) * 0.25}px`,
          }}
          data-testid="rn-parallax-far"
        ></div>
        <div
          class="absolute inset-x-0 bottom-0 h-1/2 opacity-70"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--sub-alt-color) 0 60px, transparent 60px 120px)",
            "background-position-x": `${-(engineState()?.distancePx ?? 0) * 0.6}px`,
          }}
          data-testid="rn-parallax-near"
        ></div>
        {/*the ground line*/}
        <div
          class="absolute left-0 w-full border-t-2 border-sub"
          style={{ bottom: "26%" }}
        ></div>
        {/*the obstacles streaming in (KI-34: inline reads)*/}
        <For each={engineState()?.obstacles ?? []}>
          {(obstacle) => {
            const leftPct = 100 - (obstacle.xPx / STRIP_PX) * 100;
            //jump obstacles ride the ground, slides hang high, drones fly mid
            const bottomPct =
              obstacle.kind === "jump"
                ? "26%"
                : obstacle.kind === "slide"
                  ? "58%"
                  : "42%";
            return (
              <div
                class={cn(
                  "absolute grid place-items-center rounded border-2 px-2 py-1",
                  obstacle.id === engineState()?.activeId
                    ? "border-main bg-bg"
                    : "border-sub bg-bg/70",
                )}
                style={{
                  left: `${leftPct}%`,
                  bottom: bottomPct,
                  transform: "translateX(-50%)",
                }}
                data-testid="rn-obstacle"
                data-kind={obstacle.kind}
                data-word={obstacle.word}
              >
                <span class="text-[10px] text-error">
                  {kindIcon(obstacle.kind)}
                </span>
                <span class="text-sm font-bold text-main" dir="auto">
                  {obstacle.word}
                </span>
              </div>
            );
          }}
        </For>
        {/*the runner marker, fixed mid-strip on the ground line*/}
        <div
          class="absolute grid place-items-center rounded-full border-2 border-main bg-main/30 text-xs font-bold text-main"
          style={{ left: "50%", bottom: "26%", width: "26px", height: "26px" }}
          data-testid="rn-runner"
        >
          ●
        </div>
        <Show when={paused()}>
          <div
            class="absolute inset-0 grid place-items-center bg-bg/70 text-2xl font-bold text-main"
            data-testid="rn-paused"
          >
            paused
          </div>
        </Show>
      </section>
    );
  };

  const Lives = (): JSXElement => {
    return (
      <div class="flex justify-center gap-2" aria-label="lives">
        <For each={[0, 1, 2]}>
          {(i) => (
            <div
              class={cn(
                "text-xl",
                (engineState()?.lives ?? 0) > i
                  ? "text-main"
                  : "text-sub opacity-40",
              )}
              data-testid="rn-life"
            >
              ♥
            </div>
          )}
        </For>
      </div>
    );
  };

  const ActiveWord = (): JSXElement => {
    const word = (): string => engineState()?.word ?? "";
    const typed = (): number => engineState()?.typed ?? 0;
    const kind = (): ObstacleKind | undefined =>
      engineState()?.obstacles.find((it) => it.id === engineState()?.activeId)
        ?.kind;
    return (
      <div class="grid place-items-center gap-1">
        <Show
          when={word().length > 0}
          fallback={
            <div class="text-sub" data-testid="rn-word">
              clear ground ahead
            </div>
          }
        >
          <div
            class="text-4xl font-bold tracking-widest"
            dir="auto"
            data-testid="rn-word"
            data-word={word()}
          >
            <span class="text-error">{kindIcon(kind() ?? "jump")} </span>
            <span class="text-main">{word().slice(0, typed())}</span>
            <span class="text-sub">{word().slice(typed())}</span>
          </div>
        </Show>
        <div class="text-xs text-sub">
          type the nearest word — icons: ↑ jump · ↓ slide · ✕ destroy
        </div>
      </div>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <Show when={newRecord()}>
          <div class="text-lg font-bold text-main" data-testid="rn-record">
            new best distance!
          </div>
        </Show>
        <div class="text-3xl font-bold text-main">
          {result?.distanceM ?? 0}m down the road
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.distanceM ?? 0}m
            </div>
            <div class="text-xs text-sub">distance</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.hits ?? 0}
            </div>
            <div class="text-xs text-sub">hits taken</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              x{result?.bestCombo ?? 0}
            </div>
            <div class="text-xs text-sub">best combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best distance {getRunnerBestDistanceM()}m
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
        <H2 fa={{ icon: "fa-running" }} text="endless runner" />
        <p class="text-sub">
          the runner never stops — obstacles stream in and only your typing
          clears them. jump the ground, slide the air, destroy the drones.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="endless runner hud">
            <HudCell
              label="distance"
              value={`${Math.floor((engineState()?.distancePx ?? 0) / BALANCE.pxPerMeter)}m`}
              testId="rn-distance"
            />
            <HudCell
              label="speed"
              value={`${Math.round(engineState()?.speedPxPerS ?? 0)}`}
            />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="lives"
              value={`${engineState()?.lives ?? 0}/3`}
              testId="rn-lives"
            />
          </div>
          <Arena />
          <Lives />
          <ActiveWord />
        </Show>
      </Show>
    </div>
  );
}
