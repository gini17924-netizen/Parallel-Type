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
import { BALANCE } from "../../../../utils/firefight/balance";
import {
  createFirefightEngine,
  type FirefightEngine,
  type FirefightState,
} from "../../../../utils/firefight/engine";
import {
  getFirefightBestScore,
  getFirefightWins,
  recordFirefightRun,
} from "../../../../utils/firefight/store";
import { cachedFetchJson } from "../../../../utils/json-data";
import { buildCurrentWeakness } from "../../../../utils/smart-drill";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 250;
const COLS = BALANCE.cols;
const CELL_REM = 2.4;
const FALLBACK_WORDS = [
  "blaze",
  "smoke",
  "hose",
  "flame",
  "ember",
  "spark",
  "water",
  "rescue",
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
 * Firefight (idea G16, phase 2): a building on fire — the active word
 * (the most critical burning cell) shows big below the grid; type it to
 * extinguish. The pure engine + sim own the fire; this page owns the
 * word pool (weakness-weighted, the doc's feature-check #7) and timers.
 */
export function FirefightPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    FirefightState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: FirefightEngine | undefined;
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
          .filter(
            (word) =>
              word.length >= BALANCE.minWordLen &&
              word.length <= BALANCE.maxWordLen &&
              /^\p{L}+$/u.test(word),
          )
          .map((word) => word.toLowerCase()),
      ),
    ];
    const weakness = buildCurrentWeakness();
    //weakness-weighted words for the burning cells (doc G16 §۰.۷): the
    //weakest letters' words get picked ~3x as often
    const weighted: string[] = [];
    for (const word of pickable) {
      weighted.push(word);
      const weak = [...word].some((ch) => (weakness[ch]?.score ?? 0) > 0);
      if (weak) {
        weighted.push(word, word, word);
      }
    }
    const source = weighted.length > 0 ? weighted : FALLBACK_WORDS;
    engine = createFirefightEngine({
      wordFor: () =>
        source[Math.floor(Math.random() * source.length)] ?? "blaze",
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (state.phase !== "running") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      recordFirefightRun({
        score: state.result.score,
        won: state.result.won,
        ashes: state.result.ashes,
        extinguished: state.result.extinguished,
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
    const after = engine?.feedKey(event.key);
    if (after === undefined) return;
    if (before !== undefined) {
      if (after.extinguished > before.extinguished) {
        void playClick();
      } else if (after.combo === 0 && before.combo !== 0) {
        void playError();
      }
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
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getFirefightBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getFirefightWins()}
            </div>
            <div class="text-xs text-sub">wins</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {BALANCE.surviveMs / 1000}s
            </div>
            <div class="text-xs text-sub">to survive</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          one hose, one word at a time — the most critical cell shows below the
          grid. Extinguish it before it spreads; 35% ashes loses the building;
          survive the window to win.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: the signal must be read INLINE in JSX
    return (
      <section class="grid place-items-center" aria-label="firefight arena">
        <div
          class="relative grid rounded bg-bg"
          style={{
            "grid-template-columns": `repeat(${COLS}, ${CELL_REM}rem)`,
            "grid-auto-rows": `${CELL_REM}rem`,
          }}
        >
          <For each={engineState()?.cells ?? []}>
            {(cell, idx) => (
              <div
                class={cn(
                  "border border-bg",
                  cell.state === "burning" && "animate-pulse bg-error/70",
                  cell.state === "ashes" && "bg-sub opacity-40",
                  cell.state === "intact" && "bg-sub-alt",
                  (engineState()?.activeIndex ?? -1) === idx() &&
                    "outline-2 outline-main",
                )}
                data-testid="ff-cell"
              ></div>
            )}
          </For>
        </div>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div
          class={cn(
            "text-3xl font-bold",
            result?.won === true ? "text-main" : "text-error",
          )}
        >
          {result?.won === true
            ? "the building survived!"
            : "the building is lost"}
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
              {result?.extinguished ?? 0}
            </div>
            <div class="text-xs text-sub">extinguished</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.ashes ?? 0}
            </div>
            <div class="text-xs text-sub">ashes</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">best score {getFirefightBestScore()}</div>
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
        <H2 fa={{ icon: "fa-fire" }} text="firefight" />
        <p class="text-sub">
          the building is on fire — one hose, one word at a time. Extinguish the
          most critical cell before the fire spreads; 35% ashes loses.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-5 gap-2" aria-label="firefight hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell
              label="time"
              value={`${Math.ceil((engineState()?.remainingMs ?? BALANCE.surviveMs) / 1000)}s`}
            />
            <HudCell
              label="burned"
              value={`${Math.round((engineState()?.ashRatio ?? 0) * 100)}%`}
            />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="saved"
              value={String(engineState()?.extinguished ?? 0)}
            />
          </div>
          <Arena />
          <div class="grid place-items-center gap-1">
            <div
              class="text-4xl font-bold tracking-widest"
              dir="auto"
              data-testid="ff-word"
            >
              <Show
                when={(engineState()?.activeWord?.length ?? 0) > 0}
                fallback={<span class="text-sub">no fire to fight…</span>}
              >
                <span class="text-main">
                  {(engineState()?.activeWord ?? "").slice(
                    0,
                    engineState()?.activeTyped ?? 0,
                  )}
                </span>
                <span>
                  {(engineState()?.activeWord ?? "").slice(
                    engineState()?.activeTyped ?? 0,
                  )}
                </span>
              </Show>
            </div>
            <div class="text-xs text-sub">
              the most critical burning cell — type it to extinguish
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
