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
import { BALANCE } from "../../../../utils/fruit-slash/balance";
import {
  createFruitSlashEngine,
  type FruitSlashEngine,
  type FruitSlashState,
} from "../../../../utils/fruit-slash/engine";
import {
  getFruitSlashBestScore,
  getFruitSlashBestSlashed,
  recordFruitSlashRun,
} from "../../../../utils/fruit-slash/store";
import { cachedFetchJson } from "../../../../utils/json-data";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the engine's vh band (apex ~54, floor 105) mapped into the arena */
const DISPLAY_Y_OFFSET_VH = 28;
const FALLBACK_WORDS = [
  "fig",
  "kiwi",
  "plum",
  "pear",
  "mango",
  "berry",
  "peach",
  "grape",
  "melon",
  "cherry",
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
 * Fruit Slash (idea G10, phase 2): fruits fly in arcs from the bottom —
 * type ANY visible word to slash it (word-oriented, per-fruit partials);
 * typing a bomb's word costs a life and three bombs end the run; the
 * 90-second window ends it otherwise. The pure engine owns the rules;
 * this page owns the word pool, the bomb mix and the timers.
 */
export function FruitSlashPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    FruitSlashState | undefined
  >(undefined);
  const [slashFx, setSlashFx] = createSignal<
    { x: number; y: number } | undefined
  >(undefined);
  const [bombFx, setBombFx] = createSignal<
    { x: number; y: number } | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: FruitSlashEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let fxTimer: ReturnType<typeof setTimeout> | undefined;
  const positions = new Map<number, { x: number; y: number }>();

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (fxTimer !== undefined) clearTimeout(fxTimer);
    tickTimer = undefined;
    fxTimer = undefined;
  };

  onCleanup(stopTimers);

  const applyState = (next: FruitSlashState): void => {
    const previous = engineState();
    if (previous !== undefined) {
      for (const fruit of previous.fruits) {
        if (next.fruits.some((f) => f.id === fruit.id)) continue;
        const pos = positions.get(fruit.id);
        if (pos === undefined) continue;
        if (next.bombsTyped > previous.bombsTyped) {
          //a typed bomb went off
          setBombFx({ x: pos.x, y: Math.min(pos.y, 100) });
          void playError();
        } else if (next.slashed > previous.slashed) {
          //slashed: the two halves separate at the fruit's position
          setSlashFx({ x: pos.x, y: Math.min(pos.y, 100) });
          void playClick();
        }
      }
    }
    for (const fruit of next.fruits) {
      positions.set(fruit.id, { x: fruit.x, y: fruit.y });
    }
    if (previous !== undefined && next.slashed > previous.slashed) {
      if (fxTimer !== undefined) clearTimeout(fxTimer);
      fxTimer = setTimeout(() => {
        setSlashFx(undefined);
        setBombFx(undefined);
      }, 300);
    }
    setEngineState(next);
  };

  const startRun = async (): Promise<void> => {
    setMessage(undefined);
    positions.clear();
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
    engine = createFruitSlashEngine({
      spawn: (level) => {
        //word length rides the level: 4 letters, +1 every 2 levels, cap 6
        const maxLen = Math.min(
          BALANCE.maxWordLen,
          BALANCE.minWordLen + Math.floor(level / 2),
        );
        const window_ = pickable.filter(
          (word) => word.length >= BALANCE.minWordLen && word.length <= maxLen,
        );
        const source = window_.length > 0 ? window_ : pickable;
        const word = source[Math.floor(Math.random() * source.length)] ?? "fig";
        return { word, isBomb: Math.random() < BALANCE.bombChance };
      },
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      applyState(state);
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      recordFruitSlashRun({
        score: state.result.score,
        slashed: state.result.slashed,
        bombsTyped: state.result.bombsTyped,
        maxCombo: state.result.maxCombo,
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return; //Backspace/Enter: inert in G10
    event.preventDefault();
    const after = engine?.feedKey(event.key);
    if (after !== undefined) applyState(after);
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
              {getFruitSlashBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getFruitSlashBestSlashed()}
            </div>
            <div class="text-xs text-sub">best slashed</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type ANY visible fruit&apos;s word to slash it — mid-air apex slashes
          pay +30. Do NOT type the bombs: a completed bomb costs a life and
          three end the run. A half-typed bomb defuses itself.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: read the signal inline — a local const would freeze
    //the arena on the mount-time snapshot
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "80vh" }}
        aria-label="fruit slash arena"
      >
        <div class="absolute bottom-0 w-full border-t-2 border-dashed border-error"></div>
        <For each={engineState()?.fruits ?? []}>
          {(fruit) => (
            <div
              class={cn(
                "absolute grid place-items-center rounded-full font-bold",
                fruit.isBomb && !fruit.defused
                  ? "border-2 border-error bg-error/30"
                  : "border-2 border-main bg-bg",
                fruit.defused && "opacity-60",
              )}
              style={{
                left: `${fruit.x}vw`,
                top: `${fruit.y - DISPLAY_Y_OFFSET_VH}vh`,
                "min-width": `${2.4 + fruit.word.length * 0.7}rem`,
                padding: "0.2rem 0.4rem",
              }}
              dir="auto"
              data-testid="fs-fruit"
            >
              <span class="text-main">{fruit.word.slice(0, fruit.typed)}</span>
              <span>{fruit.word.slice(fruit.typed)}</span>
              <Show when={fruit.isBomb && !fruit.defused}>
                <span class="absolute -top-2 text-xs" data-testid="fs-bomb">
                  💣
                </span>
              </Show>
              <Show when={fruit.defused}>
                <span class="absolute -top-2 text-xs text-sub">✓</span>
              </Show>
            </div>
          )}
        </For>
        <Show when={slashFx() !== undefined}>
          <div
            class="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${slashFx()?.x ?? 0}vw`,
              top: `${(slashFx()?.y ?? 0) - DISPLAY_Y_OFFSET_VH}vh`,
            }}
            data-testid="fs-slash"
          >
            <div class="h-[3px] w-16 rotate-45 bg-main"></div>
            <div class="h-[3px] w-16 -rotate-45 bg-main"></div>
          </div>
        </Show>
        <Show when={bombFx() !== undefined}>
          <div
            class="absolute grid place-items-center rounded-full border-4 border-error"
            style={{
              left: `${bombFx()?.x ?? 0}vw`,
              top: `${(bombFx()?.y ?? 0) - DISPLAY_Y_OFFSET_VH}vh`,
              width: "3.5rem",
              height: "3.5rem",
            }}
            data-testid="fs-boom"
          ></div>
        </Show>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-main">
          {result?.endedBy === "bombs" ? "three bombs!" : "time!"}
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
              {result?.slashed ?? 0}
            </div>
            <div class="text-xs text-sub">slashed</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.bombsTyped ?? 0}
            </div>
            <div class="text-xs text-sub">bombs typed</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getFruitSlashBestScore()} · best slashed{" "}
          {getFruitSlashBestSlashed()}
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
        <H2 fa={{ icon: "fa-apple-alt" }} text="fruit slash" />
        <p class="text-sub">
          fruits fly in arcs — type any visible word to slash it, ride the apex
          for the bonus, and never type the bombs.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="fruit slash hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell
              label="time"
              value={`${((engineState()?.remainingMs ?? BALANCE.durationMs) / 1000).toFixed(1)}`}
            />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="bombs"
              value={`${engineState()?.bombsTyped ?? 0}/${BALANCE.maxTypedBombs}`}
            />
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
