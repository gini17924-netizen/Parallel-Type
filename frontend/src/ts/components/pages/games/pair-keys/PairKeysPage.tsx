import {
  For,
  JSXElement,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import type { PairKeysMode } from "../../../../utils/pair-keys/board";

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
import { unlockedLetters } from "../../../../utils/learn-stats";
import { BALANCE } from "../../../../utils/pair-keys/balance";
import {
  createPairKeysEngine,
  type PairKeysEngine,
  type PairKeysState,
} from "../../../../utils/pair-keys/engine";
import { isJoining } from "../../../../utils/pair-keys/forms";
import {
  lanPairKeys,
  resolvePairVerdict,
  type PairRemoteState,
  type PairVerdict,
} from "../../../../utils/pair-keys/lan";
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
type PagePhase = "setup" | "playing" | "awaiting" | "result";

/** the online verdict once both solvers have reported */
type PairOnlineResult = {
  verdict: PairVerdict;
  myFound: number;
  myMoves: number;
  myTimeMs: number | null;
  theirFound: number;
  theirMoves: number;
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

/** the read-only letter pool (learn groups first, standard set padded) */
function letterPool(mode: PairKeysMode): string[] {
  const unlocked = [
    ...new Set(Array.from(unlockedLetters(Config.language))),
  ].filter((ch) => /[\u0600-\u06FF]/u.test(ch));
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
  //online (LAN) state — the peer solves the same seeded board
  const [remoteState, setRemoteState] = createSignal<
    PairRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    PairOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: PairKeysEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let mismatchTimer: ReturnType<typeof setTimeout> | undefined;
  const cardRefs = new Map<number, HTMLButtonElement>();
  let runStart = 0;
  let myFinish: { finishMs: number; moves: number } | undefined;
  let myFinishSent = false;
  let lastSentFound = -1;
  let lastSentMoves = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (mismatchTimer !== undefined) clearTimeout(mismatchTimer);
    tickTimer = undefined;
    mismatchTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-solve (header back, route change) tells the peer the
  //board is abandoned — they can never be beaten once it is parked
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "pair-keys") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanPairKeys.encodeProgress({
          found: state?.matched ?? 0,
          moves: state?.moves ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "pair-keys";

  const startRun = (): void => {
    if (lanMode()) return; //online: the match effect owns the start
    startOfflineRun(mode(), level());
  };

  /** the offline run: the random board, the local records */
  const startOfflineRun = (runMode: PairKeysMode, runLevel: Level): void => {
    setNewRecord(false);
    setFocusIdx(0);
    engine = createPairKeysEngine({
      mode: runMode,
      letters: letterPool(runMode),
      previewMs: BALANCE.previewMsByLevel[runLevel],
      rng: Math.random,
      now: () => Date.now(),
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const state = engine?.state();
    setOnlineResult({
      verdict: resolvePairVerdict(
        {
          finishMs:
            state?.result?.elapsedMs ?? (Date.now() - runStart),
          moves: state?.moves ?? 0,
        },
        {
          finishMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
          moves: remoteState()?.moves ?? 0,
        },
      ),
      myFound: state?.matched ?? 0,
      myMoves: state?.moves ?? 0,
      myTimeMs: state?.result?.elapsedMs ?? null,
      theirFound: remoteState()?.found ?? 0,
      theirMoves: remoteState()?.moves ?? 0,
      theirTimeMs: finished.finishMs,
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

  //an armed (or re-armed) pair match IS the online start: the seed
  //builds the identical board (the deterministic fallback letter pool —
  //unlocked letters vary per machine, the fallback does not)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "pair-keys") return;
    const matchMode =
      match.start.params["mode"] === "letter" ? "letter" : "form-name";
    const matchLevel = match.start.params["level"] === 2 ? 2 : 1;
    setOnlineResult(undefined);
    setRematchSent(false);
    setRemoteState(undefined);
    setNewRecord(false);
    setFocusIdx(0);
    myFinish = undefined;
    myFinishSent = false;
    lastSentFound = -1;
    lastSentMoves = -1;
    runStart = Date.now();
    engine = createPairKeysEngine({
      mode: matchMode,
      letters: [...JOINING_FALLBACK],
      previewMs: BALANCE.previewMsByLevel[matchLevel],
      rng: createSeededRng(match.start.seed ?? 1),
      now: () => Date.now(),
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as PairRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "pair-keys") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the solve voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "pair-keys") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
    setNewRecord(false);
    setFocusIdx(0);
    setPagePhase("setup");
  });

  /** the one tick loop both the offline solve and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.state();
      setEngineState(state);
      //online: relay the found/moves when they moved
      if (
        lanMode() &&
        (state.matched !== lastSentFound || state.moves !== lastSentMoves)
      ) {
        lastSentFound = state.matched;
        lastSentMoves = state.moves;
        sendLanMatchProgress(
          lanPairKeys.encodeProgress({
            found: state.matched,
            moves: state.moves,
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
      //the board is solved — my finish was already sent at the last pair
      if (!myFinishSent) {
        myFinishSent = true;
        myFinish = {
          finishMs:
            state?.result?.elapsedMs ?? (Date.now() - runStart),
          moves: state?.moves ?? 0,
        };
        sendLanMatchFinished(myFinish.finishMs, 100);
      }
      if (getRemoteFinished() !== undefined) {
        resolveOnlineResult();
      } else {
        setPagePhase("awaiting");
      }
      return;
    }
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
        <Show when={voidMessage() !== undefined}>
          <div class="text-error">{voidMessage()}</div>
        </Show>
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

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="pk-awaiting">
          board solved in {((myFinish?.finishMs ?? 0) / 1000).toFixed(1)}s ·{" "}
          {myFinish?.moves ?? 0} moves — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): PairOnlineResult | undefined => onlineResult();
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
          data-testid="pk-verdict"
        >
          {verdict === "won"
            ? "you win!"
            : verdict === "draw"
              ? "draw"
              : verdict === "lost" && !myFinishSent
                ? `you abandoned — ${getLanMatch()?.peerName ?? "the opponent"} takes it`
                : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.myFound ?? 0}/8 ·{" "}
              {online()?.myTimeMs === null
                ? "—"
                : `${((online()?.myTimeMs ?? 0) / 1000).toFixed(1)}s`}{" "}
              · {online()?.myMoves ?? 0} moves
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirFound ?? 0}/8 ·{" "}
              {online()?.theirTimeMs === null
                ? "solving"
                : `${((online()?.theirTimeMs ?? 0) / 1000).toFixed(1)}s`}{" "}
              · {online()?.theirMoves ?? 0} moves
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
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="pk-online-vs"
        >
          <i class="fas fa-clone"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same board, the first solve wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="pk-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.found ?? 0}/8 · {remoteState()?.moves ?? 0} moves
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.matched ?? 0}/8 · {engineState()?.moves ?? 0}{" "}
              moves
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
        </div>
      </Show>
      <Show when={pagePhase() !== "setup"} fallback={<Menu />}>
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
