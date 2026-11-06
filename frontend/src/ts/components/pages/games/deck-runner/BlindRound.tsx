import { For, JSXElement, onCleanup, Show } from "solid-js";

import {
  deckBlindInfo,
  deckQueue,
  deckRound,
  deckRun,
  handleDeckKey,
} from "../../../../states/deck-runner";
import { cn } from "../../../../utils/cn";
import { CardRow } from "./CardRow";

/**
 * The blind round (idea G24): HUD (quota/score/budget/combo/gold), the word
 * stream (current word large with dir="auto", upcoming words small), the
 * joker row, and the key handling delegated to the state layer.
 *
 * Keys: single characters type the word (wrong key = combo break + error),
 * Backspace undoes, SPACE skips the word (burns budget), modifier combos
 * stay with the browser/app.
 */

export function BlindRound(): JSXElement {
  const runState = () => deckRun();
  const roundState = () => deckRound();
  const info = () => deckBlindInfo();

  const handleKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1 || event.key === "Backspace") {
      event.preventDefault();
      handleDeckKey(event.key);
    }
  };

  window.addEventListener("keydown", handleKey);
  onCleanup(() => window.removeEventListener("keydown", handleKey));

  return (
    <div class="content-grid grid gap-6">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="blind hud">
        <HudCell label="quota" value={String(info()?.quota ?? 0)} />
        <HudCell label="score" value={String(roundState()?.score ?? 0)} />
        <HudCell
          label="words left"
          value={String(Math.floor(roundState()?.wordsLeft ?? 0))}
        />
        <HudCell label="combo" value={`x${roundState()?.combo ?? 0}`} />
        <HudCell label="gold" value={String(runState()?.gold ?? 0)} />
      </div>

      <section
        class="grid gap-4 rounded bg-sub-alt p-6 md:p-10"
        aria-label="typing area"
      >
        <Show when={roundState() !== null}>
          <div class="text-center">
            <div
              class={cn(
                "text-4xl font-bold md:text-5xl",
                (roundState()?.errorsThisWord ?? 0) > 0 && "text-error",
              )}
              dir="auto"
            >
              {roundState()?.currentWord}
            </div>
            <div
              class="mt-2 font-mono text-lg tracking-widest text-sub"
              dir="ltr"
            >
              <span class="text-text">{roundState()?.buffer}</span>
              <span>
                {"_".repeat(
                  Math.max(
                    0,
                    (roundState()?.currentWord.length ?? 0) -
                      (roundState()?.buffer.length ?? 0),
                  ),
                )}
              </span>
            </div>
          </div>
          <div class="grid gap-1 text-center text-sub" dir="auto">
            <For each={deckQueue()}>
              {(word) => <div class="text-sm opacity-60">{word}</div>}
            </For>
          </div>
          <div class="text-center text-xs text-sub">
            type the word - space skips it (still burns budget)
          </div>
        </Show>
      </section>

      <Show when={runState() !== null}>
        <section class="grid gap-2" aria-label="jokers">
          <div class="text-xs font-bold tracking-widest text-sub uppercase">
            jokers ({runState()?.jokers.length ?? 0}/5)
          </div>
          <Show
            when={(runState()?.jokers.length ?? 0) > 0}
            fallback={
              <div class="text-xs text-sub">
                no jokers yet — win blinds, visit the shop
              </div>
            }
          >
            <CardRow jokerIds={runState()?.jokers ?? []} />
          </Show>
        </section>
      </Show>
    </div>
  );
}

function HudCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-3 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}
