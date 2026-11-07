import { createSignal } from "solid-js";

import { playClick, playError } from "../controllers/sound-controller";
import * as DB from "../db";
import { createRng, deriveSeed } from "../utils/deck-runner/rng";
import {
  createWordSource,
  type WordSource,
  type WordSourceKind,
} from "../utils/deck-runner/words-source";
import {
  backspace,
  effectiveWordLengths,
  skipWord,
  startRound,
  typeChar,
  type BlindConfig,
  type RoundState,
} from "../utils/deck-runner/round-engine";
import {
  claimReward,
  currentBlindConfig,
  jokerRuntimeFor,
  endBlind,
  nextBlind,
  rerollShop as rerollShopEngine,
  buyJoker as buyJokerEngine,
  skipReward as skipRewardEngine,
  startRun,
  type DeckRunState,
} from "../utils/deck-runner/run-engine";
import { jokerRuntime, type JokerRuntime } from "../utils/deck-runner/cards";
import { buildCurrentWeakness } from "../utils/smart-drill";
import { fetchWordList } from "../utils/learn-stats";
import * as CustomText from "../test/custom-text";
import {
  clearActiveRun,
  getDeckRunnerStats,
  loadActiveRun,
  recordRunEnd,
  saveActiveRun,
  type DeckRunnerStats,
} from "../utils/deck-runner/run-store";
/** idea G24 §7: games do NOT grant XP by default (matches the no-XP status
 * of every game). Flip this fork constant when the council decides on G28. */
const DECK_RUNNER_XP_CREDIT = false;
/** flat XP per cleared blind when the credit is enabled */
const DECK_RUNNER_XP_PER_BLIND = 20;

/**
 * Solid state layer for Deck Runner (idea G24, phase 3): thin reactive
 * bindings over the PURE deck-runner engine. All game rules live in
 * utils/deck-runner/** - this module only holds signals, loads word pools
 * and mirrors the word stream for the upcoming-words display.
 */

const [run, setRun] = createSignal<DeckRunState | null>(null);
const [round, setRound] = createSignal<RoundState | null>(null);
const [queue, setQueue] = createSignal<string[]>([]);
const [loadingBlind, setLoadingBlind] = createSignal(false);
const [blindInfo, setBlindInfo] = createSignal<{
  quota: number;
  budget: number;
  isBoss: boolean;
  bossRule: BlindConfig["bossRule"];
} | null>(null);
const [stats, setStats] = createSignal<DeckRunnerStats | null>(
  getDeckRunnerStats(),
);
const [hasSave, setHasSave] = createSignal(loadActiveRun() !== null);

let source: WordSource | undefined;
let runtime: JokerRuntime = jokerRuntime([]);
let blindCfg: BlindConfig | undefined;
let weakness: ReturnType<typeof buildCurrentWeakness> | undefined;
/** mirror of the blind's word stream, pre-pulled with the same seed: index k
 * of the mirror is the word the engine serves after k completions */
let mirror: string[] = [];

export const deckRun = run;
export const deckRound = round;
export const deckQueue = queue;
export const deckLoading = loadingBlind;
export const deckBlindInfo = blindInfo;
export const deckStats = stats;
export const deckHasSave = hasSave;

type SourceSpec = {
  id: string;
  label: string;
  kind: WordSourceKind;
  base?: string;
};

/** the menu's word-source options (fixed languages + code + weakness + custom
 * texts); ids ending in _1k load the real 1k lists (phase 6: the old mapping
 * fetched the 200-word english/persian lists against a "1k" label) */
export function sourceOptions(): SourceSpec[] {
  const options: SourceSpec[] = [
    { id: "en-1k", label: "english 1k", kind: "zipf", base: "en-1k" },
    { id: "fa_1k", label: "persian 1k", kind: "zipf", base: "fa_1k" },
    {
      id: "code:python",
      label: "code — python",
      kind: "zipf",
      base: "code_python",
    },
    {
      id: "weakness:en-1k",
      label: "english — weak letters",
      kind: "weakness",
      base: "en-1k",
    },
    {
      id: "weakness:fa_1k",
      label: "فارسی — weak letters",
      kind: "weakness",
      base: "fa_1k",
    },
  ];
  for (const name of CustomText.getCustomTextNames(false)) {
    options.push({
      id: `custom:${name}`,
      label: `custom — ${name}`,
      kind: "custom",
    });
  }
  return options;
}

const poolCache = new Map<string, string[]>();

async function poolFor(wordSourceId: string): Promise<string[]> {
  const cached = poolCache.get(wordSourceId);
  if (cached !== undefined) return cached;
  let pool: string[] = [];
  if (wordSourceId.startsWith("custom:")) {
    const name = wordSourceId.slice("custom:".length);
    pool = CustomText.getCustomText(name, false);
  } else if (wordSourceId.startsWith("code:")) {
    pool = await fetchWordList("code_python");
  } else if (wordSourceId.startsWith("weakness:")) {
    pool = await fetchWordList(
      wordSourceId.endsWith("fa_1k") ? "persian_1k" : "english_1k",
    );
  } else if (wordSourceId === "fa_1k") {
    pool = await fetchWordList("persian_1k");
  } else {
    pool = await fetchWordList("english_1k");
  }
  poolCache.set(wordSourceId, pool);
  return pool;
}

function kindOf(wordSourceId: string): WordSourceKind {
  if (wordSourceId.startsWith("custom:")) return "custom";
  if (wordSourceId.startsWith("weakness:")) return "weakness";
  return "zipf";
}

/** starts a fresh blind: loads the pool, builds the source/runtime and the
 * mirror stream for the upcoming-words display */
export async function beginBlind(): Promise<void> {
  const runState = run();
  if (runState?.phase !== "blind") return;
  setLoadingBlind(true);
  try {
    weakness = buildCurrentWeakness();
    runtime = jokerRuntimeFor(runState, weakness);
    blindCfg = currentBlindConfig(runState, runtime);
    setBlindInfo({
      quota: blindCfg.quota,
      budget: blindCfg.wordBudget,
      isBoss: blindCfg.isBoss,
      bossRule: blindCfg.bossRule,
    });
    const pool = await poolFor(runState.wordSourceId);
    const lengths = effectiveWordLengths(blindCfg);
    const seed = deriveSeed(
      runState.seed,
      `blind:${runState.ante}:${runState.blindIndex}`,
    );
    const kind = kindOf(runState.wordSourceId);
    const cfg = {
      id: runState.wordSourceId,
      kind,
      pool,
      rng: createRng(seed),
      minLength: lengths.minLength,
      maxLength: lengths.maxLength,
      weakness: kind === "weakness" ? weakness : undefined,
    };
    source = createWordSource(cfg);
    //mirror stream (same seed/config) for the upcoming-words display; 2x the
    //budget so skip refunds never run the queue dry (phase 6)
    const mirrorSource = createWordSource(cfg);
    mirror = Array.from({ length: blindCfg.wordBudget * 2 }, () =>
      mirrorSource.nextWord(),
    );
    const roundState = startRound(blindCfg, source);
    setRun(runState);
    setRound(roundState);
    setQueue(mirror.slice(1, 4));
    saveActiveRun(runState);
  } finally {
    setLoadingBlind(false);
  }
}

/** menu -> new run (seed defaults to now; daily runs pass YYYYMMDD) */
export async function startNewRun(options: {
  wordSourceId: string;
  language: string;
  seed?: number;
}): Promise<void> {
  setRun(
    startRun({
      seed: options.seed ?? Date.now(),
      language: options.language,
      wordSourceId: options.wordSourceId,
    }),
  );
  await beginBlind();
}

/** menu -> continue the saved run (resumes between blinds; a live blind
 * restarts - v1 spec) */
export async function continueRun(): Promise<void> {
  const saved = loadActiveRun();
  if (saved === null) return;
  setRun(saved);
  if (saved.phase === "blind") {
    await beginBlind();
  } else {
    setRound(null);
  }
}

/** menu -> daily run (seed from the calendar date, fair local comparison) */
export function dailySeed(): number {
  const now = new Date();
  return Number(
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate(),
    ).padStart(2, "0")}`,
  );
}

function shiftQueue(): void {
  const completed = round()?.events.length ?? 0;
  setQueue(mirror.slice(completed + 1, completed + 4));
}

function finishBlindIfDone(): void {
  const roundState = round();
  const runState = run();
  if (roundState === null || !roundState.finished) return;
  if (runState === null) return;
  const wordsTyped = roundState.events.filter((e) => !e.skipped).length;
  const wordsSkipped = roundState.events.filter((e) => e.skipped).length;
  let next = endBlind(
    runState,
    { score: roundState.score, won: roundState.won, wordsTyped, wordsSkipped },
    runtime,
    {
      isBoss: blindCfg?.isBoss ?? false,
    },
  );
  setRun(next);
  if (next.phase === "gameover") {
    //run over: record the summary, clear the resumable run
    recordRunEnd({
      date: new Date().toISOString(),
      ante: next.ante,
      score: next.totalScore,
      won: next.ante > 1, //cleared at least one full ante
      jokers: next.jokers,
    });
    clearActiveRun();
    setStats(getDeckRunnerStats());
    setHasSave(false);
  } else {
    saveActiveRun(next);
    //idea G24 §7 XP hook: off by default (G28 council decision pending)
    if (DECK_RUNNER_XP_CREDIT && next.phase === "shop") {
      DB.addXp(DECK_RUNNER_XP_PER_BLIND);
    }
  }
}

/** one keystroke during a blind (single characters from the key handler) */
export function handleDeckKey(key: string): void {
  const roundState = round();
  if (roundState === null || roundState.finished) return;
  //a blind always has a live source/config/runtime (built in beginBlind)
  if (source === undefined || blindCfg === undefined) return;
  if (key === " ") {
    //space = skip the current word
    const next = skipWord(roundState, blindCfg, source, runtime);
    setRound(next);
    shiftQueue();
    finishBlindIfDone();
    return;
  }
  if (key === "Backspace") {
    setRound(backspace(roundState));
    return;
  }
  const beforeCombo = roundState.combo;
  const next = typeChar(roundState, blindCfg, source, key, runtime);
  setRound(next);
  if (next.buffer.length > roundState.buffer.length) {
    void playClick();
  } else if (
    next.combo < beforeCombo ||
    next.errorsThisWord > roundState.errorsThisWord
  ) {
    void playError();
  }
  if (next.finished) {
    finishBlindIfDone();
  } else {
    shiftQueue();
  }
}

/** reward phase: claim one of the 1-of-3 cards */
export function claimRewardCard(jokerId: string): void {
  const runState = run();
  if (runState === null) return;
  const next = claimReward(runState, jokerId);
  setRun(next);
  saveActiveRun(next);
}

/** shop: buy a joker offer */
export function buyShopCard(jokerId: string): void {
  const runState = run();
  if (runState === null) return;
  const next = buyJokerEngine(
    runState,
    jokerId,
    jokerRuntimeFor(runState, weakness),
  );
  setRun(next);
  saveActiveRun(next);
}

/** shop: reroll the offers (gold) */
export function rerollShopOffers(): void {
  const runState = run();
  if (runState === null) return;
  const next = rerollShopEngine(runState);
  setRun(next);
  saveActiveRun(next);
}

/** shop: skip the reward and go straight to the shop */
export function skipRewardCard(): void {
  const runState = run();
  if (runState === null) return;
  const next = skipRewardEngine(runState);
  setRun(next);
  saveActiveRun(next);
}

/** shop: start the next blind */
export async function proceedNextBlind(): Promise<void> {
  const runState = run();
  if (runState === null) return;
  setRun(nextBlind(runState));
  await beginBlind();
}

/** abandon the run back to the menu (run kept in stats, resumable state cleared) */
export function abandonRun(): void {
  clearActiveRun();
  setRun(null);
  setRound(null);
  setHasSave(false);
}

/** the runtime of the active run (for the UI's joker tooltips) */
export const currentRuntime = (): JokerRuntime => runtime;
