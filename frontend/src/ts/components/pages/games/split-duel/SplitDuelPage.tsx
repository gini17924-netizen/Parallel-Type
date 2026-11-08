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
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { generatePseudoWords } from "../../../../utils/learn-stats";
import { BALANCE } from "../../../../utils/split-duel/balance";
import {
  createSplitDuelMatch,
  type SplitDuelMatch,
  type SplitDuelState,
} from "../../../../utils/split-duel/match";
import { sideOf } from "../../../../utils/split-duel/sides";
import {
  getDuelHistory,
  getDuelWinsBySlot,
  recordDuelMatch,
} from "../../../../utils/split-duel/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
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
];
/** the letters each keyboard half can physically produce (QWERTY) */
const LEFT_LETTERS = "qwertasdfgzxcvb";
const RIGHT_LETTERS = "yuiophjklnm";
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

type DuelMode = "turn" | "simultaneous";
type PagePhase = "setup" | "countdown" | "playing" | "result";

/**
 * Split-Key Showdown (idea G19, phase 2): two players on ONE physical
 * keyboard. Mode A (turn) types the identical stream sequentially with
 * a swap overlay; mode B (simultaneous) splits the board per event.code
 * — each half's stream is built from that half's own letters (a player
 * can only press their own keys). Esc leaves without recording.
 */
export function SplitDuelPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("setup");
  const [mode, setMode] = createSignal<DuelMode>("simultaneous");
  const [name1, setName1] = createSignal("P1");
  const [name2, setName2] = createSignal("P2");
  const [length, setLength] = createSignal<number>(BALANCE.defaultWords);
  const [matchState, setMatchState] = createSignal<SplitDuelState | undefined>(
    undefined,
  );
  /** drives the countdown/elapsed re-renders (KI-34: read inline) */
  const [clock, setClock] = createSignal(0);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let match: SplitDuelMatch | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  const playerName = (slot: 1 | 2): string =>
    slot === 1 ? name1().trim() || "P1" : name2().trim() || "P2";

  const realWords = async (): Promise<string[]> => {
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      const pool = [
        ...new Set(
          data.words
            .filter((word) => /^[a-z]{3,8}$/.test(word))
            .map((word) => word.toLowerCase()),
        ),
      ];
      if (pool.length >= length()) return pool;
    } catch {
      //offline fallback below
    }
    return FALLBACK_WORDS;
  };

  const startMatch = async (): Promise<void> => {
    setMessage(undefined);
    const source = await realWords();
    let streams: [string[], string[]];
    if (mode() === "turn") {
      //mode A: the IDENTICAL sequence for both (doc §۰.A.۱); a small
      //offline pool cycles up to the requested length
      const shared: string[] = [];
      while (shared.length < length()) {
        shared.push(source[shared.length % source.length] ?? "cat");
      }
      streams = [shared, shared];
    } else {
      //mode B: each half types its OWN half's letters — pseudo-words
      //from the fork's bigram generator, same word count for fairness
      streams = [
        generatePseudoWords(LEFT_LETTERS, length(), source),
        generatePseudoWords(RIGHT_LETTERS, length(), source),
      ];
    }
    match = createSplitDuelMatch({
      mode: mode(),
      words: streams,
      names: [playerName(1), playerName(2)],
    });
    match.startCountdown(Date.now());
    setMatchState(match.state());
    setPagePhase("countdown");
    tickTimer = setInterval(() => {
      setClock(Date.now());
      if (match === undefined) return;
      const state = match.state();
      if (state.phase === "countdown") {
        const end = state.countdownEndsAtMs ?? 0;
        if (Date.now() >= end) {
          const begun = match.begin(Date.now());
          setMatchState(begun);
          if (begun.phase !== "countdown") setPagePhase("playing");
        }
        return;
      }
      setMatchState(state);
      if (state.phase === "result") endMatch();
    }, TICK_MS);
  };

  const endMatch = (): void => {
    stopTimers();
    const state = match?.state();
    if (state?.result !== undefined) {
      recordDuelMatch({
        mode: mode(),
        winnerSlot: state.result.winnerSlot,
        marginMs: state.result.marginMs,
      });
    }
    setPagePhase("result");
  };

  const backToSetup = (): void => {
    //Esc is always safe: leave mid-run without recording anything
    stopTimers();
    match = undefined;
    setMatchState(undefined);
    setPagePhase("setup");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (pagePhase() === "playing" || pagePhase() === "countdown") {
        event.preventDefault();
        backToSetup();
      }
      return;
    }
    if (pagePhase() !== "playing" || match === undefined) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const state = match.feedKey(
      latinCharFromEvent(event.key, event.code),
      event.code,
      Date.now(),
    );
    setMatchState(state);
    if (state.phase === "turn-swap") void playError();
    else void playClick();
    if (state.phase === "result") endMatch();
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  /** the countdown's remaining whole seconds (3, 2, 1) */
  const countdownLeft = (): number => {
    const end = matchState()?.countdownEndsAtMs ?? 0;
    return Math.max(0, Math.ceil((end - clock()) / 1000));
  };

  const StreamView = (props: { slot: 1 | 2 }): JSXElement => {
    //KI-34: every state read stays inline in the JSX expressions
    const state = (): SplitDuelState["players"][1] =>
      matchState()?.players[props.slot] ?? {
        phase: "ready",
        wordIndex: 0,
        currentWord: "",
        typed: 0,
        wordCount: 0,
        correctChars: 0,
        wrongChars: 0,
        acc: 100,
        elapsedMs: 0,
      };
    const colorClass = (): string =>
      props.slot === 1 ? "text-main" : "text-error";
    return (
      <div class="grid gap-2 rounded bg-sub-alt p-4">
        <div class="flex items-center justify-between">
          <span class={cn("font-bold", colorClass())}>
            {matchState()?.names[props.slot - 1] ?? playerName(props.slot)}
          </span>
          <span class="text-xs text-sub tabular-nums">
            {state().wordIndex}/{state().wordCount} words ·{" "}
            {(state().elapsedMs / 1000).toFixed(1)}s
          </span>
        </div>
        <div
          class="text-center text-3xl font-bold tracking-widest"
          dir="auto"
          data-testid={`sd-word-${props.slot}`}
          data-word={state().currentWord}
        >
          <span class={colorClass()}>
            {state().currentWord.slice(0, state().typed)}
          </span>
          <span class="text-sub">
            {state().currentWord.slice(state().typed)}
          </span>
        </div>
        <div class="h-2 w-full rounded bg-bg">
          <div
            class={cn(
              "h-full rounded",
              props.slot === 1 ? "bg-main" : "bg-error",
            )}
            style={{
              width: `${
                state().wordCount === 0
                  ? 0
                  : (state().wordIndex / state().wordCount) * 100
              }%`,
            }}
          ></div>
        </div>
      </div>
    );
  };

  /** the teaching keyboard: each key colored by its half (mode B) */
  const VirtualKeyboard = (): JSXElement => {
    return (
      <div
        class="mx-auto grid w-full max-w-xl gap-1"
        aria-label="keyboard split"
      >
        <For each={KEY_ROWS}>
          {(row) => (
            <div class="flex justify-center gap-1">
              <For each={[...row]}>
                {(letter) => {
                  const side = sideOf(`Key${letter.toUpperCase()}`);
                  return (
                    <div
                      class={cn(
                        "grid h-7 w-7 place-items-center rounded text-xs font-bold",
                        side === "left"
                          ? "bg-main/70 text-bg"
                          : "bg-error/70 text-bg",
                      )}
                      title={side === "left" ? "player 1" : "player 2"}
                    >
                      {letter}
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>
        <div class="mt-1 flex justify-center gap-4 text-xs text-sub">
          <span>
            <span class="inline-block h-2 w-2 rounded-full bg-main"></span>{" "}
            {playerName(1)} (left)
          </span>
          <span>
            <span class="inline-block h-2 w-2 rounded-full bg-error"></span>{" "}
            {playerName(2)} (right)
          </span>
        </div>
      </div>
    );
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <input
            class="rounded bg-bg p-2 text-main"
            value={name1()}
            maxLength={12}
            aria-label="player 1 name"
            onInput={(e) => setName1(e.currentTarget.value)}
          />
          <input
            class="rounded bg-bg p-2 text-main"
            value={name2()}
            maxLength={12}
            aria-label="player 2 name"
            onInput={(e) => setName2(e.currentTarget.value)}
          />
        </div>
        <div class="grid grid-cols-2 gap-2" role="group" aria-label="mode">
          <Button
            text="A · turn-based"
            class={cn(mode() === "turn" && "bg-main text-bg")}
            onClick={() => setMode("turn")}
          />
          <Button
            text="B · simultaneous"
            class={cn(mode() === "simultaneous" && "bg-main text-bg")}
            onClick={() => setMode("simultaneous")}
          />
        </div>
        <div class="grid grid-cols-3 gap-2" role="group" aria-label="length">
          <For each={[10, 20, 30]}>
            {(len) => (
              <Button
                text={`${len} words`}
                class={cn(length() === len && "bg-main text-bg")}
                onClick={() => setLength(len)}
              />
            )}
          </For>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getDuelWinsBySlot()["1"]}
            </div>
            <div class="text-xs text-sub">{playerName(1)} wins</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getDuelWinsBySlot()["2"]}
            </div>
            <div class="text-xs text-sub">{playerName(2)} wins</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xs text-sub">
              {getDuelHistory()[0] !== undefined
                ? `last: ${getDuelHistory()[0]?.mode} · +${getDuelHistory()[0]?.marginMs}ms`
                : "no matches yet"}
            </div>
          </div>
        </div>
        <Button
          text="start showdown"
          fa={{ icon: "fa-users" }}
          class="w-full"
          onClick={() => void startMatch()}
        />
        <div class="text-xs text-sub">
          mode B splits the physical board per key position (left half vs right
          half) — if some keys do nothing on a non-ANSI layout, use turn mode.
          Esc always leaves safely without recording.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    return (
      <section class="relative grid gap-4" aria-label="split duel arena">
        <Show
          when={mode() === "simultaneous"}
          fallback={
            <div class="relative grid gap-4">
              <StreamView slot={matchState()?.activeSlot ?? 1} />
              <Show when={matchState()?.phase === "turn-swap"}>
                <div
                  class="absolute inset-0 grid place-items-center rounded bg-bg/85"
                  data-testid="sd-swap"
                >
                  <div class="grid gap-3 text-center">
                    <div class="text-2xl font-bold text-main">
                      {playerName(2)}, ready?
                    </div>
                    <div class="text-xs text-sub">
                      same word sequence — your time starts on the click
                    </div>
                    <Button
                      text="start my run"
                      fa={{ icon: "fa-play" }}
                      onClick={() => {
                        match?.swapTo(2, Date.now());
                        setMatchState(match?.state());
                      }}
                    />
                  </div>
                </div>
              </Show>
            </div>
          }
        >
          <div class="grid grid-cols-2 gap-4">
            <StreamView slot={1} />
            <StreamView slot={2} />
          </div>
          <VirtualKeyboard />
        </Show>
      </section>
    );
  };

  const ResultScreen = (): JSXElement => {
    const result = match?.state().result;
    const winner = (): string => {
      if (result === undefined || result.winnerSlot === 0) return "draw";
      return result.winnerSlot === 1 ? playerName(1) : playerName(2);
    };
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-main" data-testid="sd-winner">
          {winner()} wins!
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {(result?.p1Ms ?? 0) / 1000}s
            </div>
            <div class="text-xs text-sub">
              {playerName(1)} · {(result?.p1Acc ?? 100).toFixed(0)}% acc
            </div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {(result?.p2Ms ?? 0) / 1000}s
            </div>
            <div class="text-xs text-sub">
              {playerName(2)} · {(result?.p2Acc ?? 100).toFixed(0)}% acc
            </div>
          </div>
        </div>
        <div class="text-xs text-sub">
          margin {(result?.marginMs ?? 0) / 1000}s ·{" "}
          {(result?.marginMs ?? 0) <= BALANCE.closeMarginMs
            ? "a close match!"
            : "a clear win"}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="rematch"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => void startMatch()}
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
        <H2 fa={{ icon: "fa-users" }} text="split duel" />
        <p class="text-sub">
          two players, one keyboard, zero servers — mode A races turns over the
          same words, mode B splits the physical board in half and both players
          type at once.
        </p>
      </section>
      <Show when={pagePhase() !== "setup"} fallback={<Menu />}>
        <Show when={pagePhase() !== "result"} fallback={<ResultScreen />}>
          <Show
            when={pagePhase() !== "countdown"}
            fallback={
              <div
                class="grid place-items-center rounded bg-sub-alt p-12 text-6xl font-bold text-main"
                data-testid="sd-countdown"
              >
                {countdownLeft()}
              </div>
            }
          >
            <Arena />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
