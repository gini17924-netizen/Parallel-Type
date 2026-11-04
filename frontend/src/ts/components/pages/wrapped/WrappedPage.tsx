import { Link } from "@tanstack/solid-router";
import {
  For,
  JSXElement,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { loadLocalResults } from "../../../utils/local-persistence";
import {
  computeWrappedStats,
  type WrappedStats,
} from "../../../utils/wrapped-stats";
import { Button } from "../../common/Button";
import { H2 } from "../../common/Headers";

const GATSBY_WORDS = "The Great Gatsby";

function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

/** simple horizontal bar built from divs — no chart library */
function Bar(props: {
  value: number;
  max: number;
  label: string;
  note: string;
}): JSXElement {
  return (
    <div class="flex items-center gap-2 text-sm">
      <div class="w-20 shrink-0 text-sub">{props.label}</div>
      <div class="h-3 grow rounded bg-bg">
        <div
          class="h-3 rounded bg-main"
          style={{
            width: `${props.max > 0 ? Math.max(2, (props.value / props.max) * 100) : 0}%`,
          }}
        ></div>
      </div>
      <div class="w-24 shrink-0 text-right text-sub">{props.note}</div>
    </div>
  );
}

type Slide = { title: string; body: JSXElement };

function buildSlides(stats: WrappedStats): Slide[] {
  const maxMonth = Math.max(
    ...stats.journey.months.map((month) => month.avgWpm),
    1,
  );
  const maxHour = Math.max(...stats.timing.hourlyCounts, 1);

  return [
    {
      title: "your year in typing",
      body: (
        <div class="grid gap-2 text-center">
          <div class="text-6xl font-bold text-main">
            {fmt(stats.hook.totalWords)}
          </div>
          <div class="text-sub">words typed</div>
          <div class="text-sub">
            in {round(stats.hook.totalSeconds / 3600)} hours across{" "}
            {fmt(stats.hook.totalTests)} tests
          </div>
          <div class="text-sm text-sub opacity-80">
            ≈{" "}
            {stats.hook.gatsbyPct < 100
              ? `${stats.hook.gatsbyPct}% of ${GATSBY_WORDS}`
              : `${Math.floor(stats.hook.gatsbyPct / 100)}× ${GATSBY_WORDS}`}
          </div>
        </div>
      ),
    },
    {
      title: "the year in numbers",
      body: (
        <div class="grid grid-cols-2 gap-4 text-center">
          <Stat label="tests taken" value={fmt(stats.hook.totalTests)} />
          <Stat
            label="characters typed"
            value={fmt(stats.yearInNumbers.totalCharacters)}
          />
          <Stat
            label="active days"
            value={`${stats.yearInNumbers.activeDays} (${stats.yearInNumbers.activeDaysPct}%)`}
          />
          <Stat
            label="longest daily streak"
            value={`${stats.yearInNumbers.longestDayStreak} days`}
          />
        </div>
      ),
    },
    {
      title: "your journey",
      body: (
        <div class="grid gap-4">
          <div class="text-center text-lg">
            <span class="text-main">{stats.journey.firstMonthAvgWpm}</span>
            <span class="text-sub"> → </span>
            <span class="text-main">{stats.journey.lastMonthAvgWpm}</span>
            <span class="text-sub"> wpm · first → last month </span>
            <span
              class={
                stats.journey.improvement >= 0 ? "text-main" : "text-error"
              }
            >
              ({stats.journey.improvement >= 0 ? "+" : ""}
              {stats.journey.improvement})
            </span>
          </div>
          <div class="grid gap-1">
            <For each={stats.journey.months}>
              {(month) => (
                <Bar
                  label={month.month}
                  value={month.avgWpm}
                  max={maxMonth}
                  note={`${month.avgWpm} wpm · ${month.testCount} tests`}
                />
              )}
            </For>
          </div>
          <div class="text-center text-sub">
            best month: <span class="text-main">{stats.journey.bestMonth}</span>
            <Show when={stats.journey.biggestJump !== undefined}>
              {" · biggest jump: "}
              <span class="text-main">
                {stats.journey.biggestJump?.month} (+
                {stats.journey.biggestJump?.amount})
              </span>
            </Show>
          </div>
        </div>
      ),
    },
    {
      title: "peak performance",
      body: (
        <div class="grid gap-4">
          <div class="text-center">
            <div class="text-6xl font-bold text-main">{stats.peak.bestWpm}</div>
            <div class="text-sub">
              best wpm · {new Date(stats.peak.bestWpmDate).toLocaleDateString()}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4 text-center">
            <Stat label="personal bests hit" value={fmt(stats.peak.pbsHit)} />
            <Stat
              label="perfect accuracy tests"
              value={`${fmt(stats.peak.perfectAccCount)} (${stats.hook.totalTests > 0 ? Math.round((stats.peak.perfectAccCount / stats.hook.totalTests) * 100) : 0}%)`}
            />
          </div>
          <div class="grid gap-1">
            <For each={stats.peak.thresholds}>
              {(threshold) => (
                <Bar
                  label={`${threshold.wpm}+ wpm`}
                  value={threshold.count}
                  max={stats.hook.totalTests}
                  note={`${threshold.count} tests`}
                />
              )}
            </For>
          </div>
        </div>
      ),
    },
    {
      title: "when you type",
      body: (
        <div class="grid gap-4">
          <div class="grid grid-cols-2 gap-4 text-center">
            <Stat
              label="best hour"
              value={`${hourLabel(stats.timing.bestHour)} (${stats.timing.bestHourWpm} wpm)`}
            />
            <Stat
              label="worst hour"
              value={`${hourLabel(stats.timing.worstHour)} (${stats.timing.worstHourWpm} wpm)`}
            />
            <Stat label="best day" value={stats.timing.bestDay} />
            <Stat label="time preference" value={stats.timing.timePreference} />
          </div>
          <div class="grid gap-1">
            <For each={stats.timing.hourlyCounts}>
              {(count, hour) => (
                <Show when={count > 0}>
                  <Bar
                    label={hourLabel(hour())}
                    value={count}
                    max={maxHour}
                    note={`${count} tests`}
                  />
                </Show>
              )}
            </For>
          </div>
        </div>
      ),
    },
    {
      title: "your typing personas",
      body: (
        <div class="grid gap-4">
          <For each={stats.personas}>
            {(persona) => (
              <div
                class={`rounded p-4 ${persona.isUser === true ? "bg-main text-bg" : "bg-bg text-main"}`}
              >
                <div class="flex items-baseline justify-between">
                  <div class="text-lg font-bold">{persona.label}</div>
                  <div class="text-sm opacity-80">
                    {persona.share}% of your tests
                  </div>
                </div>
                <div class="text-sm opacity-90">{persona.description}</div>
                <div class="text-xs opacity-80">
                  {persona.avgWpm} wpm · {persona.avgAcc}% acc ·{" "}
                  {persona.avgConsistency}% consistency
                  <Show when={persona.isUser === true}> · this is you</Show>
                </div>
              </div>
            )}
          </For>
        </div>
      ),
    },
    {
      title: "warmup",
      body: (
        <div class="grid gap-4">
          <div class="grid grid-cols-2 gap-4 text-center">
            <Stat
              label="cold start"
              value={`${stats.warmup.coldStartWpm} wpm`}
            />
            <Stat label="warmed up" value={`${stats.warmup.warmedUpWpm} wpm`} />
          </div>
          <div class="text-center text-lg">
            <span
              class={stats.warmup.improvement > 0 ? "text-main" : "text-sub"}
            >
              {stats.warmup.improvement > 0 ? "+" : ""}
              {stats.warmup.improvement} wpm after a few tests
            </span>
          </div>
          <div class="text-center text-sub">
            {stats.warmup.sessions} sessions · longest{" "}
            {stats.warmup.longestSession} tests · peak around test #
            {stats.warmup.testsUntilPeak}
          </div>
          <div class="grid gap-1">
            <For each={stats.warmup.curve}>
              {(point) => (
                <Bar
                  label={`test ${point.testNumber}`}
                  value={point.avgWpm}
                  max={Math.max(
                    ...stats.warmup.curve.map((it) => it.avgWpm),
                    1,
                  )}
                  note={`${point.avgWpm} wpm`}
                />
              )}
            </For>
          </div>
        </div>
      ),
    },
    {
      title: "your quirks",
      body: (
        <div class="grid grid-cols-2 gap-4 text-center">
          <Stat label="restart addiction" value={stats.quirks.restartLevel} />
          <Stat
            label="avg restarts per test"
            value={String(stats.quirks.avgRestarts)}
          />
          <Stat
            label="first-try tests"
            value={`${stats.quirks.firstTryPct}%`}
          />
          <Stat
            label={'time "wasted"'}
            value={`${stats.quirks.wastedMinutes} min`}
          />
          <Stat
            label="favorite mode"
            value={`${stats.quirks.favoriteMode} (${fmt(stats.quirks.favoriteModeCount)})`}
          />
          <Stat
            label="max restarts in one test"
            value={String(stats.quirks.maxRestarts)}
          />
        </div>
      ),
    },
    {
      title: "accuracy deep dive",
      body: (
        <div class="grid gap-4">
          <div class="text-center text-lg">
            <span class="text-main">{stats.accuracy.overall}%</span>
            <span class="text-sub">
              {" "}
              average accuracy · {fmt(stats.accuracy.totalErrors)} errors
            </span>
          </div>
          <div class="grid gap-1">
            <Bar
              label="wrong key"
              value={stats.accuracy.wrongKeyPct}
              max={100}
              note={`${stats.accuracy.wrongKeyPct}%`}
            />
            <Bar
              label="extra chars"
              value={stats.accuracy.extraPct}
              max={100}
              note={`${stats.accuracy.extraPct}%`}
            />
            <Bar
              label="missed chars"
              value={stats.accuracy.missedPct}
              max={100}
              note={`${stats.accuracy.missedPct}%`}
            />
          </div>
          <div class="text-center text-sub">
            clutch factor:{" "}
            <span class="text-main">
              {stats.accuracy.clutchDelta >= 0 ? "+" : ""}
              {stats.accuracy.clutchDelta}%
            </span>{" "}
            accuracy on your fastest tests vs slowest
          </div>
        </div>
      ),
    },
    {
      title: "share your year",
      body: (
        <div class="grid gap-4">
          <div class="grid place-items-center rounded bg-bg p-8 text-center">
            <div>
              <div class="text-sm text-sub">ParallelType · year wrapped</div>
              <div class="my-3 text-2xl font-bold text-main">
                I typed {fmt(stats.hook.totalWords)} words in the last 365 days!
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div class="text-sub">average wpm</div>
                  <div class="text-xl text-main">{stats.hook.avgWpm}</div>
                </div>
                <div>
                  <div class="text-sub">peak wpm</div>
                  <div class="text-xl text-main">{stats.peak.bestWpm}</div>
                </div>
                <div>
                  <div class="text-sub">tests</div>
                  <div class="text-xl text-main">
                    {fmt(stats.hook.totalTests)}
                  </div>
                </div>
                <div>
                  <div class="text-sub">active days</div>
                  <div class="text-xl text-main">
                    {stats.yearInNumbers.activeDays}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="text-center text-xs text-sub opacity-70">
            concept inspired by MonkeytypeWrapped (Vibhor7-7, MIT) — computed
            entirely from this device&apos;s local data
          </div>
        </div>
      ),
    },
  ];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function Stat(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-4">
      <div class="text-2xl font-bold text-main">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/** Year Wrapped: an animated recap of the last 365 days of local results. */
export function WrappedPage(): JSXElement {
  const [stats, setStats] = createSignal<WrappedStats | undefined>(undefined);
  const [loaded, setLoaded] = createSignal(false);
  const [slide, setSlide] = createSignal(0);

  onMount(async () => {
    const results = await loadLocalResults();
    setStats(computeWrappedStats(results));
    setLoaded(true);
  });

  const slides = (): Slide[] => {
    const current = stats();
    return current === undefined ? [] : buildSlides(current);
  };

  const next = (): void => {
    setSlide(Math.min(slide() + 1, slides().length - 1));
  };
  const previous = (): void => {
    setSlide(Math.max(slide() - 1, 0));
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (
      event.key === "ArrowRight" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      previous();
    }
  };
  onMount(() => {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  return (
    <div class="content-grid grid gap-8">
      <style>{`
        @keyframes wrapped-slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .wrapped-slide { animation: wrapped-slide-in 0.25s ease-out; }
      `}</style>
      <section>
        <H2 text="year wrapped" fa={{ icon: "fa-gift" }} />
        <p class="text-sub">
          your last 365 days of typing, computed entirely from this
          device&apos;s local results. use the arrow keys to move between
          slides.
        </p>
      </section>

      <Show
        when={loaded()}
        fallback={<div class="text-sub">computing your year…</div>}
      >
        <Show
          when={stats()?.hook.totalTests !== 0}
          fallback={
            <div class="rounded bg-sub-alt p-8 text-center text-sub">
              not enough data yet — take some tests first.
            </div>
          }
        >
          <section class="grid gap-6 rounded bg-sub-alt p-8">
            <div class="min-h-64">
              <div class="wrapped-slide grid gap-6">
                <div class="text-center text-sm font-bold tracking-widest text-sub uppercase">
                  {slides()[slide()]?.title}
                </div>
                {slides()[slide()]?.body}
              </div>
            </div>
            <div class="flex items-center justify-between">
              <Button
                text="← back"
                onClick={previous}
                disabled={slide() === 0}
              />
              <div class="flex gap-1">
                <For each={slides()}>
                  {(_, index) => (
                    <div
                      class={`h-2 w-2 rounded-full ${index() === slide() ? "bg-main" : "bg-bg"}`}
                    ></div>
                  )}
                </For>
              </div>
              <Button
                text={slide() === slides().length - 1 ? "done →" : "next →"}
                onClick={next}
                disabled={slide() === slides().length - 1}
              />
            </div>
          </section>
          <div class="text-center">
            <Link to="/account" class="text-sm text-sub hover:text-main">
              ← back to account
            </Link>
          </div>
        </Show>
      </Show>
    </div>
  );
}
