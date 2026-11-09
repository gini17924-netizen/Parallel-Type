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
import { cn } from "../../../../utils/cn";
import { BALANCE } from "../../../../utils/firefight/balance";
import {
  createFirefightEngine,
  type FirefightEngine,
  type FirefightState,
} from "../../../../utils/firefight/engine";
import {
  fireLanStream,
  lanFirefight,
  resolveFireVerdict,
  type FireRemoteState,
  type FireVerdict,
} from "../../../../utils/firefight/lan";
import {
  getFirefightBestScore,
  getFirefightWins,
  recordFirefightRun,
} from "../../../../utils/firefight/store";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
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

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both runs have ended (or the peer gave up) */
type FireOnlineResult = {
  verdict: FireVerdict;
  myWon: boolean;
  myScore: number;
  myTimeMs: number;
  theirWon: boolean;
  theirScore: number;
  theirTimeMs: number | null;
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
 * Firefight (idea G16, phase 2): a building on fire — the active word
 * (the most critical burning cell) shows big below the grid; type it to
 * extinguish. The pure engine + sim own the fire; this page owns the
 * word pool (weakness-weighted, the doc's feature-check #7) and timers.
 *
 * Online (online wave, phase 38): the armed match IS the start — both
 * machines fight the identical seeded fire (the weakness weighting does
 * NOT travel: the learn-stats vary per machine) inside the shared
 * survival window from params. Each run ends by surviving (won) or the
 * ash line (lost); the finish ships and the verdict resolves when both
 * are in — the outcome first, then the raw score, then the longer stand.
 * Nothing online is recorded.
 */
export function FirefightPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    FirefightState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer fights the same seeded fire
  const [remoteState, setRemoteState] = createSignal<
    FireRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    FireOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: FirefightEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let runStart = 0;
  let myFinish: { won: boolean; score: number; elapsedMs: number } | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentExtinguished = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-fire (header back, route change) tells the peer the run
  //was abandoned — a run without a finish loses, they can never be beaten
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "firefight") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanFirefight.encodeProgress({
          score: state?.score ?? 0,
          extinguished: state?.extinguished ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "firefight";

  const startRun = async (): Promise<void> => {
    if (lanMode()) return; //online: the match effect owns the start
    await startOfflineRun();
  };

  /** the offline run: the weakness-weighted words, the local records */
  const startOfflineRun = async (): Promise<void> => {
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
    startTickLoop();
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const surviveMs = lanSurviveMs();
    //a peer finish of null = they abandoned mid-fire: a run without a
    //finish loses, the survivor takes the win whenever their run ends
    const abandoned =
      finished.finishMs === null || finished.finishMs === undefined;
    //the peer's outcome derives from the shared clock: a finish at (or
    //past) the survival window means they made it — earlier is a collapse
    const theirWon = (finished.finishMs ?? 0) >= surviveMs;
    const sinceStart = Date.now() - runStart;
    const myTimeMs = myFinish?.elapsedMs ?? sinceStart;
    setOnlineResult({
      verdict: abandoned
        ? "won"
        : resolveFireVerdict(
            {
              won: myFinish?.won ?? false,
              score: myFinish?.score ?? 0,
              elapsedMs: myTimeMs,
            },
            {
              won: theirWon,
              score: remoteState()?.score ?? 0,
              elapsedMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
            },
          ),
      myWon: myFinish?.won ?? false,
      myScore: myFinish?.score ?? 0,
      myTimeMs,
      theirWon,
      theirScore: remoteState()?.score ?? 0,
      theirTimeMs: abandoned ? null : (finished.finishMs ?? null),
    });
    setPagePhase("result");
  };

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

  const lanSurviveMs = (): number => {
    const match = getLanMatch();
    if (match?.gameId !== "firefight") {
      return BALANCE.surviveMs;
    }
    const surviveMs = match.start.params["surviveMs"];
    return typeof surviveMs === "number" && surviveMs > 0
      ? surviveMs
      : BALANCE.surviveMs;
  };

  //an armed (or re-armed) firefight match IS the online start: one seeded
  //stream drives the ignition/spread picks AND the cells' words — the
  //identical grid evolves on both machines (no weakness weighting: the
  //learn-stats vary per machine)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "firefight") return;
    void (async () => {
      const matchLang = match.start.params["lang"];
      let pool: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${
            typeof matchLang === "string" && matchLang.length > 0
              ? matchLang
              : "english"
          }.json`,
        );
        pool = data.words;
      } catch {
        //the offline fallback list
      }
      const seed = match.start.seed ?? 1;
      const stream = fireLanStream(pool, seed);
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setVoidMessage(undefined);
      myFinish = undefined;
      myFinishSent = false;
      lastSentScore = -1;
      lastSentExtinguished = -1;
      runStart = Date.now();
      engine = createFirefightEngine({
        wordFor: stream.wordFor,
        rng: stream.rng,
        surviveMs: lanSurviveMs(),
      });
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  /** the one tick loop both the offline run and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      //online: relay the score/extinguished when they moved
      if (
        lanMode() &&
        (state.score !== lastSentScore ||
          state.extinguished !== lastSentExtinguished)
      ) {
        lastSentScore = state.score;
        lastSentExtinguished = state.extinguished;
        sendLanMatchProgress(
          lanFirefight.encodeProgress({
            score: state.score,
            extinguished: state.extinguished,
          }),
        );
      }
      if (state.phase !== "running") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //the window survived or the ash line crossed — the finish ships
      if (!myFinishSent) {
        myFinishSent = true;
        const sinceStart = Date.now() - runStart;
        myFinish = {
          won: state?.result?.won ?? false,
          //the RAW score travels: the ash penalty is a local-display rule
          //and the remote ash count never travels (symmetric comparison)
          score: state?.score ?? 0,
          elapsedMs: state?.elapsedMs ?? sinceStart,
        };
        sendLanMatchProgress(
          lanFirefight.encodeProgress({
            score: myFinish.score,
            extinguished: state?.extinguished ?? 0,
          }),
        );
        sendLanMatchFinished(myFinish.elapsedMs, 100);
      }
      if (getRemoteFinished() !== undefined) {
        resolveOnlineResult();
      } else {
        setPagePhase("awaiting");
      }
      return;
    }
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
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
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

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as FireRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "firefight") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the fire voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "firefight") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <Show when={voidMessage() !== undefined}>
          <div class="text-error">{voidMessage()}</div>
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

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="ff-awaiting">
          the run ended · score {myFinish?.score ?? 0} — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): FireOnlineResult | undefined => onlineResult();
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
          data-testid="ff-verdict"
        >
          {verdict === "won"
            ? "you win!"
            : verdict === "draw"
              ? "draw"
              : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.myScore ?? 0} score ·{" "}
              {online()?.myWon === true ? "survived" : "lost"} ·{" "}
              {((online()?.myTimeMs ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirScore ?? 0} score ·{" "}
              {online()?.theirWon === true ? "survived" : "lost"} ·{" "}
              {online()?.theirTimeMs === null
                ? "gave up"
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
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="ff-online-vs"
        >
          <i class="fas fa-fire"></i> online vs {getLanMatch()?.peerName ?? "…"}{" "}
          — same fire, survive or score more
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="ff-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.score ?? 0} score ·{" "}
              {remoteState()?.extinguished ?? 0} saved
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.score ?? 0} score ·{" "}
              {engineState()?.extinguished ?? 0} saved
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
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
