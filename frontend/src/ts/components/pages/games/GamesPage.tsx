import {
  JSXElement,
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../config/store";
import { playClick, playError } from "../../../controllers/sound-controller";
import { cn } from "../../../utils/cn";
import { cachedFetchJson } from "../../../utils/json-data";
import {
  BALANCE,
  DIFFICULTY_LABELS,
  type Difficulty,
  buildWordPools,
  comboMult,
  isDifficulty,
  levelForScore,
  pickBossWord,
  pickTarget,
  shouldSpawnHeart,
  spawnIntervalMs,
  spawnSpeed,
  type WordPools,
} from "../../../utils/word-blast";
import {
  getWordBlastBest,
  recordWordBlastGame,
} from "../../../utils/word-blast-scores";
import { Button } from "../../common/Button";
import { H2 } from "../../common/Headers";

type FallingWord = {
  id: number;
  text: string;
  typed: number;
  top: number;
  left: number;
  speed: number;
  /** v2 (idea G1): the guaranteed level-up word — flat ×5 score, slower fall */
  isBoss?: boolean;
  /** v2: a short glowing word — completing it grants a life */
  isHeart?: boolean;
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
  const [combo, setCombo] = createSignal(0);
  const [maxCombo, setMaxCombo] = createSignal(0);
  const [correctKeys, setCorrectKeys] = createSignal(0);
  const [wrongKeys, setWrongKeys] = createSignal(0);
  const [bestScore, setBestScore] = createSignal<number | undefined>(
    getWordBlastBest(loadDifficulty())?.score,
  );
  const [recordInfo, setRecordInfo] = createSignal<
    | {
        isNewRecord: boolean;
        best: number | undefined;
      }
    | undefined
  >(undefined);

  /** live accuracy percent (0 while nothing was typed) */
  const accuracy = (): number => {
    const attempts = correctKeys() + wrongKeys();
    return attempts === 0 ? 0 : Math.round((correctKeys() / attempts) * 100);
  };

  /** the doc's HUD v2 "heart word in the queue": while a glowing heart word
   * is on the field, name it here (the spawn is probabilistic per the doc's
   * own BALANCE — heartEveryNSpawns/heartChance — so there is no future
   * heart word to preview, only the live one) */
  const heartWord = (): string | undefined =>
    words().find((word) => word.isHeart === true)?.text;

  let pools: WordPools = { wordPool: [], phrasePool: [] };
  let nextId = 1;
  let typedTotal = 0;
  let startedAt = 0;
  let spawnCount = 0;
  let gameTimer: ReturnType<typeof setInterval> | undefined;
  let spawnTimer: ReturnType<typeof setInterval> | undefined;

  const selectDifficulty = (value: Difficulty): void => {
    setDifficulty(value);
    window.localStorage.setItem(DIFFICULTY_KEY, value);
    setRecordInfo(undefined);
    setBestScore(getWordBlastBest(value)?.score);
  };

  const stopTimers = (): void => {
    if (gameTimer !== undefined) clearInterval(gameTimer);
    if (spawnTimer !== undefined) clearInterval(spawnTimer);
    gameTimer = undefined;
    spawnTimer = undefined;
  };

  onCleanup(stopTimers);

  const spawn = (): void => {
    spawnCount++;
    //v2 (idea G1): on the heart windows a short glowing word may spawn —
    //completing it grants a life
    let text: string | undefined;
    let isHeart = false;
    if (shouldSpawnHeart(spawnCount, Math.random)) {
      const short = pools.wordPool.filter((word) => word.length <= 5);
      const picked = short[Math.floor(Math.random() * short.length)];
      if (picked !== undefined) {
        text = picked;
        isHeart = true;
      }
    }
    text ??= pickTarget(pools, difficulty());
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
        isHeart,
      },
    ]);
  };

  const end = (): void => {
    setRunning(false);
    setOver(true);
    stopTimers();
    //scores are best-effort: the game itself must never fail on storage
    try {
      const result = recordWordBlastGame({
        difficulty: difficulty(),
        score: score(),
        wpm: wpm(),
        maxCombo: maxCombo(),
        accuracy: accuracy(),
      });
      setRecordInfo({
        isNewRecord: result.isNewRecord,
        best: result.best?.score,
      });
      setBestScore(result.best?.score);
    } catch {
      setRecordInfo(undefined);
    }
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
      //v2: any word reaching the bottom breaks the combo — one rule for
      //every word type, boss and heart included
      setCombo(0);
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
    setCombo(0);
    setMaxCombo(0);
    setCorrectKeys(0);
    setWrongKeys(0);
    spawnCount = 0;
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
    if (expected !== ch) {
      //v2 (idea G1): a wrong key on the current word costs the whole combo
      //(keymania: accuracy costs more than speed) — one rule for every word
      //type, boss and heart included
      setWrongKeys((wrong) => wrong + 1);
      if (combo() !== 0) {
        setCombo(0);
        void playError();
      }
      return;
    }

    setCorrectKeys((correct) => correct + 1);
    typedTotal++;
    const elapsedMin = Math.max((Date.now() - startedAt) / 60000, 1 / 60);
    setWpm(Math.round(typedTotal / 5 / elapsedMin));

    const typed = target.typed + 1;
    const targetId = target.id;
    if (typed >= target.text.length) {
      //v2: the streak grows on a completed word, then scores with its
      //multiplier (post-update streak — the deck-runner engine's
      //convention). The boss word scores a flat ×5 instead.
      const nextCombo = combo() + 1;
      const mult =
        target.isBoss === true ? BALANCE.bossScoreMult : comboMult(nextCombo);
      const points = target.text.length * 10 * mult;
      const nextScore = score() + points;
      const nextLevel = levelForScore(nextScore);
      const levelUp = nextLevel > level();
      //a level-up guarantees exactly one boss word (idea G1)
      const bossText = levelUp ? pickBossWord(pools) : undefined;

      setWords((current) => {
        const kept = current.filter((word) => word.id !== targetId);
        if (bossText !== undefined) {
          kept.push({
            id: nextId++,
            text: bossText,
            typed: 0,
            top: 0,
            left: 5 + Math.random() * 80,
            speed: spawnSpeed(nextLevel, difficulty()) * BALANCE.bossSpeedMult,
            isBoss: true,
          });
        }
        return kept;
      });
      setScore(nextScore);
      setCombo(nextCombo);
      setMaxCombo((max) => Math.max(max, nextCombo));
      if (target.isHeart === true) {
        //a completed heart word grants a life, capped at maxLives
        void playClick();
        setLives((lives) => Math.min(BALANCE.maxLives, lives + 1));
      }
      if (levelUp) {
        setLevel(nextLevel);
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
        <div class="flex items-baseline justify-between">
          <div class="text-sub">difficulty</div>
          <div class="text-sub">
            best ({DIFFICULTY_LABELS[difficulty()]}): {bestScore() ?? "—"}
          </div>
        </div>
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

      <Button
        text="start game"
        fa={{ icon: "fa-play" }}
        class="w-full"
        onClick={() => void start()}
      />

      <div class="grid grid-cols-5 gap-2" aria-label="word blast hud">
        <HudCell label="score" value={String(score())} testId="wb-score" />
        <HudCell label="wpm" value={String(wpm())} />
        <HudCell label="accuracy" value={`${accuracy()}%`} testId="wb-acc" />
        <div class="rounded bg-bg p-2 text-center">
          <div
            class="text-xl font-bold text-main tabular-nums"
            data-testid="wb-combo"
          >
            x{combo()}
          </div>
          <div class="flex justify-center gap-1">
            <For each={BALANCE.comboTiers.slice(1)}>
              {(tier) => (
                <span
                  class={cn(
                    "text-[0.65rem]",
                    combo() >= tier.n ? "text-main" : "text-sub",
                  )}
                >
                  ×{tier.m}
                </span>
              )}
            </For>
          </div>
        </div>
        <HudCell
          label="lives"
          value={"❤".repeat(lives()) || "—"}
          testId="wb-lives"
        />
      </div>
      <Show when={heartWord() !== undefined}>
        <div class="text-center text-sm text-main" data-testid="wb-heart-next">
          ❤ heart word: {heartWord()}
        </div>
      </Show>

      <div
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        aria-label="word blast arena"
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
                class={cn(
                  "absolute font-mono text-2xl tracking-widest",
                  word.isBoss === true &&
                    "rounded border-2 border-main bg-sub-alt px-2",
                  word.isHeart === true &&
                    "animate-pulse rounded border border-main px-2 text-main",
                )}
                dir="auto"
                data-testid={word.isBoss === true ? "wb-boss" : undefined}
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
              <Show when={recordInfo()?.isNewRecord === true}>
                <div class="pt-1 text-main">new record!</div>
              </Show>
              <Show when={recordInfo()?.best !== undefined}>
                <div class="pt-1 text-sub">best: {recordInfo()?.best}</div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

function HudCell(props: {
  label: string;
  value: string;
  testId?: string;
}): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div
        class="text-xl font-bold text-main tabular-nums"
        data-testid={props.testId}
      >
        {props.value}
      </div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}
