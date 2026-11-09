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
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { cachedFetchJson } from "../../../../utils/json-data";
import { BALANCE } from "../../../../utils/lane-defense/balance";
import {
  createLaneDefenseEngine,
  type LaneDefenseEngine,
  type LaneDefenseState,
} from "../../../../utils/lane-defense/engine";
import {
  lanLaneDefense,
  laneLanSpawner,
  resolveLaneVerdict,
  type LaneRemoteState,
  type LaneVerdict,
} from "../../../../utils/lane-defense/lan";
import { createWaveSpawner } from "../../../../utils/lane-defense/spawner";
import {
  getLaneDefenseBestScore,
  getLaneDefenseBestWave,
  getLaneDefenseZoneBest,
  recordLaneDefenseRun,
} from "../../../../utils/lane-defense/store";
import { groupsForLanguage } from "../../../../utils/learn-stats";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 50;
const FALLBACK_WORDS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "house",
  "garden",
  "water",
  "music",
  "defender",
  "guardian",
];
const LANE_HEIGHT_VH = 13; //five strips inside the 70vh arena

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both runs have ended (or the peer gave up) */
type LaneOnlineResult = {
  verdict: LaneVerdict;
  myScore: number;
  myWallHp: number;
  myTimeMs: number;
  theirScore: number;
  theirWallHp: number;
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
 * Lane Defense (idea G9, phase 2): five lanes of enemies walking toward
 * the wall — type the targeted enemy's word to destroy it before it
 * breaches. The educational preset: pick a keyboard zone and only words
 * built from those letters spawn (learn-groups, read-only). The pure
 * engine owns the rules; this page owns the zone picker, the word pool
 * and the timers.
 *
 * Online (online wave, phase 34): the armed match IS the start — both
 * machines defend the identical seeded waves (no zone letters: the
 * learn-groups vary per machine) and race to the death: the higher score
 * wins, the longer survival breaks the tie. The wall falling sends the
 * finish; the verdict resolves when both are in (or the peer gave up — a
 * run without a finish loses). Nothing online is recorded.
 */
export function LaneDefensePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    LaneDefenseState | undefined
  >(undefined);
  /** the educational preset defaults to the FIRST group (progressive,
   * keybr-style); "free" is one click away */
  const [zone, setZone] = createSignal<string>(
    groupsForLanguage(Config.language)[0] ?? "",
  );
  const [flash, setFlash] = createSignal<
    { lane: number; x: number } | undefined
  >(undefined);
  const [breach, setBreach] = createSignal<boolean>(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer defends the same seeded waves
  const [remoteState, setRemoteState] = createSignal<
    LaneRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    LaneOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: LaneDefenseEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let breachTimer: ReturnType<typeof setTimeout> | undefined;
  let runStart = 0;
  let myFinish: { score: number; elapsedMs: number } | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentWallHp = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    if (breachTimer !== undefined) clearTimeout(breachTimer);
    tickTimer = undefined;
    flashTimer = undefined;
    breachTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-race (header back, route change) tells the peer the run
  //was abandoned — a run without a finish loses, they can never be beaten
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "lane-defense") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanLaneDefense.encodeProgress({
          score: state?.score ?? 0,
          wallHp: state?.wallHp ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "lane-defense";

  const zones = (): string[] => groupsForLanguage(Config.language);

  const applyState = (next: LaneDefenseState): void => {
    const previous = engineState();
    if (previous !== undefined) {
      for (const enemy of previous.enemies) {
        if (next.enemies.some((e) => e.id === enemy.id)) continue;
        //an enemy vanished: a kill (flash at its lane) or a breach (the
        //wall takes it — red pulse on the wall column)
        if (next.wallHp < previous.wallHp) {
          setBreach(true);
          if (breachTimer !== undefined) clearTimeout(breachTimer);
          breachTimer = setTimeout(() => setBreach(false), 300);
          void playError();
        } else {
          setFlash({ lane: enemy.lane, x: Math.max(enemy.x, BALANCE.wallXVw) });
          if (flashTimer !== undefined) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => setFlash(undefined), 120);
          void playClick();
        }
      }
    }
    setEngineState(next);
  };

  const startRun = async (): Promise<void> => {
    if (lanMode()) return; //online: the match effect owns the start
    await startOfflineRun();
  };

  /** the offline run: the random waves (zone-filtered), the local records */
  const startOfflineRun = async (): Promise<void> => {
    setMessage(undefined);
    let words: string[] = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      words = data.words;
    } catch {
      //offline fallback list (the zone spawner filters/normalizes anyway)
    }
    const spawner = createWaveSpawner({
      words,
      rng: Math.random,
      zoneLetters: zone() === "" ? undefined : zone(),
    });
    engine = createLaneDefenseEngine({ spawnWave: spawner.spawnWave });
    setEngineState(engine.state());
    setPagePhase("playing");
    startTickLoop();
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    const state = engine?.state();
    const myScore = state?.score ?? 0;
    const sinceStart = Date.now() - runStart;
    const myTimeMs = myFinish?.elapsedMs ?? sinceStart;
    //a peer finish of null = they abandoned mid-run: a run without a
    //finish loses, the survivor takes the win whenever their run ends
    const abandoned =
      finished.finishMs === null || finished.finishMs === undefined;
    const theirScore = remoteState()?.score ?? 0;
    setOnlineResult({
      verdict: abandoned
        ? "won"
        : resolveLaneVerdict(
            { score: myScore, elapsedMs: myTimeMs },
            {
              score: theirScore,
              elapsedMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
            },
          ),
      myScore,
      myWallHp: state?.wallHp ?? 0,
      myTimeMs,
      theirScore,
      theirWallHp: remoteState()?.wallHp ?? 0,
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

  //an armed (or re-armed) lane match IS the online start: the seed
  //builds the identical waves (words, speeds, lanes, tanks — no zone
  //letters: the learn-groups vary per machine)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "lane-defense") return;
    void (async () => {
      const matchLang = match.start.params["lang"];
      let words: string[] = FALLBACK_WORDS;
      try {
        const data = await cachedFetchJson<{ words: string[] }>(
          `/languages/${
            typeof matchLang === "string" && matchLang.length > 0
              ? matchLang
              : "english"
          }.json`,
        );
        words = data.words;
      } catch {
        //the offline fallback list (the spawner filters/normalizes anyway)
      }
      const seed = match.start.seed ?? 1;
      setOnlineResult(undefined);
      setRematchSent(false);
      setRemoteState(undefined);
      setVoidMessage(undefined);
      myFinish = undefined;
      myFinishSent = false;
      lastSentScore = -1;
      lastSentWallHp = -1;
      runStart = Date.now();
      engine = createLaneDefenseEngine({
        spawnWave: laneLanSpawner(words, seed).spawnWave,
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
      //online: relay the score/wall when they moved
      if (
        lanMode() &&
        (state.score !== lastSentScore || state.wallHp !== lastSentWallHp)
      ) {
        lastSentScore = state.score;
        lastSentWallHp = state.wallHp;
        sendLanMatchProgress(
          lanLaneDefense.encodeProgress({
            score: state.score,
            wallHp: state.wallHp,
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
      //the wall has fallen — the finish ships with the final numbers
      if (!myFinishSent) {
        myFinishSent = true;
        myFinish = {
          score: state?.score ?? 0,
          elapsedMs: Date.now() - runStart,
        };
        sendLanMatchProgress(
          lanLaneDefense.encodeProgress({
            score: myFinish.score,
            wallHp: state?.wallHp ?? 0,
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
      recordLaneDefenseRun({
        score: state.result.score,
        wave: state.result.wave,
        maxCombo: state.result.maxCombo,
        kills: state.result.kills,
        zone: zone(),
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return; //Backspace/Enter: inert in G9
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
    setRemoteState(progress.state as LaneRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "lane-defense") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the run voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "lane-defense") return;
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
        <div class="text-sub">keyboard zone (words spawn from its letters)</div>
        <div class="flex flex-wrap gap-2">
          <Button
            text="free"
            class={cn("w-auto", zone() === "" && "bg-main text-bg")}
            onClick={() => setZone("")}
          />
          <For each={zones()}>
            {(group) => (
              <Button
                text={group}
                class={cn("w-auto", zone() === group && "bg-main text-bg")}
                onClick={() => setZone(group)}
              />
            )}
          </For>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getLaneDefenseBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getLaneDefenseBestWave()}
            </div>
            <div class="text-xs text-sub">best wave</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getLaneDefenseZoneBest(zone())}
            </div>
            <div class="text-xs text-sub">zone best</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type the targeted enemy&apos;s word before it reaches the wall — a
          wrong key breaks the combo; each breach costs wall hp; the wall
          repairs +2 per cleared wave.
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
        style={{ height: "70vh" }}
        aria-label="lane defense arena"
      >
        <For each={[0, 1, 2, 3, 4]}>
          {(lane) => (
            <div
              class="absolute w-full border-b border-sub"
              style={{
                top: `${lane * LANE_HEIGHT_VH}vh`,
                height: `${LANE_HEIGHT_VH}vh`,
              }}
            ></div>
          )}
        </For>
        <div
          class={cn(
            "absolute top-0 h-full w-[1.2vw] rounded",
            breach() ? "bg-error" : "bg-main",
          )}
          style={{ left: `${BALANCE.wallXVw}vw` }}
          data-testid="ld-wall"
        ></div>
        <For each={engineState()?.enemies ?? []}>
          {(enemy) => (
            <div
              class={cn(
                "absolute grid place-items-center rounded border-2 bg-bg font-bold",
                enemy.typed > 0 ? "border-main" : "border-sub",
                enemy.isTank && "border-error",
              )}
              style={{
                left: `${enemy.x}vw`,
                top: `${enemy.lane * LANE_HEIGHT_VH + 1}vh`,
                "min-width": `${2 + enemy.word.length * 0.75}rem`,
                padding: "0.15rem 0.4rem",
              }}
              dir="auto"
              data-testid="ld-enemy"
            >
              <span class="text-main">{enemy.word.slice(0, enemy.typed)}</span>
              <span>{enemy.word.slice(enemy.typed)}</span>
            </div>
          )}
        </For>
        <Show when={flash() !== undefined}>
          <div
            class="absolute h-[2px] bg-main opacity-70"
            style={{
              left: `${BALANCE.wallXVw}vw`,
              top: `${(flash()?.lane ?? 0) * LANE_HEIGHT_VH + LANE_HEIGHT_VH / 2}vh`,
              width: `${Math.max(0, (flash()?.x ?? 0) - BALANCE.wallXVw)}vw`,
            }}
            data-testid="ld-flash"
          ></div>
        </Show>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="ld-awaiting">
          the wall fell at {((myFinish?.elapsedMs ?? 0) / 1000).toFixed(1)}s ·
          score {myFinish?.score ?? 0} — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): LaneOnlineResult | undefined => onlineResult();
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
          data-testid="ld-verdict"
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
              {online()?.myScore ?? 0} score · wall {online()?.myWallHp ?? 0} ·{" "}
              {((online()?.myTimeMs ?? 0) / 1000).toFixed(1)}s
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirScore ?? 0} score ·{" "}
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
        <div class="text-3xl font-bold text-error">the wall has fallen</div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.wave ?? 0}
            </div>
            <div class="text-xs text-sub">wave reached</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.kills ?? 0}
            </div>
            <div class="text-xs text-sub">kills</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getLaneDefenseBestScore()} · best wave{" "}
          {getLaneDefenseBestWave()}
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
        <H2 fa={{ icon: "fa-shield-alt" }} text="lane defense" />
        <p class="text-sub">
          five lanes of walking words — destroy them before they reach the wall.
          Pick a keyboard zone and only its letters spawn.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="ld-online-vs"
        >
          <i class="fas fa-shield-alt"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same waves, the higher score wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="ld-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.score ?? 0} score · wall{" "}
              {remoteState()?.wallHp ?? 0}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.score ?? 0} score · wall{" "}
              {engineState()?.wallHp ?? BALANCE.wallStartHp}
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
          <div class="grid grid-cols-5 gap-2" aria-label="lane defense hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell label="wave" value={String(engineState()?.wave ?? 1)} />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="wall"
              value={String(engineState()?.wallHp ?? BALANCE.wallStartHp)}
            />
            <HudCell label="zone" value={zone() === "" ? "free" : zone()} />
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
