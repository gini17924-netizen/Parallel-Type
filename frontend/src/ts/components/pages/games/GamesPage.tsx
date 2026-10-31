import {
  JSXElement,
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../config/store";
import { cachedFetchJson } from "../../../utils/json-data";
import {
  DIFFICULTY_LABELS,
  type Difficulty,
  buildWordPools,
  isDifficulty,
  pickTarget,
  spawnIntervalMs,
  spawnSpeed,
  type WordPools,
} from "../../../utils/word-blast";
import { Button } from "../../common/Button";
import { H2 } from "../../common/Headers";

type FallingWord = {
  id: number;
  text: string;
  typed: number;
  top: number;
  left: number;
  speed: number;
};

const GAME_HEIGHT_VH = 70;
const TICK_MS = 50;
const DIFFICULTY_KEY = "mtDesktopWordBlastDifficulty";

function loadDifficulty(): Difficulty {
  const stored = window.localStorage.getItem(DIFFICULTY_KEY);
  return isDifficulty(stored) ? stored : "normal";
}

export function GamesPage(): JSXElement {
  const [difficulty, setDifficulty] =
    createSignal<Difficulty>(loadDifficulty());
  const [words, setWords] = createSignal<FallingWord[]>([]);
  const [score, setScore] = createSignal(0);
  const [lives, setLives] = createSignal(3);
  const [level, setLevel] = createSignal(1);
  const [running, setRunning] = createSignal(false);
  const [over, setOver] = createSignal(false);
  const [wpm, setWpm] = createSignal(0);

  let pools: WordPools = { wordPool: [], phrasePool: [] };
  let nextId = 1;
  let typedTotal = 0;
  let startedAt = 0;
  let gameTimer: ReturnType<typeof setInterval> | undefined;
  let spawnTimer: ReturnType<typeof setInterval> | undefined;

  const selectDifficulty = (value: Difficulty): void => {
    setDifficulty(value);
    window.localStorage.setItem(DIFFICULTY_KEY, value);
  };

  const stopTimers = (): void => {
    if (gameTimer !== undefined) clearInterval(gameTimer);
    if (spawnTimer !== undefined) clearInterval(spawnTimer);
    gameTimer = undefined;
    spawnTimer = undefined;
  };

  onCleanup(stopTimers);

  const spawn = (): void => {
    const text = pickTarget(pools, difficulty());
    if (text === undefined || text === "") return;
    setWords((current) => [
      ...current,
      {
        id: nextId++,
        text,
        typed: 0,
        top: 0,
        left: 5 + Math.random() * 80,
        speed: spawnSpeed(level(), difficulty()),
      },
    ]);
  };

  const end = (): void => {
    setRunning(false);
    setOver(true);
    stopTimers();
  };

  const tick = (): void => {
    const hitBottom: number[] = [];
    setWords((current) => {
      const next: FallingWord[] = [];
      for (const word of current) {
        const top = word.top + word.speed;
        if (top >= GAME_HEIGHT_VH - 6) {
          hitBottom.push(word.id);
          continue;
        }
        next.push({ ...word, top });
      }
      return next;
    });
    if (hitBottom.length > 0) {
      setWords((current) =>
        current.filter((word) => !hitBottom.includes(word.id)),
      );
      setLives((lives) => {
        const left = lives - hitBottom.length;
        if (left <= 0) end();
        return Math.max(0, left);
      });
    }
  };

  const restartTimers = (): void => {
    stopTimers();
    gameTimer = setInterval(tick, TICK_MS);
    spawnTimer = setInterval(spawn, spawnIntervalMs(level(), difficulty()));
  };

  const start = async (): Promise<void> => {
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      pools = buildWordPools(data.words, difficulty());
    } catch {
      pools = { wordPool: [], phrasePool: [] };
    }
    if (pools.wordPool.length === 0) {
      pools = buildWordPools(
        ["parallel", "typing", "speed", "focus", "rhythm", "words"],
        difficulty(),
      );
    }

    setWords([]);
    setScore(0);
    setLives(3);
    setLevel(1);
    setOver(false);
    setRunning(true);
    typedTotal = 0;
    startedAt = Date.now();

    spawn();
    restartTimers();
    //the start button keeps focus after the click — a space press would
    //re-click it and restart the game from scratch
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (!running()) return;
    //modifier combos stay with the browser/app (copy, commandline, ...)
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    //while the game runs, single-character keys — including space — belong to
    //the game: swallow them so a focused button can never be re-clicked
    if (event.key.length === 1) event.preventDefault();
    else return;
    const ch = event.key.toLowerCase();

    //the actively typed word is the one the user has already started
    let target = words().find((word) => word.typed > 0);
    target ??= [...words()].sort((a, b) => b.top - a.top)[0];
    if (target === undefined) return;

    const expected = target.text[target.typed]?.toLowerCase();
    if (expected !== ch) return; //wrong key: ignore

    typedTotal++;
    const elapsedMin = Math.max((Date.now() - startedAt) / 60000, 1 / 60);
    setWpm(Math.round(typedTotal / 5 / elapsedMin));

    const typed = target.typed + 1;
    const targetId = target.id;
    const targetPoints = target.text.length * 10;
    if (typed >= target.text.length) {
      setWords((current) => current.filter((word) => word.id !== targetId));
      setScore((score) => score + targetPoints);
      if (score() > 0 && (score() / 500) % 1 === 0 && score() % 500 === 0) {
        setLevel((level) => level + 1);
        restartTimers();
      }
    } else {
      setWords((current) =>
        current.map((word) =>
          word.id === targetId ? { ...word, typed } : word,
        ),
      );
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-gamepad" }} text="word blast" />
        <p class="text-sub">
          ZType-style offline game: words fall from the top — type them before
          they reach the bottom. Higher difficulties bring longer words,
          multi-word phrases and faster falls.
        </p>
      </section>

      <section class="grid gap-2">
        <div class="text-sub">difficulty</div>
        <div class="grid grid-cols-3 gap-2">
          <For each={["easy", "normal", "hard"] as Difficulty[]}>
            {(value) => (
              <Button
                text={DIFFICULTY_LABELS[value]}
                class={`w-full ${difficulty() === value ? "bg-main text-bg" : ""}`}
                onClick={() => {
                  selectDifficulty(value);
                }}
              />
            )}
          </For>
        </div>
      </section>

      <div class="grid grid-cols-3 gap-4">
        <Button
          text="start game"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void start()}
        />
        <div class="text-center">
          <div class="text-sub">score</div>
          <div class="text-3xl text-main">{score()}</div>
        </div>
        <div class="text-center">
          <div class="text-sub">wpm / lives</div>
          <div class="text-3xl">
            {wpm()} <span class="text-sub">|</span> {"❤".repeat(lives())}
          </div>
        </div>
      </div>

      <div
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: `${GAME_HEIGHT_VH}vh` }}
      >
        <Show
          when={running() || over()}
          fallback={
            <div class="grid h-full place-items-center text-sub">
              press start, then type the falling words
            </div>
          }
        >
          <For each={words()}>
            {(word) => (
              <div
                class="absolute font-mono text-2xl tracking-widest"
                dir="auto"
                style={{
                  top: `${word.top}vh`,
                  left: `${word.left}%`,
                }}
              >
                <span class="text-main">{word.text.slice(0, word.typed)}</span>
                <span class="text-text">{word.text.slice(word.typed)}</span>
              </div>
            )}
          </For>
        </Show>
        <Show when={over()}>
          <div class="bg-black/70 absolute inset-0 grid place-items-center">
            <div class="text-center">
              <div class="text-4xl text-error">game over</div>
              <div class="pt-4 text-2xl">score: {score()}</div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
