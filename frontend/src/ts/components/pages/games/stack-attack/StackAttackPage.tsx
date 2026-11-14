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
import {
  getLanClients,
  isLanConnected,
  lanPreFillName,
} from "../../../../states/lan";
import {
  armLanMatch,
  clearLanMatch,
  getLanMatch,
  getLanRoomClients,
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
import { BALANCE } from "../../../../utils/stack-attack/balance";
import {
  createStackAttackEngine,
  type StackAttackEngine,
  type StackAttackState,
} from "../../../../utils/stack-attack/engine";
import {
  lanStack,
  resolveStackVerdict,
  stackLanStream,
  type StackRemoteState,
  type StackVerdict,
} from "../../../../utils/stack-attack/lan";
import {
  getStackAttackBestScore,
  recordStackAttackRun,
} from "../../../../utils/stack-attack/store";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const CELL_REM = 1.9; //the grid cell size
const FALLBACK_WORDS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "house",
  "garden",
  "water",
  "music",
];

type PagePhase = "menu" | "playing" | "awaiting" | "result" | "spectating";

/** the online verdict once both horns have landed */
type StackOnlineResult = {
  verdict: StackVerdict;
  myRows: number;
  myScore: number;
  theirRows: number;
  theirScore: number;
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
 * Stack Attack (idea G12, phase 2): a word-block falls through a grid —
 * type its word to lock it, steer the column with the arrows, clear full
 * rows. The pure engine owns the rules; this page owns the word pool and
 * the timers. The arrows are swallowed mid-run so the page never scrolls
 * or navigates (doc G12 DoD).
 */
export function StackAttackPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>(
    getLanMatch()?.gameId === "stack-attack"
      ? getLanMatch()?.role === "spectator"
        ? "spectating"
        : "playing"
      : "menu",
  );
  const [engineState, setEngineState] = createSignal<
    StackAttackState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer's rows race on the same seeded stream
  const [remoteState, setRemoteState] = createSignal<
    StackRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    StackOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: StackAttackEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let hornTimer: ReturnType<typeof setTimeout> | undefined;
  let myFinishSent = false;
  let lastSentRows = -1;
  let lastSentScore = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (hornTimer !== undefined) clearTimeout(hornTimer);
    tickTimer = undefined;
    hornTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-run (header back, route change) locks the rows and tells
  //the peer — they are never left waiting for the horn
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "stack-attack") return;
    if (getLanMatch()?.role === "spectator") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanStack.encodeProgress({
          rows: state?.rowsCleared ?? 0,
          score: state?.score ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "stack-attack";

  const startRun = async (): Promise<void> => {
    setMessage(undefined);
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
    engine = createStackAttackEngine({
      spawnWord: (level) => {
        //block length rides the level: 3 letters +1 per level, cap 6
        const maxLen = Math.min(
          BALANCE.maxWordLen,
          BALANCE.minWordLen + level - 1,
        );
        const window_ = pickable.filter(
          (word) => word.length >= BALANCE.minWordLen && word.length <= maxLen,
        );
        const source = window_.length > 0 ? window_ : pickable;
        return source[Math.floor(Math.random() * source.length)] ?? "cat";
      },
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  /** the one tick loop both the offline run and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      //online: relay the rows/score when they moved
      if (
        lanMode() &&
        (state.rowsCleared !== lastSentRows || state.score !== lastSentScore)
      ) {
        lastSentRows = state.rowsCleared;
        lastSentScore = state.score;
        sendLanMatchProgress(
          lanStack.encodeProgress({
            rows: state.rowsCleared,
            score: state.score,
          }),
        );
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const state = engine?.state();
    setOnlineResult({
      verdict: resolveStackVerdict(
        { rows: state?.rowsCleared ?? 0, score: state?.score ?? 0 },
        {
          rows: remoteState()?.rows ?? 0,
          score: remoteState()?.score ?? 0,
        },
      ),
      myRows: state?.rowsCleared ?? 0,
      myScore: state?.score ?? 0,
      theirRows: remoteState()?.rows ?? 0,
      theirScore: remoteState()?.score ?? 0,
    });
    setPagePhase("result");
  };

  const myFinishNow = (): void => {
    if (myFinishSent) return;
    myFinishSent = true;
    const state = engine?.state();
    sendLanMatchProgress(
      lanStack.encodeProgress({
        rows: state?.rowsCleared ?? 0,
        score: state?.score ?? 0,
      }),
    );
    sendLanMatchFinished(0, 100);
    //my run ended at the horn — the engine freezes. Without this a late
    //top-out's endRun fired during awaiting and overwrote the held
    //verdict with "lost" (the CI run's lesson)
    stopTimers();
    if (getRemoteFinished() !== undefined) {
      resolveOnlineResult();
    } else {
      setPagePhase("awaiting");
    }
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //the blocks piled to the top before the horn — my rows are locked
      if (!myFinishSent) {
        myFinishSent = true;
        sendLanMatchProgress(
          lanStack.encodeProgress({
            rows: state?.rowsCleared ?? 0,
            score: state?.score ?? 0,
          }),
        );
        sendLanMatchFinished(null, 0);
      }
      setOnlineResult({
        verdict: "lost",
        myRows: state?.rowsCleared ?? 0,
        myScore: state?.score ?? 0,
        theirRows: remoteState()?.rows ?? 0,
        theirScore: remoteState()?.score ?? 0,
      });
      setPagePhase("result");
      return;
    }
    if (state?.result !== undefined) {
      recordStackAttackRun({
        score: state.result.score,
        rowsCleared: state.result.rowsCleared,
        level: state.result.level,
        blocksLocked: state.result.blocksLocked,
      });
    }
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

  //an armed (or re-armed) stack match IS the online start: the seed
  //builds the shared block stream, the horn lands at durationMs
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "stack-attack") return;
    void (async () => {
      const lang =
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english";
      const durationMs =
        typeof match.start.params["durationMs"] === "number"
          ? match.start.params["durationMs"]
          : 120_000;
      let pool: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${lang}.json`,
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
      const stream = stackLanStream(pickable, match.start.seed ?? 1);
      let streamIndex = 0;
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      myFinishSent = false;
      lastSentRows = -1;
      lastSentScore = -1;
      engine = createStackAttackEngine({
        spawnWord: (level) => {
          const maxLen = Math.min(
            BALANCE.maxWordLen,
            BALANCE.minWordLen + level - 1,
          );
          const window_ = pickable.filter(
            (word) =>
              word.length >= BALANCE.minWordLen && word.length <= maxLen,
          );
          const source = window_.length > 0 ? window_ : pickable;
          //the shared stream drives the pick: the next stream word that
          //fits the level's length window (both machines see the same)
          for (const _ of stream) {
            const candidate = stream[streamIndex % stream.length] ?? "cat";
            streamIndex += 1;
            if (
              candidate.length >= BALANCE.minWordLen &&
              candidate.length <= maxLen
            ) {
              return candidate;
            }
          }
          return source[0] ?? "cat";
        },
      });
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
      hornTimer = setTimeout(() => {
        if (pagePhase() === "playing") myFinishNow();
      }, durationMs);
    })();
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as StackRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "stack-attack") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the run voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "stack-attack") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    //the arrows steer: swallowed so the page never scrolls or leaves
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const after = engine?.moveCol(-1);
      if (after !== undefined) setEngineState(after);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const after = engine?.moveCol(1);
      if (after !== undefined) setEngineState(after);
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after === undefined) return;
    if (before !== undefined) {
      if (after.blocksLocked > before.blocksLocked) {
        void playClick();
      } else if (!after.comboEligible && before.comboEligible) {
        void playError();
      }
    }
    setEngineState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  /** the occupied grid cells (inline signal read — the KI-34 lesson) */
  const occupiedCells = (): { row: number; col: number; letter: string }[] => {
    const cells: { row: number; col: number; letter: string }[] = [];
    (engineState()?.grid ?? []).forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell !== undefined) {
          cells.push({ row: r, col: c, letter: cell.letter });
        }
      });
    });
    return cells;
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="rounded bg-bg p-3 text-center">
          <div class="text-xl font-bold text-main tabular-nums">
            {getStackAttackBestScore()}
          </div>
          <div class="text-xs text-sub">best score</div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type the falling word to lock the block into the grid — steer with the
          arrows, fill a row to clear it. A lock poking above the grid ends the
          run.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson (hit a third time!): the signal must be read INLINE in
    //JSX — a local const froze the block on the mount-time snapshot
    const gridWidthRem = BALANCE.cols * CELL_REM;
    const gridHeightRem = BALANCE.rows * CELL_REM;
    return (
      <section class="grid place-items-center" aria-label="stack attack arena">
        <div
          class="relative rounded bg-bg"
          style={{
            width: `${gridWidthRem}rem`,
            height: `${gridHeightRem}rem`,
            "border-color": "var(--sub-color)",
            //KI-48: faint cell lines so the playfield reads as a grid
            "background-image":
              "linear-gradient(color-mix(in srgb, var(--sub-color) 35%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--sub-color) 35%, transparent) 1px, transparent 1px)",
            "background-size": `${CELL_REM}rem ${CELL_REM}rem`,
          }}
        >
          <Show when={engineState()?.falling !== undefined}>
            <div
              class="absolute top-0 h-full"
              style={{
                left: `${(engineState()?.falling?.col ?? 0) * CELL_REM}rem`,
                width: `${(engineState()?.falling?.word.length ?? 0) * CELL_REM}rem`,
                background: "var(--sub-alt-color)",
                opacity: 0.55,
              }}
              data-testid="sa-ghost"
            ></div>
          </Show>
          <For each={occupiedCells()}>
            {(cell) => (
              <div
                class="absolute grid place-items-center rounded-sm bg-main font-bold text-bg"
                style={{
                  left: `${cell.col * CELL_REM}rem`,
                  top: `${cell.row * CELL_REM}rem`,
                  width: `${CELL_REM}rem`,
                  height: `${CELL_REM}rem`,
                }}
                data-testid="sa-cell"
              >
                {cell.letter}
              </div>
            )}
          </For>
          <Show when={engineState()?.falling !== undefined}>
            <div
              class={cn(
                "absolute grid grid-flow-col place-items-center rounded border-2 font-bold",
                engineState()?.falling?.resting === true
                  ? "border-main bg-sub-alt"
                  : "border-sub bg-bg",
              )}
              style={{
                left: `${(engineState()?.falling?.col ?? 0) * CELL_REM}rem`,
                top: `${(engineState()?.falling?.row ?? 0) * CELL_REM}rem`,
                width: `${(engineState()?.falling?.word.length ?? 0) * CELL_REM}rem`,
                height: `${CELL_REM}rem`,
              }}
              data-testid="sa-block"
              data-word={engineState()?.falling?.word ?? ""}
              data-typed={String(engineState()?.falling?.typedIdx ?? 0)}
            >
              <For each={Array.from(engineState()?.falling?.word ?? "")}>
                {(letter, i) => (
                  <span
                    class={cn(
                      "grid h-full place-items-center",
                      i() < (engineState()?.falling?.typedIdx ?? 0)
                        ? "text-main"
                        : "text-sub",
                    )}
                    style={{ width: `${CELL_REM}rem` }}
                  >
                    {letter}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="sa-awaiting">
          your rows are locked ({engineState()?.rowsCleared ?? 0}) — waiting for{" "}
          {`${getLanMatch()?.peerName ?? "the opponent"}'s horn…`}
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): StackOnlineResult | undefined => onlineResult();
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
          data-testid="sa-verdict"
        >
          {verdict === "won"
            ? "you win!"
            : verdict === "draw"
              ? "draw"
              : verdict === "lost" && !myFinishSent
                ? `you topped out — ${getLanMatch()?.peerName ?? "the opponent"} takes it`
                : `${getLanMatch()?.peerName ?? "the opponent"} wins`}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.myRows ?? 0} rows · {online()?.myScore ?? 0}
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirRows ?? 0} rows · {online()?.theirScore ?? 0}
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
        <div class="text-3xl font-bold text-error">
          the stack reached the top
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
              {result?.rowsCleared ?? 0}
            </div>
            <div class="text-xs text-sub">rows cleared</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.level ?? 1}
            </div>
            <div class="text-xs text-sub">level</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.blocksLocked ?? 0}
            </div>
            <div class="text-xs text-sub">blocks locked</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getStackAttackBestScore()}
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
        <H2 fa={{ icon: "fa-cubes" }} text="stack attack" />
        <p class="text-sub">
          wordtris: word-blocks fall — type them, steer the column, clear full
          rows before the stack reaches the top.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="sa-online-vs"
        >
          <i class="fas fa-cubes"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same blocks, 120s, the more cleared
          rows wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="sa-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.rows ?? 0} · {remoteState()?.score ?? 0}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"} · rows · score
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.rowsCleared ?? 0} · {engineState()?.score ?? 0}
            </div>
            <div class="text-xs text-sub">you · rows · score</div>
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
          <div class="grid grid-cols-4 gap-2" aria-label="stack attack hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell label="level" value={String(engineState()?.level ?? 1)} />
            <HudCell
              label="rows"
              value={String(engineState()?.rowsCleared ?? 0)}
            />
            <div class="rounded bg-bg p-2 text-center">
              <div
                class={cn(
                  "text-xl font-bold",
                  engineState()?.comboEligible === true
                    ? "text-main"
                    : "text-sub",
                )}
              >
                ×1.5
              </div>
              <div class="text-xs text-sub">chain</div>
            </div>
          </div>
          <Arena />
        </Show>
      </Show>
      <Show when={pagePhase() === "spectating"}>
        <section
          class="grid gap-2 rounded bg-sub-alt p-4"
          data-testid="sa-spectator-hud"
        >
          <div class="text-sm text-sub">
            spectating — the racers&apos; live progress
          </div>
          <For each={Object.values(getLanRoomClients())}>
            {(client) => (
              <div class="rounded bg-bg p-2">
                <div class="text-xs font-bold text-main">
                  {getLanClients()[client.clientId]?.name ??
                    `client ${client.clientId}`}
                </div>
                <div class="text-xs text-sub">
                  rows{" "}
                  {String((client.progress as { rows?: number })?.rows ?? 0)}
                  {" · "}score{" "}
                  {String((client.progress as { score?: number })?.score ?? 0)}
                </div>
              </div>
            )}
          </For>
        </section>
      </Show>
    </div>
  );
}
