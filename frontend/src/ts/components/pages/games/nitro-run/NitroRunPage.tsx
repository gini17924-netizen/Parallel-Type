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
import { createSeededRng } from "../../../../utils/daily-gauntlet/seeded-rng";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/nitro-run/balance";
import {
  createNitroRunEngine,
  type NitroRunEngine,
  type NitroRunState,
} from "../../../../utils/nitro-run/engine";
import {
  lanNitro,
  nitroLanStream,
  resolveNitroVerdict,
  type NitroRemoteState,
  type NitroVerdict,
} from "../../../../utils/nitro-run/lan";
import {
  getNitroBestDistanceM,
  getNitroBestRankScore,
  recordNitroRun,
} from "../../../../utils/nitro-run/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the visible race window: +-100m around the player maps to the strip */
const VIEW_WINDOW_M = 200;
const FALLBACK_WORDS = [
  "nitro",
  "shift",
  "gear",
  "race",
  "boost",
  "engine",
  "wheel",
  "track",
];

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both cars have reported */
type NitroOnlineResult = {
  verdict: NitroVerdict;
  myMs: number;
  myMeters: number;
  theirMs: number | null;
  theirMeters: number;
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
 * Nitro Run (idea G23, phase 2): a top-down endless race — the player's
 * car sits mid-lane and the AI cars slide by based on their RELATIVE
 * progress; the word stream sits below (the G2 pattern). Nitro burns on
 * Enter. The pure engine owns the race; this page owns the word pool
 * and the timers.
 */
export function NitroRunPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch()?.gameId === "nitro-run" ? "playing" : "menu",
  );
  const [engineState, setEngineState] = createSignal<NitroRunState | undefined>(
    undefined,
  );
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer's car on the same seeded stream
  const [remoteState, setRemoteState] = createSignal<
    NitroRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    NitroOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: NitroRunEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  //reactive: the banner and the tick both read the live target
  const [targetM, setTargetM] = createSignal(Number.MAX_SAFE_INTEGER);
  let completedWords = 0;
  let myFinish: { finishMs: number } | undefined;
  let myFinishSent = false;
  let lastSentMeters = -1;
  let lastSentWords = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-race (header back, route change) tells the peer the race
  //ended without a finish and disarms — they are never left waiting
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "nitro-run") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    sendLanMatchFinished(null, 0);
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "nitro-run";

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined || myFinish === undefined) return;
    //a null finish means the peer never crossed — they lose
    setOnlineResult({
      verdict: resolveNitroVerdict(myFinish, {
        finishMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
      }),
      myMs: myFinish.finishMs,
      myMeters: engineState()?.distanceM ?? 0,
      theirMs: finished.finishMs,
      theirMeters: remoteState()?.meters ?? 0,
    });
    setPagePhase("result");
  };

  const myFinishNow = (): void => {
    if (myFinishSent) return;
    const state = engine?.state();
    if (state === undefined) return;
    myFinishSent = true;
    myFinish = { finishMs: Math.round(state.elapsedMs) };
    sendLanMatchProgress(
      lanNitro.encodeProgress({
        meters: state.distanceM,
        words: completedWords,
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
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      //online: the target line ends the race (the AI gap never fires)
      if (lanMode() && state.distanceM >= targetM()) {
        myFinishNow();
        return;
      }
      //online: relay the live progress when it moved
      if (
        lanMode() &&
        (Math.round(state.distanceM) !== lastSentMeters ||
          completedWords !== lastSentWords)
      ) {
        lastSentMeters = Math.round(state.distanceM);
        lastSentWords = completedWords;
        sendLanMatchProgress(
          lanNitro.encodeProgress({
            meters: state.distanceM,
            words: completedWords,
          }),
        );
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const startRun = async (): Promise<void> => {
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
          .filter((word) => /^\p{L}+$/u.test(word))
          .map((word) => word.toLowerCase()),
      ),
    ];
    engine = createNitroRunEngine({
      nextWord: () =>
        pickable[Math.floor(Math.random() * pickable.length)] ?? "nitro",
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
      //online runs end through myFinishNow (the target line) — this
      //branch only fires for a stray engine done; nothing is recorded
      setPagePhase("result");
      return;
    }
    if (state?.result !== undefined) {
      recordNitroRun({
        rankScore: state.result.rankScore,
        rank: state.result.rank,
        distanceM: state.result.distanceM,
        nitroUses: state.result.nitroUses,
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    //Enter = nitro: swallowed (a non-character, the doc's G23 §۰.۲ choice)
    if (event.key === "Enter") {
      event.preventDefault();
      const before = engine?.state();
      const after = engine?.feedKey("Enter");
      if (after !== undefined) setEngineState(after);
      if (
        before !== undefined &&
        after !== undefined &&
        after.nitroActiveMs > before.nitroActiveMs
      ) {
        void playClick();
      }
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after === undefined) return;
    if (before !== undefined) {
      if (after.currentWord !== before.currentWord) {
        completedWords += 1; //a word completed (the stream advanced)
      }
      if (after.distanceM > before.distanceM) {
        void playClick();
      } else if (after.spinOutMs > 0 && before.spinOutMs === 0) {
        void playError();
      }
    }
    setEngineState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
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

  //an armed (or re-armed) nitro match IS the online start: the seed
  //builds the shared stream, the AI field drops out, the target line
  //replaces the gap loss
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "nitro-run") return;
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
        pool = data.words;
      } catch {
        //offline fallback list
      }
      const pickable = [
        ...new Set(
          pool
            .filter((word) => /^\p{L}+$/u.test(word))
            .map((word) => word.toLowerCase()),
        ),
      ];
      const stream = nitroLanStream(pickable, match.start.seed ?? 1);
      let streamIndex = 0;
      setTargetM(
        typeof meters === "number" && meters > 0 ? Math.floor(meters) : 1000,
      );
      completedWords = 0;
      myFinish = undefined;
      myFinishSent = false;
      lastSentMeters = -1;
      lastSentWords = -1;
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      engine = createNitroRunEngine({
        nextWord: () => stream[streamIndex++ % stream.length] ?? "nitro",
        aiWpms: [], //online: no AI — the peer replaces the field
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
    setRemoteState(progress.state as NitroRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "nitro-run") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the race voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "nitro-run") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  /** the AI car's strip position: its RELATIVE progress to the player,
   * +-100m mapped across the full width (clamped off-strip when far) */
  const aiCarLeft = (progressM: number): number => {
    const rel = progressM - (engineState()?.distanceM ?? 0);
    return 50 + (rel / VIEW_WINDOW_M) * 100;
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
              {getNitroBestRankScore()}
            </div>
            <div class="text-xs text-sub">best rank score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getNitroBestDistanceM()}m
            </div>
            <div class="text-xs text-sub">best distance</div>
          </div>
        </div>
        <Button
          text="start race"
          fa={{ icon: "fa-flag-checkered" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type the stream to race — a wrong key spins you out; every 5 clean
          words banks a nitro (Enter burns it, x2 speed). Fall 300m behind the
          nearest AI and the race is over.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: read the signal inline — a local const would freeze
    //the race on the mount-time snapshot
    const spinning = (engineState()?.spinOutMs ?? 0) > 0;
    const nitroOn = (engineState()?.nitroActiveMs ?? 0) > 0;
    return (
      <section
        class={cn(
          "relative w-full overflow-hidden rounded bg-sub-alt",
          spinning && "animate-pulse",
        )}
        style={{ height: "42vh" }}
        aria-label="nitro run arena"
      >
        <For each={[0, 1, 2]}>
          {(lane) => (
            <div
              class="absolute w-full border-b border-sub"
              style={{ top: `${lane * 14}vh`, height: "14vh" }}
            ></div>
          )}
        </For>
        <Show when={nitroOn}>
          <div
            class="absolute inset-y-0 left-0 w-full bg-main opacity-10"
            data-testid="nr-nitro-streak"
          ></div>
        </Show>
        <For each={engineState()?.ai ?? []}>
          {(racer, i) => {
            const left = aiCarLeft(racer.progressM);
            const visible = left > -8 && left < 108;
            return (
              <Show when={visible}>
                <div
                  class="absolute grid place-items-center rounded-lg border-2 border-error bg-bg text-xs font-bold text-error"
                  style={{
                    left: `${left}%`,
                    top: `${6 + (i() % 3) * 12}vh`,
                    width: "3.2rem",
                    height: "2rem",
                  }}
                  data-testid="nr-ai-car"
                >
                  AI
                </div>
              </Show>
            );
          }}
        </For>
        <Show when={lanMode()}>
          {(() => {
            //the peer's car: their RELATIVE progress to me on the strip
            const rel =
              (remoteState()?.meters ?? 0) - (engineState()?.distanceM ?? 0);
            const left = 50 + (rel / VIEW_WINDOW_M) * 100;
            const visible = left > -8 && left < 108;
            return (
              <Show when={visible}>
                <div
                  class="absolute grid place-items-center rounded-lg border-2 border-error bg-bg text-xs font-bold text-error"
                  style={{
                    left: `${left}%`,
                    top: "6vh",
                    width: "3.2rem",
                    height: "2rem",
                  }}
                  data-testid="nr-peer-car"
                >
                  P2
                </div>
              </Show>
            );
          })()}
        </Show>
        <div
          class={cn(
            "absolute grid place-items-center rounded-lg border-2 font-bold",
            nitroOn
              ? "border-main bg-main text-bg"
              : "border-main bg-bg text-main",
          )}
          style={{
            left: "50%",
            top: "18vh",
            width: "3.4rem",
            height: "2.1rem",
            transform: "translateX(-50%)",
          }}
          data-testid="nr-player-car"
        >
          YOU
        </div>
        <Show when={!lanMode()}>
          <div
            class="absolute grid place-items-center rounded border border-sub bg-bg text-xs text-sub"
            style={{
              left: `${50 + (BALANCE.gapLossM / VIEW_WINDOW_M) * 50}%`,
              top: "0",
              height: "100%",
              width: "2px",
            }}
            data-testid="nr-gap-line"
          ></div>
        </Show>
        <Show when={lanMode()}>
          <div
            class="absolute top-0 h-full w-0.5 bg-main"
            style={{ left: "96%" }}
            data-testid="nr-finish-line"
          ></div>
        </Show>
      </section>
    );
  };

  const NitroPills = (): JSXElement => {
    return (
      <div class="flex justify-center gap-2" aria-label="nitro charges">
        <For each={[0, 1, 2]}>
          {(pill) => (
            <div
              class={cn(
                "h-4 w-8 rounded-full border-2",
                (engineState()?.nitroCharges ?? 0) > pill
                  ? "border-main bg-main"
                  : "border-sub",
                (engineState()?.nitroActiveMs ?? 0) > 0 &&
                  (engineState()?.nitroCharges ?? 0) === 0 &&
                  "animate-pulse",
              )}
              data-testid="nr-pill"
            ></div>
          )}
        </For>
      </div>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="nr-awaiting">
          you crossed in {((myFinish?.finishMs ?? 0) / 1000).toFixed(1)}s —
          waiting for {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): NitroOnlineResult | undefined => onlineResult();
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
          data-testid="nr-verdict"
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
              {((online()?.myMs ?? 0) / 1000).toFixed(1)}s ·{" "}
              {Math.round(online()?.myMeters ?? 0)}m
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirMs === null
                ? "—"
                : `${((online()?.theirMs ?? 0) / 1000).toFixed(1)}s`}{" "}
              · {Math.round(online()?.theirMeters ?? 0)}m
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
        <div class="text-3xl font-bold text-main">
          race over — place #{result?.rank ?? 0} of {result?.racerCount ?? 0}
        </div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.rankScore ?? 0}
            </div>
            <div class="text-xs text-sub">rank score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.distanceM ?? 0}m
            </div>
            <div class="text-xs text-sub">distance</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.perfectWords ?? 0}
            </div>
            <div class="text-xs text-sub">perfect words</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.nitroUses ?? 0}
            </div>
            <div class="text-xs text-sub">nitro used</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best rank score {getNitroBestRankScore()} · best distance{" "}
          {getNitroBestDistanceM()}m
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="race again"
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
        <H2 fa={{ icon: "fa-car-side" }} text="nitro run" />
        <p class="text-sub">
          an endless race against AI cars — your typing is the gas pedal. Bank
          nitro on clean streaks and burn it with Enter.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="nr-online-vs"
        >
          <i class="fas fa-car-side"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — first to {Math.round(targetM())}m
          wins
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
          <div class="grid grid-cols-4 gap-2" aria-label="nitro run hud">
            <HudCell
              label="distance"
              value={`${Math.round(engineState()?.distanceM ?? 0)}m`}
            />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="streak"
              value={`${(engineState()?.streak ?? 0) % BALANCE.nitroStreakWords}/5`}
            />
            <HudCell
              label="nitro"
              value={
                (engineState()?.nitroActiveMs ?? 0) > 0
                  ? "ON"
                  : `${engineState()?.nitroCharges ?? 0}`
              }
            />
          </div>
          <Arena />
          <NitroPills />
          <div class="grid place-items-center gap-1">
            <div
              class="text-4xl font-bold tracking-widest"
              dir="auto"
              data-testid="nr-word"
            >
              <span
                class={cn((engineState()?.spinOutMs ?? 0) > 0 && "text-error")}
              >
                <span class="text-main">
                  {(engineState()?.currentWord ?? "").slice(
                    0,
                    engineState()?.typed ?? 0,
                  )}
                </span>
                <span>
                  {(engineState()?.currentWord ?? "").slice(
                    engineState()?.typed ?? 0,
                  )}
                </span>
              </span>
            </div>
            <div class="text-xs text-sub">
              type the stream — Enter burns nitro
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
