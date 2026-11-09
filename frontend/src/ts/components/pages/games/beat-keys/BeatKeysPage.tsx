import {
  For,
  JSXElement,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

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
import { BALANCE } from "../../../../utils/beat-keys/balance";
import {
  generateChart,
  type BeatChart,
} from "../../../../utils/beat-keys/chart";
import {
  createBeatKeysEngine,
  type BeatGrade,
  type BeatKeysEngine,
  type BeatKeysState,
} from "../../../../utils/beat-keys/engine";
import {
  beatLanChart,
  lanBeatKeys,
  resolveBeatVerdict,
  type BeatRemoteState,
  type BeatVerdict,
} from "../../../../utils/beat-keys/lan";
import {
  createMetronome,
  type Metronome,
} from "../../../../utils/beat-keys/metronome";
import {
  getBeatBest,
  getBeatKeysHistory,
  getBeatOffsetMs,
  recordBeatKeysRun,
  setBeatOffsetMs,
} from "../../../../utils/beat-keys/store";
import { cn } from "../../../../utils/cn";
import { latinCharFromEvent } from "../../../../utils/games/latin-input";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 16;
/** the hit line's vertical position (% of the arena height) */
const HIT_PCT = 86;
/** the calibration taps (doc §۰.۴: «۸ taps on the beat» → the average) */
const CALIBRATION_TAPS = 8;

type Difficulty = keyof typeof BALANCE.bpmByDifficulty;

type PagePhase = "setup" | "playing" | "awaiting" | "result";

/** the online verdict once both charts have closed (or the peer gave up) */
type BeatOnlineResult = {
  verdict: BeatVerdict;
  myScore: number;
  myAcc: number;
  myMaxCombo: number;
  theirScore: number;
  theirAcc: number;
  theirMaxCombo: number;
  theirTimeMs: number | null;
};

/** the WebAudio subset the page touches, with a silent test fallback */
type PageAudioCtx = {
  currentTime: number;
  destination: unknown;
  createOscillator: () => {
    type: string;
    frequency: { setValueAtTime(value: number, when?: number): void };
    connect: (destination: unknown) => void;
    start: (when?: number) => void;
    stop: (when?: number) => void;
  };
  createGain: () => {
    gain: {
      setValueAtTime(value: number, when?: number): void;
      exponentialRampToValueAtTime(value: number, when?: number): void;
    };
    connect: (destination: unknown) => void;
  };
};

let audioCtxInstance: PageAudioCtx | undefined;

/** the lazy audioCtx singleton (doc §۱); jsdom/tests get a silent stand-in
 * whose clock is performance.now — the deterministic test clock */
function getAudioCtx(): PageAudioCtx {
  if (audioCtxInstance !== undefined) return audioCtxInstance;
  const ctor = (
    window as unknown as {
      AudioContext?: new () => PageAudioCtx;
      webkitAudioContext?: new () => PageAudioCtx;
    }
  ).AudioContext;
  if (ctor !== undefined) {
    audioCtxInstance = new ctor();
    return audioCtxInstance;
  }
  const silentOsc = () => ({
    type: "",
    frequency: { setValueAtTime: () => undefined },
    connect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
  });
  const silentGain = () => ({
    gain: {
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    },
    connect: () => undefined,
  });
  audioCtxInstance = {
    get currentTime(): number {
      return performance.now() / 1000;
    },
    destination: {},
    createOscillator: silentOsc,
    createGain: silentGain,
  };
  return audioCtxInstance;
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

const GRADE_LABEL: Record<BeatGrade, string> = {
  perfect: "perfect",
  good: "good",
  poor: "poor",
  miss: "MISS",
};

/**
 * Beat Keys (idea G21, phase 2): a rhythm lane layout — notes ride down
 * 4 lanes on the beat and the player types each lane's key exactly when
 * the note crosses the hit line. The audio clock (audioCtx.currentTime)
 * drives the judged timeline; a metronome oscillator click keeps the
 * beat (zero audio assets). The calibration maps 8 on-beat taps to the
 * user's offset. Switching tabs voids the round without recording.
 *
 * Online (online wave, phase 42): the armed match IS the start — both
 * machines play the identical seeded chart at the match difficulty's
 * BPM. The chart itself is the shared clock (its last note ends both
 * runs at the same musical moment) so the SCORE decides: the verdict
 * resolves when both are in — the higher score wins. Nothing online is
 * recorded.
 */
export function BeatKeysPage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("setup");
  const [difficulty, setDifficulty] = createSignal<Difficulty>("normal");
  const [engineState, setEngineState] = createSignal<BeatKeysState | undefined>(
    undefined,
  );
  /** the lane flash + grade popup (one judged note at a time) */
  const [flash, setFlash] = createSignal<
    { lane: number; grade: BeatGrade } | undefined
  >(undefined);
  const [calibrating, setCalibrating] = createSignal(false);
  const [taps, setTaps] = createSignal<number[]>([]);
  const [voided, setVoided] = createSignal(false);
  const [newRecord, setNewRecord] = createSignal(false);
  //online (LAN) state — the peer plays the same seeded chart
  const [remoteState, setRemoteState] = createSignal<
    BeatRemoteState | undefined
  >(undefined);
  const [onlineResult, setOnlineResult] = createSignal<
    BeatOnlineResult | undefined
  >(undefined);
  const [rematchSent, setRematchSent] = createSignal(false);
  const [voidMessage, setVoidMessage] = createSignal<string | undefined>(
    undefined,
  );

  let engine: BeatKeysEngine | undefined;
  let chart: BeatChart | undefined;
  let metronome: Metronome | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let runStart = 0;
  let myFinish: { score: number; elapsedMs: number } | undefined;
  let myFinishSent = false;
  let lastSentScore = -1;
  let lastSentAcc = -1;
  let lastSentCombo = -1;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    tickTimer = undefined;
    flashTimer = undefined;
    metronome?.stop();
    metronome = undefined;
  };

  onCleanup(stopTimers);

  //leaving mid-chart (header back, route change) tells the peer the run
  //was abandoned — a run without a finish loses, they can never be beaten
  onCleanup(() => {
    if (getLanMatch()?.gameId !== "beat-keys") return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    if (!myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanBeatKeys.encodeProgress({
          score: state?.score ?? 0,
          acc: state?.acc ?? 0,
          maxCombo: state?.maxCombo ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
    }
    clearLanMatch();
  });

  const lanMode = (): boolean => getLanMatch()?.gameId === "beat-keys";

  const difficulties = (): Difficulty[] =>
    Object.keys(BALANCE.bpmByDifficulty) as Difficulty[];

  const bpmOf = (d: Difficulty): number => BALANCE.bpmByDifficulty[d];

  const startRun = (): void => {
    if (lanMode()) return; //online: the match effect owns the start
    startOfflineRun();
  };

  /** the offline run: the random chart, the local records */
  const startOfflineRun = (): void => {
    setVoided(false);
    setNewRecord(false);
    const ctx = getAudioCtx(); //created inside the click (user gesture)
    chart = generateChart({ bpm: bpmOf(difficulty()), rng: Math.random });
    engine = createBeatKeysEngine({
      chart,
      now: () => ctx.currentTime * 1000,
      offsetMs: getBeatOffsetMs(),
    });
    metronome = createMetronome({ audioCtx: ctx, bpm: bpmOf(difficulty()) });
    setEngineState(engine.state());
    setPagePhase("playing");
    metronome.start();
    startTickLoop();
  };

  const resolveOnlineResult = (): void => {
    const finished = getRemoteFinished();
    if (finished === undefined) return;
    //a peer finish of null = they abandoned mid-chart: a run without a
    //finish loses, the survivor takes the win whenever their chart closes
    const abandoned =
      finished.finishMs === null || finished.finishMs === undefined;
    const theirScore = remoteState()?.score ?? 0;
    setOnlineResult({
      verdict: abandoned
        ? "won"
        : resolveBeatVerdict(
            { score: myFinish?.score ?? 0 },
            { score: theirScore },
          ),
      myScore: myFinish?.score ?? 0,
      myAcc: engine?.state().acc ?? 0,
      myMaxCombo: engine?.state().maxCombo ?? 0,
      theirScore,
      theirAcc: remoteState()?.acc ?? 0,
      theirMaxCombo: remoteState()?.maxCombo ?? 0,
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

  //an armed (or re-armed) beat match IS the online start: the seed builds
  //the identical chart at the match difficulty's BPM (the local audio
  //clock + calibration stay per-machine — only the score travels)
  createEffect(() => {
    const match = getLanMatch();
    if (match?.gameId !== "beat-keys") return;
    const matchDifficulty = match.start.params["difficulty"];
    const playDifficulty: Difficulty =
      matchDifficulty === "easy" || matchDifficulty === "hard"
        ? matchDifficulty
        : "normal";
    const seed = match.start.seed ?? 1;
    setOnlineResult(undefined);
    setRematchSent(false);
    setRemoteState(undefined);
    setVoidMessage(undefined);
    setVoided(false);
    setNewRecord(false);
    myFinish = undefined;
    myFinishSent = false;
    lastSentScore = -1;
    lastSentAcc = -1;
    lastSentCombo = -1;
    runStart = Date.now();
    setDifficulty(playDifficulty); //the match locks the difficulty
    const ctx = getAudioCtx();
    chart = beatLanChart(seed, playDifficulty);
    engine = createBeatKeysEngine({
      chart,
      now: () => ctx.currentTime * 1000,
      offsetMs: getBeatOffsetMs(),
    });
    metronome = createMetronome({ audioCtx: ctx, bpm: bpmOf(playDifficulty) });
    setEngineState(engine.state());
    setPagePhase("playing");
    metronome.start();
    startTickLoop();
  });

  /** the one tick loop both the offline run and the online race share */
  const startTickLoop = (): void => {
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const previous = engineState();
      const next = engine.state();
      if (previous !== undefined && next.grades.miss > previous.grades.miss) {
        void playError();
      }
      setEngineState(next);
      //online: relay the score/acc/combo when they moved
      if (
        lanMode() &&
        (next.score !== lastSentScore ||
          Math.floor(next.acc) !== lastSentAcc ||
          next.maxCombo !== lastSentCombo)
      ) {
        lastSentScore = next.score;
        lastSentAcc = Math.floor(next.acc);
        lastSentCombo = next.maxCombo;
        sendLanMatchProgress(
          lanBeatKeys.encodeProgress({
            score: next.score,
            acc: next.acc,
            maxCombo: next.maxCombo,
          }),
        );
      }
      if (next.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (lanMode()) {
      //the chart's last note — the finish ships with the final numbers
      if (!myFinishSent) {
        myFinishSent = true;
        myFinish = {
          score: state?.score ?? 0,
          elapsedMs: Date.now() - runStart,
        };
        sendLanMatchProgress(
          lanBeatKeys.encodeProgress({
            score: myFinish.score,
            acc: state?.acc ?? 0,
            maxCombo: state?.maxCombo ?? 0,
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
      const { isNewRecord } = recordBeatKeysRun({
        bpm: bpmOf(difficulty()),
        score: state.result.score,
        acc: state.result.acc,
        rank: state.result.rank,
        maxCombo: state.result.maxCombo,
        misses: state.result.misses,
      });
      setNewRecord(isNewRecord);
    }
    setPagePhase("result");
  };

  /** the doc §۵ rule: a background tab pauses the audioCtx — void the
   * round. Offline nothing is recorded; online the void is the abandon:
   * the peer can never be beaten once the run is parked. */
  const voidRun = (): void => {
    if (pagePhase() !== "playing") return;
    stopTimers();
    if (lanMode() && !myFinishSent) {
      myFinishSent = true;
      const state = engine?.state();
      sendLanMatchProgress(
        lanBeatKeys.encodeProgress({
          score: state?.score ?? 0,
          acc: state?.acc ?? 0,
          maxCombo: state?.maxCombo ?? 0,
        }),
      );
      sendLanMatchFinished(null, 0);
      clearLanMatch();
    }
    engine = undefined;
    setEngineState(undefined);
    setVoided(true);
    setPagePhase("setup");
  };

  const judgeLaneKey = (key: string): void => {
    const after = engine?.judge(key);
    if (after === undefined) return;
    setEngineState(after);
    if (after.lastGrade !== undefined && after.lastLane !== undefined) {
      setFlash({ lane: after.lastLane, grade: after.lastGrade });
      if (flashTimer !== undefined) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setFlash(undefined), 350);
      void playClick();
    }
  };

  /** the calibration tap: the signed ms between the tap and the nearest
   * click on the metronome grid */
  const calibrationTap = (): void => {
    const ctx = getAudioCtx();
    if (metronome === undefined) {
      metronome = createMetronome({ audioCtx: ctx, bpm: 100 });
      metronome.start();
      setTaps([]);
    }
    const beatSec = 60 / 100;
    const gridPhase = metronome.nextClickSec() % beatSec;
    const tapSec = ctx.currentTime;
    const nearest =
      Math.round((tapSec - gridPhase) / beatSec) * beatSec + gridPhase;
    const deltaMs = (tapSec - nearest) * 1000;
    if (Math.abs(deltaMs) > BALANCE.windowPoorMs) return; //a missed beat
    const next = [...taps(), deltaMs];
    setTaps(next);
    if (next.length >= CALIBRATION_TAPS) {
      const avg = next.reduce((sum, it) => sum + it, 0) / next.length;
      setBeatOffsetMs(Math.round(avg));
      metronome.stop();
      metronome = undefined;
      setCalibrating(false);
      void playClick();
    }
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (calibrating()) {
      if (event.key === " ") {
        event.preventDefault();
        calibrationTap();
      }
      return;
    }
    if (pagePhase() !== "playing") return;
    //the lane keys are PHYSICAL (doc G21 §۱): a Persian layout's «ی» on
    //KeyD still plays the d-lane
    const key = latinCharFromEvent(event.key, event.code).toLowerCase();
    if (!(BALANCE.laneKeys as readonly string[]).includes(key)) return;
    event.preventDefault();
    judgeLaneKey(key);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    const onVisibility = (): void => {
      if (document.hidden) voidRun();
    };
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  });

  //the relayed peer progress lands decoded — the panel reads it inline
  createEffect(() => {
    const progress = getRemoteProgress();
    if (progress === undefined) return;
    setRemoteState(progress.state as BeatRemoteState);
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
    if (match?.role !== "host" || match.gameId !== "beat-keys") return;
    if (!getRematchAsked()) return;
    hostRematch(match);
  });

  //a disconnect during the chart voids it — nothing online is recorded
  createEffect(() => {
    if (getLanMatch()?.gameId !== "beat-keys") return;
    if (isLanConnected()) return;
    if (pagePhase() !== "playing" && pagePhase() !== "awaiting") return;
    stopTimers();
    engine = undefined;
    clearLanMatch();
    setVoidMessage("the opponent left — race void, nothing was recorded");
    setPagePhase("setup");
  });

  const backToSetup = (): void => {
    stopTimers();
    engine = undefined;
    setPagePhase("setup");
  };

  /** the notes worth rendering right now (tracked via engineState) */
  const laneNotes = () => {
    engineState();
    return engine?.visibleNotes() ?? [];
  };

  /** the linear distance→position mapping (doc §۱): the note rides from
   * the top of the arena to the hit line as its time runs out */
  const noteTopPct = (timeUntilHitMs: number): number => {
    const pct = HIT_PCT * (1 - timeUntilHitMs / BALANCE.visibleLeadMs);
    return Math.max(-6, Math.min(100, pct));
  };

  const Setup = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={voided()}>
          <div class="text-error" data-testid="bk-voided">
            the round was voided (tab switch) — nothing was recorded
          </div>
        </Show>
        <Show when={voidMessage() !== undefined}>
          <div class="text-error">{voidMessage()}</div>
        </Show>
        <div
          class="grid grid-cols-3 gap-2"
          role="group"
          aria-label="difficulty"
        >
          <For each={difficulties()}>
            {(d) => (
              <Button
                text={`${d} · ${bpmOf(d)} bpm`}
                class={cn(difficulty() === d && "bg-main text-bg")}
                disabled={lanMode()}
                onClick={() => setDifficulty(d)}
              />
            )}
          </For>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getBeatBest(bpmOf(difficulty()))?.score ?? 0}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-lg font-bold text-main">
              {getBeatBest(bpmOf(difficulty()))?.rank ?? "—"}
            </div>
            <div class="text-xs text-sub">best rank</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div
              class="text-xl font-bold text-main tabular-nums"
              data-testid="bk-offset"
            >
              {getBeatOffsetMs()}ms
            </div>
            <div class="text-xs text-sub">calibration offset</div>
          </div>
        </div>
        <Show
          when={calibrating()}
          fallback={
            <Button
              text="calibrate offset (tap 8 on the beat)"
              fa={{ icon: "fa-drum" }}
              class="w-full"
              onClick={() => {
                setTaps([]);
                setCalibrating(true);
              }}
            />
          }
        >
          <div
            class="grid gap-2 rounded bg-bg p-3 text-center"
            data-testid="bk-calib"
          >
            <div class="text-lg font-bold text-main">
              tap SPACE on the beat — {taps().length}/{CALIBRATION_TAPS}
            </div>
            <div class="text-xs text-sub">
              the average of your 8 taps becomes your offset (audio delay
              compensation). taps more than 300ms off the beat are ignored.
            </div>
            <Button
              text="cancel"
              class="w-full"
              onClick={() => {
                stopTimers();
                setCalibrating(false);
              }}
            />
          </div>
        </Show>
        <Button
          text="start"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => startRun()}
        />
        <div class="text-xs text-sub">
          notes ride 4 lanes on the beat — type each lane key (d f j k) exactly
          when it crosses the hit line. Perfect ±80ms, Good ±160ms, Poor ±300ms;
          a note past its window breaks the combo. v1 uses latin lane keys only.
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: "56vh" }}
        aria-label="beat keys arena"
      >
        <For each={[0, 1, 2, 3]}>
          {(lane) => (
            <div
              class="absolute top-0 h-full border-x border-sub"
              style={{
                left: `${lane * 25}%`,
                width: "25%",
                background: flash()?.lane === lane ? "var(--bg)" : undefined,
              }}
            ></div>
          )}
        </For>
        {/*the hit line + the lane key pads*/}
        <div
          class="absolute left-0 w-full border-t-2 border-main"
          style={{ top: `${HIT_PCT}%` }}
          data-testid="bk-hitline"
        ></div>
        <For each={BALANCE.laneKeys}>
          {(key, i) => (
            <div
              class="absolute grid place-items-center rounded bg-bg text-sm font-bold text-main"
              style={{
                left: `${i() * 25 + 3}%`,
                top: `${HIT_PCT + 2}%`,
                width: "19%",
                height: "8%",
              }}
            >
              {key}
            </div>
          )}
        </For>
        {/*the falling notes (KI-34: everything reads the signals inline)*/}
        <For each={laneNotes()}>
          {(note) => (
            <div
              class="absolute grid place-items-center rounded border-2 border-main bg-bg text-lg font-bold text-main"
              style={{
                left: `${note.lane * 25 + 3}%`,
                top: `${noteTopPct(note.timeUntilHitMs)}%`,
                width: "19%",
                height: "9%",
                "transition-property": "top",
                "transition-timing-function": "linear",
                "transition-duration": `${TICK_MS}ms`,
              }}
              data-testid="bk-note"
              data-key={note.key}
            >
              {note.key}
            </div>
          )}
        </For>
        {/*the grade popup at the judged lane*/}
        <Show when={flash() !== undefined}>
          <div
            class={cn(
              "absolute grid place-items-center text-xl font-bold",
              flash()?.grade === "perfect" && "text-main",
              flash()?.grade === "good" && "text-sub",
              flash()?.grade === "poor" && "text-error",
              flash()?.grade === "miss" && "text-error",
            )}
            style={{
              left: `${(flash()?.lane ?? 0) * 25}%`,
              top: `${HIT_PCT - 22}%`,
              width: "25%",
            }}
            data-testid="bk-grade"
          >
            {flash() !== undefined ? GRADE_LABEL[flash()?.grade ?? "miss"] : ""}
          </div>
        </Show>
      </section>
    );
  };

  const AwaitingScreen = (): JSXElement => {
    return (
      <section class="grid place-items-center rounded bg-sub-alt py-16 text-center">
        <div class="text-2xl font-bold text-main" data-testid="bk-awaiting">
          the chart closed · score {myFinish?.score ?? 0} — waiting for{" "}
          {getLanMatch()?.peerName ?? "the opponent"}…
        </div>
      </section>
    );
  };

  const OnlineResultScreen = (): JSXElement => {
    const online = (): BeatOnlineResult | undefined => onlineResult();
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
          data-testid="bk-verdict"
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
              {online()?.myScore ?? 0} score ·{" "}
              {(online()?.myAcc ?? 0).toFixed(0)}% acc ·{" "}
              {online()?.myMaxCombo ?? 0} combo
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {online()?.theirScore ?? 0} score ·{" "}
              {(online()?.theirAcc ?? 0).toFixed(0)}% acc ·{" "}
              {online()?.theirMaxCombo ?? 0} combo ·{" "}
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
        <Show when={newRecord()}>
          <div class="text-lg font-bold text-main" data-testid="bk-record">
            new best score!
          </div>
        </Show>
        <div class="text-6xl font-bold text-main">{result?.rank ?? "—"}</div>
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.score ?? 0}
            </div>
            <div class="text-xs text-sub">score</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {(result?.acc ?? 0).toFixed(1)}%
            </div>
            <div class="text-xs text-sub">accuracy</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.maxCombo ?? 0}
            </div>
            <div class="text-xs text-sub">max combo</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.misses ?? 0}
            </div>
            <div class="text-xs text-sub">misses</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          recent runs:{" "}
          {getBeatKeysHistory(3)
            .map((it) => `${it.rank}·${it.score}`)
            .join(" · ")}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="play again"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => startRun()}
          />
          <Button
            text="back to setup"
            fa={{ icon: "fa-home" }}
            class="w-full"
            onClick={backToSetup}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-drum" }} text="beat keys" />
        <p class="text-sub">
          a typing rhythm game — the metronome keeps the beat, notes ride the
          lanes, and your timing is the score. Calibrate once if the clicks feel
          late.
        </p>
      </section>
      <Show when={lanMode()}>
        <div
          class="rounded bg-sub-alt p-2 text-center text-sm font-bold text-main"
          data-testid="bk-online-vs"
        >
          <i class="fas fa-drum"></i> online vs {getLanMatch()?.peerName ?? "…"}{" "}
          — same chart, the higher score wins
        </div>
      </Show>
      <Show when={lanMode()}>
        <div class="grid grid-cols-2 gap-2" data-testid="bk-remote">
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-error tabular-nums">
              {remoteState()?.score ?? 0} score ·{" "}
              {(remoteState()?.acc ?? 0).toFixed(0)}% acc
            </div>
            <div class="text-xs text-sub">
              {getLanMatch()?.peerName ?? "the opponent"}
            </div>
          </div>
          <div class="rounded bg-bg p-2 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {engineState()?.score ?? 0} score ·{" "}
              {(engineState()?.acc ?? 100).toFixed(0)}% acc
            </div>
            <div class="text-xs text-sub">you</div>
          </div>
        </div>
      </Show>
      <Show when={pagePhase() !== "setup"} fallback={<Setup />}>
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
          <div class="grid grid-cols-4 gap-2" aria-label="beat keys hud">
            <HudCell
              label="score"
              value={`${engineState()?.score ?? 0}`}
              testId="bk-score"
            />
            <HudCell label="combo" value={`${engineState()?.combo ?? 0}`} />
            <HudCell
              label="acc"
              value={`${(engineState()?.acc ?? 100).toFixed(0)}%`}
            />
            <HudCell
              label="misses"
              value={`${engineState()?.grades.miss ?? 0}`}
              testId="bk-misses"
            />
          </div>
          <Arena />
          <div class="text-center text-xs text-sub">
            type the lane keys on the beat — d f j k
          </div>
        </Show>
      </Show>
    </div>
  );
}
