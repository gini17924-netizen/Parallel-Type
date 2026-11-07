import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import type { DuelState } from "../../../../utils/bot-duel/duel-engine";

import { Config } from "../../../../config/store";
import { playTimeWarning } from "../../../../controllers/sound-controller";
import { getLocalPB } from "../../../../db";
import { getLastResult } from "../../../../states/snapshot";
import { getActiveFunboxes } from "../../../../test/funbox/list";
import { cn } from "../../../../utils/cn";
import {
  curveGhostFromChartData,
  ghostFromLastResult,
  ghostFromPersonalBest,
  type Ghost,
  type GhostSourceResult,
} from "../../../../utils/ghost-gp/ghost-source";
import { createGpEngine } from "../../../../utils/ghost-gp/gp-engine";
import { recordGhostRace } from "../../../../utils/ghost-gp/gp-store";
import { cachedFetchJson } from "../../../../utils/json-data";
import { loadLocalHeavyResult } from "../../../../utils/local-persistence";
import * as Misc from "../../../../utils/misc";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const COUNTDOWN_STEP_MS = 900;
const FALLBACK_WORDS = [
  "parallel",
  "typing",
  "speed",
  "focus",
  "rhythm",
  "words",
];

const RACE_LENGTHS = [
  { id: "quick", label: "quick", words: 20 },
  { id: "standard", label: "standard", words: 35 },
  { id: "long", label: "long", words: 60 },
] as const;

type PagePhase = "picker" | "countdown" | "duel" | "result";
type GhostKind = "last" | "pb";

/** fills the race to the requested length by cycling the language pool */
function buildRaceWords(pool: string[], raceWords: number): string[] {
  const source = pool.length > 0 ? pool : FALLBACK_WORDS;
  const out: string[] = [];
  for (let i = 0; i < raceWords; i++) {
    out.push(source[i % source.length] ?? "typo");
  }
  return out;
}

/**
 * Ghost GP (idea G3): race a ghost built from your own records — the last
 * run or a personal best of the current language. The race mechanics are
 * the duel engine's (idea G2); a window blur voids the race without
 * recording anything. The game never writes results/PBs/XP.
 */
export function GhostGpPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("picker");
  const [ghostKind, setGhostKind] = createSignal<GhostKind>("last");
  const [raceLength, setRaceLength] = createSignal<number>(20);
  const [wordList, setWordList] = createSignal<string[]>([]);
  const [duelState, setDuelState] = createSignal<DuelState | undefined>(
    undefined,
  );
  const [countdown, setCountdown] = createSignal(3);
  const [typed, setTyped] = createSignal(0);
  const [wordErrors, setWordErrors] = createSignal(0);
  const [flash, setFlash] = createSignal(false);
  const [voided, setVoided] = createSignal(false);
  const [sourceMessage, setSourceMessage] = createSignal<string | undefined>(
    undefined,
  );
  const [ghost, setGhost] = createSignal<Ghost | undefined>(undefined);
  const [ghostLabel, setGhostLabel] = createSignal("ghost");

  let engine: ReturnType<typeof createGpEngine> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let countdownTimer: ReturnType<typeof setInterval> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (countdownTimer !== undefined) clearInterval(countdownTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    tickTimer = undefined;
    countdownTimer = undefined;
    flashTimer = undefined;
  };

  onCleanup(stopTimers);

  /** live accuracy percent (0 while nothing was typed) */
  const accuracy = (state: DuelState): number => {
    const attempts = state.playerCorrectChars + state.playerWrongChars;
    return attempts === 0
      ? 0
      : Math.round((state.playerCorrectChars / attempts) * 100);
  };

  /** re-resolves the ghost from live data (a record can vanish between the
   * picker and the start — the re-validation the idea doc requires) */
  const resolveGhost = (): GhostSourceResult => {
    if (ghostKind() === "last") {
      const last = getLastResult();
      return ghostFromLastResult(
        last === undefined
          ? undefined
          : { wpm: last.wpm, language: last.language },
        Config.language,
      );
    }
    const pb = getLocalPB(
      Config.mode,
      Misc.getMode2(Config, null),
      Config.punctuation,
      Config.numbers,
      Config.language,
      Config.difficulty,
      Config.lazyMode,
      getActiveFunboxes(),
    );
    return ghostFromPersonalBest(
      pb === undefined ? undefined : { wpm: pb.wpm, language: pb.language },
      Config.language,
    );
  };

  /** the picker's per-source preview: the ghost wpm this source offers now */
  const previewWpm = (): number | undefined => {
    const resolved = resolveGhost();
    return resolved.ok ? resolved.ghost.wpm : undefined;
  };

  const reasonMessage = (reason: string): string => {
    if (reason === "no-result") {
      return ghostKind() === "last"
        ? "run a test first — the ghost needs a record"
        : "no personal best for this mode yet";
    }
    if (reason === "wrong-language") {
      return "the ghost's language doesn't match the race language";
    }
    return "the ghost's wpm is unusable";
  };

  /** the summary wpm of the resolved ghost (a curve shows its average) */
  const ghostWpm = (): number => {
    const g = ghost();
    if (g === undefined) return 0;
    return g.kind === "curve" ? g.averageWpm : g.wpm;
  };

  const startCountdown = (date: string | undefined): void => {
    const g = ghost();
    if (g === undefined) return;
    setGhostLabel(
      `${g.label} · ${ghostWpm()}wpm${date !== undefined ? ` · ${date}` : ""}${
        g.kind === "curve" ? " (curve)" : ""
      }`,
    );
    setPagePhase("countdown");
    setCountdown(3);
    void playTimeWarning();
    countdownTimer = setInterval(() => {
      const next = countdown() - 1;
      setCountdown(next);
      if (next <= 0) {
        stopTimers();
        beginDuel();
        return;
      }
      void playTimeWarning();
    }, COUNTDOWN_STEP_MS);
  };

  const beginDuel = (): void => {
    const g = ghost();
    if (g === undefined) return;
    engine = createGpEngine({ words: wordList(), ghost: g });
    engine.start(performance.now());
    setTyped(0);
    setWordErrors(0);
    setPagePhase("duel");
    setDuelState(engine.state());
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(performance.now());
      setDuelState(state);
      if (state.phase !== "running") endRace(state);
    }, TICK_MS);
  };

  const startRace = async (): Promise<void> => {
    setVoided(false);
    setSourceMessage(undefined);
    //re-validate against live data (the record may be gone or stale)
    const resolved = resolveGhost();
    if (!resolved.ok) {
      setSourceMessage(reasonMessage(resolved.reason));
      return;
    }
    if (wordList().length !== raceLength()) {
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${Config.language}.json`,
        );
        setWordList(buildRaceWords(data.words, raceLength()));
      } catch {
        setWordList(buildRaceWords(FALLBACK_WORDS, raceLength()));
      }
    }
    const last = ghostKind() === "last" ? getLastResult() : undefined;
    const date =
      last !== undefined
        ? new Date(last.timestamp).toLocaleDateString()
        : undefined;
    //phase 3: the last-run ghost tries the record's real per-second curve
    //(the heavy store's chartData) — stripped rows, "toolong" charts and
    //short bursts fall back to the constant ghost of the result's wpm
    let ghost: Ghost = resolved.ghost;
    if (ghostKind() === "last" && last !== undefined) {
      const heavy = await loadLocalHeavyResult(last._id);
      ghost = curveGhostFromChartData(
        heavy?.chartData,
        resolved.ghost.wpm,
        resolved.ghost.label,
      );
    }
    setGhost(ghost);
    startCountdown(date);
  };

  const endRace = (state: DuelState): void => {
    stopTimers();
    const result =
      state.phase === "playerWon"
        ? "won"
        : state.phase === "botWon"
          ? "lost"
          : "draw";
    recordGhostRace({
      result,
      finishMs: state.phase === "botWon" ? null : (state.finishedAtMs ?? null),
      ghostWpm: ghostWpm(),
      lang: Config.language,
    });
    //ghostWpm() derives from the stored ghost signal — untouched here
    setPagePhase("result");
  };

  const voidRace = (): void => {
    if (pagePhase() !== "duel" && pagePhase() !== "countdown") return;
    stopTimers();
    engine = undefined;
    setVoided(true);
    setPagePhase("picker");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "duel") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1) event.preventDefault();
    else return;
    const state = duelState();
    if (state === undefined || engine === undefined) return;

    const word = wordList()[state.playerWordIndex];
    if (word === undefined) return;
    const expected = word[typed()]?.toLowerCase();
    const ch = event.key.toLowerCase();
    const correct = expected === ch;

    engine.feed({ type: "char", correct }, performance.now());
    if (!correct) {
      setWordErrors((errors) => errors + 1);
      setFlash(true);
      if (flashTimer !== undefined) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setFlash(false), 180);
    } else {
      const nextTyped = typed() + 1;
      if (nextTyped >= word.length) {
        engine.feed(
          { type: "wordCompleted", errors: wordErrors() },
          performance.now(),
        );
        setTyped(0);
        setWordErrors(0);
      } else {
        setTyped(nextTyped);
      }
    }
    setDuelState(engine.state());
    const after = duelState();
    if (after !== undefined && after.phase !== "running") endRace(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("blur", voidRace);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", voidRace);
    });
  });

  const currentWord = (): string =>
    wordList()[duelState()?.playerWordIndex ?? 0] ?? "";
  const ghostWord = (): string => {
    const index = Math.min(duelState()?.botWordIndex ?? 0, raceLength() - 1);
    return wordList()[index] ?? "";
  };
  const progress = (wordIndex: number): number =>
    Math.min(100, Math.round((wordIndex / raceLength()) * 100));

  const GhostPicker = (): JSXElement => {
    const last = getLastResult();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={voided()}>
          <div class="text-error">
            race void — the window lost focus, nothing was recorded
          </div>
        </Show>
        <Show when={sourceMessage() !== undefined}>
          <div class="text-error">{sourceMessage()}</div>
        </Show>
        <div class="text-sub">your ghost</div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text={`last run${last === undefined ? " (—)" : ` (${last.wpm}wpm)`}`}
            class={cn("w-full", ghostKind() === "last" && "bg-main text-bg")}
            onClick={() => setGhostKind("last")}
          />
          <Button
            text={`personal best${previewWpm() === undefined && ghostKind() === "pb" ? " (—)" : ""}`}
            class={cn("w-full", ghostKind() === "pb" && "bg-main text-bg")}
            onClick={() => setGhostKind("pb")}
          />
        </div>
        <div class="text-xs text-sub">
          the ghost paces your record over the race — a PB of another mode never
          leaks in
        </div>
        <div class="text-sub">race length</div>
        <div class="grid grid-cols-3 gap-2">
          <For each={RACE_LENGTHS}>
            {(length) => (
              <Button
                text={length.label}
                class={cn(
                  "w-full",
                  raceLength() === length.words && "bg-main text-bg",
                )}
                onClick={() => {
                  setRaceLength(length.words);
                  setWordList([]); //a new length needs a fresh sequence
                }}
              />
            )}
          </For>
        </div>
        <Button
          text="start race"
          fa={{ icon: "fa-ghost" }}
          class="w-full"
          onClick={() => void startRace()}
        />
      </section>
    );
  };

  const ResultOverlay = (): JSXElement => {
    const state = duelState();
    const won = state?.phase === "playerWon";
    const draw = state?.phase === "draw";
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div
          class={cn(
            "text-4xl font-bold",
            won ? "text-main" : draw ? "text-sub" : "text-error",
          )}
        >
          {won ? "you beat the ghost!" : draw ? "dead heat" : "the ghost wins"}
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state?.finishedAtMs === undefined
                ? "—"
                : `${(state.finishedAtMs / 1000).toFixed(2)}s`}
            </div>
            <div class="text-xs text-sub">finish</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state === undefined ? "—" : `${accuracy(state)}%`}
            </div>
            <div class="text-xs text-sub">accuracy</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {ghostWpm()}
            </div>
            <div class="text-xs text-sub">ghost wpm</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          want a fresh ghost? type a new test — your latest run becomes it
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="rematch (same words)"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => {
              setVoided(false);
              startCountdown(undefined);
            }}
          />
          <Button
            text="change race"
            fa={{ icon: "fa-sliders-h" }}
            class="w-full"
            onClick={() => {
              setVoided(false);
              setPagePhase("picker");
            }}
          />
        </div>
      </section>
    );
  };

  const DuelAndResult = (): JSXElement => {
    const state = (): DuelState | undefined => duelState();
    return (
      <Show when={pagePhase() === "duel"} fallback={<ResultOverlay />}>
        <section class="grid gap-2">
          <div
            class="relative h-10 w-full rounded bg-sub-alt"
            aria-label="race strip"
          >
            <div
              class="absolute top-1 grid place-items-center"
              style={{ left: `${progress(state()?.playerWordIndex ?? 0)}%` }}
            >
              <i class="fas fa-user text-main" title="you"></i>
            </div>
            <div
              class="absolute top-4 grid place-items-center text-sub"
              style={{ left: `${progress(state()?.botWordIndex ?? 0)}%` }}
            >
              <i class="fas fa-ghost" title={ghostLabel()}></i>
              <span class="text-[0.6rem]">{ghostWpm()}wpm</span>
            </div>
          </div>
          <div class="text-center text-lg">
            <span
              class={cn(
                "tabular-nums",
                (state()?.deltaChars ?? 0) >= 0 ? "text-main" : "text-error",
              )}
              data-testid="gp-delta"
            >
              {(state()?.deltaChars ?? 0) >= 0 ? "+" : ""}
              {state()?.deltaChars ?? 0} chars
            </span>
          </div>
        </section>

        <section class="grid place-items-center rounded bg-sub-alt py-10">
          <div
            class={cn(
              "text-4xl font-bold tracking-widest",
              flash() && "text-error",
            )}
            dir="auto"
            data-testid="gp-word"
          >
            <span class="text-main">{currentWord().slice(0, typed())}</span>
            <span>{currentWord().slice(typed())}</span>
          </div>
          <div class="pt-4 text-sm text-sub" dir="auto">
            ghost is typing: {ghostWord()}
          </div>
        </section>
      </Show>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-ghost" }} text="ghost gp" />
        <p class="text-sub">
          race your own ghosts: your latest run or a personal best paces the
          same word sequence you type. Nothing here touches your results.
        </p>
      </section>

      <Show
        when={pagePhase() === "picker"}
        fallback={
          <Show when={pagePhase() === "countdown"} fallback={<DuelAndResult />}>
            <div class="grid place-items-center rounded bg-sub-alt py-16">
              <div class="text-6xl font-bold text-main">{countdown()}</div>
              <div class="pt-2 text-sub">get ready — wait for GO</div>
            </div>
          </Show>
        }
      >
        <GhostPicker />
      </Show>
    </div>
  );
}
