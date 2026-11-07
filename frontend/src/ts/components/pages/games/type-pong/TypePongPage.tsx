import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../../config/store";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/type-pong/balance";
import {
  createBreakerEngine,
  type BreakerEngine,
  type BreakerState,
} from "../../../../utils/type-pong/breaker";
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

  let pongEngine: PongEngine | undefined;
  let breakerEngine: BreakerEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  const startRun = async (): Promise<void> => {
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
    if (event.key === "Enter" && mode() === "pong") return;
    if (event.key.length !== 1 && event.key !== "Enter") return;
    if (event.key.length === 1) event.preventDefault();
    if (mode() === "breaker" && breakerEngine !== undefined) {
      const after = breakerEngine.feedKey(event.key);
      setBreakerState(after);
      return;
    }
    if (pongEngine !== undefined) {
      const after = pongEngine.feedKey(event.key);
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
            onClick={() => setMode("pong")}
          />
          <Button
            text="breaker"
            class={cn("w-full", mode() === "breaker" && "bg-main text-bg")}
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
    //KI-34 lesson: the signal must be read INLINE in JSX
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
              left: `${(pongState()?.aiX ?? 50) - BALANCE.paddleW / 2}%`,
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
          <Show when={pongState()?.ball !== undefined}>
            <div
              class="absolute rounded-full bg-main"
              style={{
                left: `${pongState()?.ball.x ?? 50}%`,
                top: `${((pongState()?.ball.y ?? 50) / BALANCE.courtH) * COURT_H - 5}px`,
                width: "10px",
                height: "10px",
                transform: "translateX(-5px)",
              }}
              data-testid="tp-ball"
            ></div>
          </Show>
          <div
            class="absolute rounded-full bg-main"
            style={{
              left: `${(pongState()?.playerX ?? 50) - BALANCE.paddleW / 2}%`,
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
  const currentWord = (): string =>
    mode() === "breaker"
      ? (breakerState()?.word ?? "")
      : (pongState()?.word ?? "");
  const currentTyped = (): number =>
    mode() === "breaker"
      ? (breakerState()?.typed ?? 0)
      : (pongState()?.typed ?? 0);

  const ResultScreen = (): JSXElement => {
    const pongResult =
      mode() === "pong" ? pongEngine?.state().result : undefined;
    const breakerResult =
      mode() === "breaker" ? breakerEngine?.state().result : undefined;
    return (
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
                  value={String(pongState()?.playerScore ?? 0)}
                />
                <HudCell label="AI" value={String(pongState()?.aiScore ?? 0)} />
                <HudCell
                  label="rally"
                  value={String(pongState()?.rally ?? 0)}
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
