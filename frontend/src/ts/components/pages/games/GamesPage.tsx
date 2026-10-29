import { JSXElement, For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { H2 } from "../../common/Headers";
import { Button } from "../../common/Button";
import { Config } from "../../../config/store";
import { cachedFetchJson } from "../../../utils/json-data";

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

export function GamesPage(): JSXElement {
  const [words, setWords] = createSignal<FallingWord[]>([]);
  const [score, setScore] = createSignal(0);
  const [lives, setLives] = createSignal(3);
  const [level, setLevel] = createSignal(1);
  const [running, setRunning] = createSignal(false);
  const [over, setOver] = createSignal(false);
  const [wpm, setWpm] = createSignal(0);

  let wordPool: string[] = [];
  let nextId = 1;
  let typedTotal = 0;
  let startedAt = 0;
  let gameTimer: ReturnType<typeof setInterval> | undefined;
  let spawnTimer: ReturnType<typeof setInterval> | undefined;

  const stopTimers = (): void => {
    if (gameTimer !== undefined) clearInterval(gameTimer);
    if (spawnTimer !== undefined) clearInterval(spawnTimer);
    gameTimer = undefined;
    spawnTimer = undefined;
  };

  onCleanup(stopTimers);

  const spawn = (): void => {
    if (wordPool.length === 0) return;
    const text = wordPool[Math.floor(Math.random() * wordPool.length)];
    setWords((current) => [
      ...current,
      {
        id: nextId++,
        text,
        typed: 0,
        top: 0,
        left: 5 + Math.random() * 80,
        speed: 0.06 + level() * 0.02 + Math.random() * 0.04,
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
    spawnTimer = setInterval(spawn, Math.max(1200, 3500 - level() * 250));
  };

  const start = async (): Promise<void> => {
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      wordPool = data.words.filter(
        (word) => word.length >= 3 && word.length <= 9,
      );
    } catch {
      wordPool = [];
    }
    if (wordPool.length === 0) {
      wordPool = ["parallel", "typing", "speed", "focus", "rhythm", "words"];
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
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (!running() || event.key.length !== 1) return;
    const ch = event.key.toLowerCase();

    //the actively typed word is the one the user has already started
    let target = words().find((word) => word.typed > 0);
    if (target === undefined) {
      //nothing started: pick the lowest word
      target = [...words()].sort((a, b) => b.top - a.top)[0];
    }
    if (target === undefined) return;

    const expected = target.text[target.typed]?.toLowerCase();
    if (expected !== ch) return; //wrong key: ignore
    event.preventDefault();

    typedTotal++;
    const elapsedMin = Math.max((Date.now() - startedAt) / 60000, 1 / 60);
    setWpm(Math.round(typedTotal / 5 / elapsedMin));

    const typed = target.typed + 1;
    if (typed >= target.text.length) {
      setWords((current) => current.filter((word) => word.id !== target!.id));
      setScore((score) => score + target!.text.length * 10);
      if (score() > 0 && (score() / 500) % 1 === 0 && score() % 500 === 0) {
        setLevel((level) => level + 1);
        restartTimers();
      }
    } else {
      setWords((current) =>
        current.map((word) =>
          word.id === target!.id ? { ...word, typed } : word,
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
          they reach the bottom. Just start typing; the game picks up your
          keystrokes automatically.
        </p>
      </section>

      <div class="grid grid-cols-3 gap-4">
        <Button text="start game" fa={{ icon: "fa-play" }} class="w-full" onClick={() => void start()} />
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
          <div class="absolute inset-0 grid place-items-center bg-black/70">
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
