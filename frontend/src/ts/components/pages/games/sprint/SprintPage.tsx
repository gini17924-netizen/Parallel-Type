import { JSXElement, Show, createSignal, onCleanup, onMount } from "solid-js";

import { Config } from "../../../../config/store";
import {
  playClick,
  playTimeWarning,
} from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import {
  BALANCE,
  createSprintEngine,
  type SprintEngine,
  type SprintState,
} from "../../../../utils/sprint/sprint-engine";
import {
  getSprintStats,
  recordSprintResult,
} from "../../../../utils/sprint/sprint-stats";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const FALLBACK_WORDS = [
  "parallel",
  "typing",
  "speed",
  "focus",
  "rhythm",
  "words",
];

type PagePhase = "idle" | "arming" | "running" | "result";
type SprintMode = "free" | "daily";

/** deterministic daily word order: an LCG shuffle seeded by dayKey + lang */
function seededShuffle(words: string[], seedText: string): string[] {
  let state = seedText
    .split("")
    .reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  if (state <= 0) state += 2147483646;
  const rand = (): number => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  const out = [...words];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
}

function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Ten-Second Sprint (idea G5): a maximum-wpm burst inside exactly ten
 * seconds behind a reaction gate — wait for GO, a pre-GO key voids the
 * attempt. The pure engine (utils/sprint) owns the phases and metrics; the
 * UI owns the word stream and the timers. A window blur voids the attempt.
 */
export function SprintPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("idle");
  const [mode, setMode] = createSignal<SprintMode>("free");
  const [engineState, setEngineState] = createSignal<SprintState | undefined>(
    undefined,
  );
  const [currentWord, setCurrentWord] = createSignal("");
  const [nextWord, setNextWord] = createSignal("");
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  const [best, setBest] = createSignal<number | undefined>(
    getSprintStats().bestByLang[Config.language]?.wpm,
  );
  const [previousBest, setPreviousBest] = createSignal<number | undefined>(
    undefined,
  );
  /** the share button's flash (KI-31: the doc's simple result share) */
  const [copied, setCopied] = createSignal(false);

  let engine: SprintEngine | undefined;
  let wordStream: string[] = [];
  let streamIndex = 0;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const warningsFired = new Set<number>();

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  const next = (): string => {
    const word = wordStream[streamIndex % wordStream.length] ?? "typo";
    streamIndex += 1;
    setCurrentWord(word);
    setNextWord(wordStream[streamIndex % wordStream.length] ?? "");
    return word;
  };

  const finish = (): void => {
    stopTimers();
    const state = engine?.state();
    const result = state?.result;
    if (state === undefined || state.voided || result === undefined) {
      backToIdle();
      return;
    }
    //the best BEFORE this attempt drives the comparison arrow
    setPreviousBest(getSprintStats().bestByLang[Config.language]?.wpm);
    const stats = recordSprintResult({
      lang: Config.language,
      wpm: result.wpm,
      raw: result.raw,
      acc: result.accuracy,
      daily: mode() === "daily",
    });
    setBest(stats.bestByLang[Config.language]?.wpm);
    setPagePhase("result");
  };

  const backToIdle = (): void => {
    engine = undefined;
    wordStream = [];
    streamIndex = 0;
    warningsFired.clear();
    setEngineState(undefined);
    setCurrentWord("");
    setNextWord("");
    setPagePhase("idle");
  };

  const startAttempt = async (): Promise<void> => {
    setMessage(undefined);
    warningsFired.clear();
    if (wordStream.length === 0) {
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${Config.language}.json`,
        );
        wordStream = data.words;
      } catch {
        wordStream = FALLBACK_WORDS;
      }
      if (mode() === "daily") {
        wordStream = seededShuffle(
          wordStream,
          `${dayKeyOf(Date.now())}:${Config.language}`,
        );
      }
    }
    streamIndex = 0;
    engine = createSprintEngine({
      next,
      durationMs: BALANCE.durationMs,
      rng: Math.random,
    });
    engine.arm(performance.now());
    //KI-35: the engine's construction already consumed next() (which sets
    //the word signals) — a second call here shifted the DISPLAYED word one
    //ahead of the engine's current word, so no typed char could ever match
    setEngineState(engine.state());
    setPagePhase("arming");
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(performance.now());
      setEngineState(state);
      if (state.phase === "running" && pagePhase() !== "running") {
        //the GO flip: the engine left arming — the page follows with the
        //flash and its beep
        setPagePhase("running");
        void playClick();
      }
      if (state.phase === "running" && state.startedAt !== undefined) {
        //beep through the final three seconds of the window
        const remaining =
          BALANCE.durationMs - (performance.now() - state.startedAt);
        for (const mark of [3000, 2000, 1000]) {
          if (remaining <= mark && !warningsFired.has(mark)) {
            warningsFired.add(mark);
            void playTimeWarning();
          }
        }
      }
      if (state.phase === "done") finish();
    }, TICK_MS);
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (engine === undefined) return;
    if (pagePhase() !== "arming" && pagePhase() !== "running") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1) event.preventDefault();
    else if (event.key !== "Backspace") return;
    const feed = engine.feedKey(performance.now(), event.key);
    setEngineState(engine.state());
    if (feed.falseStart === true) {
      stopTimers();
      setMessage("false start! attempt void — wait for GO");
      setPagePhase("idle");
    }
  };

  const voidAttempt = (): void => {
    if (pagePhase() !== "arming" && pagePhase() !== "running") return;
    engine?.voidRace();
    stopTimers();
    setMessage("attempt void — the window lost focus");
    setPagePhase("idle");
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("blur", voidAttempt);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", voidAttempt);
    });
  });

  const remaining = (): string => {
    const startedAt = engineState()?.startedAt;
    if (startedAt === undefined) {
      return (BALANCE.durationMs / 1000).toFixed(2);
    }
    const left = Math.max(
      0,
      BALANCE.durationMs - (performance.now() - startedAt),
    );
    return (left / 1000).toFixed(2);
  };

  const changeMode = (value: SprintMode): void => {
    setMode(value);
    wordStream = []; //a new mode reshuffles the stream
  };

  const IdleScreen = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="text-sub">mode</div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="free"
            class={cn("w-full", mode() === "free" && "bg-main text-bg")}
            onClick={() => changeMode("free")}
          />
          <Button
            text="daily sprint"
            class={cn("w-full", mode() === "daily" && "bg-main text-bg")}
            onClick={() => changeMode("daily")}
          />
        </div>
        <div class="text-xs text-sub">
          daily sprint: the same word order for everyone today — beat your local
          best, grow the streak
        </div>
        <div class="text-sub">
          best ({Config.language}): {best() ?? "—"}
        </div>
        <Button
          text="start attempt"
          fa={{ icon: "fa-bolt" }}
          class="w-full"
          onClick={() => void startAttempt()}
        />
        <div class="text-xs text-sub">
          wait for GO — typing before it voids the attempt
        </div>
      </section>
    );
  };

  const RunningScreen = (): JSXElement => {
    //KI-36: every read must be inline in JSX — capturing engineState() in a
    //local const froze the word prefix, the live HUD and the next word on
    //the mount-time snapshot (the same Solid once-run pattern as KI-34)
    const state = (): SprintState | undefined => engineState();
    const word = (): string => currentWord();
    const typedCount = (): number => state()?.typed ?? 0;
    return (
      <>
        <section class="grid place-items-center rounded bg-sub-alt py-6">
          <div class="animate-pulse text-5xl font-bold text-main">GO</div>
        </section>
        <section class="grid gap-4 rounded bg-sub-alt p-6">
          <div
            class="text-center text-5xl font-bold text-main tabular-nums"
            dir="ltr"
            data-testid="sp-timer"
          >
            {remaining()}
          </div>
          <div class="grid place-items-center py-4">
            <div
              class="text-4xl font-bold tracking-widest"
              dir="auto"
              data-testid="sp-word"
            >
              <span class="text-main">{word().slice(0, typedCount())}</span>
              <span>{word().slice(typedCount())}</span>
            </div>
            <div class="pt-3 text-sm text-sub" dir="auto">
              next: {nextWord()}
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <HudCell label="chars" value={String(state()?.chars ?? 0)} />
            <HudCell
              label="words"
              value={String(state()?.wordsComplete ?? 0)}
            />
            <HudCell
              label="wpm live"
              value={String(Math.round((state()?.chars ?? 0) * 6))}
            />
          </div>
        </section>
      </>
    );
  };

  /** the doc's simple result share: one plain line to the clipboard (KI-31) */
  const share = async (): Promise<void> => {
    const result = engine?.state().result;
    const text = `ParallelType ten-second sprint: ${result?.wpm ?? 0} wpm · raw ${
      result?.raw ?? 0
    } · acc ${result?.accuracy ?? 0}% · ${result?.wordsComplete ?? 0} words · ${
      Config.language
    }`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("the clipboard is unavailable");
    }
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    const previous = previousBest();
    const better = previous === undefined || (result?.wpm ?? 0) >= previous;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-4xl font-bold text-main">
          {result?.wpm ?? 0}
          <span class="text-xl text-sub"> wpm</span>
        </div>
        <Show when={previous !== undefined}>
          <div
            class={cn("text-sm", better ? "text-main" : "text-error")}
            data-testid="sp-compare"
          >
            {better ? "▲" : "▼"} best {previous} → {result?.wpm}
          </div>
        </Show>
        <div class="grid grid-cols-3 gap-2">
          <HudCell label="raw" value={String(result?.raw ?? 0)} />
          <HudCell label="accuracy" value={`${result?.accuracy ?? 0}%`} />
          <HudCell label="words" value={String(result?.wordsComplete ?? 0)} />
        </div>
        <Show when={mode() === "daily"}>
          <div class="text-xs text-sub">
            daily sprint — streak {getSprintStats().daily.streak} (best today:{" "}
            {getSprintStats().daily.bestWpm})
          </div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text={copied() ? "copied!" : "share result"}
            fa={{ icon: "fa-share-alt" }}
            class="w-full"
            onClick={() => void share()}
          />
          <Button
            text="another attempt"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => backToIdle()}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-bolt" }} text="ten-second sprint" />
        <p class="text-sub">
          maximum wpm in exactly ten seconds: wait for GO, type as fast as you
          can — a key before GO voids the attempt. The window blur voids it too.
        </p>
      </section>

      <Show when={pagePhase() !== "idle"} fallback={<IdleScreen />}>
        <Show
          when={pagePhase() !== "arming"}
          fallback={
            <div class="grid place-items-center rounded bg-sub-alt py-16">
              <div class="text-3xl font-bold text-sub">wait for GO…</div>
              <div class="pt-2 text-xs text-error">
                typing before GO voids the attempt
              </div>
            </div>
          }
        >
          <Show when={pagePhase() === "running"} fallback={<ResultScreen />}>
            <RunningScreen />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
