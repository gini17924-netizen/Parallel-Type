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
  getLanRawMessage,
  getRematchAsked,
  sendLanMatchMessage,
  sendLanMatchRematch,
  sendLanMatchStart,
  type LanMatch,
} from "../../../../states/lan-match";
import { cn } from "../../../../utils/cn";
import { createSeededRng } from "../../../../utils/daily-gauntlet/seeded-rng";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/type-pong/balance";
import {
  createBreakerEngine,
  type BreakerEngine,
  type BreakerState,
} from "../../../../utils/type-pong/breaker";
import {
  createLanPongClient,
  type ClientPongView,
} from "../../../../utils/type-pong/client";
import {
  createLanPongHost,
  decodeInput,
  encodeInput,
  encodeSnapshot,
  pongLanWordStream,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_MAX_BYTES,
  type LanPongState,
} from "../../../../utils/type-pong/lan";
import {
  createPongEngine,
  type PongEngine,
  type PongState,
} from "../../../../utils/type-pong/pong";
import {
  getPongStats,
  recordPongMatch,
  recordBreakerRun,
} from "../../../../utils/type-pong/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const FALLBACK_WORDS = ["return", "volley", "smash", "rally", "serve", "spin"];
const COURT_H = 420; //px

type PagePhase = "menu" | "playing" | "result";
type GameMode = "pong" | "breaker";

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Type Pong (idea G13, phase 2): two modes sharing the paddle-moves-on-
 * typing mechanic — pong (first to 5) and breaker (clear the brick wall).
 * The pure engines own the rules; this page owns the mode selector, the
 * word pool and the timers.
 */
export function TypePongPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [mode, setMode] = createSignal<GameMode>("pong");
  const [pongState, setPongState] = createSignal<PongState | undefined>(
    undefined,
  );
  const [breakerState, setBreakerState] = createSignal<
    BreakerState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the pattern V versus: the host simulates, the
  //client renders the snapshots
  const [hostState, setHostState] = createSignal<LanPongState | undefined>(
    undefined,
  );
  const [lanView, setLanView] = createSignal<ClientPongView | undefined>(
    undefined,
  );
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let pongEngine: PongEngine | undefined;
  let breakerEngine: BreakerEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let lanHost: ReturnType<typeof createLanPongHost> | undefined;
  let lanClient: ReturnType<typeof createLanPongClient> | undefined;
  let relayTimer: ReturnType<typeof setInterval> | undefined;
  let snapshotSeq = 0;
  let lanEnded = false;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (relayTimer !== undefined) clearInterval(relayTimer);
    tickTimer = undefined;
    relayTimer = undefined;
  };

  onCleanup(stopTimers);

  const lanMode = (): boolean => getLanMatch()?.gameId === "type-pong";

  //leaving mid-rally tells the peer the match is over for us
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "type-pong") return;
    if (pagePhase() !== "playing") return;
    sendLanMatchMessage({ type: "pong-left", gameId: "type-pong" });
    clearLanMatch();
  });

  const lanTargetScore = (): number => {
    const match = getLanMatch();
    if (match?.gameId !== "type-pong") return BALANCE.targetScore;
    const target = match.start.params["targetScore"];
    return typeof target === "number" && target > 0
      ? target
      : BALANCE.targetScore;
  };

  const endLanMatch = (): void => {
    if (lanEnded) return;
    lanEnded = true;
    stopTimers();
    setPagePhase("result");
  };

  //an armed (or re-armed) type-pong match IS the online start: the HOST
  //simulates and ships snapshots, the CLIENT renders the state-sync
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "type-pong") return;
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
      const nextWord = pongLanWordStream(pool, seed);
      setMode("pong"); //the versus is pong only — the breaker stays offline
      setVoidMessage(undefined);
      setRematchSent(false);
      setHostState(undefined);
      setLanView(undefined);
      snapshotSeq = 0;
      lanEnded = false;
      if (match.role === "host") {
        lanHost = createLanPongHost({
          nextWord,
          rng: createSeededRng(seed),
          targetScore: lanTargetScore(),
        });
        setHostState(lanHost.state());
        setPagePhase("playing");
        tickTimer = setInterval(() => {
          if (lanHost === undefined) return;
          const state = lanHost.tick(TICK_MS);
          setHostState(state);
          //the fixed-rate snapshot: the whole match state to the client —
          //never over the 64KB wire cap (the Rust pipe would drop it)
          snapshotSeq += 1;
          const snap = encodeSnapshot({ ...state, seq: snapshotSeq });
          if (JSON.stringify(snap).length <= SNAPSHOT_MAX_BYTES) {
            sendLanMatchMessage({
              type: "pong-snapshot",
              gameId: "type-pong",
              snap,
            });
          } else {
            console.error("lan: snapshot over the 64KB cap — dropped");
          }
          if (state.phase === "done") endLanMatch();
        }, TICK_MS);
      } else {
        lanClient = createLanPongClient({ now: () => performance.now() });
        setPagePhase("playing");
        //the render loop: the interpolated view at 60fps-ish
        tickTimer = setInterval(() => {
          if (lanClient === undefined) return;
          setLanView(lanClient.view());
          if (lanClient.view().phase === "done") endLanMatch();
        }, 16);
        //the input relay: the typed chars ride the raw passthrough
        relayTimer = setInterval(() => {
          if (lanClient === undefined) return;
          const batch = lanClient.takeInputBatch();
          if (batch.length === 0) return;
          sendLanMatchMessage({
            type: "pong-input",
            gameId: "type-pong",
            ...encodeInput(batch),
          });
        }, SNAPSHOT_INTERVAL_MS);
      }
    })();
  });

  //the relayed peer messages: the client ingests snapshots, the host
  //applies the client's chars authoritatively; pong-left voids
  createEffect(() => {
    const raw = getLanRawMessage();
    if (raw === undefined) return;
    const type = raw.message["type"];
    if (type === "pong-snapshot" && lanClient !== undefined) {
      lanClient.ingest(raw.message["snap"]);
      return;
    }
    if (type === "pong-input" && lanHost !== undefined) {
      const chars = decodeInput(raw.message);
      if (chars !== undefined) {
        for (const ch of chars) lanHost.clientKey(ch);
        setHostState(lanHost.state());
      }
      return;
    }
    if (type === "pong-left") {
      endLanMatch();
      setVoidMessage("the opponent left — match void, nothing was recorded");
    }
  });

  //a disconnect during the rally voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "type-pong") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing") return;
    stopTimers();
    lanHost = undefined;
    lanClient = undefined;
    clearLanMatch();
    setVoidMessage("the opponent left — match void, nothing was recorded");
    setPagePhase("menu");
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

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "type-pong") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  const startRun = async (): Promise<void> => {
    if (lanMode()) return; //online: the match effect owns the start
    setMessage(undefined);
    stopTimers();
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
              word.length >= 4 && word.length <= 8 && /^\p{L}+$/u.test(word),
          )
          .map((word) => word.toLowerCase()),
      ),
    ];
    const source = pickable.length > 0 ? pickable : FALLBACK_WORDS;
    const nextWord = () =>
      source[Math.floor(Math.random() * source.length)] ?? "return";

    if (mode() === "breaker") {
      breakerEngine = createBreakerEngine({ nextWord, rng: Math.random });
      setBreakerState(breakerEngine.state());
      setPagePhase("playing");
      tickTimer = setInterval(() => {
        if (breakerEngine === undefined) return;
        const state = breakerEngine.tick(TICK_MS);
        setBreakerState(state);
        if (state.phase !== "running") endRun();
      }, TICK_MS);
      return;
    }
    pongEngine = createPongEngine({
      nextWord,
      rng: Math.random,
      aiSpeed: 60,
    });
    setPongState(pongEngine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (pongEngine === undefined) return;
      const state = pongEngine.tick(TICK_MS);
      setPongState(state);
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    if (mode() === "breaker") {
      const state = breakerEngine?.state();
      if (state?.result !== undefined) {
        recordBreakerRun({
          won: state.result.won,
          timeMs: state.elapsedMs,
          score: state.result.score,
        });
      }
    } else {
      const state = pongEngine?.state();
      if (state?.result !== undefined) {
        recordPongMatch({
          won: state.result.winner === "player",
          playerScore: state.result.playerScore,
          aiScore: state.result.aiScore,
          bestRally: state.result.bestRally,
        });
      }
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter" && (mode() === "pong" || lanMode())) return;
    if (event.key.length !== 1 && event.key !== "Enter") return;
    if (event.key.length === 1) event.preventDefault();
    if (lanMode()) {
      //the paddle moves only when you type — locally echoed, judged by
      //the host (the V pattern: the client relays, never simulates)
      const ch = latinCharFromEvent(event.key, event.code);
      if (lanHost !== undefined) {
        const state = lanHost.hostKey(ch);
        setHostState(state);
        if (state.hostScore > (hostState()?.hostScore ?? 0)) {
          void playClick();
        } else if (state.clientScore > (hostState()?.clientScore ?? 0)) {
          void playError();
        }
      } else if (lanClient !== undefined) {
        lanClient.pushLocalChar(ch);
        setLanView(lanClient.view());
      }
      return;
    }
    if (mode() === "breaker" && breakerEngine !== undefined) {
      const after = breakerEngine.feedKey(
        latinCharFromEvent(event.key, event.code),
      );
      setBreakerState(after);
      return;
    }
    if (pongEngine !== undefined) {
      const after = pongEngine.feedKey(
        latinCharFromEvent(event.key, event.code),
      );
      setPongState(after);
      if (after.playerScore > (pongState()?.playerScore ?? 0)) {
        void playClick();
      } else if (after.aiScore > (pongState()?.aiScore ?? 0)) {
        void playError();
      }
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const Menu = (): JSXElement => {
    const pong = getPongStats();
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
              {pong.wins}
            </div>
            <div class="text-xs text-sub">wins</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {pong.losses}
            </div>
            <div class="text-xs text-sub">losses</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {pong.bestRally}
            </div>
            <div class="text-xs text-sub">best rally</div>
          </div>
        </div>
        <div class="text-sub">mode</div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="pong"
            class={cn("w-full", mode() === "pong" && "bg-main text-bg")}
            disabled={lanMode()}
            onClick={() => setMode("pong")}
          />
          <Button
            text="breaker"
            class={cn("w-full", mode() === "breaker" && "bg-main text-bg")}
            disabled={lanMode()}
            onClick={() => setMode("breaker")}
          />
        </div>
        <Button
          text="start match"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          {mode() === "pong"
            ? "the paddle ONLY moves when you type — finish the word to snap onto the ball. First to 5 wins."
            : "break the brick wall — type the lowest brick's word; the ball chips bricks too. 3 lives."}
        </div>
      </section>
    );
  };

  const PongArena = (): JSXElement => {
    //KI-34 lesson (again): the reads stay INLINE in the JSX expressions —
    //local consts freeze the first render (the LAN paddles/ball proved it)
    return (
      <section class="grid place-items-center" aria-label="type pong arena">
        <div
          class="relative overflow-hidden rounded border-2 border-sub bg-bg"
          style={{
            width: "100%",
            "max-width": "32rem",
            height: `${COURT_H}px`,
          }}
        >
          <div
            class="absolute rounded-full bg-error"
            style={{
              left: `${
                (lanMode() ? lanTopX() : (pongState()?.aiX ?? 50)) -
                BALANCE.paddleW / 2
              }%`,
              top: "4px",
              width: `${BALANCE.paddleW}%`,
              height: "8px",
            }}
            data-testid="tp-ai-paddle"
          ></div>
          <div
            class="absolute left-0 w-full border-t border-dashed border-sub opacity-30"
            style={{ top: "50%" }}
          ></div>
          <div
            class="absolute rounded-full bg-main"
            style={{
              left: `${lanMode() ? lanBall().x : (pongState()?.ball.x ?? 50)}%`,
              top: `${
                ((lanMode() ? lanBall().y : (pongState()?.ball.y ?? 50)) /
                  BALANCE.courtH) *
                  COURT_H -
                5
              }px`,
              width: "10px",
              height: "10px",
              transform: "translateX(-5px)",
            }}
            data-testid="tp-ball"
          ></div>
          <div
            class="absolute rounded-full bg-main"
            style={{
              left: `${
                (lanMode() ? lanBottomX() : (pongState()?.playerX ?? 50)) -
                BALANCE.paddleW / 2
              }%`,
              bottom: "4px",
              width: `${BALANCE.paddleW}%`,
              height: "8px",
            }}
            data-testid="tp-player-paddle"
          ></div>
        </div>
      </section>
    );
  };

  const BreakerArena = (): JSXElement => {
    //KI-34 lesson: the signal must be read INLINE in JSX
    return (
      <section class="grid place-items-center" aria-label="breaker arena">
        <div
          class="relative overflow-hidden rounded border-2 border-sub bg-bg"
          style={{
            width: "100%",
            "max-width": "32rem",
            height: `${COURT_H}px`,
          }}
        >
          <For each={breakerState()?.bricks ?? []}>
            {(brick, idx) => (
              <Show when={brick.alive}>
                <div
                  class={cn(
                    "absolute grid place-items-center rounded-sm border text-xs font-bold",
                    brick.hp > 1
                      ? "border-error text-error"
                      : "border-sub text-text",
                  )}
                  style={{
                    left: `${(idx() % BALANCE.breakerCols) * (100 / BALANCE.breakerCols)}%`,
                    top: `${Math.floor(idx() / BALANCE.breakerCols) * 36}px`,
                    width: `${100 / BALANCE.breakerCols}%`,
                    height: "34px",
                  }}
                  data-testid="tp-brick"
                >
                  {brick.word}
                </div>
              </Show>
            )}
          </For>
          <div
            class="absolute rounded-full bg-main"
            style={{
              left: `${breakerState()?.ball.x ?? 50}%`,
              top: `${(breakerState()?.ball.y ?? 90) * (COURT_H / 100) - 5}px`,
              width: "10px",
              height: "10px",
            }}
            data-testid="tp-ball"
          ></div>
          <div
            class="absolute rounded-full bg-main"
            style={{
              left: `${(breakerState()?.playerX ?? 50) - BALANCE.paddleW / 2}%`,
              bottom: "4px",
              width: `${BALANCE.paddleW}%`,
              height: "8px",
            }}
            data-testid="tp-player-paddle"
          ></div>
        </div>
      </section>
    );
  };

  /** the reactive word reads (the KI-34 lesson: inline in JSX, never in
   * a component body — the fourth time this pattern bites) */
  const currentWord = (): string => {
    if (lanMode()) {
      return getLanMatch()?.role === "host"
        ? (hostState()?.hostWord ?? "")
        : (lanView()?.myWord ?? "");
    }
    return mode() === "breaker"
      ? (breakerState()?.word ?? "")
      : (pongState()?.word ?? "");
  };
  const currentTyped = (): number => {
    if (lanMode()) {
      return getLanMatch()?.role === "host"
        ? (hostState()?.hostTyped ?? 0)
        : (lanView()?.myTyped ?? 0);
    }
    return mode() === "breaker"
      ? (breakerState()?.typed ?? 0)
      : (pongState()?.typed ?? 0);
  };
  /** the LAN arena reads: the TOP paddle is the opponent, the bottom is me */
  const lanTopX = (): number =>
    getLanMatch()?.role === "host"
      ? (hostState()?.clientX ?? 50)
      : (lanView()?.hostX ?? 50);
  const lanBottomX = (): number =>
    getLanMatch()?.role === "host"
      ? (hostState()?.hostX ?? 50)
      : (lanView()?.myX ?? 50);
  const lanBall = (): { x: number; y: number } => {
    const state = getLanMatch()?.role === "host" ? hostState() : undefined;
    if (state !== undefined) return state.ball;
    const view = lanView();
    return { x: view?.ballX ?? 50, y: view?.ballY ?? 50 };
  };
  const lanYouScore = (): number =>
    getLanMatch()?.role === "host"
      ? (hostState()?.hostScore ?? 0)
      : (lanView()?.clientScore ?? 0);
  const lanPeerScore = (): number =>
    getLanMatch()?.role === "host"
      ? (hostState()?.clientScore ?? 0)
      : (lanView()?.hostScore ?? 0);
  const lanRally = (): number =>
    getLanMatch()?.role === "host"
      ? (hostState()?.rally ?? 0)
      : (lanView()?.rally ?? 0);

  const LanResultScreen = (): JSXElement => {
    //the LAN verdict: the winner is INSIDE the match state (the score to
    //N decided it — no separate arbitration message exists in the V
    //pattern); each side renders it from its own perspective
    const lanWinner =
      getLanMatch()?.role === "host"
        ? hostState()?.winner
        : (lanView()?.winner ?? lanClient?.snapshot()?.winner);
    const myScore = lanYouScore();
    const theirScore = lanPeerScore();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div
          class={cn(
            "text-3xl font-bold",
            lanWinner === getLanMatch()?.role ? "text-main" : "text-error",
          )}
          data-testid="tp-verdict"
        >
          {lanWinner === getLanMatch()?.role
            ? "you win!"
            : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {myScore}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {theirScore}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {lanRally() > 0
                ? lanRally()
                : (lanClient?.snapshot()?.bestRally ?? 0)}
            </div>
            <div class="text-xs text-sub">best rally</div>
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
    const pongResult =
      mode() === "pong" ? pongEngine?.state().result : undefined;
    const breakerResult =
      mode() === "breaker" ? breakerEngine?.state().result : undefined;
    return (
      <Show
        when={
          lanMode() &&
          (getLanMatch()?.role === "host"
            ? hostState()?.phase === "done"
            : (lanView()?.phase ?? lanClient?.snapshot()?.phase) === "done")
        }
        fallback={
          <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
            <Show
              when={mode() === "pong"}
              fallback={
                <section class="grid gap-4">
                  <div
                    class={cn(
                      "text-3xl font-bold",
                      breakerResult?.won === true ? "text-main" : "text-error",
                    )}
                  >
                    {breakerResult?.won === true
                      ? "the wall is cleared!"
                      : "out of lives"}
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div class="rounded bg-bg p-3">
                      <div class="text-xl font-bold text-main tabular-nums">
                        {breakerResult?.score ?? 0}
                      </div>
                      <div class="text-xs text-sub">score</div>
                    </div>
                    <div class="rounded bg-bg p-3">
                      <div class="text-xl font-bold text-main tabular-nums">
                        {breakerResult?.bricksBroken ?? 0}
                      </div>
                      <div class="text-xs text-sub">bricks broken</div>
                    </div>
                    <div class="rounded bg-bg p-3">
                      <div class="text-xl font-bold text-main tabular-nums">
                        {breakerResult?.lives ?? 0}
                      </div>
                      <div class="text-xs text-sub">lives left</div>
                    </div>
                  </div>
                </section>
              }
            >
              <div
                class={cn(
                  "text-3xl font-bold",
                  pongResult?.winner === "player" ? "text-main" : "text-error",
                )}
              >
                {pongResult?.winner === "player" ? "you win!" : "the AI wins"}
              </div>
              <div class="grid grid-cols-3 gap-2">
                <div class="rounded bg-bg p-3">
                  <div class="text-xl font-bold text-main tabular-nums">
                    {pongResult?.playerScore ?? 0}
                  </div>
                  <div class="text-xs text-sub">you</div>
                </div>
                <div class="rounded bg-bg p-3">
                  <div class="text-xl font-bold text-main tabular-nums">
                    {pongResult?.aiScore ?? 0}
                  </div>
                  <div class="text-xs text-sub">AI</div>
                </div>
                <div class="rounded bg-bg p-3">
                  <div class="text-xl font-bold text-main tabular-nums">
                    {pongResult?.bestRally ?? 0}
                  </div>
                  <div class="text-xs text-sub">best rally</div>
                </div>
              </div>
            </Show>
            <div class="text-xs text-sub">
              wins {getPongStats().wins} · losses {getPongStats().losses}
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Button
                text="rematch"
                fa={{ icon: "fa-redo" }}
                class="w-full"
                onClick={() => void startRun()}
              />
              <Button
                text="back to menu"
                fa={{ icon: "fa-home" }}
                class="w-full"
                onClick={() => {
                  pongEngine = undefined;
                  breakerEngine = undefined;
                  setPagePhase("menu");
                }}
              />
            </div>
          </section>
        }
      >
        <LanResultScreen />
      </Show>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-table-tennis" }} text="type pong" />
        <p class="text-sub">
          two modes: pong (the paddle moves only when you type, first to 5) and
          breaker (clear the brick wall). The paddle moves only when you type in
          both.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="tp-online-vs"
        >
          <i class="fas fa-table-tennis"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — the first real versus: one shared
          ball, first to {lanTargetScore()}
        </div>
      </Show>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <Show
            when={mode() === "pong"}
            fallback={
              <div class="grid gap-8">
                <div class="grid grid-cols-3 gap-2" aria-label="breaker hud">
                  <HudCell
                    label="lives"
                    value={"❤".repeat(breakerState()?.lives ?? 0) || "—"}
                  />
                  <HudCell
                    label="score"
                    value={String(breakerState()?.score ?? 0)}
                  />
                  <HudCell
                    label="bricks left"
                    value={String(
                      (breakerState()?.bricks ?? []).filter((b) => b.alive)
                        .length,
                    )}
                  />
                </div>
                <BreakerArena />
                <div class="grid place-items-center gap-1">
                  <div
                    class="text-4xl font-bold tracking-widest"
                    dir="auto"
                    data-testid="tp-word"
                  >
                    <span class="text-main">
                      {currentWord().slice(0, currentTyped())}
                    </span>
                    <span>{currentWord().slice(currentTyped())}</span>
                  </div>
                  <div class="text-xs text-sub">
                    type the lowest brick&apos;s word to break it
                  </div>
                </div>
              </div>
            }
          >
            <div class="grid gap-8">
              <div class="grid grid-cols-3 gap-2" aria-label="type pong hud">
                <HudCell
                  label="you"
                  value={String(
                    lanMode() ? lanYouScore() : (pongState()?.playerScore ?? 0),
                  )}
                />
                <HudCell
                  label={
                    lanMode()
                      ? (getLanMatch()?.peerName ?? "the opponent")
                      : "AI"
                  }
                  value={String(
                    lanMode() ? lanPeerScore() : (pongState()?.aiScore ?? 0),
                  )}
                />
                <HudCell
                  label="rally"
                  value={String(
                    lanMode() ? lanRally() : (pongState()?.rally ?? 0),
                  )}
                />
              </div>
              <PongArena />
              <div class="grid place-items-center gap-1">
                <div
                  class="text-4xl font-bold tracking-widest"
                  dir="auto"
                  data-testid="tp-word"
                >
                  <span class="text-main">
                    {currentWord().slice(0, currentTyped())}
                  </span>
                  <span>{currentWord().slice(currentTyped())}</span>
                </div>
                <div class="text-xs text-sub">
                  type the word — the paddle chases the ball as you type
                </div>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
