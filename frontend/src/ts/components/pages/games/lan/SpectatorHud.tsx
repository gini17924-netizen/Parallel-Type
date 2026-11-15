import { For, JSXElement, Show } from "solid-js";

import { getLanClients } from "../../../../states/lan";
import { getLanRoomClients } from "../../../../states/lan-match";
import { cn } from "../../../../utils/cn";

/**
 * phase 113: the shared spectator HUD — the live per-seat progress for a
 * LAN match's non-playing seats. the games' progress contracts differ
 * (score races carry `score`, climber adds `height`, sprint/runner carry
 * `distance`/`wpm`) so the numeric summary prefers the known fields and
 * falls back to whatever scalars the contract ships.
 */
function progressLine(progress: Record<string, unknown> | undefined): string {
  if (progress === undefined) return "waiting for the first tick…";
  const parts: string[] = [];
  const read = (key: string): number | undefined => {
    const value = progress[key];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  };
  const score = read("score");
  if (score !== undefined) parts.push(`score ${score}`);
  const height = read("height");
  if (height !== undefined) parts.push(`height ${height}`);
  const distance = read("distance");
  if (distance !== undefined) parts.push(`distance ${distance}`);
  const wpm = read("wpm");
  if (wpm !== undefined) parts.push(`${wpm} wpm`);
  if (parts.length === 0) {
    //unknown contract: show the scalar fields it does ship
    for (const [key, value] of Object.entries(progress)) {
      if (typeof value === "number") parts.push(`${key} ${value}`);
    }
  }
  return parts.length === 0 ? "no progress yet" : parts.join(" · ");
}

export function LanSpectatorHud(props: { gameId?: string }): JSXElement {
  type RoomClient = {
    clientId: number;
    progress?: Record<string, unknown>;
    finished?: { finishMs: number | null; acc: number };
  };
  const clients = Object.values(getLanRoomClients()) as RoomClient[];
  return (
    <section
      class="grid gap-2 rounded bg-sub-alt p-4"
      data-testid="lan-spectator-hud"
    >
      <div class="text-sm text-sub">
        spectating — the racers&apos; live progress
        <Show when={props.gameId !== undefined}> · {props.gameId}</Show>
      </div>
      <For each={clients}>
        {(client) => (
          <div
            class={cn(
              "rounded p-2",
              client.finished !== undefined ? "bg-main/20" : "bg-bg",
            )}
          >
            <div class="text-xs font-bold text-main">
              {getLanClients()[client.clientId]?.name ??
                `client ${client.clientId}`}
              <Show when={client.finished !== undefined}>
                <span class="ml-2 text-sub">finished</span>
              </Show>
            </div>
            <div class="text-xs text-sub">{progressLine(client.progress)}</div>
          </div>
        )}
      </For>
    </section>
  );
}
