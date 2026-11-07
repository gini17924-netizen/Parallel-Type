import { For, JSXElement, Match, Show, Switch, createSignal } from "solid-js";

import type { DeckRunState } from "../../../../utils/deck-runner/run-engine";

import {
  abandonRun,
  buyShopCard,
  claimRewardCard,
  continueRun,
  dailySeed,
  deckHasSave,
  deckRun,
  deckStats,
  proceedNextBlind,
  rerollShopOffers,
  skipRewardCard,
  sourceOptions,
  startNewRun,
} from "../../../../states/deck-runner";
import { cn } from "../../../../utils/cn";
import { jokerRuntime } from "../../../../utils/deck-runner/cards";
import {
  shopOffers as shopOffersEngine,
  rewardOffers as rewardOffersEngine,
} from "../../../../utils/deck-runner/shop";
import { buildCurrentWeakness } from "../../../../utils/smart-drill";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";
import { BlindRound } from "./BlindRound";
import { CardRow } from "./CardRow";

/**
 * Deck Runner page (idea G24, phase 3): one route, the phases rendered from
 * the run state machine - menu / blind / reward / shop / gameover. The
 * keyboard lives in BlindRound; menu/shop/gameover are click-driven.
 *
 * Shop/reward offers are NOT stored: they derive deterministically from the
 * run position (seed ^ ante/blind/rerolls), so they recompute live.
 */

function hasWeaknessEvidence(): boolean {
  return Object.keys(buildCurrentWeakness()).length > 0;
}

function shopOfferList(): { jokerId: string; cost: number }[] {
  const state = deckRun();
  if (state === null) return [];
  return shopOffersEngine(
    state,
    jokerRuntime(state.jokers),
    hasWeaknessEvidence(),
  );
}

function rewardOfferList(): string[] {
  const state = deckRun();
  if (state === null) return [];
  return rewardOffersEngine(state, hasWeaknessEvidence());
}

export function DeckRunnerPage(): JSXElement {
  const [selectedSource, setSelectedSource] = createSignal("en-1k");

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-layer-group" }} text="deck runner" />
        <p class="text-sub">
          a typing roguelite: clear word quotas, earn gold, buy jokers that
          rewrite the rules — one bad streak away from starting over.
        </p>
      </section>

      <Show
        when={deckRun() !== null}
        fallback={
          <Menu
            selectedSource={selectedSource}
            setSelectedSource={setSelectedSource}
          />
        }
      >
        <Switch>
          <Match when={deckRun()?.phase === "blind"}>
            <BlindRound />
          </Match>
          <Match when={deckRun()?.phase === "reward"}>
            <RewardPhase />
          </Match>
          <Match when={deckRun()?.phase === "shop"}>
            <ShopPhase />
          </Match>
          <Match when={deckRun()?.phase === "gameover"}>
            <GameoverPhase />
          </Match>
        </Switch>
      </Show>
    </div>
  );
}

function Menu(props: {
  selectedSource: () => string;
  setSelectedSource: (id: string) => void;
}): JSXElement {
  const [confirmAbandon, setConfirmAbandon] = createSignal(false);
  return (
    <>
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="text-sub">new run — word source</div>
        <div class="grid gap-2">
          <For each={sourceOptions()}>
            {(option) => (
              <button
                type="button"
                class={cn(
                  "rounded p-2 text-left transition-[background,color]",
                  props.selectedSource() === option.id
                    ? "bg-bg text-main"
                    : "text-sub hover:text-text",
                )}
                onClick={() => props.setSelectedSource(option.id)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <Button
            text="new run"
            fa={{ icon: "fa-play" }}
            class="w-full"
            onClick={() => {
              void startNewRun({
                wordSourceId: props.selectedSource(),
                language: props.selectedSource().startsWith("fa")
                  ? "persian"
                  : "english",
              });
            }}
          />
          <Button
            text="daily run"
            fa={{ icon: "fa-calendar-day" }}
            class="w-full"
            onClick={() => {
              void startNewRun({
                wordSourceId: props.selectedSource(),
                language: props.selectedSource().startsWith("fa")
                  ? "persian"
                  : "english",
                seed: dailySeed(),
              });
            }}
          />
        </div>
        <Show when={deckHasSave()}>
          <Button
            text="continue run"
            fa={{ icon: "fa-forward" }}
            class="w-full"
            onClick={() => {
              void continueRun();
            }}
          />
        </Show>
      </section>

      <section class="grid gap-2 rounded bg-sub-alt p-4">
        <div class="text-xs font-bold tracking-widest text-sub uppercase">
          records
        </div>
        <div class="grid grid-cols-3 gap-2">
          <StatCell label="runs" value={String(deckStats()?.runs ?? 0)} />
          <StatCell
            label="best score"
            value={String(deckStats()?.bestScore ?? 0)}
          />
          <StatCell
            label="best ante"
            value={String(deckStats()?.bestAnte ?? 0)}
          />
        </div>
        <Button
          text={
            confirmAbandon()
              ? "tap again to abandon (deletes the run)"
              : "abandon resumable run"
          }
          fa={{ icon: "fa-trash" }}
          class="w-full"
          onClick={() => {
            //two-step confirm: an accidental click must not delete a live run
            if (confirmAbandon()) {
              abandonRun();
              setConfirmAbandon(false);
            } else {
              setConfirmAbandon(true);
              window.setTimeout(() => setConfirmAbandon(false), 3000);
            }
          }}
        />
      </section>

      <Show when={(deckStats()?.history.length ?? 0) > 0}>
        <div class="text-xs font-bold tracking-widest text-sub uppercase">
          recent runs
        </div>
        <For each={deckStats()?.history ?? []}>
          {(summary) => (
            <div class="flex items-baseline justify-between rounded bg-bg p-2 text-sm">
              <span>
                ante {summary.ante} ·{" "}
                <span class={summary.won ? "text-main" : "text-error"}>
                  {summary.won ? "won" : "lost"}
                </span>
              </span>
              <span class="text-sub">
                {new Date(summary.date).toLocaleDateString()} · {summary.score}{" "}
                pts
              </span>
            </div>
          )}
        </For>
      </Show>
    </>
  );
}

function RewardPhase(): JSXElement {
  const rewards = rewardOfferList();
  return (
    <section class="grid gap-4 rounded bg-sub-alt p-4">
      <div class="flex items-baseline justify-between">
        <div class="text-sub">reward — pick 1 of 3</div>
        <div class="text-main tabular-nums">{deckRun()?.gold ?? 0}g</div>
      </div>
      <CardRow
        jokerIds={rewards}
        selectable={true}
        onSelect={(jokerId) => claimRewardCard(jokerId)}
      />
      <Button
        text="skip reward"
        fa={{ icon: "fa-forward" }}
        class="w-full"
        onClick={() => skipRewardCard()}
      />
    </section>
  );
}

function ShopPhase(): JSXElement {
  const offers = shopOfferList();
  const costs: Record<string, number> = {};
  for (const offer of offers) costs[offer.jokerId] = offer.cost;
  return (
    <section class="grid gap-4 rounded bg-sub-alt p-4">
      <div class="flex items-baseline justify-between">
        <div class="text-sub">shop — buy jokers with gold</div>
        <div class="text-main tabular-nums">{deckRun()?.gold ?? 0}g</div>
      </div>
      <Show
        when={offers.length > 0}
        fallback={<div class="text-sub">sold out — reroll or continue</div>}
      >
        <CardRow
          jokerIds={offers.map((o) => o.jokerId)}
          costs={costs}
          selectable={true}
          onSelect={(jokerId) => buyShopCard(jokerId)}
        />
      </Show>
      <div class="grid grid-cols-2 gap-2">
        <Button
          text="reroll (2g)"
          fa={{ icon: "fa-dice" }}
          class="w-full"
          onClick={() => rerollShopOffers()}
        />
        <Button
          text="next blind"
          fa={{ icon: "fa-play" }}
          class="w-full"
          onClick={() => void proceedNextBlind()}
        />
      </div>
    </section>
  );
}

function GameoverPhase(): JSXElement {
  const runState = () => deckRun();
  return (
    <section class="grid gap-4 rounded bg-sub-alt p-6 text-center">
      <div class="text-3xl font-bold text-error">run over</div>
      <div class="grid grid-cols-2 gap-2">
        <StatCell label="ante reached" value={String(runState()?.ante ?? 0)} />
        <StatCell
          label="total score"
          value={String(runState()?.totalScore ?? 0)}
        />
      </div>
      <div class="text-sub">
        jokers:{" "}
        {(runState()?.jokers ?? []).length > 0
          ? (runState()?.jokers ?? []).join(", ")
          : "none"}
      </div>
      <Button
        text="back to menu"
        fa={{ icon: "fa-home" }}
        class="w-full"
        onClick={() => abandonRun()}
      />
    </section>
  );
}

function StatCell(props: { label: string; value: string }): JSXElement {
  return (
    <div class="rounded bg-bg p-3 text-center">
      <div class="text-xl font-bold text-main tabular-nums">{props.value}</div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

//kept for the phase-4 playtest: the raw run state of the active game
export type DeckRunnerPageProps = { debugState?: DeckRunState };
