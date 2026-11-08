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
import { BALANCE } from "../../../../utils/climber/balance";
import {
  createClimberEngine,
  type ClimberEngine,
  type ClimberState,
} from "../../../../utils/climber/engine";
import {
  getClimberBestHeight,
  getClimberBestScore,
  recordClimberRun,
} from "../../../../utils/climber/store";
import { cn } from "../../../../utils/cn";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import {
  generatePseudoWords,
  unlockedLetters,
} from "../../../../utils/learn-stats";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the platform bar geometry (px) */
const PLATFORM_W = 240;
const PLATFORM_H = 34;
const PLATFORM_GAP = 26;
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
 * Sky Climber (idea G15, phase 2 — mode A): the vertical pressure
 * climb. Platforms stack bottom-up; typing the active word jumps up;
 * each platform's timer ring drains faster the higher you get — at
 * zero you fall one floor (word and partial survive). Two consecutive
 * falls or the ground end the run. At stage 2+ some words come from the
 * unlocked (weak) letters, 30% of the time. A window blur pauses.
 */
export function ClimberPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<ClimberState | undefined>(
    undefined,
  );
  const [fallFlash, setFallFlash] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [newRecord, setNewRecord] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: ClimberEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    tickTimer = undefined;
    flashTimer = undefined;
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
    //the stage≥2 weak-letter pool (read-only, the G9 pattern): pseudo
    //words from the unlocked letters
    const unlocked = [...unlockedLetters(Config.language)].filter((ch) =>
      /\p{L}/u.test(ch),
    );
    const weakPool =
      unlocked.length >= 2
        ? generatePseudoWords(unlocked.join(""), 20, pool)
        : pool;
    let platformCounter = 0;
    const wordFor = (index: number): string => {
      void index;
      platformCounter += 1;
      const stage = 1 + Math.floor(platformCounter / BALANCE.stageEvery);
      if (stage >= 2 && Math.random() < 0.3) {
        return weakPool[Math.floor(Math.random() * weakPool.length)] ?? "cat";
      }
      return pool[Math.floor(Math.random() * pool.length)] ?? "cat";
    };
    engine = createClimberEngine({ wordFor });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined || paused()) return;
      const before = engine.state();
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (state.totalFalls > before.totalFalls) {
        setFallFlash(true);
        if (flashTimer !== undefined) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => setFallFlash(false), 400);
        void playError();
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      const { isNewHeightRecord, isNewScoreRecord } = recordClimberRun({
        height: state.result.height,
        score: state.result.score,
        falls: state.result.falls,
      });
      setNewRecord(isNewHeightRecord || isNewScoreRecord);
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing" || paused()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const state = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (state === undefined) return;
    setEngineState(state);
    if (before !== undefined && state.platformIndex > before.platformIndex) {
      void playClick();
    } else if (before !== undefined && state.typed === 0 && before.typed > 0) {
      void playError();
    }
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
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getClimberBestHeight()}
            </div>
            <div class="text-xs text-sub">best height</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getClimberBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-lg font-bold text-main">
              {getClimberBestHeight() >= BALANCE.stageEvery ? "2+" : "1"}
            </div>
            <div class="text-xs text-sub">stage reached</div>
          </div>
        </div>
        <Button
          text="start climbing"
          fa={{ icon: "fa-arrow-up" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type the word on your platform to jump up. each timer ring drains
          faster the higher you climb (8s → 4s) — at zero you fall one floor
          with your word and progress intact. two falls in a row, or touching
          the ground, end the run. from stage 2, some words come from your
          unlocked letters.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34: the state reads are FUNCTIONS called inline in the JSX —
    //body consts would freeze on the mount-time snapshot
    const st = (): ClimberState | undefined => engineState();
    const index = (): number => engineState()?.platformIndex ?? 0;
    const platforms = (): ClimberState["platforms"] =>
      engineState()?.platforms ?? [];
    const lowest = (): number => platforms()[0]?.index ?? 0;
    const topOf = (platformIndex: number): number =>
      //platforms render bottom-up; index 0 sits at the arena's floor
      (platformIndex - lowest()) * (PLATFORM_H + PLATFORM_GAP);
    const timerPct = (): number => {
      const full = st()?.timerFullMs ?? 1;
      return Math.max(
        0,
        Math.min(100, ((st()?.timerRemainingMs ?? 0) / full) * 100),
      );
    };
    return (
      <section
        class={cn(
          "relative w-full overflow-hidden rounded bg-sub-alt",
          fallFlash() && "animate-pulse",
        )}
        style={{
          height: `${Math.min(420, platforms().length * (PLATFORM_H + PLATFORM_GAP) + 40)}px`,
        }}
        aria-label="sky climber arena"
      >
        <div class="absolute inset-0" style={{ opacity: fallFlash() ? 1 : 0 }}>
          <div class="h-full w-full bg-error/20"></div>
        </div>
        {/*the platform bars, bottom-up (the array is index-ascending)*/}
        <For each={[...platforms()].reverse()}>
          {(platform) => (
            <div
              class={cn(
                "absolute flex items-center justify-center rounded border-2",
                platform.index === st()?.platformIndex
                  ? "border-main bg-bg"
                  : "border-sub bg-bg/60",
              )}
              style={{
                left: `${50 - PLATFORM_W / 2}px`,
                bottom: `${topOf(platform.index)}px`,
                width: `${PLATFORM_W}px`,
                height: `${PLATFORM_H}px`,
              }}
              data-testid="cl-platform"
              data-index={platform.index}
            >
              <span
                class={cn(
                  "text-sm font-bold",
                  platform.index === st()?.platformIndex
                    ? "text-main"
                    : "text-sub",
                )}
                dir="auto"
              >
                {platform.word}
              </span>
            </div>
          )}
        </For>
        {/*the runner circle slides with a CSS transition*/}
        <div
          class="absolute grid place-items-center rounded-full border-2 border-main bg-main/30 text-xs font-bold text-main"
          style={{
            width: "22px",
            height: "22px",
            left: `${50 - 11}px`,
            bottom: `${topOf(index()) + PLATFORM_H - 8}px`,
            transition: "bottom 200ms ease",
          }}
          data-testid="cl-runner"
        >
          ▲
        </div>
        {/*the pressure ring (conic-gradient)*/}
        <div
          class="absolute grid place-items-center rounded-full"
          style={{
            width: "54px",
            height: "54px",
            right: "16px",
            top: "16px",
            background: `conic-gradient(var(--main) ${timerPct()}%, var(--bg) 0)`,
          }}
          data-testid="cl-ring"
        >
          <div class="grid h-[42px] w-[42px] place-items-center rounded-full bg-bg text-[10px] font-bold text-main tabular-nums">
            {Math.ceil((engineState()?.timerRemainingMs ?? 0) / 1000)}s
          </div>
        </div>
        <Show when={paused()}>
          <div
            class="absolute inset-0 grid place-items-center bg-bg/70 text-2xl font-bold text-main"
            data-testid="cl-paused"
          >
            paused
          </div>
        </Show>
      </section>
    );
  };

  const ActiveWord = (): JSXElement => {
    //KI-34: inline reads — a body const would freeze the word display
    const word = (): string => engineState()?.word ?? "";
    const typed = (): number => engineState()?.typed ?? 0;
    return (
      <div class="grid place-items-center gap-1">
        <div
          class="text-4xl font-bold tracking-widest"
          dir="auto"
          data-testid="cl-word"
          data-word={word()}
        >
          <span class="text-main">{word().slice(0, typed())}</span>
          <span class="text-sub">{word().slice(typed())}</span>
        </div>
        <div class="text-xs text-sub">
          type it to jump — a wrong key restarts the word
        </div>
      </div>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <Show when={newRecord()}>
          <div class="text-lg font-bold text-main" data-testid="cl-record">
            new record!
          </div>
        </Show>
        <div class="text-3xl font-bold text-main">the climb is over</div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.height ?? 0}
            </div>
            <div class="text-xs text-sub">height</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.falls ?? 0}
            </div>
            <div class="text-xs text-sub">falls</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best height {getClimberBestHeight()} · best score{" "}
          {getClimberBestScore()}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="climb again"
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
        <H2 fa={{ icon: "fa-arrow-up" }} text="sky climber" />
        <p class="text-sub">
          climb the platform stack against shrinking timers — your typing is the
          jump, the clock is the fall.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="sky climber hud">
            <HudCell
              label="height"
              value={`${engineState()?.platformIndex ?? 0}`}
            />
            <HudCell label="score" value={`${engineState()?.score ?? 0}`} />
            <HudCell label="stage" value={`${engineState()?.stage ?? 1}`} />
            <HudCell
              label="falls"
              value={`${engineState()?.totalFalls ?? 0}`}
              testId="cl-falls"
            />
          </div>
          <Arena />
          <ActiveWord />
        </Show>
      </Show>
    </div>
  );
}
