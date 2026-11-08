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
import {
  getRunnerBestDistanceM,
  recordRunnerRun,
} from "../../../../utils/climber/store";
import { cn } from "../../../../utils/cn";
import { createSeededRng } from "../../../../utils/daily-gauntlet/seeded-rng";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/runner/balance";
import {
  createRunnerEngine,
  type RunnerEngine,
  type RunnerState,
} from "../../../../utils/runner/engine";
import { kindIcon, type ObstacleKind } from "../../../../utils/runner/gen";
import {
  lanRunner,
  resolveRunnerVerdict,
  runnerLanPickWord,
  type RunnerRemoteState,
  type RunnerVerdict,
} from "../../../../utils/runner/lan";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the px→% mapping across the arena strip */
const STRIP_PX = 640;
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
];

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both runners have reported */
type RunnerOnlineResult = {
  verdict: RunnerVerdict;
  myMeters: number;
  theirMeters: number;
  theirLives: number;
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
 * Endless Runner (idea G15, phase 2 — mode B): the runner moves by
 * itself; obstacles stream in with a word and a direction icon (jump ↑
 * / slide ↓ / destroy ✕). Type the nearest obstacle's word to clear it;
 * one that passes untyped costs a life — three and the run is over.
 * Distance is the score. The background parallaxes on two layers.
 */
export function RunnerPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch()?.gameId === "runner" ? "playing" : "menu",
  );
  const [engineState, setEngineState] = createSignal<RunnerState | undefined>(
    undefined,
  );
  const [paused, setPaused] = createSignal(false);
  const [newRecord, setNewRecord] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer's run on the same seeded obstacles
  const [remoteState, setRemoteState] = createSignal<
    RunnerRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    RunnerOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: RunnerEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  //reactive: the banner and the tick both read the live target
  const [targetM, setTargetM] = createSignal(Number.MAX_SAFE_INTEGER);
  let runStart = 0;
  let myFinish: { finishMs: number } | undefined;
  let myFinishSent = false;
  let lastSentMeters = -1;
  let lastSentLives = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-run (header back, route change) tells the peer the race
  //ended without a finish and disarms — they are never left waiting
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "runner") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    sendLanMatchFinished(null, 0);
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "runner";

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (myFinish !== undefined) {
      //I crossed the line: the lower finish time wins
      if (finished === undefined) return;
      setOnlineResult({
        verdict: resolveRunnerVerdict(myFinish, {
          finishMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
        }),
        myMeters: engineState()?.result?.distanceM ?? 0,
        theirMeters: remoteState()?.meters ?? 0,
        theirLives: remoteState()?.lives ?? 0,
        theirTimeMs: finished.finishMs,
      });
    } else {
      //I died (three hits) before the line — I can never finish
      setOnlineResult({
        verdict: "lost",
        myMeters: engineState()?.result?.distanceM ?? 0,
        theirMeters: remoteState()?.meters ?? 0,
        theirLives: remoteState()?.lives ?? 0,
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
      lanRunner.encodeProgress({
        meters: state?.result?.distanceM ?? 0,
        lives: state?.lives ?? 0,
      }),
    );
    sendLanMatchFinished(myFinish.finishMs, 100);
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    } else {
      setPagePhase("awaiting");
    }
  };

  /** the one tick loop both the offline run and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined || paused()) return;
      const before = engine.state();
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (state.hits > before.hits) void playError();
      if (state.combo > before.combo) void playClick();
      //online: relay the run when it moved
      if (lanMode()) {
        const meters = Math.floor(state.distancePx / BALANCE.pxPerMeter);
        if (meters !== lastSentMeters || state.lives !== lastSentLives) {
          lastSentMeters = meters;
          lastSentLives = state.lives;
          sendLanMatchProgress(
            lanRunner.encodeProgress({ meters, lives: state.lives }),
          );
        }
      }
      //online: the target line ends the race (death would lose it)
      if (lanMode() && state.distancePx / BALANCE.pxPerMeter >= targetM()) {
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
    engine = createRunnerEngine({
      pickWord: (minLen, maxLen) => {
        const fitting = pool.filter(
          (word) => word.length >= minLen && word.length <= maxLen,
        );
        const source = fitting.length > 0 ? fitting : pool;
        return source[Math.floor(Math.random() * source.length)] ?? "cat";
      },
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //died (three hits) before the line — I can never finish
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchFinished(null, 0);
      }
      setOnlineResult({
        verdict: "lost",
        myMeters: state?.result?.distanceM ?? 0,
        theirMeters: remoteState()?.meters ?? 0,
        theirLives: remoteState()?.lives ?? 0,
        theirTimeMs: getRemoteFinished()?.finishMs ?? null,
      });
      setPagePhase("result");
      return;
    }
    if (state?.result !== undefined) {
      const { isNewRecord } = recordRunnerRun({
        distanceM: state.result.distanceM,
        hits: state.result.hits,
      });
      setNewRecord(isNewRecord);
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing" || paused()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const state = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (state === undefined) return;
    setEngineState(state);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    const onBlur = (): void => {
      if (pagePhase() !== "playing") return;
      if (lanMode()) return; //online: the run keeps going — no pause
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

  //an armed (or re-armed) runner match IS the online start: the seed
  //spawns the identical obstacles, the race to the line begins
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "runner") return;
    void (async () => {
      const lang =
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english";
      const meters = match.start.params["meters"];
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
      lastSentMeters = -1;
      lastSentLives = -1;
      setTargetM(
        typeof meters === "number" && meters > 0 ? Math.floor(meters) : 400,
      );
      runStart = Date.now();
      engine = createRunnerEngine({
        pickWord: runnerLanPickWord(pool, match.start.seed ?? 1),
        rng: createSeededRng(match.start.seed ?? 1),
      });
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  //the relayed peer progress lands decoded — the strip reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as RunnerRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "runner") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the run voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "runner") return;
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
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getRunnerBestDistanceM()}m
            </div>
            <div class="text-xs text-sub">best distance</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-lg font-bold text-main">
              {getRunnerBestDistanceM() > 0 ? "survivor" : "—"}
            </div>
            <div class="text-xs text-sub">status</div>
          </div>
        </div>
        <Button
          text="start running"
          fa={{ icon: "fa-running" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          the runner moves by itself — clear each obstacle by typing its word:
          ground words mean JUMP, air words mean SLIDE, drones get DESTROYED. an
          obstacle that passes you untyped costs one of your three lives. the
          gaps shrink as you speed up.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "38vh" }}
        aria-label="endless runner arena"
      >
        {/*the two-layer parallax (both keyed off the distance)*/}
        <div
          class="absolute inset-x-0 top-0 h-1/2 opacity-40"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--sub-alt-color) 0 40px, transparent 40px 80px)",
            "background-position-x": `${-(engineState()?.distancePx ?? 0) * 0.25}px`,
          }}
          data-testid="rn-parallax-far"
        ></div>
        <div
          class="absolute inset-x-0 bottom-0 h-1/2 opacity-70"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--sub-alt-color) 0 60px, transparent 60px 120px)",
            "background-position-x": `${-(engineState()?.distancePx ?? 0) * 0.6}px`,
          }}
          data-testid="rn-parallax-near"
        ></div>
        {/*the ground line*/}
        <div
          class="absolute left-0 w-full border-t-2 border-sub"
          style={{ bottom: "26%" }}
        ></div>
        {/*the obstacles streaming in (KI-34: inline reads)*/}
        <For each={engineState()?.obstacles ?? []}>
          {(obstacle) => {
            const leftPct = 100 - (obstacle.xPx / STRIP_PX) * 100;
            //jump obstacles ride the ground, slides hang high, drones fly mid
            const bottomPct =
              obstacle.kind === "jump"
                ? "26%"
                : obstacle.kind === "slide"
                  ? "58%"
                  : "42%";
            return (
              <div
                class={cn(
                  "absolute grid place-items-center rounded border-2 px-2 py-1",
                  obstacle.id === engineState()?.activeId
                    ? "border-main bg-bg"
                    : "border-sub bg-bg/70",
                )}
                style={{
                  left: `${leftPct}%`,
                  bottom: bottomPct,
                  transform: "translateX(-50%)",
                }}
                data-testid="rn-obstacle"
                data-kind={obstacle.kind}
                data-word={obstacle.word}
              >
                <span class="text-[10px] text-error">
                  {kindIcon(obstacle.kind)}
                </span>
                <span class="text-sm font-bold text-main" dir="auto">
                  {obstacle.word}
                </span>
              </div>
            );
          }}
        </For>
        {/*the runner marker, fixed mid-strip on the ground line*/}
        <div
          class="absolute grid place-items-center rounded-full border-2 border-main bg-main/30 text-xs font-bold text-main"
          style={{ left: "50%", bottom: "26%", width: "26px", height: "26px" }}
          data-testid="rn-runner"
        >
          ●
        </div>
        {/*online: the peer's runner marker (their relative progress)*/}
        <Show when={lanMode()}>
          {(() => {
            const rel =
              (remoteState()?.meters ?? 0) * BALANCE.pxPerMeter -
              (engineState()?.distancePx ?? 0);
            const left = 50 + (rel / (BALANCE.pxPerMeter * 40)) * 50;
            const visible = left > -6 && left < 106;
            return (
              <Show when={visible}>
                <div
                  class="absolute grid place-items-center rounded-full border-2 border-error bg-bg/30 text-[9px] font-bold text-error"
                  style={{
                    left: `${left}%`,
                    bottom: "30%",
                    width: "22px",
                    height: "22px",
                  }}
                  data-testid="rn-peer"
                >
                  ▲
                </div>
              </Show>
            );
          })()}
        </Show>
        <Show when={paused()}>
          <div
            class="absolute inset-0 grid place-items-center bg-bg/70 text-2xl font-bold text-main"
            data-testid="rn-paused"
          >
            paused
          </div>
        </Show>
      </section>
    );
  };

  const Lives = (): JSXElement => {
    return (
      <div class="flex justify-center gap-2" aria-label="lives">
        <For each={[0, 1, 2]}>
          {(i) => (
            <div
              class={cn(
                "text-xl",
                (engineState()?.lives ?? 0) > i
                  ? "text-main"
                  : "text-sub opacity-40",
              )}
              data-testid="rn-life"
            >
              ♥
            </div>
          )}
        </For>
      </div>
    );
  };

  const ActiveWord = (): JSXElement => {
    const word = (): string => engineState()?.word ?? "";
    const typed = (): number => engineState()?.typed ?? 0;
    const kind = (): ObstacleKind | undefined =>
      engineState()?.obstacles.find((it) => it.id === engineState()?.activeId)
        ?.kind;
    return (
      <div class="grid place-items-center gap-1">
        <Show
          when={word().length > 0}
          fallback={
            <div class="text-sub" data-testid="rn-word">
              clear ground ahead
            </div>
          }
        >
          <div
            class="text-4xl font-bold tracking-widest"
            dir="auto"
            data-testid="rn-word"
            data-word={word()}
          >
            <span class="text-error">{kindIcon(kind() ?? "jump")} </span>
            <span class="text-main">{word().slice(0, typed())}</span>
            <span class="text-sub">{word().slice(typed())}</span>
          </div>
        </Show>
        <div class="text-xs text-sub">
          type the nearest word — icons: ↑ jump · ↓ slide · ✕ destroy
        </div>
      </div>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="rn-awaiting">
          you crossed in {((myFinish?.finishMs ?? 0) / 1000).toFixed(1)}s —
          waiting for {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): RunnerOnlineResult | undefined => onlineResult();
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
          data-testid="rn-verdict"
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
              {online()?.myMeters ?? 0}m ·{" "}
              {myFinish !== undefined
                ? `${((myFinish.finishMs ?? 0) / 1000).toFixed(1)}s`
                : "fell"}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirMeters ?? 0}m ·{" "}
              {online()?.theirTimeMs === null
                ? "running"
                : `${((online()?.theirTimeMs ?? 0) / 1000).toFixed(1)}s`}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"} ·{" "}
              {online()?.theirLives ?? 0} ♥
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
          <div class="text-lg font-bold text-main" data-testid="rn-record">
            new best distance!
          </div>
        </Show>
        <div class="text-3xl font-bold text-main">
          {result?.distanceM ?? 0}m down the road
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.distanceM ?? 0}m
            </div>
            <div class="text-xs text-sub">distance</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.hits ?? 0}
            </div>
            <div class="text-xs text-sub">hits taken</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              x{result?.bestCombo ?? 0}
            </div>
            <div class="text-xs text-sub">best combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best distance {getRunnerBestDistanceM()}m
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
            onClick={backToMenu}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-running" }} text="endless runner" />
        <p class="text-sub">
          the runner never stops — obstacles stream in and only your typing
          clears them. jump the ground, slide the air, destroy the drones.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="rn-online-vs"
        >
          <i class="fas fa-running"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — first to {targetM()}m wins
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
          <div class="grid grid-cols-4 gap-2" aria-label="endless runner hud">
            <HudCell
              label="distance"
              value={`${Math.floor((engineState()?.distancePx ?? 0) / BALANCE.pxPerMeter)}m`}
              testId="rn-distance"
            />
            <HudCell
              label="speed"
              value={`${Math.round(engineState()?.speedPxPerS ?? 0)}`}
            />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="lives"
              value={`${engineState()?.lives ?? 0}/3`}
              testId="rn-lives"
            />
          </div>
          <Arena />
          <Lives />
          <ActiveWord />
        </Show>
      </Show>
    </div>
  );
}
