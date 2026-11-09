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
import { BALANCE } from "../../../../utils/type-snake/balance";
import {
  createTypeSnakeEngine,
  type TypeSnakeEngine,
  type TypeSnakeState,
} from "../../../../utils/type-snake/engine";
import {
  lanTypeSnake,
  resolveSnakeVerdict,
  typeSnakeLanWordStream,
  type SnakeRemoteState,
  type SnakeVerdict,
} from "../../../../utils/type-snake/lan";
import {
  getTypeSnakeBestLength,
  getTypeSnakeBestScore,
  recordTypeSnakeRun,
} from "../../../../utils/type-snake/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const CELL_PX = 22;
const FALLBACK_WORDS = ["hi", "run", "key", "tap", "win", "ace"];

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both runs have ended (or the peer gave up) */
type SnakeOnlineResult = {
  verdict: SnakeVerdict;
  myScore: number;
  myLength: number;
  myTimeMs: number;
  theirScore: number;
  theirLength: number;
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
 * Type Snake (idea G11, phase 2): the snake walks itself toward the food —
 * you type the 2-3 letter word riding the food to ripen it; the eat lands
 * when the head arrives. Death = boxed in. The pure engine owns the rules;
 * this page owns the food words and the timers.
 *
 * Online (online wave, phase 30): the armed match IS the start — both
 * machines build the identical seeded food stream (the placement rng and
 * the word stream both from the shared seed) and race to the death: the
 * higher score wins, the longer survival breaks the tie. The death sends
 * the finish; the verdict resolves when both are in (or the peer gave
 * up — a run without a finish loses). Nothing online is recorded.
 */
export function TypeSnakePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    TypeSnakeState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer races the same seeded food stream
  const [remoteState, setRemoteState] = createSignal<
    SnakeRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    SnakeOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: TypeSnakeEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let runStart = 0;
  let myFinish:
    | { score: number; length: number; elapsedMs: number }
    | undefined;
  let myFinishSent = false;
  let lastSentLength = -1;
  let lastSentScore = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-race (header back, route change) tells the peer the run
  //was abandoned — a run without a finish loses, they can never be beaten
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "type-snake") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanTypeSnake.encodeProgress({
          length: state?.snake.length ?? 0,
          score: state?.score ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "type-snake";

  const startRun = async (): Promise<void> => {
    if (lanMode()) return; //online: the match effect owns the start
    await startOfflineRun();
  };

  /** the offline run: the random foods, the local records */
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
    const shortWords = [
      ...new Set(
        pool
          .filter(
            (word) =>
              word.length >= BALANCE.foodWordMinLen &&
              word.length <= BALANCE.foodWordMaxLen &&
              /^\p{L}+$/u.test(word),
          )
          .map((word) => word.toLowerCase()),
      ),
    ];
    const source = shortWords.length > 0 ? shortWords : FALLBACK_WORDS;
    engine = createTypeSnakeEngine({
      foodWord: () => source[Math.floor(Math.random() * source.length)] ?? "go",
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const state = engine?.state();
    const myScore = state?.score ?? 0;
    const myLength = state?.snake.length ?? 0;
    const sinceStart = Date.now() - runStart;
    const myTimeMs = state?.elapsedMs ?? myFinish?.elapsedMs ?? sinceStart;
    //a peer finish of null = they abandoned mid-run: a run without a
    //finish loses, the survivor takes the win whenever their run ends
    const abandoned =
      finished.finishMs === null || finished.finishMs === undefined;
    const theirScore = remoteState()?.score ?? 0;
    setOnlineResult({
      verdict: abandoned
        ? "won"
        : resolveSnakeVerdict(
            { score: myScore, elapsedMs: myTimeMs },
            {
              score: theirScore,
              elapsedMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
            },
          ),
      myScore,
      myLength,
      myTimeMs,
      theirScore,
      theirLength: remoteState()?.length ?? 0,
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

  //an armed (or re-armed) snake match IS the online start: the seed
  //builds the identical food stream (the placement rng and the word
  //stream both from the shared seed — same foods in the same order)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "type-snake") return;
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
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setVoidMessage(undefined);
      myFinish = undefined;
      myFinishSent = false;
      lastSentLength = -1;
      lastSentScore = -1;
      runStart = Date.now();
      engine = createTypeSnakeEngine({
        foodWord: typeSnakeLanWordStream(pool, seed),
        rng: createSeededRng(seed),
      });
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as SnakeRemoteState);
  });

  //the peer's finish resolves the held verdict (or arrived before mine)
  createEffect(() => {
    if (pagePhase() !== "awaiting") return;
    if (getRemoteFinished() === undefined) return;
    resolveOnlineResult();
  });

  /** the one tick loop both the offline run and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      //online: relay the length/score when they moved
      if (
        lanMode() &&
        (state.snake.length !== lastSentLength || state.score !== lastSentScore)
      ) {
        lastSentLength = state.snake.length;
        lastSentScore = state.score;
        sendLanMatchProgress(
          lanTypeSnake.encodeProgress({
            length: state.snake.length,
            score: state.score,
          }),
        );
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //boxed in — the finish ships with the final numbers
      if (!myFinishSent) {
        myFinishSent = true;
        const sinceStart = Date.now() - runStart;
        myFinish = {
          score: state?.score ?? 0,
          length: state?.snake.length ?? 0,
          elapsedMs: state?.elapsedMs ?? sinceStart,
        };
        sendLanMatchProgress(
          lanTypeSnake.encodeProgress({
            length: myFinish.length,
            score: myFinish.score,
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
      recordTypeSnakeRun({
        score: state.result.score,
        length: state.result.length,
        eaten: state.result.eaten,
        maxCombo: state.result.maxCombo,
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
    if (before !== undefined && after.eaten > before.eaten) {
      void playClick();
    } else if (
      after.food !== undefined &&
      before?.food !== undefined &&
      after.food.typed > before.food.typed
    ) {
      void playClick();
    } else {
      void playError();
    }
    setEngineState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "type-snake") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the run voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "type-snake") return;
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
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getTypeSnakeBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getTypeSnakeBestLength()}
            </div>
            <div class="text-xs text-sub">best length</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          the snake walks itself toward the food — type the food&apos;s word to
          ripen it; the eat lands when the head arrives. Wrong letters do
          nothing; getting boxed in ends the run.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: read the signal inline — a local const would freeze
    //the snake on the mount-time snapshot
    return (
      <section class="grid place-items-center" aria-label="type snake arena">
        <div
          class="relative rounded bg-bg"
          style={{
            width: `${BALANCE.cols * CELL_PX}px`,
            height: `${BALANCE.rows * CELL_PX}px`,
            //KI-48: faint cell lines so the board reads as a grid
            "background-image":
              "linear-gradient(color-mix(in srgb, var(--sub-color) 35%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--sub-color) 35%, transparent) 1px, transparent 1px)",
            "background-size": `${CELL_PX}px ${CELL_PX}px`,
          }}
        >
          <For each={engineState()?.snake ?? []}>
            {(segment, i) => (
              <div
                class={cn(
                  "absolute rounded-sm",
                  i() === 0 ? "bg-main" : "bg-sub",
                )}
                style={{
                  left: `${segment.x * CELL_PX}px`,
                  top: `${segment.y * CELL_PX}px`,
                  width: `${CELL_PX - 2}px`,
                  height: `${CELL_PX - 2}px`,
                  opacity: i() === 0 ? 1 : Math.max(0.35, 1 - i() * 0.03),
                }}
                data-testid="ts-segment"
              ></div>
            )}
          </For>
          <Show when={engineState()?.food !== undefined}>
            <div
              class="absolute grid place-items-center rounded-full border-2 border-main bg-bg font-bold"
              style={{
                left: `${(engineState()?.food?.x ?? 0) * CELL_PX - 4}px`,
                top: `${(engineState()?.food?.y ?? 0) * CELL_PX - 4}px`,
                "min-width": `${CELL_PX + 18}px`,
                padding: "0.1rem 0.3rem",
              }}
              dir="auto"
              data-testid="ts-food"
            >
              <span class="text-main">
                {(engineState()?.food?.word ?? "").slice(
                  0,
                  engineState()?.food?.typed ?? 0,
                )}
              </span>
              <span>
                {(engineState()?.food?.word ?? "").slice(
                  engineState()?.food?.typed ?? 0,
                )}
              </span>
            </div>
          </Show>
        </div>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="ts-awaiting">
          boxed in at {((myFinish?.elapsedMs ?? 0) / 1000).toFixed(1)}s · score{" "}
          {myFinish?.score ?? 0} — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): SnakeOnlineResult | undefined => onlineResult();
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
          data-testid="ts-verdict"
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
              {online()?.myScore ?? 0} score · {online()?.myLength ?? 0} long ·{" "}
              {((online()?.myTimeMs ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirScore ?? 0} score · {online()?.theirLength ?? 0}{" "}
              long ·{" "}
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
        <div class="text-3xl font-bold text-error">boxed in!</div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.length ?? 0}
            </div>
            <div class="text-xs text-sub">length</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.eaten ?? 0}
            </div>
            <div class="text-xs text-sub">eaten</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getTypeSnakeBestScore()} · best length{" "}
          {getTypeSnakeBestLength()}
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
        <H2 fa={{ icon: "fa-dragon" }} text="type snake" />
        <p class="text-sub">
          the snake walks itself — your typing ripens the word on the food; grow
          long without getting boxed in.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="ts-online-vs"
        >
          <i class="fas fa-dragon"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same food stream, the higher score
          wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="ts-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.length ?? 0} long · {remoteState()?.score ?? 0}{" "}
              score
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.snake.length ?? 0} long ·{" "}
              {engineState()?.score ?? 0} score
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
          <div class="grid grid-cols-4 gap-2" aria-label="type snake hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell
              label="length"
              value={String(engineState()?.snake.length ?? 0)}
            />
            <HudCell label="eaten" value={String(engineState()?.eaten ?? 0)} />
            <HudCell
              label="speed"
              value={`${(BALANCE.startIntervalMs / (engineState()?.intervalMs ?? BALANCE.startIntervalMs)).toFixed(1)}x`}
            />
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
