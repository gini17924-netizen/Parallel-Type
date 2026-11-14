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
import { playClick } from "../../../../controllers/sound-controller";
import { navigate } from "../../../../router/navigate";
import {
  getLanPeerName,
  getLanRole,
  isLanConnected,
} from "../../../../states/lan";
import {
  armLanMatch,
  clearLanMatch,
  getLanMatch,
  getLanRawMessage,
  getRemoteFinished,
  getRemoteProgress,
  sendLanMatchFinished,
  sendLanMatchProgress,
  sendLanMatchRematch,
  sendLanMatchStart,
  type LanMatch,
} from "../../../../states/lan-match";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import {
  lanTowerDefense,
  resolveTowerVerdict,
  towerLanSpawner,
  type TowerRemoteState,
  type TowerVerdict,
} from "../../../../utils/tower-defense/lan";
import {
  createTowerDefenseEngine,
  type TowerDefenseEngine,
  type TowerDefenseState,
} from "../../../../utils/tower-defense/engine";
import {
  getTowerDefenseBests,
  recordTowerDefenseRun,
} from "../../../../utils/tower-defense/store";
import { BALANCE } from "../../../../utils/tower-defense/balance";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const FALLBACK_WORDS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "moon",
  "star",
  "tower",
  "wall",
  "keep",
  "archer",
];

type PagePhase = "menu" | "playing" | "awaiting" | "result";

export function TowerDefensePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    TowerDefenseState | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online state — the peer's tower races on the same seeded waves
  const [remoteState, setRemoteState] = createSignal<
    TowerRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<{
    verdict: TowerVerdict;
    myScore: number;
    theirScore: number;
  } | undefined>(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);

  let engine: TowerDefenseEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentHp = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-run tells the peer — they are never left waiting
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "tower-defense") return;
    if (pagePhase() !== "playing") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchFinished(null, 0);
      void state;
    }
    clearLanMatch();
  });

  const lanMode = (): boolean =>
    getLanMatch()?.gameId === "tower-defense";

  const startRun = async (): Promise<void> => {
    stopTimers();
    let pickable: string[] = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      pickable = data.words;
    } catch {
      //the offline fallback list
    }
    const runSeed = Date.now() % 2_147_483_647;
    const spawner = towerLanSpawner(pickable, runSeed);
    engine = createTowerDefenseEngine({
      spawnWave: (wave) => spawner.spawnWave(wave),
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const state = engine.tick(TICK_MS);
      setEngineState(state);
      //online: relay the live score/tower when they moved
      if (
        lanMode() &&
        (state.score !== lastSentScore || state.towerHp !== lastSentHp)
      ) {
        lastSentScore = state.score;
        lastSentHp = state.towerHp;
        sendLanMatchProgress(
          lanTowerDefense.encodeProgress({
            score: state.score,
            towerHp: state.towerHp,
          }),
        );
      }
      if (state.phase === "done") finishRun(state);
    }, TICK_MS);
  };

  const finishRun = (state: TowerDefenseState): void => {
    stopTimers();
    if (myFinishSent) {
      setPagePhase("result");
      return;
    }
    myFinishSent = true;
    if (lanMode()) {
      sendLanMatchFinished(null, 100);
      resolveOnlineResult(state);
      return;
    }
    const run = recordTowerDefenseRun({
      score: state.score,
      wave: state.wave,
      maxCombo: state.maxCombo,
      kills: state.kills,
    });
    void run;
    setPagePhase("result");
  };

  const resolveOnlineResult = (state: TowerDefenseState): void => {
    const remote = getRemoteProgress() as TowerRemoteState | undefined;
    const finished = getRemoteFinished();
    if (remote === undefined || finished === undefined) {
      setPagePhase("awaiting");
      return;
    }
    const elapsed = performance.now();
    const verdict = resolveTowerVerdict(
      { score: state.score, elapsedMs: elapsed },
      { score: remote.score, elapsedMs: finished.finishMs ?? elapsed },
    );
    setOnlineResult({
      verdict,
      myScore: state.score,
      theirScore: remote.score,
    });
    setPagePhase("result");
  };

  const hostRematch = (match: LanMatch): void => {
    const playable = lanTowerDefense;
    const start = playable.buildStart({
      lang:
        typeof match.start.params["lang"] === "string"
          ? match.start.params["lang"]
          : "english",
    });
    armLanMatch({ role: "host", peerName: getLanPeerName() ?? "P2", start });
    if (getLanMatch() === undefined) return;
    sendLanMatchStart(start, getLanPeerName() ?? "P1");
    void navigate({ to: playable.route });
  };

  const clientAskRematch = (): void => {
    if (rematchSent()) return;
    setRematchSent(true);
    sendLanMatchRematch();
  };

  //the match lifecycle: the peer's progress renders, the horn resolves,
  //the rematch re-arms (the same seeding as lane-defense)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "tower-defense") return;
    void (async () => {
      stopTimers();
      let pickable: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${
            typeof match.start.params["lang"] === "string"
              ? match.start.params["lang"]
              : "english"
          }.json`,
        );
        pickable = data.words;
      } catch {
        //the offline fallback list
      }
      const spawner = towerLanSpawner(
        pickable,
        typeof match.start.seed === "number" ? match.start.seed : 1,
      );
      engine = createTowerDefenseEngine({
        spawnWave: (wave) => spawner.spawnWave(wave),
      });
      setRemoteState(undefined);
      setOnlineResult(undefined);
      setRematchSent(false);
      myFinishSent = false;
      lastSentScore = -1;
      lastSentHp = -1;
      setEngineState(engine.state());
      setPagePhase("playing");
      startTickLoop();
    })();
  });

  createEffect(() => {
    const raw = getLanRawMessage();
    if (raw === undefined) return;
    if (
      raw.message["type"] === "tower-progress" &&
      engine !== undefined &&
      lanMode()
    ) {
      const decoded = lanTowerDefense.decodeProgress(
        raw.message["progress"],
      );
      if (decoded !== undefined) setRemoteState(decoded as TowerRemoteState);
      return;
    }
    if (raw.message["type"] === "tower-left") {
      endLanMatchVoided();
      return;
    }
    //the rematch ask: the host re-arms, the client marks the ask
    if (
      raw.message["type"] === "rematch" &&
      getLanRole() === "host" &&
      lanMode()
    ) {
      const match = getLanMatch();
      if (match !== undefined) hostRematch(match);
    }
  });

  createEffect(() => {
    const remote = getRemoteFinished();
    if (remote === undefined) return;
    if (getLanMatch()?.gameId !== "tower-defense") return;
    if (pagePhase() !== "playing") return;
    const state = engine?.state();
    if (state === undefined) return;
    myFinishSent = myFinishSent || state.phase === "done";
    if (myFinishSent && state.phase === "done") {
      resolveOnlineResult(state);
      return;
    }
    //the peer finished first: our run keeps going to the natural end
    void remote;
  });

  const endLanMatchVoided = (): void => {
    stopTimers();
    clearLanMatch();
    setPagePhase("result");
    setMessage("the opponent left — match void, nothing was recorded");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after === undefined) return;
    if (before !== undefined) {
      if (after.kills > before.kills) {
        void playClick();
      }
    }
    setEngineState(after);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const peerName = (): string => getLanPeerName() ?? "the opponent";

  const Menu = (): JSXElement => {
    const bests = getTowerDefenseBests();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {bests.bestScore}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {bests.bestWave}
            </div>
            <div class="text-xs text-sub">best wave</div>
          </div>
        </div>
        <Button
          text="defend the tower"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          enemies march down carrying words — type the closest one&apos;s word
          to destroy it before it reaches the tower. every 3rd wave
          carries a tank.
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-chess-rook" }} text="tower defense" />
        <p class="text-sub">
          the vertical sibling of lane defense — enemies descend on five
          columns, the tower holds the bottom line.
        </p>
      </section>
      <Show
        when={pagePhase() !== "menu"}
        fallback={
          <Show when={isLanConnected()} fallback={<Menu />}>
            <Menu />
          </Show>
        }
      >
        <div class="grid gap-4">
          <Show when={lanMode()}>
            <div class="grid grid-cols-3 gap-2">
              <div class="rounded bg-bg p-2 text-center">
                <div class="text-lg font-bold text-main tabular-nums">
                  {engineState()?.score ?? 0}
                </div>
                <div class="text-xs text-sub">you</div>
              </div>
              <div class="rounded bg-bg p-2 text-center">
                <div class="text-lg font-bold text-main tabular-nums">
                  {remoteState()?.score ?? 0}
                </div>
                <div class="text-xs text-sub">{peerName()}</div>
              </div>
              <div class="rounded bg-bg p-2 text-center">
                <div class="text-lg font-bold text-main tabular-nums">
                  ❤ {engineState()?.towerHp ?? 0}
                </div>
                <div class="text-xs text-sub">your tower</div>
              </div>
            </div>
          </Show>
          <div
            class="relative h-[86vh] w-full overflow-hidden rounded bg-bg"
            aria-label="tower defense arena"
          >
            <For each={engineState()?.enemies ?? []}>
              {(enemy) => (
                <div
                  class="absolute w-[16vw] rounded bg-sub-alt p-1 text-center text-xs"
                  style={{
                    left: `${enemy.lane * 20 + 2}vw`,
                    top: `${enemy.y}vh`,
                  }}
                >
                  <span class="font-bold text-main">{enemy.word}</span>
                </div>
              )}
            </For>
            <div
              class="absolute w-full border-t-2 border-dashed border-error"
              style={{ top: `${BALANCE.towerYVh}vh` }}
            ></div>
          </div>
          <Show when={message() !== undefined}>
            <div class="text-center text-sm text-error">{message()}</div>
          </Show>
        </div>
        <Show when={pagePhase() === "result"}>
          <section
            class="grid gap-4 rounded bg-sub-alt p-4"
            data-testid="tower-result"
          >
            <Show
              when={onlineResult() !== undefined}
              fallback={
                <div class="text-center text-lg font-bold text-main">
                  the tower fell at wave {engineState()?.wave ?? 1} — score{" "}
                  {engineState()?.score ?? 0}
                </div>
              }
            >
              <div class="text-center text-lg font-bold text-main">
                {onlineResult()?.verdict === "won"
                  ? "victory!"
                  : onlineResult()?.verdict === "draw"
                    ? "a draw"
                    : "defeat"}{" "}
                — {onlineResult()?.myScore} vs {onlineResult()?.theirScore}
              </div>
            </Show>
            <Show when={lanMode()}>
              <Show
                when={getLanRole() === "host"}
                fallback={
                  <Button
                    text="ask for a rematch"
                    fa={{ icon: "fa-redo" }}
                    class="w-full"
                    disabled={rematchSent()}
                    onClick={clientAskRematch}
                  />
                }
              >
                <Button
                  text="host a rematch"
                  fa={{ icon: "fa-redo" }}
                  class="w-full"
                  onClick={() => {
                    const match = getLanMatch();
                    if (match !== undefined) hostRematch(match);
                  }}
                />
              </Show>
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  );
}
