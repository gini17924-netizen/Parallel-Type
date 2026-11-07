import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Config } from "../../../../config/store";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { cn } from "../../../../utils/cn";
import { BALANCE } from "../../../../utils/crane/balance";
import {
  createCraneEngine,
  type CraneEngine,
  type CraneQuality,
  type CraneState,
} from "../../../../utils/crane/engine";
import {
  getCraneBestHeight,
  getCraneBestScore,
  getCraneHistory,
  recordCraneRun,
} from "../../../../utils/crane/store";
import { unlockedLetters } from "../../../../utils/learn-stats";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

const TICK_MS = 30; //doc G17 §۱: tick 30ms
const FALL_MS = 450; //the fall animation length
/** the tower segment geometry (px) */
const SEG_H = 16;
const SEG_W = 44;
const ARENA_VH = 44;

type PagePhase = "menu" | "playing" | "result";

type TowerSeg = { x: number; quality: CraneQuality };

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Crane Stack (idea G17, phase 2): the crane sweeps with the key sequence
 * hanging from its hook; completing the sequence releases the box and the
 * release quality is the hook's distance from the zone center at that
 * moment. The base rises per successful box — a real tilted tower from the
 * landing x's. The pure engine owns the sweep and the scoring; this page
 * owns the letter source (unlocked groups, read-only), the tower visual
 * and the timers.
 */
export function CranePage(): JSXElement {
  const [pagePhase, setPagePhase] = createSignal<PagePhase>("menu");
  const [engineState, setEngineState] = createSignal<CraneState | undefined>(
    undefined,
  );
  /** the tower segments (page-owned presentation: each landing x) */
  const [tower, setTower] = createSignal<TowerSeg[]>([]);
  /** the falling box (release animation) */
  const [fall, setFall] = createSignal<
    { x: number; quality: CraneQuality } | undefined
  >(undefined);
  /** the blur-pause badge (KI-33, the balloon-pop pattern) */
  const [paused, setPaused] = createSignal(false);
  /** flips the falling box from the hook to the base (CSS transition) */
  const [fallDropped, setFallDropped] = createSignal(false);
  const [newRecord, setNewRecord] = createSignal(false);
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  let engine: CraneEngine | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let fallTimer: ReturnType<typeof setTimeout> | undefined;
  let fallDropTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = (): void => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    if (fallTimer !== undefined) clearTimeout(fallTimer);
    if (fallDropTimer !== undefined) clearTimeout(fallDropTimer);
    tickTimer = undefined;
    fallTimer = undefined;
    fallDropTimer = undefined;
  };

  onCleanup(stopTimers);

  /** the key sequence: len 4..6 from the unlocked letters (read-only,
   * the G9 pattern), growing per level (doc G17 §۰.۴) */
  const buildSeq = (level: number): string[] => {
    const source = [...unlockedLetters(Config.language)];
    if (source.length === 0) source.push(..."fjdksla".split(""));
    const len = Math.min(
      BALANCE.seqMaxLen,
      BALANCE.seqMinLen + Math.floor((level - 1) / 3),
    );
    const seq: string[] = [];
    for (let i = 0; i < len; i++) {
      seq.push(source[Math.floor(Math.random() * source.length)] ?? "f");
    }
    return seq;
  };

  const startRun = (): void => {
    setMessage(undefined);
    setTower([]);
    setFall(undefined);
    setFallDropped(false);
    setNewRecord(false);
    engine = createCraneEngine({
      seqFor: buildSeq,
      rng: Math.random,
    });
    setEngineState(engine.state());
    setPagePhase("playing");
    tickTimer = setInterval(() => {
      if (engine === undefined || paused()) return;
      setEngineState(engine.tick(TICK_MS));
    }, TICK_MS);
  };

  const endRun = (): void => {
    stopTimers();
    const state = engine?.state();
    if (state?.result !== undefined) {
      const { isNewScoreRecord } = recordCraneRun({
        score: state.result.score,
        height: state.result.height,
        perfectCount: state.result.perfectCount,
        misses: state.result.misses,
      });
      setNewRecord(isNewScoreRecord);
    }
    setPagePhase("result");
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (pagePhase() !== "playing" || paused()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    event.preventDefault();
    const before = engine?.state();
    const after = engine?.feedKey(event.key);
    if (after === undefined || before === undefined) return;
    //a release happened: the box count (height + misses) grew — animate the
    //fall from the hook's x at that exact moment (the feedKey snapshot)
    if (after.height + after.misses > before.height + before.misses) {
      const x = after.craneX;
      const quality = after.lastQuality ?? "miss";
      setFall({ x, quality });
      setFallDropped(false);
      if (fallTimer !== undefined) clearTimeout(fallTimer);
      if (fallDropTimer !== undefined) clearTimeout(fallDropTimer);
      fallDropTimer = setTimeout(() => {
        setFallDropped(true);
        if (quality !== "miss") {
          setTower((prev) => [...prev, { x, quality }]);
        }
      }, 20);
      fallTimer = setTimeout(() => setFall(undefined), FALL_MS);
      if (quality === "miss") void playError();
      else void playClick();
    }
    setEngineState(after);
    if (after.phase === "done") endRun();
  };

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    const onBlur = (): void => {
      if (pagePhase() !== "playing") return;
      setPaused(true);
    };
    const onFocus = (): void => {
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
    //otherwise double-tick the next run
    stopTimers();
    engine = undefined;
    setPaused(false);
    setPagePhase("menu");
  };

  const qualityOpacity = (quality: CraneQuality): string => {
    switch (quality) {
      case "perfect":
        return "1";
      case "good":
        return "0.7";
      case "poor":
        return "0.4";
      case "miss":
        return "0.25";
    }
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show when={message() !== undefined}>
          <div class="text-error">{message()}</div>
        </Show>
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getCraneBestScore()}
            </div>
            <div class="text-xs text-sub">best score</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getCraneBestHeight()}
            </div>
            <div class="text-xs text-sub">best height</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {getCraneHistory().length}
            </div>
            <div class="text-xs text-sub">runs</div>
          </div>
        </div>
        <Button
          text="start stacking"
          fa={{ icon: "fa-anchor" }}
          class="w-full"
          onClick={() => startRun()}
        />
        <div class="text-xs text-sub">
          the crane carries the key sequence — type it and the box drops at that
          exact spot. Land inside the zone: perfect {BALANCE.perfectScore}, good{" "}
          {BALANCE.goodScore}, poor {BALANCE.poorScore}. 3 misses and the run is
          over. every 10 floors levels the crane up (faster sweep, longer
          sequences, a shifted zone).
        </div>
      </section>
    );
  };

  const Arena = (): JSXElement => {
    return (
      <section
        class="relative w-full overflow-hidden rounded bg-sub-alt"
        style={{ height: `${ARENA_VH}vh` }}
        aria-label="crane stack arena"
      >
        {/*the crane rail*/}
        <div
          class="absolute left-0 w-full border-t-2 border-sub"
          style={{ top: "8px" }}
        ></div>
        {/*the crane: head + chain + the hanging box with the sequence
           (KI-34: the signal reads stay inline in the JSX expressions)*/}
        <div
          class="absolute"
          style={{
            left: `${engineState()?.craneX ?? 50}%`,
            top: "8px",
            transform: "translateX(-50%)",
            transition: `left ${TICK_MS}ms linear`,
          }}
          data-testid="cr-crane"
        >
          <div class="mx-auto h-3 w-6 rounded-t bg-main"></div>
          <div class="mx-auto w-0.5 bg-main" style={{ height: "5vh" }}></div>
          <div
            class={cn(
              "grid min-w-24 place-items-center rounded border-2 px-2 py-1",
              fall() === undefined ? "border-main bg-bg" : "border-main/30",
            )}
          >
            <span
              class="text-xl font-bold tracking-widest"
              dir="auto"
              data-testid="cr-seq"
            >
              <span class="text-main">
                {(engineState()?.sequence ?? [])
                  .slice(0, engineState()?.typed ?? 0)
                  .join("")}
              </span>
              <span class="text-sub">
                {(engineState()?.sequence ?? [])
                  .slice(engineState()?.typed ?? 0)
                  .join("")}
              </span>
            </span>
          </div>
        </div>
        {/*the falling box (release animation with tilt per quality)*/}
        <Show when={fall() !== undefined}>
          <div
            class="absolute grid place-items-center rounded border-2 border-main bg-bg"
            style={{
              left: `${fall()?.x ?? 50}%`,
              top: fallDropped()
                ? `calc(${ARENA_VH}vh - ${(tower().length + 1) * SEG_H}px - 18px)`
                : "12vh",
              width: `${SEG_W}px`,
              height: `${SEG_H + 2}px`,
              transform: `translateX(-50%) rotate(${
                fall()?.quality === "perfect" ? "0deg" : "6deg"
              })`,
              "transition-property": "top",
              "transition-timing-function": "linear",
              "transition-duration": `${FALL_MS - 40}ms`,
            }}
            data-testid="cr-fallbox"
          ></div>
        </Show>
        {/*the zone bar: poor/good/perfect bands around the zone center
           (KI-34: zoneCenter read inline)*/}
        <div
          class="absolute left-0 w-full"
          style={{ bottom: "6px", height: "22px" }}
        >
          <div
            class="absolute h-full bg-main opacity-20"
            style={{
              left: `${(engineState()?.zoneCenter ?? 50) - BALANCE.poorPct}%`,
              width: `${BALANCE.poorPct * 2}%`,
            }}
          ></div>
          <div
            class="absolute h-full bg-main opacity-50"
            style={{
              left: `${(engineState()?.zoneCenter ?? 50) - BALANCE.goodPct}%`,
              width: `${BALANCE.goodPct * 2}%`,
            }}
          ></div>
          <div
            class="absolute h-full rounded-sm bg-main"
            style={{
              left: `${(engineState()?.zoneCenter ?? 50) - BALANCE.perfectPct}%`,
              width: `${BALANCE.perfectPct * 2}%`,
            }}
            data-testid="cr-zone"
          ></div>
        </div>
        {/*the tower: real segments from the landing x's (tilted tower)*/}
        <For each={tower()}>
          {(seg, i) => (
            <div
              class="absolute rounded-sm bg-main"
              style={{
                left: `${seg.x}%`,
                bottom: `${i() * SEG_H}px`,
                width: `${SEG_W}px`,
                height: `${SEG_H - 2}px`,
                transform: "translateX(-50%)",
                opacity: qualityOpacity(seg.quality),
              }}
              data-testid="cr-seg"
            ></div>
          )}
        </For>
        <Show when={paused()}>
          <div
            class="absolute inset-0 grid place-items-center bg-bg/70 text-2xl font-bold text-main"
            data-testid="cr-paused"
          >
            paused
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
          <div class="text-lg font-bold text-main" data-testid="cr-record">
            new best score!
          </div>
        </Show>
        <div class="text-3xl font-bold text-main">
          tower done — {result?.height ?? 0} floors
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
              {result?.height ?? 0}
            </div>
            <div class="text-xs text-sub">height</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.perfectCount ?? 0}
            </div>
            <div class="text-xs text-sub">perfects</div>
          </div>
          <div class="rounded bg-bg p-3">
            <div class="text-xl font-bold text-main tabular-nums">
              {result?.misses ?? 0}
            </div>
            <div class="text-xs text-sub">misses</div>
          </div>
        </div>
        <div class="text-xs text-sub">
          best score {getCraneBestScore()} · best height {getCraneBestHeight()}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="stack again"
            fa={{ icon: "fa-redo" }}
            class="w-full"
            onClick={() => startRun()}
          />
          <Button
            text="back to menu"
            fa={{ icon: "fa-home" }}
            class="w-full"
            onClick={backToMenu}
          />
        </div>
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-anchor" }} text="crane stack" />
        <p class="text-sub">
          a timing-precision crane — type the hanging sequence to release the
          box at that exact moment. The closer the hook to the zone center, the
          higher the score; the tower stacks from your real landings.
        </p>
      </section>
      <Show when={pagePhase() !== "menu"} fallback={<Menu />}>
        <Show when={pagePhase() === "playing"} fallback={<ResultScreen />}>
          <div class="grid grid-cols-4 gap-2" aria-label="crane stack hud">
            <HudCell label="score" value={`${engineState()?.score ?? 0}`} />
            <HudCell label="height" value={`${engineState()?.height ?? 0}`} />
            <HudCell label="level" value={`${engineState()?.level ?? 1}`} />
            <HudCell
              label="misses"
              value={`${engineState()?.misses ?? 0}/${BALANCE.maxMisses}`}
            />
          </div>
          <Arena />
          <div class="text-center text-xs text-sub">
            type the sequence on the hook — it releases on the last key. a wrong
            key resets the partial.
          </div>
        </Show>
      </Show>
    </div>
  );
}
