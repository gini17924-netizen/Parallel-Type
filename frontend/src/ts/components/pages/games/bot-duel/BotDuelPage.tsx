import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../../config/store";
import { playTimeWarning } from "../../../../controllers/sound-controller";
import { navigate } from "../../../../router/navigate";
import { completeDailyBotDuel } from "../../../../utils/bot-duel/daily";
import {
  createDuelEngine,
  type DuelEngine,
  type DuelState,
} from "../../../../utils/bot-duel/duel-engine";
import { recordDuelResult } from "../../../../utils/bot-duel/duel-store";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
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

const BOT_TIERS = [40, 60, 80, 100, 120, 140];
const RACE_LENGTHS = [
  { id: "quick", label: "quick", words: 15 },
  { id: "standard", label: "standard", words: 30 },
  { id: "long", label: "long", words: 60 },
] as const;

type PagePhase = "picker" | "countdown" | "duel" | "result";

/** fills the race to the requested length by cycling the language pool */
function buildRaceWords(pool: string[], raceWords: number): string[] {
  const source = pool.length > 0 ? pool : FALLBACK_WORDS;
  const out: string[] = [];
  for (let i = 0; i < raceWords; i++) {
    out.push(source[i % source.length] ?? "typo");
  }
  return out;
}

function ProgressBar(props: {
  label: string;
  percent: number;
  tone: "main" | "sub";
}): JSXElement {
  return (
    <div class="grid gap-1">
      <div class="flex justify-between text-xs text-sub">
        <span>{props.label}</span>
        <span class="tabular-nums">{props.percent}%</span>
      </div>
      <div class="h-2 w-full overflow-hidden rounded bg-bg">
        <div
          class={cn("h-full", props.tone === "main" ? "bg-main" : "bg-sub")}
          style={{ width: `${props.percent}%` }}
        ></div>
      </div>
    </div>
  );
}

/**
 * Bot Duel (idea G2): race a bot with a nominal wpm over one shared word
 * sequence. The UI owns the typing buffer and the timers; the pure engine
 * (utils/bot-duel) owns the race state. A window blur during the race voids
 * it without recording anything (anti clock-cheat, per the idea doc).
 */
export function BotDuelPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("picker");
  const [botWpm, setBotWpm] = createSignal(60);
  const [raceLength, setRaceLength] = createSignal<number>(30);
  const [wordList, setWordList] = createSignal<string[]>([]);
  const [duelState, setDuelState] = createSignal<DuelState | undefined>(
    undefined,
  );
  const [countdown, setCountdown] = createSignal(3);
  const [typed, setTyped] = createSignal(0);
  const [wordErrors, setWordErrors] = createSignal(0);
  const [flash, setFlash] = createSignal(false);
  const [voided, setVoided] = createSignal(false);

  let engine: DuelEngine | undefined;
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

  const accuracy = (state: DuelState): number => {
    const attempts = state.playerCorrectChars + state.playerWrongChars;
    return attempts === 0
      ? 0
      : Math.round((state.playerCorrectChars / attempts) * 100);
  };

  const startCountdown = (): void => {
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
    engine = createDuelEngine({ words: wordList(), botWpm: botWpm() });
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
    startCountdown();
  };

  const endRace = (state: DuelState): void => {
    stopTimers();
    const result =
      state.phase === "playerWon"
        ? "won"
        : state.phase === "botWon"
          ? "lost"
          : "draw";
    recordDuelResult({
      botWpm: botWpm(),
      words: raceLength(),
      result,
      //a loss has no player finish: the bot's crossing is not the player's
      finishMs: state.phase === "botWon" ? null : (state.finishedAtMs ?? null),
      accuracy: accuracy(state),
    });
    //the daily gauntlet: a pending stage resolves here and returns to it
    if (completeDailyBotDuel({ result, accuracy: accuracy(state) })) {
      void navigate({ to: "/games/daily-gauntlet" });
      return;
    }
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
  const botWord = (): string => {
    const index = Math.min(duelState()?.botWordIndex ?? 0, raceLength() - 1);
    return wordList()[index] ?? "";
  };
  const progress = (wordIndex: number): number =>
    Math.min(100, Math.round((wordIndex / raceLength()) * 100));

  const Picker = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={voided()}>
          <div class="text-error">
            race void — the window lost focus, nothing was recorded
          </div>
        </Show>
        <div class="text-sub">bot speed (wpm)</div>
        <div class="grid grid-cols-6 gap-2">
          <For each={BOT_TIERS}>
            {(tier) => (
              <Button
                text={String(tier)}
                class={cn(
                  "w-full",
                  botWpm() === tier && "bg-main text-bg",
                  tier === 140 && "text-xs",
                )}
                onClick={() => setBotWpm(tier)}
              />
            )}
          </For>
        </div>
        <div class="text-xs text-sub">
          140 is endgame — most typists never beat it
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
          fa={{ icon: "fa-flag-checkered" }}
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
          {won ? "you win!" : draw ? "draw" : "bot wins"}
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
            <div
              class="text-xl font-bold text-main tabular-nums"
              data-testid="bd-acc"
            >
              {state === undefined ? "—" : `${accuracy(state)}%`}
            </div>
            <div class="text-xs text-sub">accuracy</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state?.momentum ?? 0}
            </div>
            <div class="text-xs text-sub">momentum</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="rematch (same words)"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => {
              setVoided(false);
              startCountdown();
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
        <section class="grid gap-3">
          <ProgressBar
            label={`you — ${state()?.playerWordIndex ?? 0}/${raceLength()}`}
            percent={progress(state()?.playerWordIndex ?? 0)}
            tone="main"
          />
          <ProgressBar
            label={`bot ${botWpm()}wpm — ${state()?.botWordIndex ?? 0}/${raceLength()}`}
            percent={progress(state()?.botWordIndex ?? 0)}
            tone="sub"
          />
          <div class="text-center text-lg">
            <span
              class={cn(
                "tabular-nums",
                (state()?.deltaChars ?? 0) >= 0 ? "text-main" : "text-error",
              )}
              data-testid="bd-delta"
            >
              {(state()?.deltaChars ?? 0) >= 0 ? "+" : ""}
              {state()?.deltaChars ?? 0} chars
            </span>
            <span class="pl-3 text-sub">momentum {state()?.momentum ?? 0}</span>
          </div>
        </section>

        <section class="grid place-items-center rounded bg-sub-alt py-10">
          <div
            class={cn(
              "text-4xl font-bold tracking-widest",
              flash() && "text-error",
            )}
            dir="auto"
            data-testid="bd-word"
          >
            <span class="text-main">{currentWord().slice(0, typed())}</span>
            <span>{currentWord().slice(typed())}</span>
          </div>
          <div class="pt-4 text-sm text-sub" dir="auto">
            bot is typing: {botWord()}
          </div>
        </section>
      </Show>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-robot" }} text="bot duel" />
        <p class="text-sub">
          1-vs-1 against a bot with a fixed wpm: both sides type the same word
          sequence — first across the finish line wins. A window blur voids the
          race.
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
        <Picker />
      </Show>
    </div>
  );
}
