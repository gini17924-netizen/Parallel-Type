import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { playClick, playError } from "../../../../controllers/sound-controller";
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
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 16;
/** the hit line's vertical position (% of the arena height) */
const HIT_PCT = 86;
/** the calibration taps (doc §۰.۴: «۸ taps on the beat» → the average) */
const CALIBRATION_TAPS = 8;

type Difficulty = keyof typeof BALANCE.bpmByDifficulty;

type PagePhase = "setup" | "playing" | "result";

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

  let engine: BeatKeysEngine | undefined;
  let chart: BeatChart | undefined;
  let metronome: Metronome | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    tickTimer = undefined;
    flashTimer = undefined;
    metronome?.stop();
    metronome = undefined;
  };

  onCleanup(stopTimers);

  const difficulties = (): Difficulty[] =>
    Object.keys(BALANCE.bpmByDifficulty) as Difficulty[];

  const bpmOf = (d: Difficulty): number => BALANCE.bpmByDifficulty[d];

  const startRun = (): void => {
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
    tickTimer = setInterval(() => {
      if (engine === undefined) return;
      const previous = engineState();
      const next = engine.state();
      if (previous !== undefined && next.grades.miss > previous.grades.miss) {
        void playError();
      }
      setEngineState(next);
      if (next.phase === "done") endRun();
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
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
   * round WITHOUT recording anything */
  const voidRun = (): void => {
    if (pagePhase() !== "playing") return;
    stopTimers();
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
    const key = event.key.toLowerCase();
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
      <Show when={pagePhase() === "playing"} fallback={<Setup />}>
        <Show when={pagePhase() !== "result"} fallback={<ResultScreen />}>
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
