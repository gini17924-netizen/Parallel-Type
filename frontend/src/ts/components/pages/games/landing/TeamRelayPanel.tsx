import { createSignal, For, JSXElement, Show } from "solid-js";

import { getLanClients, getLanRole } from "../../../../states/lan";
import {
  getRelayState,
  isMyRelayTurn,
  isRelayArmed,
  relayTypeKey,
  startTeamRelay,
} from "../../../../states/lan-relay";
import { showErrorNotification } from "../../../../states/notifications";
import { cn } from "../../../../utils/cn";
import { Button } from "../../../common/Button";

/**
 * phase 111: the team relay panel inside the lobby's connected view — the
 * host pastes the shared word list and starts; every seated seat types
 * ITS own words (the event-replay lockstep keeps all machines in
 * agreement), unseated seats and the progress rows stay read-only.
 */
export function TeamRelayPanel(): JSXElement {
  const [relayDraft, setRelayDraft] = createSignal("");

  const startRelayMatch = (): void => {
    const words = relayDraft()
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const clientIds = Object.keys(getLanClients())
      .map(Number)
      .filter((id) => Number.isFinite(id));
    if (!startTeamRelay(words, clientIds)) {
      showErrorNotification(
        "a team relay needs at least two seats and at least one word",
      );
      return;
    }
    setRelayDraft("");
  };

  const onRelayKey = (event: KeyboardEvent): void => {
    if (event.key.length !== 1) return;
    event.preventDefault();
    relayTypeKey(event.key);
  };

  const totalWords = (): number =>
    getRelayState()?.players.reduce((sum, p) => sum + p.words.length, 0) ?? 0;

  return (
    <div class="grid gap-2 rounded bg-bg p-4" data-testid="team-relay-block">
      <div class="text-sub">team relay (phase 111)</div>
      <Show
        when={isRelayArmed()}
        fallback={
          <Show
            when={getLanRole() === "host"}
            fallback={
              <div class="text-xs text-sub">
                waiting for the host to start a relay…
              </div>
            }
          >
            <textarea
              class="rounded bg-bg p-2 text-sm text-text"
              rows="2"
              placeholder="paste the shared word list — seats are dealt word-by-word"
              value={relayDraft()}
              data-testid="relay-input"
              onInput={(event) => {
                setRelayDraft(event.currentTarget.value);
              }}
            ></textarea>
            <Button
              text="start team relay"
              fa={{ icon: "fa-users" }}
              class="w-full"
              disabled={relayDraft().trim() === ""}
              data-testid="relay-start"
              onClick={startRelayMatch}
            />
          </Show>
        }
      >
        <Show
          when={isMyRelayTurn()}
          fallback={
            <div class="text-xs text-sub" data-testid="relay-waiting">
              waiting — it is another seat&apos;s word
            </div>
          }
        >
          <div class="grid gap-1" data-testid="relay-my-word">
            <div class="text-xs text-sub">your word — type it:</div>
            <input
              class="rounded bg-bg p-2 font-mono text-lg text-main"
              data-testid="relay-type-input"
              onKeyDown={onRelayKey}
            />
          </div>
        </Show>
        <div class="text-xs text-sub tabular-nums">
          word {getRelayState()?.cursor ?? 0} of {totalWords()} — seat{" "}
          {getRelayState()?.activePlayerId ?? "?"} is up
        </div>
        <div class="grid grid-cols-2 gap-1">
          <For each={getRelayState()?.players ?? []}>
            {(player) => (
              <div
                class={cn(
                  "rounded p-2 text-xs",
                  player.playerId === getRelayState()?.activePlayerId
                    ? "bg-main text-bg"
                    : "bg-sub-alt text-sub",
                )}
              >
                seat {player.playerId}: {player.done}/{player.words.length} done
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
