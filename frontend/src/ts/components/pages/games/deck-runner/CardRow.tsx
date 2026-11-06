import { For, JSXElement, Show } from "solid-js";

import { cn } from "../../../../utils/cn";
import { JOKER_REGISTRY } from "../../../../utils/deck-runner/cards";

/**
 * Card rendering for Deck Runner (idea G24): joker row during a run and the
 * buyable/claimable grids in reward/shop. Pure CSS cards - no sprites (v1).
 */

const RARITY_RING: Record<string, string> = {
  common: "border-sub",
  rare: "border-main",
  legendary: "border-colorful-error",
};

export function CardRow(props: {
  jokerIds: string[];
  costs?: Record<string, number>;
  selectable?: boolean;
  onSelect?: (jokerId: string) => void;
}): JSXElement {
  return (
    <div class="grid grid-cols-2 gap-2 lg:grid-cols-3">
      <For each={props.jokerIds}>
        {(jokerId) => {
          const def = JOKER_REGISTRY[jokerId];
          if (def === undefined) return null;
          const cost = props.costs?.[jokerId];
          return (
            <button
              type="button"
              class={cn(
                "grid gap-1 rounded border-2 bg-bg p-3 text-left transition-[border-color,transform]",
                props.selectable === true && "hover:-translate-y-0.5",
                RARITY_RING[def.rarity] ?? "border-sub",
              )}
              onClick={() => {
                if (props.selectable === true) props.onSelect?.(jokerId);
              }}
              disabled={props.selectable !== true}
            >
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-text">{def.name}</span>
                <Show when={cost !== undefined}>
                  <span class="text-sm text-main">{cost}g</span>
                </Show>
              </div>
              <div class="text-xs text-sub">{def.description}</div>
              <div
                class={cn(
                  "text-xs tracking-widest uppercase",
                  def.rarity === "legendary"
                    ? "text-colorful-error"
                    : def.rarity === "rare"
                      ? "text-main"
                      : "text-sub",
                )}
              >
                {def.rarity}
              </div>
            </button>
          );
        }}
      </For>
    </div>
  );
}
