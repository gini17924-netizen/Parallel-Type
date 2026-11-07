import { JSXElement, Show, createSignal, onCleanup, onMount } from "solid-js";

import { Config } from "../../../../config/store";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/type-pong/balance";
import {
  createPongEngine,
  type PongEngine,
  type PongState,
} from "../../../../utils/type-pong/pong";
import {
  getPongStats,
  recordPongMatch,
} from "../../../../utils/type-pong/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const FALLBACK_WORDS = ["return", "volley", "smash", "rally", "serve", "spin"];
const COURT_H = 420; //px

type PagePhase = "menu" | "playing" | "result";

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Type Pong (idea G13, phase 2, mode A): the paddle ONLY moves when you
 * type — each correct char pulls it toward the ball's live x; completing
 * the word snaps it onto the ball. The pure engine owns the physics;
 * this page owns the word pool and the timers.
 */
export function TypePongPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<PongState | undefined>(
    undefined,
  );
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: PongEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

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
          .filter(
            (word) =>
              word.length >= 4 && word.length <= 8 && /^\p{L}+$/u.test(word),
          )
          .map((word) => word.toLowerCase()),
      ),
    ];
    const source = pickable.length > 0 ? pickable : FALLBACK_WORDS;
    engine = createPongEngine({
      nextWord: () =>
        source[Math.floor(Math.random() * source.length)] ?? "return",
      rng: Math.random,
      aiSpeed: 60, //the 60wpm tier
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

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      recordPongMatch({
        won: state.result.winner === "player",
        playerScore: state.result.playerScore,
        aiScore: state.result.aiScore,
        bestRally: state.result.bestRally,
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
    const after = engine?.feedKey(event.key);
    if (after === undefined) return;
    if (before !== undefined) {
      if (after.playerScore > before.playerScore) {
        void playClick();
      } else if (after.aiScore > before.aiScore) {
        void playError();
      }
    }
    setEngineState(after);
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
        <Button
          text="start match"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          the paddle ONLY moves when you type — each correct char pulls it
          toward the ball; finish the word to snap onto the ball. First to 5
          wins.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: the signal must be read INLINE in JSX
    const courtW = "100%";
    const paddleW = `${BALANCE.paddleW}%`;
    return (
      <section class="grid place-items-center" aria-label="type pong arena">
        <div
          class="relative overflow-hidden rounded border-2 border-sub bg-bg"
          style={{
            width: courtW,
            "max-width": "32rem",
            height: `${COURT_H}px`,
          }}
        >
          {/*the AI paddle (top) */}
          <div
            class="absolute rounded-full bg-error"
            style={{
              left: `${(engineState()?.aiX ?? 50) - BALANCE.paddleW / 2}%`,
              top: "4px",
              width: paddleW,
              height: "8px",
            }}
            data-testid="tp-ai-paddle"
          ></div>
          {/*the center line */}
          <div
            class="absolute left-0 w-full border-t border-dashed border-sub opacity-30"
            style={{ top: "50%" }}
          ></div>
          {/*the ball */}
          <Show when={engineState()?.ball !== undefined}>
            <div
              class="absolute rounded-full bg-main"
              style={{
                left: `${engineState()?.ball.x ?? 50}%`,
                top: `${((engineState()?.ball.y ?? 50) / BALANCE.courtH) * COURT_H - 5}px`,
                width: "10px",
                height: "10px",
                transform: "translateX(-5px)",
              }}
              data-testid="tp-ball"
            ></div>
          </Show>
          {/*the player paddle (bottom) */}
          <div
            class="absolute rounded-full bg-main"
            style={{
              left: `${(engineState()?.playerX ?? 50) - BALANCE.paddleW / 2}%`,
              bottom: "4px",
              width: paddleW,
              height: "8px",
            }}
            data-testid="tp-player-paddle"
          ></div>
        </div>
      </section>
    );
  };

  const WordDisplay = (): JSXElement => {
    //KI-34 lesson: read the signal inline
    return (
      <div class="grid place-items-center gap-1">
        <div
          class="text-4xl font-bold tracking-widest"
          dir="auto"
          data-testid="tp-word"
        >
          <span class="text-main">
            {(engineState()?.word ?? "").slice(0, engineState()?.typed ?? 0)}
          </span>
          <span>
            {(engineState()?.word ?? "").slice(engineState()?.typed ?? 0)}
          </span>
        </div>
        <div class="text-xs text-sub">
          type the word — the paddle chases the ball as you type
        </div>
      </div>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    const won = result?.winner === "player";
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class={cn("text-3xl font-bold", won ? "text-main" : "text-error")}>
          {won ? "you win!" : "the AI wins"}
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.playerScore ?? 0}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.aiScore ?? 0}
            </div>
            <div class="text-xs text-sub">AI</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.bestRally ?? 0}
            </div>
            <div class="text-xs text-sub">best rally</div>
          </div>
        </div>
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
        <H2 fa={{ icon: "fa-table-tennis" }} text="type pong" />
        <p class="text-sub">
          the paddle ONLY moves when you type — finish the word to snap onto the
          ball. First to 5 wins.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-3 gap-2" aria-label="type pong hud">
            <HudCell
              label="you"
              value={String(engineState()?.playerScore ?? 0)}
            />
            <HudCell label="AI" value={String(engineState()?.aiScore ?? 0)} />
            <HudCell label="rally" value={String(engineState()?.rally ?? 0)} />
          </div>
          <Arena />
          <WordDisplay />
        </Show>
      </Show>
    </div>
  );
}
