import { createSignal, For, JSXElement, onMount, Show } from "solid-js";

import { cn } from "../../../utils/cn";
import { gameTrendSeries } from "../../../utils/game-trends";
import { buildStreakView, type StreakView } from "../../../utils/streaks/state";
import {
  buildWeeklyReport,
  type WeeklyReport,
} from "../../../utils/weekly-report";

/**
 * phase 98: THE unified streak view — daily, weekly and per-game streaks
 * side by side, all fed from the same pure engine. the daily rule: a
 * streak stays alive while its last day is today or yesterday.
 */
export function StreaksPage(): JSXElement {
  const [view, setView] = createSignal<StreakView | undefined>(undefined);
  const [weekly, setWeekly] = createSignal<WeeklyReport | undefined>(undefined);
  const [trends, setTrends] = createSignal(gameTrendSeries());
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    void buildStreakView(Date.now())
      .then((built) => {
        setView(built);
      })
      .catch((error: unknown) => {
        console.error("streak view failed", error);
        setFailed(true);
      });
    setTrends(gameTrendSeries());
    //phase 108: the weekly report rides the same boot
    void buildWeeklyReport()
      .then((report) => {
        setWeekly(report);
      })
      .catch((error: unknown) => {
        console.error("weekly report failed", error);
      });
  });

  const SummaryRow = (props: {
    label: string;
    current: number;
    longest: number;
    unit: string;
    testId: string;
  }): JSXElement => (
    <div
      class="flex items-center justify-between gap-4 rounded bg-sub-alt p-4"
      data-testid={props.testId}
    >
      <div class="text-sub">{props.label}</div>
      <div class="text-right">
        <div class="text-2xl font-bold text-main tabular-nums">
          {props.current}
          <span class="ml-1 text-sm font-normal text-sub">{props.unit}</span>
        </div>
        <div class="text-xs text-sub">longest: {props.longest}</div>
      </div>
    </div>
  );

  return (
    <div class="content-grid grid gap-6 py-10">
      <div class="text-center">
        <div class="text-3xl font-bold text-main">streaks</div>
        <div class="text-sub">
          every chain you are keeping alive — a day counts, a week counts, a
          game counts
        </div>
      </div>
      <Show
        when={!failed()}
        fallback={
          <div class="text-center text-sub" data-testid="streaks-error">
            the streak view could not be built
          </div>
        }
      >
        <Show
          when={view() !== undefined}
          fallback={
            <div class="text-center text-sub" data-testid="streaks-loading">
              counting the chains…
            </div>
          }
        >
          <section class="grid gap-3" data-testid="streaks-main">
            <div class="text-sub">overall</div>
            <SummaryRow
              label="daily — typed at least once"
              current={view()?.daily.current ?? 0}
              longest={view()?.daily.longest ?? 0}
              unit="days"
              testId="streak-daily"
            />
            <SummaryRow
              label="weekly — typed in the week"
              current={view()?.weekly.current ?? 0}
              longest={view()?.weekly.longest ?? 0}
              unit="weeks"
              testId="streak-weekly"
            />
          </section>
          <Show when={weekly() !== undefined}>
            <section class="grid gap-3" data-testid="weekly-report">
              <div class="text-sub">weekly report</div>
              <Show
                when={(weekly()?.weeks.length ?? 0) > 0}
                fallback={
                  <div class="text-xs text-sub">
                    complete tests to fill the weekly buckets
                  </div>
                }
              >
                <For each={weekly()?.weeks.slice(-6)}>
                  {(week) => (
                    <div class="flex items-center justify-between rounded bg-sub-alt p-3">
                      <div class="text-xs text-sub">week {week.weekIndex}</div>
                      <div class="text-sm text-main tabular-nums">
                        {week.tests} tests · {week.avgWpm} wpm ·{" "}
                        {Math.round(week.avgAcc * 100)}%
                      </div>
                    </div>
                  )}
                </For>
                <div class="text-xs text-sub">
                  latest week vs the one before:{" "}
                  <span
                    class={cn(
                      "font-bold",
                      (weekly()?.wpmTrend ?? 0) >= 0
                        ? "text-main"
                        : "text-error",
                    )}
                  >
                    {(weekly()?.wpmTrend ?? 0) >= 0 ? "+" : ""}
                    {weekly()?.wpmTrend} wpm
                  </span>{" "}
                  / {(weekly()?.accTrend ?? 0) >= 0 ? "+" : ""}
                  {Math.round((weekly()?.accTrend ?? 0) * 100)}% acc
                </div>
              </Show>
            </section>
          </Show>
          <section class="grid gap-3" data-testid="game-trends">
            <div class="text-sub">game trends — the recent runs per game</div>
            <For each={trends().filter((trend) => trend.points.length > 0)}>
              {(trend) => (
                <div class="grid gap-1 rounded bg-sub-alt p-3">
                  <div class="flex items-center justify-between">
                    <div class="text-sm font-bold text-main">{trend.label}</div>
                    <div class="text-xs text-sub tabular-nums">
                      best {trend.best} · latest {trend.latest} ·{" "}
                      <span
                        class={cn(trend.step > 0 ? "text-main" : "text-sub")}
                      >
                        {trend.step > 0 ? "▲ +" : trend.step < 0 ? "▼ " : "· "}
                        {trend.step !== 0 ? trend.step : "flat"}
                      </span>
                    </div>
                  </div>
                  <div class="flex h-8 items-end gap-1">
                    <For each={trend.points}>
                      {(point) => (
                        <div
                          class="flex-1 rounded-t bg-main/70"
                          style={{
                            height: `${Math.max(
                              10,
                              Math.round(
                                (point.value / Math.max(1, trend.best)) * 100,
                              ),
                            )}%`,
                          }}
                          title={`${new Date(point.at).toISOString().slice(0, 10)}: ${point.value}`}
                        ></div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </section>
          <section class="grid gap-3" data-testid="streaks-per-game">
            <div class="text-sub">per game</div>
            <For each={view()?.perGame ?? []}>
              {(game) => (
                <SummaryRow
                  label={game.label}
                  current={game.summary.current}
                  longest={game.summary.longest}
                  unit="days"
                  testId={`streak-game-${game.gameId}`}
                />
              )}
            </For>
            <Show when={(view()?.perGame.length ?? 0) === 0}>
              <div class="text-xs text-sub">
                play a game that tracks its history to grow a game streak
              </div>
            </Show>
          </section>
          <div class={cn("text-xs text-sub")}>
            a streak survives while its last entry is today or yesterday — a
            full missed day breaks the chain.
          </div>
        </Show>
      </Show>
    </div>
  );
}
