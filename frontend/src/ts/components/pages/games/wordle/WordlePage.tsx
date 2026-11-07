import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { cn } from "../../../../utils/cn";
import { cachedFetchJson } from "../../../../utils/json-data";
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

  const todayKey = (): string => wordleDayKey(Date.now());

  const loadLang = async (value: PageLang): Promise<void> => {
    setPagePhase("loading");
    setMessage(undefined);
    setBuffer("");
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

  const submitGuess = (): void => {
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

      <section class="grid gap-2">
        <div class="grid grid-cols-2 gap-2">
          <For each={["fa", "en"] as PageLang[]}>
            {(value) => (
              <Button
                text={LANG_LABELS[value]}
                class={cn("w-full", lang() === value && "bg-main text-bg")}
                onClick={() => selectLang(value)}
              />
            )}
          </For>
        </div>
      </section>

      <Show
        when={pagePhase() === "puzzle"}
        fallback={
          <div class="grid place-items-center rounded bg-sub-alt py-16 text-sub">
            loading the puzzle…
          </div>
        }
      >
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
