import {
  For,
  JSXElement,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

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
import { cachedFetchJson } from "../../../../utils/json-data";
import {
  lanWordle,
  resolveWordleVerdict,
  type WordleRemoteState,
  type WordleVerdict,
} from "../../../../utils/wordle/lan";
import {
  buildShareGrid,
  computeWordlePools,
  gradeGuess,
  isValidGuess,
  normalizeGuess,
  pickAnswer,
  type LetterState,
  type WordlePools,
} from "../../../../utils/wordle/wordle-engine";
import {
  getWordleStats,
  loadWordleState,
  recordWordleGame,
  saveWordleState,
  wordleDayKey,
} from "../../../../utils/wordle/wordle-store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const WORDLE_LENGTH = 5;
const MAX_GUESSES = 6;
/** the puzzle-number epoch: the game's launch month (v1 freedom) */
const PUZZLE_EPOCH = Date.UTC(2026, 10, 1);
/** the yellow tone, inline so the theme file stays untouched (v1) */
const YELLOW = "#c9a227";

const FALLBACK_WORDS = ["crane", "apple", "level", "eeler", "brine", "adobe"];

const WORDLE_LANG_FILES: Record<
  "fa" | "en",
  { common: string; valid: string }
> = {
  en: { common: "english_5k", valid: "english_25k" },
  fa: { common: "persian_5k", valid: "persian_20k" },
};

const LANG_LABELS: Record<"fa" | "en", string> = {
  fa: "فارسی",
  en: "english",
};

const KEY_ROWS: Record<"fa" | "en", string[][]> = {
  en: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["Enter", "z", "x", "c", "v", "b", "n", "m", "Backspace"],
  ],
  fa: [
    ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج", "چ"],
    ["ش", "س", "ی", "ب", "ل", "ا", "ت", "ن", "م", "ک", "گ"],
    ["Enter", "ظ", "ط", "ز", "ر", "ذ", "د", "پ", "و", "Backspace"],
  ],
};

type PageLang = "fa" | "en";
type PagePhase = "loading" | "puzzle";

/** the online verdict once both solvers have reported */
type WordleOnlineResult = {
  verdict: WordleVerdict;
  myGuesses: number;
  myWon: boolean;
  theirGuesses: number;
  theirSolved: boolean;
};

/** the local calendar day key in the wordle store's HUMAN convention
 * (1-indexed months — must match the store's yesterdayKey arithmetic) */
function puzzleNumber(ts: number): number {
  const d = new Date(ts);
  const todayUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((todayUtc - PUZZLE_EPOCH) / (24 * 60 * 60 * 1000)) + 1;
}

/** the reveal colors: theme green, an inline gold for yellow (the theme
 * file stays untouched), muted sub for gray */
function cellLook(state: LetterState | undefined): {
  class: string;
  style: Record<string, string>;
} {
  if (state === "green") {
    return { class: "bg-main text-bg border-main", style: {} };
  }
  if (state === "yellow") {
    return {
      class: "text-bg border-main",
      style: { background: YELLOW },
    };
  }
  if (state === "gray") {
    return { class: "bg-sub text-sub border-sub", style: {} };
  }
  return { class: "border-sub text-text", style: {} };
}

/**
 * Wordle (idea G4): one daily 5-letter puzzle per language. The pure engine
 * (utils/wordle) owns the pools, the pick, the grade and the share grid;
 * this page owns the fetches, the keyboard and the reveal styling.
 */
export function WordlePage(): JSXElement {
  const [lang, setLang] = createSignal<PageLang>("en");
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("loading");
  const [pools, setPools] = createSignal<WordlePools | undefined>(undefined);
  const [puzzleState, setPuzzleState] = createSignal<
    ReturnType<typeof loadWordleState> | undefined
  >(undefined);
  const [buffer, setBuffer] = createSignal("");
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  const [copied, setCopied] = createSignal(false);
  //online (LAN) state — the peer solves the same seeded answer
  const [remoteState, setRemoteState] = createSignal<
    WordleRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    WordleOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [onlineAnswer, setOnlineAnswer] = createSignal<string | undefined>(
    undefined,
  );
  const [onlineGuesses, setOnlineGuesses] = createSignal<string[]>([]);
  const [onlineOver, setOnlineOver] = createSignal<"won" | "lost" | null>(null);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let onlineStartTs = 0;
  const [myFinishSent, setMyFinishSent] = createSignal(false);
  let lastSentGuesses = -1;
  let lastSentSolved = -1;

  const todayKey = (): string => wordleDayKey(Date.now());

  const lanMode = (): boolean => getLanMatch()?.gameId === "wordle";

  //leaving mid-solve (header back, route change) locks the guesses and
  //tells the peer — they are never left waiting for my report
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "wordle") return;
    if (pagePhase() !== "puzzle") return;
    if (!myFinishSent()) {
      setMyFinishSent(true);
      sendLanMatchProgress(
        lanWordle.encodeProgress({
          guesses: onlineGuesses().length,
          solved: false,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const loadPools = async (value: PageLang): Promise<void> => {
    try {
      const files = WORDLE_LANG_FILES[value];
      const [common, valid] = await Promise.all([
        cachedFetchJson<{ words: string[] }>(`/languages/${files.common}.json`),
        cachedFetchJson<{ words: string[] }>(`/languages/${files.valid}.json`),
      ]);
      setPools(computeWordlePools(common.words, valid.words));
    } catch {
      //offline: a small self-contained pool keeps the game playable
      setPools(computeWordlePools(FALLBACK_WORDS, FALLBACK_WORDS));
    }
  };

  const loadLang = async (value: PageLang): Promise<void> => {
    setPagePhase("loading");
    setMessage(undefined);
    setBuffer("");
    await loadPools(value);
    setPuzzleState(loadWordleState(value, todayKey()));
    setBuffer("");
    setPagePhase("puzzle");
  };

  onMount(() => {
    void loadLang("en");
  });

  const selectLang = (value: PageLang): void => {
    if (value === lang()) return;
    setLang(value);
    void loadLang(value);
  };

  const answer = (): string | undefined => {
    if (lanMode()) return onlineAnswer();
    const currentPools = pools();
    if (currentPools === undefined) return undefined;
    return pickAnswer(currentPools.answers, todayKey(), lang());
  };

  const validSet = (): Set<string> => new Set(pools()?.validGuesses ?? []);

  const gradedRows = (): {
    cells: { letter: string; state: LetterState }[];
  }[] => {
    const solved = answer();
    const guesses = puzzleState()?.guesses ?? [];
    return guesses.map((guess) => ({
      cells:
        solved === undefined
          ? [...normalizeGuess(guess)].map((letter) => ({
              letter,
              state: "gray" as LetterState,
            }))
          : gradeGuess(solved, normalizeGuess(guess)),
    }));
  };

  const letterState = (letter: string): LetterState | undefined => {
    let best: LetterState | undefined;
    for (const row of gradedRows()) {
      for (const cell of row.cells) {
        if (cell.letter.toLowerCase() !== letter.toLowerCase()) continue;
        if (cell.state === "green") return "green";
        if (cell.state === "yellow" && best !== "green") best = "yellow";
        best ??= "gray";
      }
    }
    return best;
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    setOnlineResult({
      verdict: resolveWordleVerdict(
        {
          guesses: onlineGuesses().length,
          elapsedMs: Date.now() - onlineStartTs,
        },
        {
          guesses: remoteState()?.guesses ?? 0,
          elapsedMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
        },
      ),
      myGuesses: onlineGuesses().length,
      myWon: onlineOver() === "won",
      theirGuesses: remoteState()?.guesses ?? 0,
      theirSolved: remoteState()?.solved ?? false,
    });
  };

  const myFinishNow = (): void => {
    if (myFinishSent()) return;
    setMyFinishSent(true);
    sendLanMatchProgress(
      lanWordle.encodeProgress({
        guesses: onlineGuesses().length,
        solved: onlineOver() === "won",
      }),
    );
    sendLanMatchFinished(Date.now() - onlineStartTs, 100);
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    }
  };

  const submitGuess = (): void => {
    if (lanMode()) {
      submitOnlineGuess();
      return;
    }
    const currentPools = pools();
    const solved = answer();
    const currentState = puzzleState();
    if (
      currentPools === undefined ||
      solved === undefined ||
      currentState === undefined
    ) {
      return;
    }
    if (currentState.finished !== null) return;
    const normalized = normalizeGuess(buffer());
    if (normalized.length !== WORDLE_LENGTH) {
      setMessage(`needs ${WORDLE_LENGTH} letters`);
      return;
    }
    if (!isValidGuess(normalized, validSet())) {
      setMessage("not in word list");
      return;
    }
    setMessage(undefined);
    const guesses = [...currentState.guesses, normalized];
    const won = normalized === solved;
    const lost = !won && guesses.length >= MAX_GUESSES;
    const nextState = {
      ...currentState,
      guesses,
      finished: won ? ("won" as const) : lost ? ("lost" as const) : null,
    };
    saveWordleState(lang(), nextState);
    if (nextState.finished !== null) {
      //KI-29: record BEFORE revealing the result — a raw window keydown
      //renders synchronously (no Solid batching), so the result section
      //would otherwise read the stats store before the record and show
      //stale zeros with no reactive dependency to refresh it
      recordWordleGame({
        lang: lang(),
        dayKey: todayKey(),
        won,
        guessCount: guesses.length,
      });
    }
    setPuzzleState(nextState);
    setBuffer("");
  };

  /** the online submit: session-only guesses — the daily state untouched */
  const submitOnlineGuess = (): void => {
    const solved = onlineAnswer();
    if (onlineOver() !== null || solved === undefined) return;
    const normalized = normalizeGuess(buffer());
    if (normalized.length !== WORDLE_LENGTH) {
      setMessage(`needs ${WORDLE_LENGTH} letters`);
      return;
    }
    if (!isValidGuess(normalized, validSet())) {
      setMessage("not in word list");
      return;
    }
    setMessage(undefined);
    const guesses = [...onlineGuesses(), normalized];
    const won = normalized === solved;
    const lost = !won && guesses.length >= MAX_GUESSES;
    setOnlineGuesses(guesses);
    setBuffer("");
    //online: relay the guess count / solve flag when they moved
    const count = guesses.length;
    if (count !== lastSentGuesses || (won ? 1 : 0) !== lastSentSolved) {
      lastSentGuesses = count;
      lastSentSolved = won ? 1 : 0;
      sendLanMatchProgress(
        lanWordle.encodeProgress({ guesses: count, solved: won }),
      );
    }
    if (won || lost) {
      setOnlineOver(won ? "won" : "lost");
      myFinishNow();
    }
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "puzzle") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitGuess();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      setBuffer((buffer) => buffer.slice(0, -1));
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      const ch = normalizeGuess(event.key);
      if (ch.length === 1 && buffer().length < WORDLE_LENGTH) {
        setBuffer((buffer) => buffer + ch);
      }
    }
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

  //an armed (or re-armed) wordle match IS the online start: the seed
  //picks the answer from the identical pools, the session guesses reset
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "wordle") return;
    void (async () => {
      //one seeded rng drives BOTH the random language pick and the answer
      //pick — the same call order on both machines lands on identical state
      const seeded = createSeededRng(match.start.seed ?? 1);
      const mode = match.start.params["mode"];
      const matchLang: PageLang =
        mode === "fa"
          ? "fa"
          : mode === "random"
            ? seeded() < 0.5
              ? "fa"
              : "en"
            : "en";
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setOnlineOver(null);
      setOnlineAnswer(undefined);
      setOnlineGuesses([]);
      setMyFinishSent(false);
      lastSentGuesses = -1;
      lastSentSolved = -1;
      setMessage(undefined);
      setBuffer("");
      setLang(matchLang); //the match locks the language
      setPagePhase("loading");
      await loadPools(matchLang);
      const currentPools = pools();
      if (currentPools === undefined || currentPools.answers.length === 0) {
        setMessage("the puzzle pools failed to load");
        return;
      }
      //the seeded pick: both machines land on the identical answer
      const answer =
        currentPools.answers[
          Math.floor(seeded() * currentPools.answers.length) %
            currentPools.answers.length
        ] ?? currentPools.answers[0];
      setOnlineAnswer(answer);
      onlineStartTs = Date.now();
      setPagePhase("puzzle");
    })();
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as WordleRemoteState);
  });

  //the peer's finish resolves the held verdict (or arrived before mine)
  createEffect(() => {
    if (!myFinishSent()) return;
    if (getRemoteFinished() === undefined) return;
    resolveOnlineResult();
  });

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "wordle") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the solve voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "wordle") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "puzzle") return;
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
  });

  const share = async (): Promise<void> => {
    const rows = gradedRows().map((row) => row.cells);
    const grid = buildShareGrid(
      rows,
      `wordle-like #${puzzleNumber(Date.now())} ${lang()} ${
        puzzleState()?.guesses.length ?? 0
      }/${MAX_GUESSES}`,
    );
    try {
      await navigator.clipboard.writeText(grid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("the clipboard is unavailable");
    }
  };

  const keyLook = (
    letter: string,
  ): { class: string; style: Record<string, string> } =>
    cellLook(letterState(letter));

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-font" }} text="wordle" />
        <p class="text-sub">
          one daily 5-letter puzzle per language: six guesses, the colors tell
          you how close you are. The streak is per language.
        </p>
      </section>

      <Show when={voidMessage() !== undefined}>
        <div class="text-error">{voidMessage()}</div>
      </Show>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="wd-online-vs"
        >
          <i class="fas fa-font"></i> online vs {getLanMatch()?.peerName ?? "…"}{" "}
          — same answer, fewer guesses wins
        </div>
      </Show>
      <section class="grid gap-2">
        <div class="grid grid-cols-2 gap-2">
          <For each={["fa", "en"] as PageLang[]}>
            {(value) => (
              <Button
                text={LANG_LABELS[value]}
                class={cn("w-full", lang() === value && "bg-main text-bg")}
                disabled={lanMode()}
                onClick={() => selectLang(value)}
              />
            )}
          </For>
        </div>
      </section>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="wd-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.guesses ?? 0} guesses ·{" "}
              {remoteState()?.solved ? "solved" : "solving"}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {onlineGuesses().length} guesses ·{" "}
              {onlineOver() === "won"
                ? "solved"
                : onlineOver() === "lost"
                  ? "failed"
                  : "solving"}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
        </div>
      </Show>

      <Show
        when={pagePhase() === "puzzle"}
        fallback={
          <div class="grid place-items-center rounded bg-sub-alt py-16 text-sub">
            loading the puzzle…
          </div>
        }
      >
        <Show
          when={lanMode() && myFinishSent() && onlineResult() === undefined}
        >
          <div
            class="grid place-items-center rounded bg-sub-alt py-8 text-center"
            data-testid="wd-awaiting"
          >
            <div class="text-2xl font-bold text-main">
              {`your guesses are locked (${onlineGuesses().length}) — waiting
              for ${getLanMatch()?.peerName ?? "the opponent"}'s horn…`}
            </div>
          </div>
        </Show>
        <Show when={onlineResult() !== undefined}>
          <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
            <div
              class={cn(
                "text-3xl font-bold",
                onlineResult()?.verdict === "won"
                  ? "text-main"
                  : onlineResult()?.verdict === "draw"
                    ? "text-sub"
                    : "text-error",
              )}
              data-testid="wd-verdict"
            >
              {onlineResult()?.verdict === "won"
                ? "you win!"
                : onlineResult()?.verdict === "draw"
                  ? "draw"
                  : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded bg-bg p-3">
                <div class="text-xl font-bold text-main tabular-nums">
                  {onlineResult()?.myGuesses ?? 0} guesses ·{" "}
                  {onlineResult()?.myWon ? "solved" : "failed"}
                </div>
                <div class="text-xs text-sub">you</div>
              </div>
              <div class="rounded bg-bg p-3">
                <div class="text-xl font-bold text-main tabular-nums">
                  {onlineResult()?.theirGuesses ?? 0} guesses ·{" "}
                  {onlineResult()?.theirSolved ? "solved" : "failed"}
                </div>
                <div class="text-xs text-sub">
                  {getLanMatch()?.peerName ?? "the opponent"}
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Button
                text={
                  rematchSent() ? "rematch requested — waiting…" : "rematch"
                }
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
        </Show>
        <section class="grid gap-1" aria-label="wordle grid">
          <For each={[0, 1, 2, 3, 4, 5]}>
            {(rowIndex) => (
              <div
                class="flex justify-center gap-1"
                dir={lang() === "fa" ? "rtl" : "ltr"}
              >
                <For each={[0, 1, 2, 3, 4]}>
                  {(cellIndex) => {
                    const submittedRow = gradedRows()[rowIndex];
                    const cell = submittedRow?.cells[cellIndex];
                    const isCurrent =
                      rowIndex === (puzzleState()?.guesses.length ?? 0) &&
                      puzzleState()?.finished === null;
                    const letter =
                      cell?.letter ??
                      (isCurrent ? (buffer()[cellIndex] ?? "") : "");
                    const look = cellLook(cell?.state);
                    return (
                      <div
                        class={cn(
                          "grid h-11 w-11 place-items-center rounded border-2 text-xl font-bold uppercase transition-colors duration-300",
                          look.class,
                          isCurrent &&
                            cellIndex === buffer().length &&
                            "border-main",
                        )}
                        style={{
                          ...look.style,
                          "transition-delay":
                            cell !== undefined
                              ? `${cellIndex * 120}ms`
                              : undefined,
                        }}
                      >
                        {letter}
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </section>

        <Show when={message() !== undefined}>
          <div class="text-center text-sm text-error">{message()}</div>
        </Show>

        <section class="grid gap-1" aria-label="wordle keyboard">
          <For each={KEY_ROWS[lang()]}>
            {(row) => (
              <div class="flex justify-center gap-1">
                <For each={row}>
                  {(key) => (
                    <Show
                      when={key === "Enter" || key === "Backspace"}
                      fallback={
                        <button
                          type="button"
                          class={cn(
                            "h-10 w-9 rounded text-sm font-bold",
                            keyLook(key).class,
                            lang() === "fa" && "text-base",
                          )}
                          style={keyLook(key).style}
                          onClick={() => {
                            if (buffer().length < WORDLE_LENGTH) {
                              setBuffer((buffer) => buffer + key);
                            }
                          }}
                        >
                          {key}
                        </button>
                      }
                    >
                      <Button
                        text={key === "Enter" ? "enter" : "⌫"}
                        class="h-10 min-w-14 px-2 text-xs"
                        onClick={() => {
                          if (key === "Enter") submitGuess();
                          else setBuffer((buffer) => buffer.slice(0, -1));
                        }}
                      />
                    </Show>
                  )}
                </For>
              </div>
            )}
          </For>
        </section>

        <Show
          when={
            puzzleState()?.finished !== null &&
            puzzleState()?.finished !== undefined
          }
        >
          <section class="grid gap-3 rounded bg-sub-alt p-6 text-center">
            <div
              class={cn(
                "text-3xl font-bold",
                puzzleState()?.finished === "won" ? "text-main" : "text-error",
              )}
            >
              {puzzleState()?.finished === "won"
                ? "solved!"
                : `the word was: ${answer() ?? "—"}`}
            </div>
            <div class="text-sm text-sub">
              played {getWordleStats(lang()).played} · won{" "}
              {getWordleStats(lang()).won} · streak{" "}
              {getWordleStats(lang()).streak} (max{" "}
              {getWordleStats(lang()).maxStreak})
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Button
                text={copied() ? "copied!" : "share result"}
                fa={{ icon: "fa-share-alt" }}
                class="w-full"
                onClick={() => void share()}
              />
              <Button
                text="switch language"
                fa={{ icon: "fa-language" }}
                class="w-full"
                onClick={() => selectLang(lang() === "en" ? "fa" : "en")}
              />
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}
