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
import {
  createLetterStrikeEngine,
  type LetterStrikeEngine,
  type LetterStrikeState,
} from "../../../../utils/letter-strike/engine";
import {
  lanStrike,
  resolveStrikeVerdict,
  strikeLanSpawner,
  type StrikeRemoteState,
  type StrikeVerdict,
} from "../../../../utils/letter-strike/lan";
import { createWaveSpawner } from "../../../../utils/letter-strike/spawner";
import {
  getLetterStrikeBestScore,
  getLetterStrikeBestWave,
  recordLetterStrikeRun,
} from "../../../../utils/letter-strike/store";
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
  "planet",
  "orange",
];
const SLOTS = 8;

type PagePhase = "menu" | "playing" | "awaiting" | "result";

/** the online verdict once both runs have ended (or the peer gave up) */
type StrikeOnlineResult = {
  verdict: StrikeVerdict;
  myScore: number;
  myLives: number;
  myTimeMs: number;
  theirScore: number;
  theirLives: number;
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
 * Letter Strike (idea G8, phase 2): ZType-lite — ships fall with words;
 * the first letter locks the nearest ship, correct letters are shots,
 * completing a word destroys the ship, the floor costs a life. Space fires
 * the EMP; Escape is swallowed in the capture phase so the commandline can
 * never open mid-run (doc G8 §۵ — page-scoped, no INF-1). The pure engine
 * owns the rules; this page owns the word pool, the slots and the timers.
 *
 * Online (online wave, phase 32): the armed match IS the start — both
 * machines build the identical seeded waves (the spawner's rng derives
 * from the shared seed) and race to the death: the higher score wins, the
 * longer survival breaks the tie. Losing the last life sends the finish;
 * the verdict resolves when both are in (or the peer gave up — a run
 * without a finish loses). Nothing online is recorded.
 */
export function LetterStrikePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<
    LetterStrikeState | undefined
  >(undefined);
  const [laser, setLaser] = createSignal<
    { slot: number; y: number } | undefined
  >(undefined);
  const [explosion, setExplosion] = createSignal<
    { slot: number; y: number } | undefined
  >(undefined);
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //online (LAN) state — the peer races the same seeded waves
  const [remoteState, setRemoteState] = createSignal<
    StrikeRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    StrikeOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: LetterStrikeEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let laserTimer: ReturnType<typeof setTimeout> | undefined;
  let explosionTimer: ReturnType<typeof setTimeout> | undefined;
  const slotById = new Map<number, number>();
  const positions = new Map<number, { slot: number; y: number }>();
  let lastSlot = -1;
  let runStart = 0;
  let myFinish: { score: number; elapsedMs: number } | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentLives = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (laserTimer !== undefined) clearTimeout(laserTimer);
    if (explosionTimer !== undefined) clearTimeout(explosionTimer);
    tickTimer = undefined;
    laserTimer = undefined;
    explosionTimer = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-race (header back, route change) tells the peer the run
  //was abandoned — a run without a finish loses, they can never be beaten
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "letter-strike") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanStrike.encodeProgress({
          score: state?.score ?? 0,
          lives: state?.lives ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "letter-strike";

  const slotFor = (id: number): number => {
    let slot = slotById.get(id);
    if (slot === undefined) {
      const options = [...Array(SLOTS).keys()].filter((s) => s !== lastSlot);
      slot = options[Math.floor(Math.random() * options.length)] ?? 0;
      slotById.set(id, slot);
      lastSlot = slot;
    }
    return slot;
  };

  /** diffs the fresh state: shot lasers, explosion rings, slot bookkeeping */
  const applyState = (next: LetterStrikeState): void => {
    const previous = engineState();
    if (previous !== undefined) {
      for (const ship of previous.ships) {
        if (next.ships.some((s) => s.id === ship.id)) continue;
        //a ship vanished: destroyed (an escape also removes it — the ring
        //reads as the ship going down either way)
        const pos = positions.get(ship.id);
        if (pos !== undefined) {
          setExplosion({ slot: pos.slot, y: Math.min(pos.y, 92) });
          if (explosionTimer !== undefined) clearTimeout(explosionTimer);
          explosionTimer = setTimeout(() => setExplosion(undefined), 250);
        }
        positions.delete(ship.id);
        slotById.delete(ship.id);
      }
    }
    for (const ship of next.ships) {
      positions.set(ship.id, { slot: slotFor(ship.id), y: ship.y });
    }
    setEngineState(next);
  };

  const startRun = async (): Promise<void> => {
    if (lanMode()) return; //online: the match effect owns the start
    await startOfflineRun();
  };

  /** the offline run: the random waves, the local records */
  const startOfflineRun = async (): Promise<void> => {
    setMessage(undefined);
    slotById.clear();
    positions.clear();
    lastSlot = -1;
    let words: string[] = FALLBACK_WORDS;
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      words = data.words;
    } catch {
      //offline fallback list (the spawner filters/normalizes anyway)
    }
    const spawner = createWaveSpawner({ words, rng: Math.random });
    engine = createLetterStrikeEngine({ spawnWave: spawner.spawnWave });
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
        : resolveStrikeVerdict(
            { score: myScore, elapsedMs: myTimeMs },
            {
              score: theirScore,
              elapsedMs: finished.finishMs ?? Number.MAX_SAFE_INTEGER,
            },
          ),
      myScore,
      myLives: state?.lives ?? 0,
      myTimeMs,
      theirScore,
      theirLives: remoteState()?.lives ?? 0,
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

  //an armed (or re-armed) strike match IS the online start: the seed
  //builds the identical waves (ships, speeds, bosses — in the same order)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "letter-strike") return;
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
      lastSentLives = -1;
      runStart = Date.now();
      slotById.clear();
      positions.clear();
      lastSlot = -1;
      engine = createLetterStrikeEngine({
        spawnWave: strikeLanSpawner(words, seed).spawnWave,
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
      //online: relay the score/lives when they moved
      if (
        lanMode() &&
        (state.score !== lastSentScore || state.lives !== lastSentLives)
      ) {
        lastSentScore = state.score;
        lastSentLives = state.lives;
        sendLanMatchProgress(
          lanStrike.encodeProgress({ score: state.score, lives: state.lives }),
        );
      }
      if (state.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //the last life is gone — the finish ships with the final numbers
      if (!myFinishSent) {
        myFinishSent = true;
        myFinish = {
          score: state?.score ?? 0,
          elapsedMs: Date.now() - runStart,
        };
        sendLanMatchProgress(
          lanStrike.encodeProgress({
            score: myFinish.score,
            lives: state?.lives ?? 0,
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
      recordLetterStrikeRun({
        score: state.result.score,
        wave: state.result.wave,
        maxCombo: state.result.maxCombo,
        shipsDestroyed: state.result.shipsDestroyed,
      });
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    //Space = EMP: swallowed so a focused button can never be re-clicked
    if (event.key === " ") {
      event.preventDefault();
      const before = engine?.state();
      const after = engine?.feedKey(" ");
      if (after !== undefined) applyState(after);
      if ((before?.ships.length ?? 0) > (after?.ships.length ?? 0)) {
        void playClick();
      }
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      const after = engine?.feedKey("Backspace");
      if (after !== undefined) applyState(after);
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(latinCharFromEvent(event.key, event.code));
    if (after === undefined) return;
    //a shot: the locked ship's prefix grew — flash the laser line
    const lockedBefore = before?.ships.find(
      (s) => s.id === before.lockedShipId,
    );
    const lockedAfter = after.ships.find((s) => s.id === after.lockedShipId);
    const shotFired =
      (lockedAfter !== undefined &&
        (lockedBefore === undefined ||
          lockedAfter.typed > lockedBefore.typed)) ||
      ((before?.ships.length ?? 0) > after.ships.length &&
        before?.lockedShipId !== undefined);
    if (shotFired) {
      const pos =
        lockedAfter !== undefined
          ? { slot: slotFor(lockedAfter.id), y: lockedAfter.y }
          : undefined;
      if (pos !== undefined) {
        setLaser(pos);
        if (laserTimer !== undefined) clearTimeout(laserTimer);
        laserTimer = setTimeout(() => setLaser(undefined), 100);
      }
      void playClick();
    } else {
      void playError();
    }
    applyState(after);
  };

  //the Escape swallow must run in the CAPTURE phase: the commandline's
  //bubble listener on the document can then never see the key mid-run
  const swallowEscape = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing") return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keydown", swallowEscape, { capture: true });
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keydown", swallowEscape, { capture: true });
    });
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as StrikeRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "letter-strike") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the run voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "letter-strike") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("menu");
  });

  const backToMenu = (): void => {
    engine = undefined;
    setPagePhase("menu");
  };

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
              {getLetterStrikeBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getLetterStrikeBestWave()}
            </div>
            <div class="text-xs text-sub">best wave</div>
          </div>
        </div>
        <Button
          text="start run"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void startRun()}
        />
        <div class="text-xs text-sub">
          type a ship&apos;s first letter to lock it — finish the word to
          destroy it. Backspace unwinds the lock; Space fires the EMP when
          charged; Escape is safe mid-run.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    //KI-34 lesson: the signal must be read INLINE in JSX — a local const
    //would freeze the arena on the mount-time snapshot
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "70vh" }}
        aria-label="letter strike arena"
      >
        <div class="absolute bottom-0 w-full border-t-2 border-dashed border-error"></div>
        <div class="absolute bottom-1 w-full text-center text-[0.65rem] text-error">
          the floor
        </div>
        <For each={engineState()?.ships ?? []}>
          {(ship) => {
            const slot = slotFor(ship.id);
            const locked = engineState()?.lockedShipId === ship.id;
            return (
              <div
                class={cn(
                  "absolute grid place-items-center rounded border-2 bg-bg font-bold",
                  locked ? "border-main" : "border-sub",
                  ship.isBoss && "border-error",
                )}
                style={{
                  top: `${ship.y}vh`,
                  left: `${4 + slot * 11.5}%`,
                  "min-width": `${2 + ship.word.length * 0.75}rem`,
                  padding: "0.15rem 0.4rem",
                }}
                dir="auto"
                data-testid="ls-ship"
              >
                <span class="text-main">{ship.word.slice(0, ship.typed)}</span>
                <span>{ship.word.slice(ship.typed)}</span>
                <Show when={ship.isBoss}>
                  <span class="text-[0.6rem] text-error">
                    {"✦".repeat(ship.armorHp)}
                  </span>
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={laser() !== undefined}>
          <div
            class="absolute w-[2px] bg-main opacity-70"
            style={{
              left: `${4 + (laser()?.slot ?? 0) * 11.5 + 1}%`,
              top: `${laser()?.y ?? 0}vh`,
              height: `${100 - (laser()?.y ?? 0)}vh`,
            }}
            data-testid="ls-laser"
          ></div>
        </Show>
        <Show when={explosion() !== undefined}>
          <div
            class="absolute grid place-items-center rounded-full border-4 border-error"
            style={{
              left: `${4 + (explosion()?.slot ?? 0) * 11.5}%`,
              top: `${explosion()?.y ?? 0}vh`,
              width: "3rem",
              height: "3rem",
            }}
            data-testid="ls-explosion"
          ></div>
        </Show>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="ls-awaiting">
          last ship fell at {((myFinish?.elapsedMs ?? 0) / 1000).toFixed(1)}s ·
          score {myFinish?.score ?? 0} — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): StrikeOnlineResult | undefined => onlineResult();
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
          data-testid="ls-verdict"
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
              {online()?.myScore ?? 0} score · {online()?.myLives ?? 0}{" "}
              {"❤".repeat(online()?.myLives ?? 0) || "—"} ·{" "}
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
        <div class="text-3xl font-bold text-error">run over</div>
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
              {result?.shipsDestroyed ?? 0}
            </div>
            <div class="text-xs text-sub">destroyed</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getLetterStrikeBestScore()} · best wave{" "}
          {getLetterStrikeBestWave()}
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
            onClick={() => backToMenu()}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-rocket" }} text="letter strike" />
        <p class="text-sub">
          ZType-lite: ships fall with words — lock, shoot, destroy. Waves step
          up; every 4th wave is a two-pass boss; the EMP clears the screen.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="ls-online-vs"
        >
          <i class="fas fa-rocket"></i> online vs{" "}
          {getLanMatch()?.peerName ?? "…"} — same waves, the higher score wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="ls-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.score ?? 0} score ·{" "}
              {"❤".repeat(remoteState()?.lives ?? 0) || "—"}
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.score ?? 0} score ·{" "}
              {"❤".repeat(engineState()?.lives ?? 0) || "—"}
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
          <div class="grid grid-cols-5 gap-2" aria-label="letter strike hud">
            <HudCell label="score" value={String(engineState()?.score ?? 0)} />
            <HudCell label="wave" value={String(engineState()?.wave ?? 1)} />
            <HudCell label="combo" value={`x${engineState()?.combo ?? 0}`} />
            <HudCell
              label="lives"
              value={"❤".repeat(engineState()?.lives ?? 0) || "—"}
            />
            <div class="rounded bg-bg p-2 text-center">
              <div
                class={cn(
                  "text-xl font-bold",
                  engineState()?.empCharged === true ? "text-main" : "text-sub",
                )}
                data-testid="ls-emp"
              >
                ⚡
              </div>
              <div class="text-xs text-sub">EMP</div>
            </div>
          </div>
          <Arena />
        </Show>
      </Show>
    </div>
  );
}
