import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import type { PairKeysMode } from "../../../../utils/pair-keys/board";

import { Config } from "../../../../config/store";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { unlockedLetters } from "../../../../utils/learn-stats";
import { BALANCE } from "../../../../utils/pair-keys/balance";
import {
  createPairKeysEngine,
  type PairKeysEngine,
  type PairKeysState,
} from "../../../../utils/pair-keys/engine";
import { isJoining } from "../../../../utils/pair-keys/forms";
import {
  getPairKeysBest,
  getPairKeysGames,
  recordPairKeysRun,
} from "../../../../utils/pair-keys/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 100;
/** every Persian letter that joins on both sides (the form-name pool) */
const JOINING_FALLBACK = "بپتثجچحخسشصضطظعغفقکگلمنهی".split("");

type Level = 1 | 2;
type PagePhase = "setup" | "playing" | "result";

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/** the read-only letter pool (learn groups first, standard set padded) */
function letterPool(mode: PairKeysMode): string[] {
  const unlocked = [...new Set([...unlockedLetters(Config.language)])].filter(
    (ch) => /[\u0600-\u06FF]/u.test(ch),
  );
  const base =
    mode === "form-name" ? unlocked.filter((ch) => isJoining(ch)) : unlocked;
  if (base.length >= BALANCE.pairs) return base;
  return [...new Set([...base, ...JOINING_FALLBACK])];
}

/**
 * Pair Keys (idea G18, phase 2): the Persian letter-form memory game.
 * A 4×4 grid of 3D-flipping cards — in form-name mode a joined form
 * glyph pairs with its bare letter, in letter mode twins match. The
 * pure engine owns the rules; this page owns the flip-back timer, the
 * preview countdown and the keyboard navigation.
 */
export function PairKeysPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("setup");
  const [mode, setMode] = createSignal<PairKeysMode>("form-name");
  const [level, setLevel] = createSignal<Level>(1);
  const [engineState, setEngineState] = createSignal<PairKeysState | undefined>(
    undefined,
  );
  const [newRecord, setNewRecord] = createSignal(false);
  const [focusIdx, setFocusIdx] = createSignal(0);

  let engine: PairKeysEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let mismatchTimer: ReturnType<typeof setTimeout> | undefined;
  const cardRefs = new Map<number, HTMLButtonElement>();

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (mismatchTimer !== undefined) clearTimeout(mismatchTimer);
    tickTimer = undefined;
    mismatchTimer = undefined;
  };

  onCleanup(stopTimers);

  const startRun = (): void => {
    setNewRecord(false);
    setFocusIdx(0);
    engine = createPairKeysEngine({
      mode: mode(),
      letters: letterPool(mode()),
      previewMs: BALANCE.previewMsByLevel[level()],
      rng: Math.random,
      now: () => Date.now(),
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.state();
      setEngineState(state);
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      const { isNewRecord } = recordPairKeysRun({
        mode: mode(),
        score: state.result.score,
        moves: state.result.moves,
        timeMs: state.result.elapsedMs,
        perfect: state.result.perfect,
      });
      setNewRecord(isNewRecord);
    }
    setPagePhase("result");
  };

  const flipCard = (index: number): void => {
    if (engine === undefined) return;
    if (engineState()?.phase !== "playing") return;
    const state = engine.flip(index);
    setEngineState(state);
    if (state.open.length === 2) {
      //a mismatch pends — the page owns the 700ms flip-back timer
      if (mismatchTimer !== undefined) clearTimeout(mismatchTimer);
      void playError();
      mismatchTimer = setTimeout(() => {
        const after = engine?.resolve();
        if (after !== undefined) setEngineState(after);
      }, BALANCE.mismatchReturnMs);
    }
    if (state.open.length === 1) void playClick();
  };

  /** arrow-key grid navigation (a11y, doc §۲) */
  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    const idx = focusIdx();
    let next = idx;
    switch (event.key) {
      case "ArrowRight":
        next = (idx + 1) % 16;
        break;
      case "ArrowLeft":
        next = (idx + 15) % 16;
        break;
      case "ArrowDown":
        next = (idx + 4) % 16;
        break;
      case "ArrowUp":
        next = (idx + 12) % 16;
        break;
      default:
        return;
    }
    event.preventDefault();
    setFocusIdx(next);
    cardRefs.get(next)?.focus();
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const backToSetup = (): void => {
    stopTimers();
    engine = undefined;
    setEngineState(undefined);
    setPagePhase("setup");
  };

  const modeLabel = (m: PairKeysMode): string =>
    m === "form-name" ? "letter forms" : "letters";

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="grid grid-cols-2 gap-2" role="group" aria-label="mode">
          <For each={[...BALANCE.modes]}>
            {(m) => (
              <Button
                text={modeLabel(m)}
                class={cn(mode() === m && "bg-main text-bg")}
                onClick={() => setMode(m)}
              />
            )}
          </For>
        </div>
        <div class="grid grid-cols-2 gap-2" role="group" aria-label="level">
          <Button
            text="level 1 · preview"
            class={cn(level() === 1 && "bg-main text-bg")}
            onClick={() => setLevel(1)}
          />
          <Button
            text="level 2 · blind"
            class={cn(level() === 2 && "bg-main text-bg")}
            onClick={() => setLevel(2)}
          />
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getPairKeysBest("form-name")?.score ?? 0}
            </div>
            <div class="text-xs text-sub">best forms</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getPairKeysBest("letter")?.score ?? 0}
            </div>
            <div class="text-xs text-sub">best letters</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getPairKeysGames()}
            </div>
            <div class="text-xs text-sub">games</div>
          </div>
        </div>
        <Button
          text="start memory game"
          fa={{ icon: "fa-clone" }}
          class="w-full"
          onClick={() => startRun()}
        />
        <div class="text-xs text-sub">
          find the 8 pairs. in letter forms mode a joined form glyph pairs with
          its bare letter (the four forms of ب via the ZWJ trick). each pair is
          worth 100 minus the extra moves; a perfect run (8 moves) doubles the
          score. level 1 shows everything for 2s first.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    /** the KI-34 rule: the face state is a FUNCTION called inline in the
     * JSX expressions — a body const would freeze on the mount snapshot */
    const faceOf = (id: number): string => engineState()?.faces[id] ?? "down";
    return (
      <section
        class="relative w-full rounded bg-sub-alt p-4"
        aria-label="pair keys arena"
      >
        <Show when={engineState()?.phase === "preview"}>
          <div
            class="mb-2 text-center text-sm font-bold text-main"
            data-testid="pk-preview"
          >
            memorize! the grid hides in a moment
          </div>
        </Show>
        <div class="mx-auto grid w-full max-w-2xl grid-cols-4 gap-2">
          <For each={engine?.board().cards ?? []}>
            {(card) => (
              <button
                ref={(el) => cardRefs.set(card.id, el)}
                type="button"
                class="aspect-square rounded outline-none"
                style={{ perspective: "600px" }}
                onClick={() => flipCard(card.id)}
                data-testid="pk-card"
                data-base={card.baseLetter}
                data-kind={card.kind}
                data-face={faceOf(card.id)}
                aria-label={
                  faceOf(card.id) === "down" ? "hidden card" : card.display
                }
              >
                <div
                  class="relative h-full w-full"
                  style={{
                    transform:
                      faceOf(card.id) === "down"
                        ? "rotateY(0deg)"
                        : "rotateY(180deg)",
                    "transform-style": "preserve-3d",
                    transition: "transform 300ms",
                  }}
                >
                  {/*the back (the pattern side)*/}
                  <div
                    class={cn(
                      "absolute inset-0 grid place-items-center rounded border-2 bg-bg text-2xl text-sub",
                      faceOf(card.id) === "matched" && "border-main",
                    )}
                    style={{ "backface-visibility": "hidden" }}
                  >
                    ◆
                  </div>
                  {/*the face (the character side)*/}
                  <div
                    class={cn(
                      "absolute inset-0 grid place-items-center rounded border-2 text-4xl font-bold",
                      faceOf(card.id) === "matched"
                        ? "border-main bg-main/20 text-main"
                        : "border-sub bg-sub-alt text-main",
                    )}
                    style={{
                      "backface-visibility": "hidden",
                      transform: "rotateY(180deg)",
                      "font-family":
                        '"Noto Naskh Arabic", var(--font), sans-serif',
                    }}
                    dir="rtl"
                  >
                    {card.display}
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <Show when={newRecord()}>
          <div class="text-lg font-bold text-main" data-testid="pk-record">
            new best score!
          </div>
        </Show>
        <Show
          when={result?.perfect}
          fallback={<div class="text-3xl font-bold text-main">grid done</div>}
        >
          <div class="text-3xl font-bold text-main">perfect run!</div>
        </Show>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.moves ?? 0}
            </div>
            <div class="text-xs text-sub">moves</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {((result?.elapsedMs ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">time</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {mode() === "form-name" ? "forms" : "letters"}
            </div>
            <div class="text-xs text-sub">mode</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best {modeLabel(mode())}: {getPairKeysBest(mode())?.score ?? 0} ·{" "}
          {getPairKeysBest(mode())?.moves ?? 0} moves
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="play again"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => startRun()}
          />
          <Button
            text="back to menu"
            fa={{ icon: "fa-home" }}
            class="w-full"
            onClick={backToSetup}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-clone" }} text="pair keys" />
        <p class="text-sub">
          the Persian letter-form memory game — pair each joined form with its
          bare letter, or match letter twins. rendered with the ZWJ trick: no
          extra fonts, just your keyboard memory.
        </p>
      </section>
      <Show when={pagePhase() !== "setup"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="pair keys hud">
            <HudCell label="moves" value={`${engineState()?.moves ?? 0}`} />
            <HudCell
              label="pairs"
              value={`${engineState()?.matched ?? 0}/${engineState()?.pairs ?? 8}`}
            />
            <HudCell label="score" value={`${engineState()?.score ?? 0}`} />
            <HudCell
              label="time"
              value={`${((engineState()?.elapsedMs ?? 0) / 1000).toFixed(0)}s`}
            />
          </div>
          <Arena />
          <div class="text-center text-xs text-sub">
            click or Tab+Enter to flip — arrow keys move around the grid
          </div>
        </Show>
      </Show>
    </div>
  );
}
