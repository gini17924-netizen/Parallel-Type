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
import {
  BALANCE,
  comboMult,
  type BalloonStage,
} from "../../../../utils/balloon-pop/balance";
import {
  createBalloonEngine,
  type BalloonEngine,
  type BalloonState,
} from "../../../../utils/balloon-pop/engine";
import {
  lanBalloon,
  resolveBalloonVerdict,
  type BalloonRemoteState,
  type BalloonVerdict,
} from "../../../../utils/balloon-pop/lan";
import { createSpawner } from "../../../../utils/balloon-pop/spawner";
import {
  getBalloonPopStats,
  recordBalloonRun,
} from "../../../../utils/balloon-pop/store";
import { cn } from "../../../../utils/cn";
import { createSeededRng } from "../../../../utils/daily-gauntlet/seeded-rng";
import { cachedFetchJson } from "../../../../utils/json-data";
import { unlockedLetters } from "../../../../utils/learn-stats";
import { buildCurrentWeakness } from "../../../../utils/smart-drill";
import { speakWord } from "../../../../utils/tts-speech";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = BALANCE.tickMs;
const FALLBACK_WORDS = ["cat", "frog", "bird", "sun", "tree", "fish"];

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both horns have landed */
type BalloonOnlineResult = {
  verdict: BalloonVerdict;
  myPops: number;
  myScore: number;
  theirPops: number;
  theirScore: number;
};
type PageLang = "fa" | "en";

const LANG_LABELS: Record<PageLang, string> = {
  fa: "فارسی",
  en: "english",
};

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Balloon Pop (idea G6): bubbles rise with your weak letters first — type
 * them before they escape. The pure engine (utils/balloon-pop) owns the
 * physics/pops/stages; this page owns the word pool, the letter unlock set,
 * the spawn slots and the timers. The game never writes the learn state.
 */
export function BalloonPopPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [lang, setLang] = createSignal<PageLang>(
    Config.language.startsWith("persian") ? "fa" : "en",
  );
  const [engineState, setEngineState] = createSignal<BalloonState | undefined>(
    undefined,
  );
  const [stageBanner, setStageBanner] = createSignal<number | undefined>(
    undefined,
  );
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  const [startStage, setStartStage] = createSignal(1);
  /** the hear-it TTS mode (idea G6, phase 3): speak each balloon as it
   * spawns; the cadence slows to make room for the speech */
  const [hearIt, setHearIt] = createSignal(false);
  /** the blur-pause badge (KI-33): the engine pauses on window blur by
   * design (anti unfair-death) — without this the run just looks frozen */
  const [paused, setPaused] = createSignal(false);
  //online (LAN) state — the peer's pop race on the same seeded stream
  const [remoteState, setRemoteState] = createSignal<
    BalloonRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    BalloonOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: BalloonEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  let hornTimer: ReturnType<typeof setTimeout> | undefined;
  const slotById = new Map<number, number>();
  const spokenIds = new Set<number>();
  let lastSlot = -1;
  let words: string[] = [];
  let letters: string[] = [];
  let previousStage = 1;
  let myFinishSent = false;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (bannerTimer !== undefined) clearTimeout(bannerTimer);
    if (hornTimer !== undefined) clearTimeout(hornTimer);
    tickTimer = undefined;
    bannerTimer = undefined;
    hornTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-game (header back, route change) locks the pops and tells
  //the peer — they are never left waiting for the horn
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "balloon-pop") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanBalloon.encodeProgress({
          pops: state?.popped ?? 0,
          score: state?.score ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "balloon-pop";

  //online: the seeded LCG (both machines spawn the identical balloons)
  let runRng: () => number = Math.random;
  const rng = (): number => runRng();

  const spawnerFor = (
    stage: number,
    level: number,
  ): { payload: string; speed: number } => {
    const spawner = createSpawner({
      stage,
      level,
      letters,
      words: words.length > 0 ? words : FALLBACK_WORDS,
      weakness: buildCurrentWeakness(),
      //online: the seeded rng — both machines spawn the same balloons
      rng: lanMode() ? runRng : Math.random,
    });
    return spawner.nextSpawn();
  };

  const slotFor = (id: number): number => {
    let slot = slotById.get(id);
    if (slot === undefined) {
      //8 columns, never the just-used one (the doc's slot-based spawn)
      const options = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== lastSlot);
      slot = options[Math.floor(rng() * options.length)] ?? 0;
      slotById.set(id, slot);
      lastSlot = slot;
    }
    return slot;
  };

  const startRun = async (fromStage: BalloonStage): Promise<void> => {
    setMessage(undefined);
    slotById.clear();
    lastSlot = -1;
    spokenIds.clear();
    letters = [...new Set(unlockedLetters(Config.language).split(""))];
    if (letters.length === 0) letters = ["a", "s", "d", "f"];
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      words = data.words;
    } catch {
      words = FALLBACK_WORDS;
    }
    engine = createBalloonEngine({
      spawn: spawnerFor,
      letters,
      startStage: fromStage,
      lives: BALANCE.startLives,
      spawnExtraMs: hearIt() ? BALANCE.hearItSpawnExtraMs : 0,
    });
    previousStage = fromStage;
    setStageBanner(fromStage > 1 ? fromStage : undefined);
    if (fromStage > 1) {
      bannerTimer = setTimeout(() => setStageBanner(undefined), 1500);
    }
    setEngineState(engine.state());
    setPaused(false);
    setPagePhase("playing");
    //KI-30: install this run's tick only after retiring any previous run's
    //timers — two overlapping startRuns must never leave two intervals
    //ticking one engine (2x balloon speed, doubled TTS)
    stopTimers();
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      if (hearIt()) {
        for (const balloon of state.bubbles) {
          if (spokenIds.has(balloon.id)) continue;
          spokenIds.add(balloon.id);
          //spoken as spawned: the trailing stage-4 punctuation stays silent
          void speakWord(balloon.payload.replace(/[،؟«»]/g, ""));
        }
      }
      if (state.stage > previousStage) {
        previousStage = state.stage;
        setStageBanner(state.stage);
        if (bannerTimer !== undefined) clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => setStageBanner(undefined), 1500);
      }
      if (state.phase === "done") endRun(state);
    }, TICK_MS);
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const state = engine?.state();
    setOnlineResult({
      verdict: resolveBalloonVerdict(
        { pops: state?.popped ?? 0, score: state?.score ?? 0 },
        {
          pops: remoteState()?.pops ?? 0,
          score: remoteState()?.score ?? 0,
        },
      ),
      myPops: state?.popped ?? 0,
      myScore: state?.score ?? 0,
      theirPops: remoteState()?.pops ?? 0,
      theirScore: remoteState()?.score ?? 0,
    });
    setPagePhase("result");
  };

  const myFinishNow = (): void => {
    if (myFinishSent) return;
    myFinishSent = true;
    const state = engine?.state();
    sendLanMatchProgress(
      lanBalloon.encodeProgress({
        pops: state?.popped ?? 0,
        score: state?.score ?? 0,
      }),
    );
    sendLanMatchFinished(0, 100);
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    } else {
      setPagePhase("awaiting");
    }
  };

  const endRun = (state: BalloonState): void => {
    stopTimers();
    if (lanMode()) {
      //all balloons escaped before the horn — the pops are locked
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchProgress(
          lanBalloon.encodeProgress({
            pops: state.popped,
            score: state.score,
          }),
        );
        sendLanMatchFinished(null, 0);
      }
      setOnlineResult({
        verdict: "lost",
        myPops: state.popped,
        myScore: state.score,
        theirPops: remoteState()?.pops ?? 0,
        theirScore: remoteState()?.score ?? 0,
      });
      setPagePhase("result");
      return;
    }
    recordBalloonRun({
      stage: state.stage,
      score: state.score,
      popped: state.popped,
      escaped: state.escaped,
    });
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state().popped ?? 0;
    const state = engine?.feedKey(event.key);
    setEngineState(state);
    if ((state?.popped ?? 0) > before) void playClick();
    else if (state?.combo === 0) void playError();
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

  //an armed (or re-armed) balloon match IS the online start: the seed
  //drives the spawner, the horn lands at the match's durationMs
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "balloon-pop") return;
    void (async () => {
      const matchLang =
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english";
      const stage = match.start.params["stage"];
      const durationMs =
        typeof match.start.params["durationMs"] === "number"
          ? match.start.params["durationMs"]
          : 120_000;
      let pool: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${matchLang}.json`,
        );
        pool = data.words;
      } catch {
        //offline fallback list
      }
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      myFinishSent = false;
      setHearIt(false); //TTS stays offline-only
      runRng = createSeededRng(match.start.seed ?? 1);
      slotById.clear();
      lastSlot = -1;
      words = pool;
      letters = ["a", "s", "d", "f", "j", "k", "l"];
      previousStage =
        typeof stage === "number" && stage >= 1 && stage <= 4 ? stage : 1;
      setLang(matchLang.startsWith("persian") ? "fa" : "en");
      await startRun(previousStage as BalloonStage);
      hornTimer = setTimeout(() => {
        if (pagePhase() === "playing") myFinishNow();
      }, durationMs);
    })();
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as BalloonRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "balloon-pop") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the game voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "balloon-pop") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    const onBlur = (): void => {
      engine?.setPaused(true);
      setPaused(true);
    };
    const onFocus = (): void => {
      engine?.setPaused(false);
      setPaused(false);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    });
  });

  const backToMenu = (): void => {
    //KI-30: leaving mid-run must stop the tick — the leaked interval would
    //otherwise double-tick the next run (2x balloon speed, doubled TTS)
    stopTimers();
    engine = undefined;
    setPagePhase("menu");
  };

  const bests = (): { stage: number; score: number }[] => {
    const bestByStage = getBalloonPopStats().bestByStage;
    return Object.entries(bestByStage)
      .map(([stage, best]) => ({ stage: Number(stage), score: best.score }))
      .sort((a, b) => a.stage - b.stage);
  };

  const continueStage = (): number => {
    const entries = bests();
    return entries.length === 0
      ? 1
      : Math.min(4, (entries[entries.length - 1]?.stage ?? 1) + 1);
  };

  const Menu = (): JSXElement => {
    const entries = bests();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="text-sub">language</div>
        <div class="grid grid-cols-2 gap-2">
          <For each={["fa", "en"] as PageLang[]}>
            {(value) => (
              <Button
                text={LANG_LABELS[value]}
                class={cn("w-full", lang() === value && "bg-main text-bg")}
                onClick={() => setLang(value)}
              />
            )}
          </For>
        </div>
        <div class="text-sub">start at stage</div>
        <div class="grid grid-cols-4 gap-2">
          <For each={[1, 2, 3, 4]}>
            {(stage) => (
              <Button
                text={`stage ${stage}`}
                class={cn(
                  "w-full",
                  startStage() === stage && "bg-main text-bg",
                )}
                onClick={() => setStartStage(stage)}
              />
            )}
          </For>
        </div>
        <Show when={entries.length > 0}>
          <div class="text-xs text-sub">
            bests:{" "}
            {entries
              .map((entry) => `stage ${entry.stage}: ${entry.score}`)
              .join(" · ")}
          </div>
        </Show>
        <div class="flex items-center justify-between gap-2">
          <span class="text-sub">hear it (speak each balloon)</span>
          <Button
            text={hearIt() ? "on" : "off"}
            class={cn("w-24", hearIt() && "bg-main text-bg")}
            onClick={() => setHearIt(!hearIt())}
          />
        </div>
        <Button
          text={
            startStage() > 1
              ? `start at stage ${startStage()}`
              : "start stage 1"
          }
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun(startStage() as BalloonStage)}
        />
        <div class="text-xs text-sub">
          pop the rising balloons — your weak letters come first. An escape
          costs a life.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34: the signal must be read inline in JSX — capturing it in a local
    //const froze the arena on the mount-time snapshot (no movement, no
    //spawns, no pops ever rendered)
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "70vh" }}
        aria-label="balloon arena"
      >
        <div class="absolute top-0 w-full border-t-2 border-dashed border-error"></div>
        <div class="absolute top-1 w-full text-center text-[0.65rem] text-error">
          danger line
        </div>
        <For each={engineState()?.bubbles ?? []}>
          {(balloon) => (
            <div
              class="absolute grid place-items-center rounded-full border-2 border-main bg-bg font-bold"
              style={{
                top: `${balloon.y}vh`,
                left: `${4 + slotFor(balloon.id) * 11.5}%`,
                width: `${2.2 + balloon.payload.length * 0.9}rem`,
                height: `${2.2 + balloon.payload.length * 0.5}rem`,
              }}
              dir="auto"
              data-testid="bp-balloon"
            >
              <span class="text-main">{balloon.payload}</span>
            </div>
          )}
        </For>
        <Show when={paused()}>
          <div
            class="absolute inset-0 grid place-items-center"
            data-testid="bp-paused"
          >
            <div class="rounded border-2 border-main bg-bg px-6 py-3 text-2xl font-bold text-main">
              paused
            </div>
          </div>
        </Show>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="bp-awaiting">
          your pops are locked ({engineState()?.popped ?? 0}) — waiting for{" "}
          {`${getLanMatch()?.peerName ?? "the opponent"}'s horn…`}
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): BalloonOnlineResult | undefined => onlineResult();
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
          data-testid="bp-verdict"
        >
          {verdict === "won"
            ? "you win!"
            : verdict === "draw"
              ? "draw"
              : verdict === "lost" && !myFinishSent
                ? `you flooded — ${getLanMatch()?.peerName ?? "the opponent"} takes it`
                : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.myPops ?? 0} pops · {online()?.myScore ?? 0}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirPops ?? 0} pops · {online()?.theirScore ?? 0}
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
    const state = engine?.state();
    const best = getBalloonPopStats().bestByStage[String(state?.stage ?? 1)];
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-error">run over</div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state?.stage ?? 1}
            </div>
            <div class="text-xs text-sub">stage reached</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {state?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {best?.score ?? "—"}
            </div>
            <div class="text-xs text-sub">stage best</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          popped {state?.popped ?? 0} · escaped {state?.escaped ?? 0} · max
          combo {state?.maxCombo ?? 0}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text={`continue at stage ${continueStage()}`}
            fa={{ icon: "fa-forward" }}
            class="w-full"
            onClick={() => {
              setStartStage(continueStage());
              void startRun(continueStage() as BalloonStage);
            }}
          />
          <Button
            text="back to menu"
            fa={{ icon: "fa-home" }}
            class="w-full"
            onClick={() => backToMenu()}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-circle" }} text="balloon pop" />
        <p class="text-sub">
          bubbles rise with your weak letters first — type them before they
          escape. Four stages: letters, short words, words, punctuation.
        </p>
      </section>

      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="bp-online-vs"
        >
          <i class="fas fa-circle"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same balloons, 120s, the more pops
          wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="bp-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.pops ?? 0} · {remoteState()?.score ?? 0}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"} · pops · score
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.popped ?? 0} · {engineState()?.score ?? 0}
            </div>
            <div class="text-xs text-sub">you · pops · score</div>
          </div>
        </div>
      </Show>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
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
          <section class="grid grid-cols-5 gap-2" aria-label="balloon hud">
            <HudCell label="stage" value={String(engineState()?.stage ?? 1)} />
            <HudCell label="level" value={String(engineState()?.level ?? 1)} />
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell
              label="combo"
              value={`${engineState()?.combo ?? 0} · x${comboMult(engineState()?.combo ?? 0)}`}
            />
            <HudCell
              label="lives"
              value={"❤".repeat(engineState()?.lives ?? 0) || "—"}
            />
          </section>
          <Show when={stageBanner() !== undefined}>
            <div class="text-center text-2xl font-bold text-main">
              stage {stageBanner()}
            </div>
          </Show>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
