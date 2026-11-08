import {
  For,
  JSXElement,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../../config/store";
import { playTimeWarning } from "../../../../controllers/sound-controller";
import { navigate } from "../../../../router/navigate";
import { isLanConnected, lanPreFillName } from "../../../../states/lan";
import {
  armLanMatch,
  clearLanMatch,
  getLanMatch,
  getRemoteFinished,
  getRemoteProgress,
  getRematchAsked,
  sendLanMatchFinished,
  sendLanMatchProgress,
  sendLanMatchRematch,
  sendLanMatchStart,
  type LanMatch,
} from "../../../../states/lan-match";
import {
  completeDailyBotDuel,
  takePendingDailyStage,
} from "../../../../utils/bot-duel/daily";
import {
  createDuelEngine,
  type DuelEngine,
  type DuelPhase,
  type DuelState,
} from "../../../../utils/bot-duel/duel-engine";
import { recordDuelResult } from "../../../../utils/bot-duel/duel-store";
import {
  FALLBACK_WORDS,
  buildRaceWords,
} from "../../../../utils/bot-duel/duel-words";
import {
  lanBotDuel,
  type BotDuelProgress,
} from "../../../../utils/bot-duel/lan";
import {
  createRemotePacer,
  type RemotePacer,
} from "../../../../utils/bot-duel/remote-pacer";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const COUNTDOWN_STEP_MS = 900;

const BOT_TIERS = [40, 60, 80, 100, 120, 140];
const RACE_LENGTHS = [
  { id: "quick", label: "quick", words: 15 },
  { id: "standard", label: "standard", words: 30 },
  { id: "long", label: "long", words: 60 },
] as const;

type PagePhase = "picker" | "countdown" | "duel" | "awaiting" | "result";

/** the online verdict once the peer's finish is known (the engine's own
 * phase can be stale — their crossing may predate my completion) */
type OnlineResult = {
  phase: DuelPhase;
  winnerAtMs: number | undefined;
  margin: string | undefined;
  opponentAcc: number | undefined;
};

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
 *
 * Online (LAN phase 4): with a lan match armed the opponent replaces the
 * bot — a RemotePacer feeds the engine from the relayed progress, the
 * words come from the host's start message, and the finish verdict is the
 * comparison of the two reported finish times. Nothing is recorded.
 */
export function BotDuelPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch() !== undefined ? "countdown" : "picker",
  );
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
  const [voidText, setVoidText] = createSignal(
    "race void — the window lost focus, nothing was recorded",
  );
  const [onlineResult, setOnlineResult] = createSignal<
    OnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: DuelEngine | undefined;
  let remotePacer: RemotePacer | undefined;
  let engineStartedAt = 0;
  let myFinishSent = false;
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

  //leaving mid-race (header back, route change) tells the peer the race
  //ended without a completion and disarms — they are never left waiting
  onCleanup(() => {
    if (getLanMatch() === undefined) return;
    if (
      pagePhase() !== "countdown" &&
      pagePhase() !== "duel" &&
      pagePhase() !== "awaiting"
    ) {
      return;
    }
    if (!myFinishSent) {
      myFinishSent = true;
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const accuracy = (state: DuelState): number => {
    const attempts = state.playerCorrectChars + state.playerWrongChars;
    return attempts === 0
      ? 0
      : Math.round((state.playerCorrectChars / attempts) * 100);
  };

  /** online matches race over the host's word list, not the picker length */
  const totalWords = (): number =>
    getLanMatch() !== undefined ? wordList().length : raceLength();

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
    engine = createDuelEngine({
      words: wordList(),
      botWpm: botWpm(),
      pacer: remotePacer,
    });
    engine.start(performance.now());
    engineStartedAt = performance.now();
    myFinishSent = false;
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
    //KI-40: a pending gauntlet stage locks the tier and length to the
    //day's table (the word order cycles deterministically already)
    const stage = takePendingDailyStage("bot-duel");
    if (stage !== undefined) {
      const params = stage.params as { botWpm?: number; words?: number };
      if (params.botWpm !== undefined) setBotWpm(params.botWpm);
      if (params.words !== undefined) setRaceLength(params.words);
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
    startCountdown();
  };

  /** the finish verdict in the aligned frames: the smaller reported time
   * wins; a peer without a completion loses; the exact tie is a draw */
  const finalizeOnline = (state: DuelState): void => {
    const remote = getRemoteFinished();
    const myAt = state.finishedAtMs;
    let phase: DuelPhase = state.phase;
    let winnerAtMs: number | undefined = myAt;
    let margin: string | undefined;
    if (phase === "playerWon" && remote !== undefined) {
      const theirAt = remote.finishMs;
      if (theirAt === null) {
        phase = "playerWon";
      } else if (myAt === undefined || theirAt < myAt) {
        phase = "botWon";
        winnerAtMs = theirAt;
      } else if (theirAt === myAt) {
        phase = "draw";
      } else {
        phase = "playerWon";
      }
      if (theirAt !== null && myAt !== undefined) {
        margin = `${(Math.abs(myAt - theirAt) / 1000).toFixed(2)}s`;
      }
    }
    setOnlineResult({
      phase,
      winnerAtMs,
      margin,
      opponentAcc: remote?.acc,
    });
    setPagePhase("result");
  };

  const endOnlineRace = (state: DuelState): void => {
    if (!myFinishSent) {
      myFinishSent = true;
      sendLanMatchFinished(null, accuracy(state));
    }
    const remote = getRemoteFinished();
    if (state.phase === "playerWon" && remote === undefined) {
      //I crossed first — hold the verdict until their finish lands
      setPagePhase("awaiting");
      return;
    }
    finalizeOnline(state);
  };

  const endRace = (state: DuelState): void => {
    stopTimers();
    if (getLanMatch() !== undefined) {
      endOnlineRace(state);
      return;
    }
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
    if (getLanMatch() !== undefined) return; //online: a blur cannot cheat the local clock
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
        if (remotePacer !== undefined) {
          const after = engine.state();
          sendLanMatchProgress(
            lanBotDuel.encodeProgress({
              wordIndex: after.playerWordIndex,
              correctChars: after.playerCorrectChars,
            }),
          );
          if (after.playerWordIndex >= totalWords() && !myFinishSent) {
            myFinishSent = true;
            sendLanMatchFinished(
              performance.now() - engineStartedAt,
              accuracy(after),
            );
          }
        }
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

  const hostRematch = (match: LanMatch): void => {
    sendLanMatchStart(match.start, lanPreFillName() || "P1");
    armLanMatch({
      role: "host",
      peerName: match.peerName,
      start: match.start,
    });
  };

  //an armed (or re-armed) match IS the online start: the words arrive in
  //the start message and the countdown begins on mount and on rematch
  createEffect(() => {
    const match = getLanMatch();
    if (match === undefined) {
      remotePacer = undefined;
      return;
    }
    const words = match.start.words ?? [];
    setOnlineResult(undefined);
    setRematchSent(false);
    setVoided(false);
    setWordList(words);
    remotePacer = createRemotePacer(words);
    startCountdown();
  });

  //the relayed peer progress feeds the pacer (anchored in OUR frame)
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined || remotePacer === undefined) return;
    //the registry decode already shaped this state (BotDuelProgress)
    const state = progress.state as BotDuelProgress;
    remotePacer.onProgress(
      state.wordIndex,
      Math.max(0, progress.arrivalPerf - engineStartedAt),
    );
  });
  createEffect(() => {
    const finished = getRemoteFinished();
    if (finished === undefined || remotePacer === undefined) return;
    remotePacer.onFinished(
      finished.finishMs,
      Math.max(0, finished.arrivalPerf - engineStartedAt),
    );
  });

  //the host answers a rematch request by re-sending the same words
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the race voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch() === undefined) return;
    if (isLanConnected()) return;
    if (
      pagePhase() !== "countdown" &&
      pagePhase() !== "duel" &&
      pagePhase() !== "awaiting"
    ) {
      return;
    }
    stopTimers();
    clearLanMatch();
    setVoidText("the opponent left — match voided, nothing was recorded");
    setVoided(true);
    setPagePhase("picker");
  });

  //the peer's finish resolves the held verdict
  createEffect(() => {
    if (pagePhase() !== "awaiting") return;
    if (getRemoteFinished() === undefined) return;
    const state = duelState();
    if (state !== undefined) finalizeOnline(state);
  });

  const currentWord = (): string =>
    wordList()[duelState()?.playerWordIndex ?? 0] ?? "";
  const botWord = (): string => {
    const index = Math.min(duelState()?.botWordIndex ?? 0, totalWords() - 1);
    return wordList()[index] ?? "";
  };
  const progress = (wordIndex: number): number =>
    Math.min(100, Math.round((wordIndex / totalWords()) * 100));
  const opponentLabel = (): string => getLanMatch()?.peerName ?? "bot";
  const resultPhase = (): DuelPhase =>
    onlineResult()?.phase ?? duelState()?.phase ?? "draw";
  const resultFinishMs = (): number | undefined =>
    onlineResult()?.winnerAtMs ?? duelState()?.finishedAtMs;
  const myAccuracy = (): string => {
    const state = duelState();
    return state === undefined ? "—" : `${accuracy(state)}%`;
  };

  const Picker = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={voided()}>
          <div class="text-error">{voidText()}</div>
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
    const won = resultPhase() === "playerWon";
    const draw = resultPhase() === "draw";
    //full class names: tailwind cannot generate dynamic grid-cols values
    const resultCols = (): string => {
      const extra =
        (onlineResult()?.margin !== undefined ? 1 : 0) +
        (onlineResult()?.opponentAcc !== undefined ? 1 : 0);
      if (extra === 2) return "grid-cols-5";
      if (extra === 1) return "grid-cols-4";
      return "grid-cols-3";
    };
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div
          class={cn(
            "text-4xl font-bold",
            won ? "text-main" : draw ? "text-sub" : "text-error",
          )}
        >
          {won ? "you win!" : draw ? "draw" : `${opponentLabel()} wins`}
        </div>
        <div class={cn("grid gap-2", resultCols())}>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {resultFinishMs() === undefined
                ? "—"
                : `${((resultFinishMs() ?? 0) / 1000).toFixed(2)}s`}
            </div>
            <div class="text-xs text-sub">finish</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div
              class="text-xl font-bold text-main tabular-nums"
              data-testid="bd-acc"
            >
              {myAccuracy()}
            </div>
            <div class="text-xs text-sub">accuracy</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {duelState()?.momentum ?? 0}
            </div>
            <div class="text-xs text-sub">momentum</div>
          </div>
          <Show when={onlineResult()?.margin !== undefined}>
            <div class="rounded bg-bg p-3" data-testid="bd-margin">
              <div class="text-xl font-bold text-main tabular-nums">
                {onlineResult()?.margin}
              </div>
              <div class="text-xs text-sub">margin</div>
            </div>
          </Show>
          <Show when={onlineResult()?.opponentAcc !== undefined}>
            <div class="rounded bg-bg p-3" data-testid="bd-opp-acc">
              <div class="text-xl font-bold text-main tabular-nums">
                {onlineResult()?.opponentAcc}%
              </div>
              <div class="text-xs text-sub">opponent</div>
            </div>
          </Show>
        </div>
        <Show
          when={onlineResult()?.opponentAcc !== undefined}
          fallback={
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
          }
        >
          <div class="grid grid-cols-2 gap-2">
            <Button
              text={rematchSent() ? "rematch requested — waiting…" : "rematch"}
              fa={{ icon: "fa-redo" }}
              class="w-full"
              onClick={() => {
                const match = getLanMatch();
                if (match === undefined || rematchSent()) return;
                if (match.role === "host") {
                  hostRematch(match);
                } else {
                  sendLanMatchRematch();
                  setRematchSent(true);
                }
              }}
            />
            <Button
              text="leave to lobby"
              fa={{ icon: "fa-arrow-left" }}
              class="w-full"
              onClick={() => {
                clearLanMatch();
                void navigate({ to: "/games/online" });
              }}
            />
          </div>
        </Show>
      </section>
    );
  };

  const Awaiting = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="bd-awaiting">
          waiting for {opponentLabel()} to finish…
        </div>
        <div class="pt-2 text-sub">
          you crossed in {((duelState()?.finishedAtMs ?? 0) / 1000).toFixed(2)}s
          — the verdict lands when they do
        </div>
      </section>
    );
  };

  const DuelAndResult = (): JSXElement => {
    const state = (): DuelState | undefined => duelState();
    return (
      <Show
        when={pagePhase() === "duel"}
        fallback={
          <Show when={pagePhase() === "awaiting"} fallback={<ResultOverlay />}>
            <Awaiting />
          </Show>
        }
      >
        <section class="grid gap-3">
          <ProgressBar
            label={`you — ${state()?.playerWordIndex ?? 0}/${totalWords()}`}
            percent={progress(state()?.playerWordIndex ?? 0)}
            tone="main"
          />
          <ProgressBar
            label={
              getLanMatch() !== undefined
                ? `${opponentLabel()} — ${state()?.botWordIndex ?? 0}/${totalWords()}`
                : `bot ${botWpm()}wpm — ${state()?.botWordIndex ?? 0}/${totalWords()}`
            }
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
            {opponentLabel()} is typing: {botWord()}
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

      <Show when={getLanMatch() !== undefined}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="bd-online-vs"
        >
          <i class="fas fa-wifi"></i> online vs {opponentLabel()}
        </div>
      </Show>

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
