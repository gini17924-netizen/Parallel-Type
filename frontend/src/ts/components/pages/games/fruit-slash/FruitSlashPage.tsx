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
import { createSeededRng } from "../../../../utils/daily-gauntlet/seeded-rng";
import { BALANCE } from "../../../../utils/fruit-slash/balance";
import {
  createFruitSlashEngine,
  type FruitSlashEngine,
  type FruitSlashState,
} from "../../../../utils/fruit-slash/engine";
import {
  fruitLanSpawn,
  lanFruitSlash,
  resolveFruitVerdict,
  type FruitRemoteState,
  type FruitVerdict,
} from "../../../../utils/fruit-slash/lan";
import {
  getFruitSlashBestScore,
  getFruitSlashBestSlashed,
  recordFruitSlashRun,
} from "../../../../utils/fruit-slash/store";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
/** the engine's vh band (apex ~54, floor 105) mapped into the arena */
const DISPLAY_Y_OFFSET_VH = 28;
const FALLBACK_WORDS = [
  "fig",
  "kiwi",
  "plum",
  "pear",
  "mango",
  "berry",
  "peach",
  "grape",
  "melon",
  "cherry",
];

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both windows have closed (or the peer gave up) */
type FruitOnlineResult = {
  verdict: FruitVerdict;
  myScore: number;
  myBombs: number;
  theirScore: number;
  theirBombs: number;
  theirTimeMs: number | null;
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
 * Fruit Slash (idea G10, phase 2): fruits fly in arcs from the bottom —
 * type ANY visible word to slash it (word-oriented, per-fruit partials);
 * typing a bomb's word costs a life and three bombs end the run; the
 * 90-second window ends it otherwise. The pure engine owns the rules;
 * this page owns the word pool, the bomb mix and the timers.
 *
 * Online (online wave, phase 36): the armed match IS the start — both
 * machines slash the identical seeded launch stream (words, bombs and
 * arc angles all from the shared seed) inside the shared window from
 * params. The horn fires for both; the finish ships at the horn (or at
 * the third bomb); the verdict resolves when both are in — the higher
 * score wins. Nothing online is recorded.
 */
export function FruitSlashPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    FruitSlashState | undefined
  >(undefined);
  const [slashFx, setSlashFx] = createSignal<
    { x: number; y: number } | undefined
  >(undefined);
  const [bombFx, setBombFx] = createSignal<
    { x: number; y: number } | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer slashes the same seeded stream
  const [remoteState, setRemoteState] = createSignal<
    FruitRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    FruitOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: FruitSlashEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let fxTimer: ReturnType<typeof setTimeout> | undefined;
  const positions = new Map<number, { x: number; y: number }>();
  let myFinish: { score: number; elapsedMs: number } | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentBombs = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (fxTimer !== undefined) clearTimeout(fxTimer);
    tickTimer = undefined;
    fxTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-window (header back, route change) tells the peer the run
  //was abandoned — a run without a finish loses, they can never be beaten
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "fruit-slash") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanFruitSlash.encodeProgress({
          score: state?.score ?? 0,
          bombs: state?.bombsTyped ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "fruit-slash";

  const applyState = (next: FruitSlashState): void => {
    const previous = engineState();
    if (previous !== undefined) {
      for (const fruit of previous.fruits) {
        if (next.fruits.some((f) => f.id === fruit.id)) continue;
        const pos = positions.get(fruit.id);
        if (pos === undefined) continue;
        if (next.bombsTyped > previous.bombsTyped) {
          //a typed bomb went off
          setBombFx({ x: pos.x, y: Math.min(pos.y, 100) });
          void playError();
        } else if (next.slashed > previous.slashed) {
          //slashed: the two halves separate at the fruit's position
          setSlashFx({ x: pos.x, y: Math.min(pos.y, 100) });
          void playClick();
        }
      }
    }
    for (const fruit of next.fruits) {
      positions.set(fruit.id, { x: fruit.x, y: fruit.y });
    }
    if (previous !== undefined && next.slashed > previous.slashed) {
      if (fxTimer !== undefined) clearTimeout(fxTimer);
      fxTimer = setTimeout(() => {
        setSlashFx(undefined);
        setBombFx(undefined);
      }, 300);
    }
    setEngineState(next);
  };

  const startRun = async (): Promise<void> => {
    if (lanMode()) return; //online: the match effect owns the start
    await startOfflineRun();
  };

  /** the offline run: the random stream, the local records */
  const startOfflineRun = async (): Promise<void> => {
    setMessage(undefined);
    positions.clear();
    let pool: string[] = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      pool = data.words;
    } catch {
      //offline fallback list
    }
    const pickable = [
      ...new Set(
        pool
          .filter((word) => /^\p{L}+$/u.test(word))
          .map((word) => word.toLowerCase()),
      ),
    ];
    engine = createFruitSlashEngine({
      spawn: (level) => {
        //word length rides the level: 4 letters, +1 every 2 levels, cap 6
        const maxLen = Math.min(
          BALANCE.maxWordLen,
          BALANCE.minWordLen + Math.floor(level / 2),
        );
        const window_ = pickable.filter(
          (word) => word.length >= BALANCE.minWordLen && word.length <= maxLen,
        );
        const source = window_.length > 0 ? window_ : pickable;
        const word = source[Math.floor(Math.random() * source.length)] ?? "fig";
        return { word, isBomb: Math.random() < BALANCE.bombChance };
      },
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const state = engine?.state();
    const myScore = state?.score ?? 0;
    //a peer finish of null = they abandoned mid-window: a run without a
    //finish loses, the survivor takes the win whenever their window closes
    const abandoned =
      finished.finishMs === null || finished.finishMs === undefined;
    const theirScore = remoteState()?.score ?? 0;
    setOnlineResult({
      verdict: abandoned
        ? "won"
        : resolveFruitVerdict({ score: myScore }, { score: theirScore }),
      myScore,
      myBombs: state?.bombsTyped ?? 0,
      theirScore,
      theirBombs: remoteState()?.bombs ?? 0,
      theirTimeMs: abandoned ? null : (finished.finishMs ?? null),
    });
    setPagePhase("result");
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

  //an armed (or re-armed) slash match IS the online start: the seed
  //drives the words, the bomb mix AND the arc angles — identical
  //launches on both machines, the window from params
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "fruit-slash") return;
    void (async () => {
      const matchLang = match.start.params["lang"];
      let pool: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${
            typeof matchLang === "string" && matchLang.length > 0
              ? matchLang
              : "english"
          }.json`,
        );
        pool = data.words;
      } catch {
        //the offline fallback list
      }
      const seed = match.start.seed ?? 1;
      const matchDuration = match.start.params["durationMs"];
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setVoidMessage(undefined);
      myFinish = undefined;
      myFinishSent = false;
      lastSentScore = -1;
      lastSentBombs = -1;
      positions.clear();
      engine = createFruitSlashEngine({
        spawn: fruitLanSpawn(pool, seed),
        rng: createSeededRng(seed),
        durationMs:
          typeof matchDuration === "number" && matchDuration > 0
            ? matchDuration
            : BALANCE.durationMs,
      });
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  /** the one tick loop both the offline run and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      applyState(state);
      //online: relay the score/bombs when they moved
      if (
        lanMode() &&
        (state.score !== lastSentScore || state.bombsTyped !== lastSentBombs)
      ) {
        lastSentScore = state.score;
        lastSentBombs = state.bombsTyped;
        sendLanMatchProgress(
          lanFruitSlash.encodeProgress({
            score: state.score,
            bombs: state.bombsTyped,
          }),
        );
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //the horn (or the third bomb) — the finish ships with the numbers
      if (!myFinishSent) {
        myFinishSent = true;
        myFinish = {
          score: state?.score ?? 0,
          elapsedMs: state?.elapsedMs ?? 0,
        };
        sendLanMatchProgress(
          lanFruitSlash.encodeProgress({
            score: myFinish.score,
            bombs: state?.bombsTyped ?? 0,
          }),
        );
        sendLanMatchFinished(myFinish.elapsedMs, 100);
      }
      if (getRemoteFinished() !== undefined) {
        resolveOnlineResult();
      } else {
        setPagePhase("awaiting");
      }
      return;
    }
    if (state?.result !== undefined) {
      recordFruitSlashRun({
        score: state.result.score,
        slashed: state.result.slashed,
        bombsTyped: state.result.bombsTyped,
        maxCombo: state.result.maxCombo,
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return; //Backspace/Enter: inert in G10
    event.preventDefault();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after !== undefined) applyState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as FruitRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "fruit-slash") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the window voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "fruit-slash") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <Show when={voidMessage() !== undefined}>
          <div class="text-error">{voidMessage()}</div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getFruitSlashBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getFruitSlashBestSlashed()}
            </div>
            <div class="text-xs text-sub">best slashed</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type ANY visible fruit&apos;s word to slash it — mid-air apex slashes
          pay +30. Do NOT type the bombs: a completed bomb costs a life and
          three end the run. A half-typed bomb defuses itself.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: read the signal inline — a local const would freeze
    //the arena on the mount-time snapshot
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "80vh" }}
        aria-label="fruit slash arena"
      >
        <div class="absolute bottom-0 w-full border-t-2 border-dashed border-error"></div>
        <For each={engineState()?.fruits ?? []}>
          {(fruit) => (
            <div
              class={cn(
                "absolute grid place-items-center rounded-full font-bold",
                fruit.isBomb && !fruit.defused
                  ? "border-2 border-error bg-error/30"
                  : "border-2 border-main bg-bg",
                fruit.defused && "opacity-60",
              )}
              style={{
                left: `${fruit.x}vw`,
                top: `${fruit.y - DISPLAY_Y_OFFSET_VH}vh`,
                "min-width": `${2.4 + fruit.word.length * 0.7}rem`,
                padding: "0.2rem 0.4rem",
              }}
              dir="auto"
              data-testid="fs-fruit"
            >
              <span class="text-main">{fruit.word.slice(0, fruit.typed)}</span>
              <span>{fruit.word.slice(fruit.typed)}</span>
              <Show when={fruit.isBomb && !fruit.defused}>
                <span class="absolute -top-2 text-xs" data-testid="fs-bomb">
                  💣
                </span>
              </Show>
              <Show when={fruit.defused}>
                <span class="absolute -top-2 text-xs text-sub">✓</span>
              </Show>
            </div>
          )}
        </For>
        <Show when={slashFx() !== undefined}>
          <div
            class="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${slashFx()?.x ?? 0}vw`,
              top: `${(slashFx()?.y ?? 0) - DISPLAY_Y_OFFSET_VH}vh`,
            }}
            data-testid="fs-slash"
          >
            <div class="h-[3px] w-16 rotate-45 bg-main"></div>
            <div class="h-[3px] w-16 -rotate-45 bg-main"></div>
          </div>
        </Show>
        <Show when={bombFx() !== undefined}>
          <div
            class="absolute grid place-items-center rounded-full border-4 border-error"
            style={{
              left: `${bombFx()?.x ?? 0}vw`,
              top: `${(bombFx()?.y ?? 0) - DISPLAY_Y_OFFSET_VH}vh`,
              width: "3.5rem",
              height: "3.5rem",
            }}
            data-testid="fs-boom"
          ></div>
        </Show>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="fs-awaiting">
          the window closed · score {myFinish?.score ?? 0} — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): FruitOnlineResult | undefined => onlineResult();
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
          data-testid="fs-verdict"
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
              {online()?.myScore ?? 0} score · {online()?.myBombs ?? 0} bombs
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirScore ?? 0} score · {online()?.theirBombs ?? 0}{" "}
              bombs ·{" "}
              {online()?.theirTimeMs === null
                ? "gave up"
                : `${((online()?.theirTimeMs ?? 0) / 1000).toFixed(1)}s`}
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
    const result = engine?.state().result;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-3xl font-bold text-main">
          {result?.endedBy === "bombs" ? "three bombs!" : "time!"}
        </div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.slashed ?? 0}
            </div>
            <div class="text-xs text-sub">slashed</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.bombsTyped ?? 0}
            </div>
            <div class="text-xs text-sub">bombs typed</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getFruitSlashBestScore()} · best slashed{" "}
          {getFruitSlashBestSlashed()}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="run again"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => void startRun()}
          />
          <Button
            text="back to menu"
            fa={{ icon: "fa-home" }}
            class="w-full"
            onClick={() => {
              engine = undefined;
              setPagePhase("menu");
            }}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-apple-alt" }} text="fruit slash" />
        <p class="text-sub">
          fruits fly in arcs — type any visible word to slash it, ride the apex
          for the bonus, and never type the bombs.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="fs-online-vs"
        >
          <i class="fas fa-apple-alt"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same stream, the higher score wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="fs-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.score ?? 0} score · {remoteState()?.bombs ?? 0}{" "}
              bombs
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.score ?? 0} score ·{" "}
              {engineState()?.bombsTyped ?? 0} bombs
            </div>
            <div class="text-xs text-sub">you</div>
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
          <div class="grid grid-cols-4 gap-2" aria-label="fruit slash hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell
              label="time"
              value={`${((engineState()?.remainingMs ?? BALANCE.durationMs) / 1000).toFixed(1)}`}
            />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="bombs"
              value={`${engineState()?.bombsTyped ?? 0}/${BALANCE.maxTypedBombs}`}
            />
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
