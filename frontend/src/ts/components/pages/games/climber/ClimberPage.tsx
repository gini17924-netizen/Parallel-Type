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
import { playClick, playError } from "../../../../controllers/sound-controller";
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
import { BALANCE } from "../../../../utils/climber/balance";
import {
  createClimberEngine,
  type ClimberEngine,
  type ClimberState,
} from "../../../../utils/climber/engine";
import {
  climberLanWordFor,
  lanClimber,
  resolveClimberVerdict,
  type ClimberRemoteState,
  type ClimberVerdict,
} from "../../../../utils/climber/lan";
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

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both climbers have reported */
type ClimberOnlineResult = {
  verdict: ClimberVerdict;
  myHeight: number;
  theirHeight: number;
  theirTimeMs: number | null;
};

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
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch()?.gameId === "climber" ? "playing" : "menu",
  );
  const [engineState, setEngineState] = createSignal<ClimberState | undefined>(
    undefined,
  );
  const [fallFlash, setFallFlash] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [newRecord, setNewRecord] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer's climb on the same seeded platforms
  const [remoteState, setRemoteState] = createSignal<
    ClimberRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    ClimberOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: ClimberEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  //reactive: the banner and the tick both read the live target
  const [targetH, setTargetH] = createSignal(Number.MAX_SAFE_INTEGER);
  let runStart = 0;
  let myFinish: { finishMs: number } | undefined;
  let myFinishSent = false;
  let lastSentHeight = -1;
  let lastSentScore = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    tickTimer = undefined;
    flashTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-climb (header back, route change) tells the peer the
  //race ended without a finish and disarms — they are never left waiting
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "climber") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    sendLanMatchFinished(null, 0);
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "climber";

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (myFinish !== undefined) {
      //I reached the target: the lower finish time wins
      if (finished === undefined) return;
      setOnlineResult({
        verdict: resolveClimberVerdict(myFinish, {
          finishMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
        }),
        myHeight: engineState()?.platformIndex ?? 0,
        theirHeight: remoteState()?.height ?? 0,
        theirTimeMs: finished.finishMs,
      });
    } else {
      //I died before the target — I can never finish: they win
      setOnlineResult({
        verdict: "lost",
        myHeight: engineState()?.platformIndex ?? 0,
        theirHeight: remoteState()?.height ?? 0,
        theirTimeMs: finished?.finishMs ?? null,
      });
    }
    setPagePhase("result");
  };

  const myFinishNow = (): void => {
    if (myFinishSent) return;
    myFinishSent = true;
    myFinish = { finishMs: Date.now() - runStart };
    const state = engine?.state();
    sendLanMatchProgress(
      lanClimber.encodeProgress({
        height: state?.platformIndex ?? 0,
        score: state?.score ?? 0,
      }),
    );
    sendLanMatchFinished(myFinish.finishMs, 100);
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    } else {
      setPagePhase("awaiting");
    }
  };

  /** the one tick loop both the offline climb and the online race share */
  const startTickLoop = (): void => {
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
      //online: relay the climb when it moved
      if (
        lanMode() &&
        (state.platformIndex !== lastSentHeight ||
          state.score !== lastSentScore)
      ) {
        lastSentHeight = state.platformIndex;
        lastSentScore = state.score;
        sendLanMatchProgress(
          lanClimber.encodeProgress({
            height: state.platformIndex,
            score: state.score,
          }),
        );
      }
      //online: the target height ends the race (death would lose it)
      if (lanMode() && state.platformIndex >= targetH()) {
        stopTimers();
        myFinishNow();
        return;
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

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
    const unlocked = Array.from(unlockedLetters(Config.language)).filter((ch) =>
      /\p{L}/u.test(ch),
    );
    const weakPool =
      unlocked.length >= 2
        ? generatePseudoWords(unlocked.join(""), 20, [...pool])
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
    startTickLoop();
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //died before the target — I can never finish: the peer takes it
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchFinished(null, 0);
      }
      setOnlineResult({
        verdict: "lost",
        myHeight: state?.platformIndex ?? 0,
        theirHeight: remoteState()?.height ?? 0,
        theirTimeMs: getRemoteFinished()?.finishMs ?? null,
      });
      setPagePhase("result");
      return;
    }
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
      if (lanMode()) return; //online: the timers keep draining — no pause
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

  //an armed (or re-armed) climber match IS the online start: the seed
  //builds the identical platforms, the race to the target height begins
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "climber") return;
    void (async () => {
      const lang =
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english";
      const height = match.start.params["height"];
      let pool: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${lang}.json`,
        );
        const filtered = [
          ...new Set(data.words.map((word) => word.toLowerCase())),
        ].filter((word) => /^\p{L}{3,6}$/u.test(word));
        if (filtered.length >= 30) pool = filtered;
      } catch {
        //offline fallback list
      }
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setNewRecord(false);
      setPaused(false);
      myFinish = undefined;
      myFinishSent = false;
      lastSentHeight = -1;
      lastSentScore = -1;
      setTargetH(
        typeof height === "number" && height > 0 ? Math.floor(height) : 30,
      );
      runStart = Date.now();
      engine = createClimberEngine({
        wordFor: climberLanWordFor(pool, match.start.seed ?? 1),
      });
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  //the relayed peer progress lands decoded — the HUD reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as ClimberRemoteState);
  });

  //the peer's finish resolves the held verdict (or arrived before mine)
  createEffect(() => {
    if (pagePhase() !== "awaiting") return;
    if (getRemoteFinished() === undefined) return;
    resolveOnlineResult();
  });

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "climber") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the climb voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "climber") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  const backToMenu = (): void => {
    if (lanMode()) {
      //leaving online: the same clean leave
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchFinished(null, 0);
      }
      clearLanMatch();
    }
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
                //KI-47: 50 here was 50 PIXELS, not 50% — center properly
                left: `calc(50% - ${PLATFORM_W / 2}px)`,
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
            left: "calc(50% - 11px)",
            bottom: `${topOf(index()) + PLATFORM_H - 8}px`,
            transition: "bottom 200ms ease",
          }}
          data-testid="cl-runner"
        >
          ▲
        </div>
        {/*online: the peer's marker when they are inside my window*/}
        <Show
          when={
            lanMode() &&
            (remoteState()?.height ?? -1) >= lowest() &&
            (remoteState()?.height ?? -1) <= lowest() + platforms().length
          }
        >
          <div
            class="absolute grid place-items-center rounded-full border-2 border-error bg-bg/40 text-[9px] font-bold text-error"
            style={{
              width: "20px",
              height: "20px",
              right: "calc(50% - 11px)",
              bottom: `${topOf(remoteState()?.height ?? 0) + PLATFORM_H - 8}px`,
              transition: "bottom 200ms ease",
            }}
            data-testid="cl-peer"
          >
            ▲
          </div>
        </Show>
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

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="cl-awaiting">
          you reached {targetH()} in{" "}
          {((myFinish?.finishMs ?? 0) / 1000).toFixed(1)}s — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): ClimberOnlineResult | undefined => onlineResult();
    const verdict = online()?.verdict;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div
          class={cn(
            "text-3xl font-bold",
            verdict === "won"
              ? "text-main"
              : verdict === "draw"
                ? "text-sub"
                : "text-error",
          )}
          data-testid="cl-verdict"
        >
          {verdict === "won"
            ? "you win!"
            : verdict === "draw"
              ? "draw"
              : verdict === "lost" && myFinish === undefined
                ? `you fell — ${getLanMatch()?.peerName ?? "the opponent"} takes it`
                : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.myHeight ?? 0} ·{" "}
              {myFinish !== undefined
                ? `${((myFinish.finishMs ?? 0) / 1000).toFixed(1)}s`
                : "fell"}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirHeight ?? 0} ·{" "}
              {online()?.theirTimeMs === null
                ? "climbing"
                : `${((online()?.theirTimeMs ?? 0) / 1000).toFixed(1)}s`}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
        </div>
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
      </section>
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
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="cl-online-vs"
        >
          <i class="fas fa-arrow-up"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — first to {targetH()} platforms wins
        </div>
      </Show>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show
          when={pagePhase() === "playing"}
          fallback={
            <Show
              when={pagePhase() === "awaiting"}
              fallback={
                <Show when={lanMode()} fallback={<ResultScreen />}>
                  <OnlineResultScreen />
                </Show>
              }
            >
              <AwaitingScreen />
            </Show>
          }
        >
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
