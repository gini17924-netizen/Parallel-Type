import { createSignal, For, JSXElement, onMount, Show } from "solid-js";

import { cn } from "../../../utils/cn";
import { buildStreakView, type StreakView } from "../../../utils/streaks/state";

/**
 * phase 98: THE unified streak view — daily, weekly and per-game streaks
 * side by side, all fed from the same pure engine. the daily rule: a
 * streak stays alive while its last day is today or yesterday.
 */
export function StreaksPage(): JSXElement {
  const [view, setView] = createSignal<StreakView | undefined>(undefined);
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
