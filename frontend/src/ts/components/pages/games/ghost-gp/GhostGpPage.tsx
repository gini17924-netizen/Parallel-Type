import {
  For,
  JSXElement,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import type { BotDuelProgress } from "../../../../utils/bot-duel/lan";

import { Config } from "../../../../config/store";
import { playTimeWarning } from "../../../../controllers/sound-controller";
import { getLocalPB } from "../../../../db";
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
import { getLastResult } from "../../../../states/snapshot";
import { getActiveFunboxes } from "../../../../test/funbox/list";
import {
  createDuelEngine,
  type DuelState,
  type DuelPhase,
} from "../../../../utils/bot-duel/duel-engine";
import {
  createRemotePacer,
  type RemotePacer,
} from "../../../../utils/bot-duel/remote-pacer";
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
import { gpLanStream, lanGhostGp } from "../../../../utils/ghost-gp/lan";
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

type PagePhase = "picker" | "countdown" | "duel" | "awaiting" | "result";
type GhostKind = "last" | "pb";

/** the online verdict once the peer's finish is known (the engine's own
 * phase can be stale — their crossing may predate my completion) */
type GpOnlineResult = {
  phase: DuelPhase;
  winnerAtMs: number | undefined;
  margin: string | undefined;
  opponentAcc: number | undefined;
};

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
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch()?.gameId === "ghost-gp" ? "countdown" : "picker",
  );
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
  const [voidText, setVoidText] = createSignal(
    "race void — the window lost focus, nothing was recorded",
  );
  //online (LAN) state — the opponent replaces the ghost
  const [onlineResult, setOnlineResult] = createSignal<
    GpOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: ReturnType<typeof createGpEngine> | undefined;
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
    if (getLanMatch()?.gameId !== "ghost-gp") return;
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

  const lanMode = (): boolean => getLanMatch()?.gameId === "ghost-gp";

  /** online matches race over the host's seeded length, not the picker's */
  const totalWords = (): number =>
    lanMode() ? wordList().length : raceLength();

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

  /** the shared countdown mechanics (offline ghosts and the online peer) */
  const runCountdown = (): void => {
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

  const startCountdown = (date: string | undefined): void => {
    const g = ghost();
    if (g === undefined) return;
    setGhostLabel(
      `${g.label} · ${ghostWpm()}wpm${date !== undefined ? ` · ${date}` : ""}${
        g.kind === "curve" ? " (curve)" : ""
      }`,
    );
    runCountdown();
  };

  const beginDuel = (): void => {
    if (lanMode()) {
      remotePacer = createRemotePacer(wordList());
      engine = createDuelEngine({
        words: wordList(),
        botWpm: 0,
        pacer: remotePacer,
      });
    } else {
      const g = ghost();
      if (g === undefined) return;
      remotePacer = undefined;
      engine = createGpEngine({ words: wordList(), ghost: g });
    }
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
    let resolvedGhost: Ghost = resolved.ghost;
    if (ghostKind() === "last" && last !== undefined) {
      const heavy = await loadLocalHeavyResult(last._id);
      resolvedGhost = curveGhostFromChartData(
        heavy?.chartData,
        resolved.ghost.wpm,
        resolved.ghost.label,
      );
    }
    setGhost(resolvedGhost);
    startCountdown(date);
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
    if (lanMode()) {
      endOnlineRace(state);
      return;
    }
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
    if (lanMode()) return; //online: a blur cannot cheat the local clock
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
        if (remotePacer !== undefined) {
          const after = engine.state();
          sendLanMatchProgress(
            lanGhostGp.encodeProgress({
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
    //arm first: a refused start never reaches the wire
    armLanMatch({
      role: "host",
      peerName: match.peerName,
      start: match.start,
    });
    if (getLanMatch() === undefined) return;
    sendLanMatchStart(match.start, lanPreFillName() || "P1");
  };

  //an armed (or re-armed) gp match IS the online start: the seed builds
  //the shared stream, the remote pacer replaces the ghost, the countdown
  //begins on mount and on rematch
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "ghost-gp") return;
    void (async () => {
      let pool: string[] = [];
      const lang = match.start.params["lang"];
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${typeof lang === "string" ? lang : Config.language}.json`,
        );
        pool = data.words;
      } catch {
        pool = [];
      }
      setOnlineResult(undefined);
      setRematchSent(false);
      setVoided(false);
      setWordList(gpLanStream(pool, match.start.seed ?? 1));
      remotePacer = createRemotePacer(wordList());
      setGhostLabel(`${match.peerName} — online`);
      runCountdown();
    })();
  });

  //the relayed peer progress feeds the remote pacer (our race frame)
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined || remotePacer === undefined) return;
    //the registry decode already shaped this state (the word-index pair)
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

  //the peer's finish resolves the held verdict
  createEffect(() => {
    if (pagePhase() !== "awaiting") return;
    if (getRemoteFinished() === undefined) return;
    const state = duelState();
    if (state !== undefined) finalizeOnline(state);
  });

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "ghost-gp") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the race voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "ghost-gp") return;
    if (isLanConnected()) return;
    if (
      pagePhase() !== "countdown" &&
      pagePhase() !== "duel" &&
      pagePhase() !== "awaiting"
    ) {
      return;
    }
    stopTimers();
    engine = undefined;
    remotePacer = undefined;
    clearLanMatch();
    setVoidText("the opponent left — race void, nothing was recorded");
    setVoided(true);
    setPagePhase("picker");
  });

  const currentWord = (): string =>
    wordList()[duelState()?.playerWordIndex ?? 0] ?? "";
  const ghostWord = (): string => {
    const index = Math.min(duelState()?.botWordIndex ?? 0, totalWords() - 1);
    return wordList()[index] ?? "";
  };
  const progress = (wordIndex: number): number =>
    Math.min(100, Math.round((wordIndex / totalWords()) * 100));

  const opponentLabel = (): string => getLanMatch()?.peerName ?? "the ghost";
  const resultPhase = (): DuelPhase =>
    onlineResult()?.phase ?? duelState()?.phase ?? "draw";
  const resultFinishMs = (): number | undefined =>
    onlineResult()?.winnerAtMs ?? duelState()?.finishedAtMs;

  const GhostPicker = (): JSXElement => {
    const last = getLastResult();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={voided()}>
          <div class="text-error">{voidText()}</div>
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

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="gp-awaiting">
          waiting for {opponentLabel()} to finish…
        </div>
        <div class="pt-2 text-sub">
          you crossed in {((duelState()?.finishedAtMs ?? 0) / 1000).toFixed(2)}s
          — the verdict lands when they do
        </div>
      </section>
    );
  };

  const ResultOverlay = (): JSXElement => {
    const state = duelState();
    const online = (): GpOnlineResult | undefined => onlineResult();
    const won = resultPhase() === "playerWon";
    const draw = resultPhase() === "draw";
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div
          class={cn(
            "text-4xl font-bold",
            won ? "text-main" : draw ? "text-sub" : "text-error",
          )}
        >
          {won
            ? lanMode()
              ? "you win!"
              : "you beat the ghost!"
            : draw
              ? lanMode()
                ? "draw"
                : "dead heat"
              : lanMode()
                ? `${opponentLabel()} wins`
                : "the ghost wins"}
        </div>
        <div
          class={cn(
            "grid gap-2",
            online()?.margin !== undefined ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {resultFinishMs() === undefined
                ? "—"
                : `${((resultFinishMs() ?? 0) / 1000).toFixed(2)}s`}
            </div>
            <div class="text-xs text-sub">finish</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state === undefined ? "—" : `${accuracy(state)}%`}
            </div>
            <div class="text-xs text-sub">accuracy</div>
          </div>
          <Show
            when={online() !== undefined}
            fallback={
              <div class="rounded bg-bg p-3">
                <div class="text-xl font-bold text-main tabular-nums">
                  {ghostWpm()}
                </div>
                <div class="text-xs text-sub">ghost wpm</div>
              </div>
            }
          >
            <div class="rounded bg-bg p-3" data-testid="gp-margin">
              <div class="text-xl font-bold text-main tabular-nums">
                {online()?.margin}
              </div>
              <div class="text-xs text-sub">margin</div>
            </div>
            <div class="rounded bg-bg p-3">
              <div class="text-xl font-bold text-main tabular-nums">
                {online()?.opponentAcc ?? 0}%
              </div>
              <div class="text-xs text-sub">opponent</div>
            </div>
          </Show>
        </div>
        <Show
          when={online() === undefined}
          fallback={
            <div class="grid grid-cols-2 gap-2">
              <Button
                text={
                  rematchSent() ? "rematch requested — waiting…" : "rematch"
                }
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
          }
        >
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
        </Show>
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
            <AwaitingScreen />
          </Show>
        }
      >
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
              <Show
                when={lanMode()}
                fallback={
                  <>
                    <i class="fas fa-ghost" title={ghostLabel()}></i>
                    <span class="text-[0.6rem]">{ghostWpm()}wpm</span>
                  </>
                }
              >
                <i class="fas fa-user-friends" title={ghostLabel()}></i>
                <span class="text-[0.6rem]">{opponentLabel()}</span>
              </Show>
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
            {lanMode() ? `${opponentLabel()} is typing` : "ghost is typing"}:{" "}
            {ghostWord()}
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

      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="gp-online-vs"
        >
          <i class="fas fa-user-friends"></i> online vs {opponentLabel()}
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
        <GhostPicker />
      </Show>
    </div>
  );
}
