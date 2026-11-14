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
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { generatePseudoWords } from "../../../../utils/learn-stats";
import { BALANCE } from "../../../../utils/split-duel/balance";
import {
  createStreamEngine,
  type StreamState,
} from "../../../../utils/split-duel/engine";
import {
  resolveSplitVerdict,
  sideForRole,
  splitLanStreams,
  lanSplitDuel,
  type SplitSide,
  type SplitVerdict,
} from "../../../../utils/split-duel/lan";
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
type PagePhase =
  | "setup"
  | "countdown"
  | "playing"
  | "awaiting"
  | "result"
  | "spectating";

/** the online verdict once both halves have reported */
type SplitOnlineResult = {
  verdict: SplitVerdict;
  myMs: number;
  myAcc: number;
  theirMs: number;
  theirAcc: number;
};

function coerceLanWords(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : BALANCE.defaultWords;
}

/**
 * Split-Key Showdown (idea G19, phase 2): two players on ONE physical
 * keyboard. Mode A (turn) types the identical stream sequentially with
 * a swap overlay; mode B (simultaneous) splits the board per event.code
 * — each half's stream is built from that half's own letters (a player
 * can only press their own keys). Esc leaves without recording.
 */
export function SplitDuelPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch()?.gameId === "split-duel" ? "countdown" : "setup",
  );
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
  //online (LAN) state — my half + the relayed remote half
  const [myState, setMyState] = createSignal<StreamState | undefined>(
    undefined,
  );
  const [remoteState, setRemoteState] = createSignal<
    { wordIndex: number; correctChars: number } | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    SplitOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [onlineCountdown, setOnlineCountdown] = createSignal(3);

  let match: SplitDuelMatch | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let myEngine: ReturnType<typeof createStreamEngine> | undefined;
  let mySide: SplitSide = "left";
  let myWords: string[] = [];
  let myFinish: { finishMs: number; acc: number } | undefined;
  let myFinishSent = false;
  let lastSentWords = -1;
  let lastSentChars = -1;
  let onlineEndsAt = 0;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-race (Esc, header back) tells the peer the race ended
  //without a completion and disarms — they are never left waiting
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "split-duel") return;
    if (
      pagePhase() !== "countdown" &&
      pagePhase() !== "playing" &&
      pagePhase() !== "awaiting"
    ) {
      return;
    }
    sendLanMatchFinished(null, 0);
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "split-duel";

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
    if (lanMode()) {
      //online: the same leave — the peer learns the race ended
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchFinished(null, 0);
      }
      clearLanMatch();
    }
    stopTimers();
    match = undefined;
    myEngine = undefined;
    setMatchState(undefined);
    setPagePhase("setup");
  };

  const fetchLanPool = async (lang: string): Promise<string[]> => {
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${lang}.json`,
      );
      return [
        ...new Set(
          data.words
            .filter((word) => /^[a-z]{3,8}$/.test(word))
            .map((word) => word.toLowerCase()),
        ),
      ];
    } catch {
      return [];
    }
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined || myFinish === undefined) return;
    //a null finish means the peer's half never completed — they lose
    const theirs = {
      finishMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
      acc: finished.acc,
    };
    setOnlineResult({
      verdict: resolveSplitVerdict(myFinish, theirs),
      myMs: myFinish.finishMs,
      myAcc: myFinish.acc,
      theirMs: finished.finishMs ?? 0,
      theirAcc: finished.acc,
    });
    setPagePhase("result");
  };

  const myFinishNow = (): void => {
    if (myFinishSent || myEngine === undefined) return;
    const state = myEngine.state();
    if (state.phase !== "done") return;
    myFinishSent = true;
    myFinish = {
      finishMs: Math.round(state.elapsedMs),
      acc: Math.round(state.acc),
    };
    sendLanMatchFinished(myFinish.finishMs, myFinish.acc);
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    } else {
      setPagePhase("awaiting");
    }
  };

  /** the online tick: the countdown flip, the progress relay, the finish */
  const startOnlineTick = (): void => {
    stopTimers();
    tickTimer = setInterval(() => {
      setClock(Date.now());
      if (pagePhase() === "countdown") {
        const left = Math.max(0, Math.ceil((onlineEndsAt - Date.now()) / 1000));
        setOnlineCountdown(left);
        if (Date.now() >= onlineEndsAt && myEngine !== undefined) {
          myEngine.start(Date.now());
          setMyState(myEngine.state());
          setPagePhase("playing");
        }
        return;
      }
      const engine = myEngine;
      if (engine === undefined || pagePhase() !== "playing") return;
      const state = engine.state();
      setMyState(state);
      //relay the live progress when it moved (the tick batches it)
      if (
        state.wordIndex !== lastSentWords ||
        state.correctChars !== lastSentChars
      ) {
        lastSentWords = state.wordIndex;
        lastSentChars = state.correctChars;
        sendLanMatchProgress(
          lanSplitDuel.encodeProgress({
            wordIndex: state.wordIndex,
            correctChars: state.correctChars,
          }),
        );
      }
    }, TICK_MS);
  };

  //an armed (or re-armed) split-duel match IS the online start: the seed
  //builds BOTH halves' streams locally; I type my half on my keyboard
  createEffect(() => {
    const armed = getLanMatch();
    if (armed?.gameId !== "split-duel") return;
    void (async () => {
      const lang =
        typeof armed.start.params["lang"] === "string"
          ? armed.start.params["lang"]
          : "english";
      //phase 79: a spectator renders nothing and drives nothing — the
      //split streams are per-player and cannot be spectated without a
      //field protocol (the roster view covers them in the lobby)
      if (armed.role === "spectator") {
        setPagePhase("spectating");
        return;
      }
      const words = coerceLanWords(armed.start.params["words"]);
      const pool = await fetchLanPool(lang);
      const [left, right] = splitLanStreams(pool, armed.start.seed ?? 1, words);
      mySide = sideForRole(armed.role);
      myWords = mySide === "left" ? left : right;
      myEngine = createStreamEngine({ words: myWords });
      myFinish = undefined;
      myFinishSent = false;
      lastSentWords = -1;
      lastSentChars = -1;
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setMyState(myEngine.state());
      onlineEndsAt = Date.now() + BALANCE.countdownMs;
      setOnlineCountdown(BALANCE.countdownMs / 1000);
      setPagePhase("countdown");
      startOnlineTick();
    })();
  });

  //the relayed remote progress lands decoded — the bar reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(
      progress.state as { wordIndex: number; correctChars: number },
    );
  });

  //the peer's finish resolves the held verdict (or arrived before mine)
  createEffect(() => {
    if (pagePhase() !== "awaiting") return;
    if (getRemoteFinished() === undefined) return;
    resolveOnlineResult();
  });

  const hostRematch = (armed: LanMatch): void => {
    //arm first: a refused start never reaches the wire
    armLanMatch({
      role: "host",
      peerName: armed.peerName,
      start: armed.start,
    });
    if (getLanMatch() === undefined) return;
    sendLanMatchStart(armed.start, lanPreFillName() || "P1");
  };

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const armed = getLanMatch();
    if (armed?.role !== "host" || armed.gameId !== "split-duel") return;
    if (!getRematchAsked()) return;
    hostRematch(armed);
  });

  //a disconnect during the race voids it — nothing online is recorded
  createEffect(() => {
    const armed = getLanMatch();
    if (armed?.gameId !== "split-duel") return;
    if (isLanConnected()) return;
    if (
      pagePhase() !== "countdown" &&
      pagePhase() !== "playing" &&
      pagePhase() !== "awaiting"
    ) {
      return;
    }
    stopTimers();
    myEngine = undefined;
    clearLanMatch();
    setMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("setup");
  });

  const handleKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (
        pagePhase() === "playing" ||
        pagePhase() === "countdown" ||
        pagePhase() === "awaiting"
      ) {
        event.preventDefault();
        backToSetup();
      }
      return;
    }
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const ch = latinCharFromEvent(event.key, event.code);
    if (lanMode()) {
      //online: every letter I type belongs to MY half's stream
      const engine = myEngine;
      if (engine === undefined) return;
      engine.feedKey(ch, Date.now());
      setMyState(engine.state());
      void playClick();
      if (engine.state().phase === "done") myFinishNow();
      return;
    }
    if (match === undefined) return;
    const state = match.feedKey(ch, event.code, Date.now());
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
              <For each={row.split("")}>
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

  /** the online arena: my half on my keyboard + the peer's live bar */
  const OnlineArena = (): JSXElement => {
    //KI-34: every state read stays inline in the JSX expressions
    const mine = (): StreamState | undefined => myState();
    const peerName = (): string => getLanMatch()?.peerName ?? "the opponent";
    const myProgress = (): number =>
      mine() === undefined || mine()?.wordCount === 0
        ? 0
        : ((mine()?.wordIndex ?? 0) / (mine()?.wordCount ?? 1)) * 100;
    const theirProgress = (): number =>
      myWords.length === 0
        ? 0
        : Math.min(
            100,
            ((remoteState()?.wordIndex ?? 0) / myWords.length) * 100,
          );
    return (
      <section class="grid gap-4" aria-label="online split duel arena">
        <div class="grid gap-2 rounded bg-sub-alt p-4">
          <div class="flex items-center justify-between">
            <span class="font-bold text-main">you · {mySide} half</span>
            <span class="text-xs text-sub tabular-nums">
              {mine()?.wordIndex ?? 0}/{mine()?.wordCount ?? 0} words ·{" "}
              {((mine()?.elapsedMs ?? 0) / 1000).toFixed(1)}s
            </span>
          </div>
          <div
            class="text-center text-3xl font-bold tracking-widest"
            dir="auto"
            data-testid="sd-online-word"
          >
            <span class="text-main">
              {(mine()?.currentWord ?? "").slice(0, mine()?.typed ?? 0)}
            </span>
            <span class="text-sub">
              {(mine()?.currentWord ?? "").slice(mine()?.typed ?? 0)}
            </span>
          </div>
          <div class="h-2 w-full rounded bg-bg">
            <div
              class="h-full rounded bg-main"
              style={{ width: `${myProgress()}%` }}
            ></div>
          </div>
        </div>
        <div class="grid gap-1 rounded bg-sub-alt p-3">
          <div class="flex items-center justify-between text-xs text-sub">
            <span>
              {peerName()} · {mySide === "left" ? "right" : "left"} half
            </span>
            <span class="tabular-nums">
              {remoteState()?.wordIndex ?? 0}/{myWords.length} words
            </span>
          </div>
          <div class="h-2 w-full rounded bg-bg">
            <div
              class="h-full rounded bg-error"
              style={{ width: `${theirProgress()}%` }}
            ></div>
          </div>
        </div>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="sd-awaiting">
          your half is done in {((myFinish?.finishMs ?? 0) / 1000).toFixed(1)}s
          — waiting for {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): SplitOnlineResult | undefined => onlineResult();
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
          data-testid="sd-online-winner"
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
              {(online()?.myMs ?? 0) / 1000}s
            </div>
            <div class="text-xs text-sub">
              you · {(online()?.myAcc ?? 100).toFixed(0)}% acc
            </div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {(online()?.theirMs ?? 0) / 1000}s
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"} ·{" "}
              {(online()?.theirAcc ?? 100).toFixed(0)}% acc
            </div>
          </div>
        </div>
        <div class="text-xs text-sub">
          {Math.abs((online()?.myMs ?? 0) - (online()?.theirMs ?? 0)) <=
          BALANCE.closeMarginMs
            ? "a close match!"
            : "a clear win"}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text={rematchSent() ? "rematch requested — waiting…" : "rematch"}
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => {
              const armed = getLanMatch();
              if (armed === undefined || rematchSent()) return;
              if (armed.role === "host") {
                hostRematch(armed);
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
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="sd-online-vs"
        >
          <i class="fas fa-users"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} —{" "}
          {getLanMatch()?.role === "spectator"
            ? "spectating"
            : `you are the ${sideForRole(
                getLanMatch()?.role === "host" ? "host" : "client",
              )} half`}
        </div>
      </Show>
      <Show when={pagePhase() !== "setup"} fallback={<Menu />}>
        <Show
          when={lanMode()}
          fallback={
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
          }
        >
          <Show
            when={pagePhase() !== "result"}
            fallback={<OnlineResultScreen />}
          >
            <Show
              when={pagePhase() !== "awaiting"}
              fallback={<AwaitingScreen />}
            >
              <Show
                when={pagePhase() !== "countdown"}
                fallback={
                  <div
                    class="grid place-items-center rounded bg-sub-alt p-12 text-6xl font-bold text-main"
                    data-testid="sd-online-countdown"
                  >
                    {onlineCountdown()}
                  </div>
                }
              >
                <OnlineArena />
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
