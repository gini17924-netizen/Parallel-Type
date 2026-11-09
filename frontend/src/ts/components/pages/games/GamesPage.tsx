import {
  JSXElement,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../config/store";
import { playClick, playError } from "../../../controllers/sound-controller";
import { navigate } from "../../../router/navigate";
import { isLanConnected, lanPreFillName } from "../../../states/lan";
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
} from "../../../states/lan-match";
import { cn } from "../../../utils/cn";
import { createSeededRng } from "../../../utils/daily-gauntlet/seeded-rng";
import { cachedFetchJson } from "../../../utils/json-data";
import {
  BALANCE,
  DIFFICULTY_LABELS,
  DIFFICULTY_SPEED,
  PHRASE_CHANCE,
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
import {
  completeDailyWordBlast,
  takePendingDailyStage,
} from "../../../utils/word-blast/daily";
import {
  lanWordBlast,
  resolveWordBlastVerdict,
  type WordBlastRemoteState,
  type WordBlastVerdict,
} from "../../../utils/word-blast/lan";
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

/** the online verdict once both horns have landed */
type BlastOnlineResult = {
  verdict: WordBlastVerdict;
  myScore: number;
  theirScore: number;
};

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
  //online (LAN) state — the peer's score race on the same seeded stream
  const [remoteState, setRemoteState] = createSignal<
    WordBlastRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    BlastOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let hornTimer: ReturnType<typeof setTimeout> | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentCombo = -1;

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

  //leaving mid-game (header back, route change) locks my score and tells
  //the peer — they are never left waiting for the horn
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "word-blast") return;
    if (!running()) return;
    if (!myFinishSent) {
      myFinishSent = true;
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "word-blast";

  //KI-40: in a daily stage this is the seeded LCG; outside it Math.random
  let runRng: () => number = Math.random;
  const rng = (): number => runRng();

  const spawn = (): void => {
    spawnCount++;
    //online: the seeded picks (both machines see the identical spawns)
    const seededPick = (): string | undefined => {
      if (
        pools.phrasePool.length > 0 &&
        pools.wordPool.length > 0 &&
        rng() < PHRASE_CHANCE[difficulty()]
      ) {
        return pools.phrasePool[Math.floor(rng() * pools.phrasePool.length)];
      }
      const pool =
        pools.wordPool.length > 0 ? pools.wordPool : pools.phrasePool;
      return pool[Math.floor(rng() * pool.length)];
    };
    const seededSpeed = (): number =>
      (0.06 + level() * 0.02 + rng() * 0.04) * DIFFICULTY_SPEED[difficulty()];
    //v2 (idea G1): on the heart windows a short glowing word may spawn —
    //completing it grants a life
    let text: string | undefined;
    let isHeart = false;
    if (shouldSpawnHeart(spawnCount, rng)) {
      const short = pools.wordPool.filter((word) => word.length <= 5);
      const picked = short[Math.floor(rng() * short.length)];
      if (picked !== undefined) {
        text = picked;
        isHeart = true;
      }
    }
    text ??= lanMode() ? seededPick() : pickTarget(pools, difficulty());
    if (text === undefined || text === "") return;
    setWords((current) => [
      ...current,
      {
        id: nextId++,
        text,
        typed: 0,
        top: 0,
        left: 5 + rng() * 80,
        speed: lanMode() ? seededSpeed() : spawnSpeed(level(), difficulty()),
        isHeart,
      },
    ]);
  };

  const end = (): void => {
    setRunning(false);
    setOver(true);
    stopTimers();
    if (lanMode()) {
      //dead before the horn — my score is locked; the horn verdict waits
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchProgress(
          lanWordBlast.encodeProgress({ score: score(), combo: combo() }),
        );
        sendLanMatchFinished(0, accuracy());
      }
      return;
    }
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
    //the daily gauntlet: a pending stage resolves here and returns to it
    if (completeDailyWordBlast({ score: score(), difficulty: difficulty() })) {
      void navigate({ to: "/games/daily-gauntlet" });
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
      setLives((current) => {
        const left = current - hitBottom.length;
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

  const myFinishNow = (): void => {
    if (myFinishSent) return;
    myFinishSent = true;
    sendLanMatchProgress(
      lanWordBlast.encodeProgress({ score: score(), combo: combo() }),
    );
    sendLanMatchFinished(0, accuracy());
    setRunning(false);
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    }
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    setOnlineResult({
      verdict: resolveWordBlastVerdict(
        { score: score() },
        { score: remoteState()?.score ?? 0 },
      ),
      myScore: score(),
      theirScore: remoteState()?.score ?? 0,
    });
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

  //an armed (or re-armed) blast match IS the online start: the seed
  //drives the spawns, the horn lands at durationMs on both machines
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "word-blast") return;
    void (async () => {
      const lang =
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english";
      const matchDifficulty = isDifficulty(match.start.params["difficulty"])
        ? match.start.params["difficulty"]
        : "normal";
      const durationMs =
        typeof match.start.params["durationMs"] === "number"
          ? match.start.params["durationMs"]
          : 90_000;
      let allWords: string[] = [
        "parallel",
        "typing",
        "speed",
        "focus",
        "rhythm",
        "words",
      ];
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${lang}.json`,
        );
        allWords = data.words;
      } catch {
        //offline fallback list
      }
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      myFinishSent = false;
      lastSentScore = -1;
      lastSentCombo = -1;
      //the seeded run: the same difficulty lock as the daily path
      selectDifficulty(matchDifficulty);
      runRng = createSeededRng(match.start.seed ?? 1);
      await startOnlineRun(allWords);
      //the horn fires durationMs after the run's own start
      hornTimer = setTimeout(() => {
        if (running()) myFinishNow();
      }, durationMs);
    })();
  });

  /** the online run: identical pools (the phrase pool is seeded too) */
  const startOnlineRun = async (allWords: string[]): Promise<void> => {
    const [min, max] = [3, 8];
    const wordPool = allWords.filter(
      (word) => word.length >= min && word.length <= max,
    );
    const shortWords = allWords.filter(
      (word) => word.length >= 3 && word.length <= 6,
    );
    const phrasePool: string[] = [];
    if (difficulty() !== "easy" && shortWords.length >= 2) {
      const phraseCount = difficulty() === "hard" ? 24 : 12;
      for (let i = 0; i < phraseCount; i++) {
        const parts: string[] = [];
        for (let p = 0; p < 2; p++) {
          parts.push(shortWords[Math.floor(rng() * shortWords.length)] ?? "");
        }
        const phrase = parts.join(" ").trim();
        if (phrase.includes(" ")) phrasePool.push(phrase);
      }
    }
    pools = { wordPool, phrasePool };
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
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const start = async (): Promise<void> => {
    //KI-40: a pending daily stage seeds the whole run and locks the
    //difficulty to the day's table
    const dailyStage = takePendingDailyStage("word-blast");
    if (dailyStage !== undefined) {
      runRng = createSeededRng(dailyStage.seed);
      selectDifficulty(
        (dailyStage.params as { difficulty?: Difficulty }).difficulty ??
          "normal",
      );
    } else {
      runRng = Math.random;
    }
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
    //online: relay the score/combo when they moved
    if (lanMode() && (score() !== lastSentScore || combo() !== lastSentCombo)) {
      lastSentScore = score();
      lastSentCombo = combo();
      sendLanMatchProgress(
        lanWordBlast.encodeProgress({ score: score(), combo: combo() }),
      );
    }

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
            left: 5 + rng() * 80,
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
        setLives((current) => Math.min(BALANCE.maxLives, current + 1));
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

  //the relayed peer progress lands decoded — the HUD reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as WordBlastRemoteState);
  });

  //the peer's finish resolves the held verdict (or arrived before mine)
  createEffect(() => {
    if (running() || !over()) {
      //still racing: their finish only parks — the horn resolves later
    }
    if (running()) return;
    if (getRemoteFinished() === undefined) return;
    resolveOnlineResult();
  });

  //the host answers a rematch request by re-sending the same start
  createEffect(() => {
    const match = getLanMatch();
    if (match?.role !== "host" || match.gameId !== "word-blast") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the game voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "word-blast") return;
    if (isLanConnected()) return;
    if (!running()) return;
    stopTimers();
    if (hornTimer !== undefined) clearTimeout(hornTimer);
    setRunning(false);
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
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

      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="wb-online-vs"
        >
          <i class="fas fa-gamepad"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same stream, 90s, the higher score
          wins
        </div>
      </Show>

      <Button
        text={lanMode() ? "the match starts from the lobby" : "start game"}
        fa={{ icon: "fa-play" }}
        class="w-full"
        disabled={lanMode()}
        onClick={() => void start()}
      />
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="wb-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.score ?? 0}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"} · x
              {remoteState()?.combo ?? 0} combo
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {score()}
            </div>
            <div class="text-xs text-sub">you · x{combo()} combo</div>
          </div>
        </div>
      </Show>
      <Show when={voidMessage() !== undefined}>
        <div class="text-error">{voidMessage()}</div>
      </Show>

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
        <Show
          when={
            lanMode() && !running() && !over() && onlineResult() === undefined
          }
        >
          <div
            class="bg-black/70 absolute inset-0 grid place-items-center"
            data-testid="wb-awaiting"
          >
            <div class="text-2xl font-bold text-main">
              your score is locked ({score()}) — waiting for{" "}
              {`${getLanMatch()?.peerName ?? "the opponent"}'s horn…`}
            </div>
          </div>
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
        <Show when={onlineResult() !== undefined}>
          <div class="bg-black/70 absolute inset-0 grid place-items-center">
            <div class="grid gap-2 text-center">
              <div
                class={cn(
                  "text-4xl font-bold",
                  onlineResult()?.verdict === "won"
                    ? "text-main"
                    : onlineResult()?.verdict === "draw"
                      ? "text-sub"
                      : "text-error",
                )}
                data-testid="wb-verdict"
              >
                {onlineResult()?.verdict === "won"
                  ? "you win!"
                  : onlineResult()?.verdict === "draw"
                    ? "draw"
                    : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
              </div>
              <div class="text-2xl text-main tabular-nums">
                {onlineResult()?.myScore ?? 0} vs{" "}
                {onlineResult()?.theirScore ?? 0}
              </div>
              <div class="grid grid-cols-2 gap-2 pt-2">
                <Button
                  text={
                    rematchSent() ? "rematch requested — waiting…" : "rematch"
                  }
                  fa={{ icon: "fa-redo" }}
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
                  onClick={() => {
                    clearLanMatch();
                    void navigate({ to: "/games/online" });
                  }}
                />
              </div>
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
