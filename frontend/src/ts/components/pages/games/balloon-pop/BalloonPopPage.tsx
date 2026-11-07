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
  BALANCE,
  type BalloonStage,
} from "../../../../utils/balloon-pop/balance";
import {
  createBalloonEngine,
  type BalloonEngine,
  type BalloonState,
} from "../../../../utils/balloon-pop/engine";
import { createSpawner } from "../../../../utils/balloon-pop/spawner";
import {
  getBalloonPopStats,
  recordBalloonRun,
} from "../../../../utils/balloon-pop/store";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import { unlockedLetters } from "../../../../utils/learn-stats";
import { buildCurrentWeakness } from "../../../../utils/smart-drill";
import { speakWord } from "../../../../utils/tts-speech";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = BALANCE.tickMs;
const FALLBACK_WORDS = ["cat", "frog", "bird", "sun", "tree", "fish"];

type PagePhase = "menu" | "playing" | "result";
type PageLang = "fa" | "en";

const LANG_LABELS: Record<PageLang, string> = {
  fa: "فارسی",
  en: "english",
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
 * Balloon Pop (idea G6): bubbles rise with your weak letters first — type
 * them before they escape. The pure engine (utils/balloon-pop) owns the
 * physics/pops/stages; this page owns the word pool, the letter unlock set,
 * the spawn slots and the timers. The game never writes the learn state.
 */
export function BalloonPopPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [lang, setLang] = createSignal<PageLang>(
    Config.language.startsWith("persian") ? "fa" : "en",
  );
  const [engineState, setEngineState] = createSignal<BalloonState | undefined>(
    undefined,
  );
  const [stageBanner, setStageBanner] = createSignal<number | undefined>(
    undefined,
  );
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  const [startStage, setStartStage] = createSignal(1);
  /** the hear-it TTS mode (idea G6, phase 3): speak each balloon as it
   * spawns; the cadence slows to make room for the speech */
  const [hearIt, setHearIt] = createSignal(false);

  let engine: BalloonEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  const slotById = new Map<number, number>();
  const spokenIds = new Set<number>();
  let lastSlot = -1;
  let words: string[] = [];
  let letters: string[] = [];
  let previousStage = 1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (bannerTimer !== undefined) clearTimeout(bannerTimer);
    tickTimer = undefined;
    bannerTimer = undefined;
  };

  onCleanup(stopTimers);

  const spawnerFor = (
    stage: number,
    level: number,
  ): { payload: string; speed: number } => {
    const spawner = createSpawner({
      stage,
      level,
      letters,
      words: words.length > 0 ? words : FALLBACK_WORDS,
      weakness: buildCurrentWeakness(),
      rng: Math.random,
    });
    return spawner.nextSpawn();
  };

  const slotFor = (id: number): number => {
    let slot = slotById.get(id);
    if (slot === undefined) {
      //8 columns, never the just-used one (the doc's slot-based spawn)
      const options = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== lastSlot);
      slot = options[Math.floor(Math.random() * options.length)] ?? 0;
      slotById.set(id, slot);
      lastSlot = slot;
    }
    return slot;
  };

  const startRun = async (fromStage: BalloonStage): Promise<void> => {
    setMessage(undefined);
    slotById.clear();
    lastSlot = -1;
    spokenIds.clear();
    letters = [...new Set(unlockedLetters(Config.language).split(""))];
    if (letters.length === 0) letters = ["a", "s", "d", "f"];
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      words = data.words;
    } catch {
      words = FALLBACK_WORDS;
    }
    engine = createBalloonEngine({
      spawn: spawnerFor,
      letters,
      startStage: fromStage,
      lives: BALANCE.startLives,
      spawnExtraMs: hearIt() ? BALANCE.hearItSpawnExtraMs : 0,
    });
    previousStage = fromStage;
    setStageBanner(fromStage > 1 ? fromStage : undefined);
    if (fromStage > 1) {
      bannerTimer = setTimeout(() => setStageBanner(undefined), 1500);
    }
    setEngineState(engine.state());
    setPagePhase("playing");
    //KI-30: install this run's tick only after retiring any previous run's
    //timers — two overlapping startRuns must never leave two intervals
    //ticking one engine (2x balloon speed, doubled TTS)
    stopTimers();
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (hearIt()) {
        for (const balloon of state.bubbles) {
          if (spokenIds.has(balloon.id)) continue;
          spokenIds.add(balloon.id);
          //spoken as spawned: the trailing stage-4 punctuation stays silent
          void speakWord(balloon.payload.replace(/[،؟«»]/g, ""));
        }
      }
      if (state.stage > previousStage) {
        previousStage = state.stage;
        setStageBanner(state.stage);
        if (bannerTimer !== undefined) clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => setStageBanner(undefined), 1500);
      }
      if (state.phase === "done") endRun(state);
    }, TICK_MS);
  };

  const endRun = (state: BalloonState): void => {
    stopTimers();
    recordBalloonRun({
      stage: state.stage,
      score: state.score,
      popped: state.popped,
      escaped: state.escaped,
    });
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state().popped ?? 0;
    const state = engine?.feedKey(event.key);
    setEngineState(state);
    if ((state?.popped ?? 0) > before) void playClick();
    else if (state?.combo === 0) void playError();
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    const onBlur = (): void => engine?.setPaused(true);
    const onFocus = (): void => engine?.setPaused(false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    });
  });

  const backToMenu = (): void => {
    //KI-30: leaving mid-run must stop the tick — the leaked interval would
    //otherwise double-tick the next run (2x balloon speed, doubled TTS)
    stopTimers();
    engine = undefined;
    setPagePhase("menu");
  };

  const bests = (): { stage: number; score: number }[] => {
    const bestByStage = getBalloonPopStats().bestByStage;
    return Object.entries(bestByStage)
      .map(([stage, best]) => ({ stage: Number(stage), score: best.score }))
      .sort((a, b) => a.stage - b.stage);
  };

  const continueStage = (): number => {
    const entries = bests();
    return entries.length === 0
      ? 1
      : Math.min(4, (entries[entries.length - 1]?.stage ?? 1) + 1);
  };

  const Menu = (): JSXElement => {
    const entries = bests();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="text-sub">language</div>
        <div class="grid grid-cols-2 gap-2">
          <For each={["fa", "en"] as PageLang[]}>
            {(value) => (
              <Button
                text={LANG_LABELS[value]}
                class={cn("w-full", lang() === value && "bg-main text-bg")}
                onClick={() => setLang(value)}
              />
            )}
          </For>
        </div>
        <div class="text-sub">start at stage</div>
        <div class="grid grid-cols-4 gap-2">
          <For each={[1, 2, 3, 4]}>
            {(stage) => (
              <Button
                text={`stage ${stage}`}
                class={cn(
                  "w-full",
                  startStage() === stage && "bg-main text-bg",
                )}
                onClick={() => setStartStage(stage)}
              />
            )}
          </For>
        </div>
        <Show when={entries.length > 0}>
          <div class="text-xs text-sub">
            bests:{" "}
            {entries
              .map((entry) => `stage ${entry.stage}: ${entry.score}`)
              .join(" · ")}
          </div>
        </Show>
        <div class="flex items-center justify-between gap-2">
          <span class="text-sub">hear it (speak each balloon)</span>
          <Button
            text={hearIt() ? "on" : "off"}
            class={cn("w-24", hearIt() && "bg-main text-bg")}
            onClick={() => setHearIt(!hearIt())}
          />
        </div>
        <Button
          text={
            startStage() > 1
              ? `start at stage ${startStage()}`
              : "start stage 1"
          }
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun(startStage() as BalloonStage)}
        />
        <div class="text-xs text-sub">
          pop the rising balloons — your weak letters come first. An escape
          costs a life.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34: the signal must be read inline in JSX — capturing it in a local
    //const froze the arena on the mount-time snapshot (no movement, no
    //spawns, no pops ever rendered)
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "70vh" }}
        aria-label="balloon arena"
      >
        <div class="absolute top-0 w-full border-t-2 border-dashed border-error"></div>
        <div class="absolute top-1 w-full text-center text-[0.65rem] text-error">
          danger line
        </div>
        <For each={engineState()?.bubbles ?? []}>
          {(balloon) => (
            <div
              class="absolute grid place-items-center rounded-full border-2 border-main bg-bg font-bold"
              style={{
                top: `${balloon.y}vh`,
                left: `${4 + slotFor(balloon.id) * 11.5}%`,
                width: `${2.2 + balloon.payload.length * 0.9}rem`,
                height: `${2.2 + balloon.payload.length * 0.5}rem`,
              }}
              dir="auto"
              data-testid="bp-balloon"
            >
              <span class="text-main">{balloon.payload}</span>
            </div>
          )}
        </For>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const state = engine?.state();
    const best = getBalloonPopStats().bestByStage[String(state?.stage ?? 1)];
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-error">run over</div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state?.stage ?? 1}
            </div>
            <div class="text-xs text-sub">stage reached</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {best?.score ?? "—"}
            </div>
            <div class="text-xs text-sub">stage best</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          popped {state?.popped ?? 0} · escaped {state?.escaped ?? 0} · max
          combo {state?.maxCombo ?? 0}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text={`continue at stage ${continueStage()}`}
            fa={{ icon: "fa-forward" }}
            class="w-full"
            onClick={() => {
              setStartStage(continueStage());
              void startRun(continueStage() as BalloonStage);
            }}
          />
          <Button
            text="back to menu"
            fa={{ icon: "fa-home" }}
            class="w-full"
            onClick={() => backToMenu()}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-circle" }} text="balloon pop" />
        <p class="text-sub">
          bubbles rise with your weak letters first — type them before they
          escape. Four stages: letters, short words, words, punctuation.
        </p>
      </section>

      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <section class="grid grid-cols-5 gap-2" aria-label="balloon hud">
            <HudCell label="stage" value={String(engineState()?.stage ?? 1)} />
            <HudCell label="level" value={String(engineState()?.level ?? 1)} />
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="lives"
              value={"❤".repeat(engineState()?.lives ?? 0) || "—"}
            />
          </section>
          <Show when={stageBanner() !== undefined}>
            <div class="text-center text-2xl font-bold text-main">
              stage {stageBanner()}
            </div>
          </Show>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
