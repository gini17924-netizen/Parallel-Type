import { Show, JSXElement } from "solid-js";

import { ghostScoreAt, type GhostRun } from "../../../../utils/ghost/ghost-store";

/**
 * The shared ghost overlay (phase 82): the previous best run's score at
 * the current tick vs yours — the same little meter in every wired game.
 * Pure rendering: the delta sign is the whole story.
 */
export function GhostMeter(props: {
  ghost: GhostRun | undefined;
  tick: number;
  score: number;
}): JSXElement {
  const ghostScore = () => ghostScoreAt(props.ghost, props.tick);
  return (
    <Show when={ghostScore() !== undefined}>
      <div
        class="rounded bg-bg p-2 text-xs text-sub"
        data-testid="ghost-meter"
      >
        <span class="font-bold text-sub">ghost: </span>
        <span class="tabular-nums">{ghostScore()}</span>
        {" — you: "}
        <span
          class={`font-bold tabular-nums ${
            props.score >= (ghostScore() ?? 0) ? "text-main" : "text-error"
          }`}
        >
          {props.score}
        </span>
        <span class="text-sub">
          {props.score >= (ghostScore() ?? 0) ? " (ahead)" : " (behind)"}
        </span>
      </div>
    </Show>
  );
}
