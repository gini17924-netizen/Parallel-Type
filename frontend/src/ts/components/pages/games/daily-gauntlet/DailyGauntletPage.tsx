import { For, JSXElement, Show, createSignal, onMount } from "solid-js";

import { playClick } from "../../../../controllers/sound-controller";
import { navigate } from "../../../../router/navigate";
import { registerDailyBotDuel } from "../../../../utils/bot-duel/daily";
import { cn } from "../../../../utils/cn";
import { buildDaily, dayKeyOf } from "../../../../utils/daily-gauntlet/compose";
import {
  gauntletTotal,
  type GauntletState,
} from "../../../../utils/daily-gauntlet/engine";
import {
  clearGauntletState,
  getGauntletCalendarEntry,
  getGauntletStats,
  loadGauntletState,
  recordGauntletCompletion,
  saveGauntletState,
  type GauntletStateSnapshot,
} from "../../../../utils/daily-gauntlet/store";
import {
  getDailyPlayable,
  listDailyPlayables,
  type DailyStage as DailyStageType,
  type DailyStageResult as DailyStageResultType,
} from "../../../../utils/games/game-registry";
import { registerDailySprint } from "../../../../utils/sprint/daily";
import { registerDailyWordBlast } from "../../../../utils/word-blast/daily";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

/** where each daily stage's game lives (the launch routes) */
const GAME_ROUTES: Record<string, string> = {
  "word-blast": "/games/word-blast",
  sprint: "/games/sprint",
  "bot-duel": "/games/bot-duel",
};

type View = "loading" | "ready" | "running" | "complete" | "voided";

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * Daily Gauntlet (idea G22, phase 4): the composite daily challenge —
 * three stages from three registered games, composed once per day from
 * the day hash. Each stage runs full-page in its own game; the store is
 * the coordinator, so closing the app between stages resumes cleanly.
 * The day locks after the first stage; the calendar stamps the streak.
 */
/** KI-43 fix: the wrappers registered themselves only in tests — in
 * production the registry stayed empty and the day composed 0 stages.
 * KI-44 fix: idempotent by REGISTRY LOOKUP (no flag) — safe to call from
 * any mount, any number of times. KI-41 note: onMount is unreliable in
 * the test harness, so startDay/runStage also call this. */
function ensureDailyRegistered(): void {
  if (getDailyPlayable("word-blast") === undefined) {
    try {
      registerDailyWordBlast();
    } catch {
      /* already registered */
    }
  }
  if (getDailyPlayable("sprint") === undefined) {
    try {
      registerDailySprint();
    } catch {
      /* already registered */
    }
  }
  if (getDailyPlayable("bot-duel") === undefined) {
    try {
      registerDailyBotDuel();
    } catch {
      /* already registered */
    }
  }
}
ensureDailyRegistered(); //at module load: the route imports the page

export function DailyGauntletPage(): JSXElement {
  const [view, setView] = createSignal<View>("loading");
  const [state, setState] = createSignal<GauntletState | undefined>(undefined);
  const [isNewBest, setIsNewBest] = createSignal(false);
  const today = dayKeyOf();

  const loadView = (): void => {
    const saved = loadGauntletState();
    if (saved === undefined) {
      setState(undefined);
      setView(
        getGauntletCalendarEntry(today) === undefined ? "ready" : "complete",
      );
      return;
    }
    if (saved.dayKey !== today) {
      //a stale day's slot frees up; its result already lives in stats
      clearGauntletState();
      setState(undefined);
      setView("ready");
      return;
    }
    if (saved.phase === "complete") {
      //record ONCE (the calendar entry is the done-marker)
      const entry = getGauntletCalendarEntry(today);
      if (entry === undefined) {
        const total = saved.results.reduce((sum, it) => sum + it.normalized, 0);
        const stagesWon = saved.results.filter((it) => it.won).length;
        const { isNewBest } = recordGauntletCompletion({
          dayKey: saved.dayKey,
          total,
          stagesWon,
        });
        setIsNewBest(isNewBest);
      }
      clearGauntletState(); //the slot frees; the calendar holds the result
      setState(undefined);
      setView("complete");
      return;
    }
    if (saved.phase === "voided") {
      clearGauntletState();
      setState(saved as GauntletState);
      setView("voided");
      return;
    }
    if (saved.stages.length === 0) {
      //KI-43 self-heal: a pre-fix empty day state had no stages and no
      //escape — drop it and start fresh
      clearGauntletState();
      setState(undefined);
      setView("ready");
      return;
    }
    setState(saved as GauntletState);
    setView("running");
  };

  onMount(() => {
    ensureDailyRegistered();
    loadView();
  });

  const composeToday = (): GauntletState => {
    const stages = buildDaily(today, listDailyPlayables());
    return {
      dayKey: today,
      stages,
      stageIndex: 0,
      results: [],
      phase: "ready",
      locked: false,
      startedAt: undefined,
      voidReason: undefined,
    };
  };

  const startDay = (): void => {
    if (view() === "complete" || view() === "running") return; //the day lock
    ensureDailyRegistered();
    const fresh = composeToday();
    if (fresh.stages.length === 0) return; //nothing registered — refuse
    saveGauntletState(fresh);
    setState(fresh);
    setView("running");
    void playClick();
  };

  /** arms the pending stage and sends the player to the game's page */
  const runStage = (gameId: string): void => {
    ensureDailyRegistered();
    const current = state();
    if (current === undefined) return;
    const stageIndex = current.results.length;
    const stage = current.stages[stageIndex];
    if (stage === undefined || stage.gameId !== gameId) return;
    const playable = getDailyPlayable(gameId);
    if (playable === undefined) return;
    void playable.runDailyStage(stage); //the game resolves the bridge
    void navigate({
      to: GAME_ROUTES[gameId] ?? "/games",
    });
  };

  const summaryTotal = (): number => {
    const saved = loadGauntletState();
    if (saved !== undefined) return gauntletTotal(saved as GauntletState);
    const entry = getGauntletCalendarEntry(today);
    return entry?.total ?? 0;
  };

  const stagesWon = (): number => {
    const saved = loadGauntletState();
    if (saved !== undefined) {
      return saved.results.filter((it) => it.won).length;
    }
    return getGauntletCalendarEntry(today)?.stagesWon ?? 0;
  };

  const Menu = (): JSXElement => {
    const stats = getGauntletStats();
    const playedToday = getGauntletCalendarEntry(today) !== undefined;
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-error">
              {stats.streak > 0 ? "🔥" : "·"} {stats.streak}
            </div>
            <div class="text-xs text-sub">streak</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {stats.bestTotal}
            </div>
            <div class="text-xs text-sub">best total</div>
          </div>
          <div class="rounded bg-bg p-3 text-center">
            <div class="text-xl font-bold text-main tabular-nums">
              {stats.maxStreak}
            </div>
            <div class="text-xs text-sub">max streak</div>
          </div>
        </div>
        <Show
          when={!playedToday}
          fallback={
            <div class="rounded bg-bg p-4 text-center text-sm text-sub">
              the gauntlet of today is stamped — come back tomorrow (the day
              locks once played)
            </div>
          }
        >
          <Button
            text="start today's gauntlet"
            fa={{ icon: "fa-shield-alt" }}
            class="w-full"
            onClick={startDay}
          />
        </Show>
        <div class="text-xs text-sub">
          every day composes three stages from three different games — same
          stages for everyone, locked after the first one. finish all three to
          stamp the calendar and grow the streak. closing the app between stages
          resumes from the next stage.
        </div>
        <StreakCalendar />
      </section>
    );
  };

  const StageRow = (props: { index: number }): JSXElement => {
    //KI-34: the stage/result reads are FUNCTIONS called inline — body
    //consts would freeze the row on the mount snapshot
    const stage = (): DailyStageType | undefined =>
      state()?.stages[props.index];
    const result = (): DailyStageResultType | undefined =>
      state()?.results[props.index];
    const isNext = (): boolean =>
      state() !== undefined && state()?.results.length === props.index;
    return (
      <Show when={stage() !== undefined} fallback={<div></div>}>
        <div
          class={cn(
            "flex items-center justify-between rounded border-2 p-3",
            result() !== undefined && "border-main/40 bg-bg",
            isNext() && "border-main bg-bg",
            result() === undefined && !isNext() && "border-sub bg-bg/50",
          )}
          data-testid="dg-stage"
          data-game={stage()?.gameId}
          data-status={
            result() !== undefined ? "done" : isNext() ? "next" : "pending"
          }
        >
          <div class="grid gap-0.5">
            <div class="text-sm font-bold text-main">
              {props.index + 1}. {stage()?.title}
            </div>
            <div class="text-xs text-sub">
              {result() !== undefined
                ? `${result()?.normalized}/1000 · ${result()?.won ? "won" : "played"}`
                : isNext()
                  ? "up next"
                  : "locked"}
            </div>
          </div>
          <Show when={isNext()}>
            <Button
              text="run stage"
              fa={{ icon: "fa-play" }}
              onClick={() => {
                const id = stage()?.gameId;
                if (id !== undefined) runStage(id);
              }}
            />
          </Show>
          <Show when={result() !== undefined}>
            <span class="text-main">{result()?.won ? "✓" : "·"}</span>
          </Show>
        </div>
      </Show>
    );
  };

  const CompositeBar = (): JSXElement => {
    const current = state();
    const total = current === undefined ? 0 : gauntletTotal(current);
    const parts = current?.results ?? [];
    return (
      <div
        class="flex h-3 w-full gap-1 rounded bg-bg p-0.5"
        data-testid="dg-bar"
      >
        <For each={[0, 1, 2]}>
          {(i) => {
            const part = parts[i];
            return (
              <div
                class={cn(
                  "h-full flex-1 rounded-sm",
                  part !== undefined ? "bg-main" : "bg-sub-alt",
                )}
                style={
                  part !== undefined
                    ? { opacity: 0.4 + (part.normalized / 1000) * 0.6 }
                    : undefined
                }
              ></div>
            );
          }}
        </For>
        <span class="sr-only">{total}</span>
      </div>
    );
  };

  const Running = (): JSXElement => {
    const current = state();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <CompositeBar />
        <For each={[0, 1, 2]}>{(i) => <StageRow index={i} />}</For>
        <div class="text-center text-xs text-sub">
          stage total {current === undefined ? 0 : gauntletTotal(current)} — the
          day locks after the first stage (no seed rerolls)
        </div>
      </section>
    );
  };

  /** the month calendar with the stamped days (the activity-calendar idea) */
  const StreakCalendar = (): JSXElement => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = now.toLocaleString("en-US", { month: "long" });
    return (
      <div class="grid gap-2 rounded bg-bg p-3" data-testid="dg-calendar">
        <div class="text-center text-xs font-bold text-sub">
          {monthLabel} {year}
        </div>
        <div class="grid grid-cols-7 gap-1">
          <For each={Array.from({ length: firstDay }, (_, i) => i)}>
            {() => <div></div>}
          </For>
          <For each={Array.from({ length: daysInMonth }, (_, i) => i + 1)}>
            {(day) => {
              const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const entry = getGauntletCalendarEntry(key);
              const isToday = key === today;
              return (
                <div
                  class={cn(
                    "grid aspect-square place-items-center rounded-sm text-[10px]",
                    entry !== undefined
                      ? "bg-main font-bold text-bg"
                      : "bg-sub-alt text-sub",
                    isToday && entry === undefined && "border border-main",
                  )}
                  data-testid="dg-day"
                  data-key={key}
                >
                  <Show when={entry !== undefined} fallback={day}>
                    🔥
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    );
  };

  const Complete = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <Show when={isNewBest()}>
          <div class="text-lg font-bold text-main" data-testid="dg-record">
            new best total!
          </div>
        </Show>
        <div class="text-3xl font-bold text-main">
          gauntlet complete — {summaryTotal()} points
        </div>
        <div class="grid grid-cols-3 gap-2">
          <HudCell label="total" value={`${summaryTotal()}`} />
          <HudCell label="stages won" value={`${stagesWon()}/3`} />
          <HudCell label="streak" value={`🔥 ${getGauntletStats().streak}`} />
        </div>
        <StreakCalendar />
        <div class="text-xs text-sub">
          today is stamped — the next gauntlet unlocks at midnight
        </div>
      </section>
    );
  };

  const Voided = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
        <div class="text-2xl font-bold text-error">the run was voided</div>
        <div class="text-xs text-sub">
          {state()?.voidReason ?? "the round was interrupted"} — nothing was
          recorded; you can start the day fresh
        </div>
        <Button
          text="start the day again"
          fa={{ icon: "fa-shield-alt" }}
          class="w-full"
          onClick={startDay}
        />
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-shield-alt" }} text="daily gauntlet" />
        <p class="text-sub">
          one composite challenge a day — three games, one shared seed, a
          calendar that remembers your streak.
        </p>
      </section>
      <Show
        when={
          view() === "running" || view() === "complete" || view() === "voided"
        }
        fallback={<Menu />}
      >
        <Show
          when={view() === "running"}
          fallback={
            <Show when={view() === "voided"} fallback={<Complete />}>
              <Voided />
            </Show>
          }
        >
          <Running />
        </Show>
      </Show>
    </div>
  );
}

export type { GauntletStateSnapshot };
