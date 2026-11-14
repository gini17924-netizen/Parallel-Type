import { createEffect, For, JSXElement, Show, createSignal } from "solid-js";

import { navigate } from "../../../../router/navigate";
import { getLanPeerName } from "../../../../states/lan";
import { H2 } from "../../../common/Headers";
import {
  getLanMatch,
  getLanRawMessage,
  getRemoteFinished,
  sendLanMatchFinished,
  sendLanMatchMessage,
} from "../../../../states/lan-match";
import {
  createRelayEngine,
  type RelayEngine,
  type RelaySide,
} from "../../../../utils/relay/relay-engine";
import { playClick, playError } from "../../../../controllers/sound-controller";
import { Button } from "../../../common/Button";

/**
 * The word relay page (phase 83): two players alternate words on ONE
 * shared list — the host takes the even words, the client the odd ones.
 * The turn is derived from the global word index; the partner's cursor
 * arrives through the raw passthrough (the V pattern) and the team
 * finishes when the whole list is covered. There is no own race clock —
 * the co-op's verdict is the shared completion time.
 */

export function RelayPage(): JSXElement {
  const match = getLanMatch();
  const role = match?.role ?? "client";
  const side: RelaySide = role === "host" ? 0 : 1;
  const words = match?.start.words ?? [];

  const [myTyped, setMyTyped] = createSignal("");
  const [wrongFlash, setWrongFlash] = createSignal(false);
  const [finished, setFinished] = createSignal<{
    elapsedMs: number;
  } | undefined>(undefined);
  const [teamTime, setTeamTime] = createSignal<number | undefined>(undefined);

  let startedAt: number | undefined;
  let myFinishAt: number | undefined;
  let theirFinishSeen = false;
  let engine: RelayEngine | undefined;

  if (words.length >= 4) {
    engine = createRelayEngine(words, side);
  }

  const state = (): ReturnType<RelayEngine["state"]> | undefined =>
    engine?.state();

  const myTurn = (): boolean => state()?.turn === side;

  const globalIndex = (): number => state()?.globalIndex ?? 0;

  const handleWord = (): void => {
    const word = myTyped().trim();
    if (word === "" || engine === undefined) return;
    if (!engine.feedWord(word)) {
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 400);
      void playError();
      return;
    }
    startedAt ??= performance.now();
    void playClick();
    setMyTyped("");
    //the raw passthrough: the partner's cursor rides the same pipe
    sendLanMatchMessage({
      type: "relay-progress",
      gameId: "relay",
      myIndex: engine.state().myIndex,
    });
    if (engine.state().myDone) {
      myFinishAt = performance.now();
      sendLanMatchFinished(
        performance.now() - (startedAt ?? performance.now()),
        100,
      );
    }
    if (engine.state().allDone) {
      const elapsed = performance.now() - (startedAt ?? performance.now());
      setFinished({ elapsedMs: elapsed });
    }
  };

  //the partner's cursor + the team finish ride the raw passthrough
  createEffect(() => {
    const raw = getLanRawMessage();
    if (raw === undefined) return;
    if (raw.message["type"] !== "relay-progress" || engine === undefined) return;
    const index = raw.message["myIndex"];
    if (typeof index === "number") engine.setTheirIndex(index);
    if (engine.state().allDone && !finished()) {
      const elapsed = performance.now() - (startedAt ?? performance.now());
      setFinished({ elapsedMs: elapsed });
      if (myFinishAt !== undefined) {
        setTeamTime(Math.max(myFinishAt, performance.now()) - (startedAt ?? performance.now()));
      }
    }
    if (
      getRemoteFinished() !== undefined &&
      !theirFinishSeen &&
      myFinishAt !== undefined
    ) {
      theirFinishSeen = true;
      setTeamTime(
        Math.max(myFinishAt, performance.now()) -
          (startedAt ?? performance.now()),
      );
    }
  });

  createEffect(() => {
    //the team finish lands on the result view once both sides resolved
    const remote = getRemoteFinished();
    if (remote !== undefined && finished() !== undefined) {
      if (teamTime() === undefined && myFinishAt !== undefined) {
        setTeamTime(
          Math.max(myFinishAt, performance.now()) -
            (startedAt ?? performance.now()),
        );
      }
    }
  });

  const peerName = (): string => getLanPeerName() ?? "the partner";

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-people-arrows" }} text="word relay" />
        <p class="text-sub">
          two typists, one word list — you alternate words. {side === 0 ? "you type the even words (1st, 3rd, …)" : "you type the odd words (2nd, 4th, …)"}; {" "}
          {peerName()} covers the rest.
        </p>
      </section>

      <Show
        when={words.length >= 4}
        fallback={
          <div class="rounded bg-sub-alt p-4 text-sm text-sub">
            this relay was started with too few words
          </div>
        }
      >
        <section class="grid gap-4 rounded bg-sub-alt p-4">
          <div class="flex flex-wrap gap-1" dir="auto">
            <For each={words}>
              {(word, index) => (
                <span
                  class={`rounded px-1 ${
                    index() === globalIndex()
                      ? "bg-main text-bg font-bold"
                      : index() % 2 === side
                        ? "bg-sub text-text"
                        : "bg-sub text-sub"
                  }`}
                >
                  {word}
                </span>
              )}
            </For>
          </div>
          <Show when={!finished()}>
            <div
              class={`text-sm ${myTurn() ? "text-main font-bold" : "text-sub"}`}
              data-testid="relay-turn"
            >
              {myTurn()
                ? "your word — type it and hit enter"
                : `waiting for ${peerName()}…`}
            </div>
            <div class="flex items-center gap-2">
              <input
                class="flex-1 rounded bg-bg p-2 text-lg text-text"
                value={myTyped()}
                data-testid="relay-input"
                disabled={!myTurn()}
                spellcheck={false}
                autocomplete="off"
                onInput={(event) => {
                  setMyTyped(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleWord();
                  }
                }}
              />
            </div>
            <Show when={wrongFlash()}>
              <div class="text-sm text-error">not the right word</div>
            </Show>
            <div class="text-xs text-sub">
              progress: {globalIndex()}/{words.length}
            </div>
          </Show>
          <Show when={finished()}>
            <div
              class="rounded bg-main p-4 text-center font-bold text-bg"
              data-testid="relay-result"
            >
              relay complete in {((finished()?.elapsedMs ?? 0) / 1000).toFixed(1)}s
              <Show when={teamTime() !== undefined}>
                {" "}— team clock {((teamTime() ?? 0) / 1000).toFixed(1)}s
              </Show>
            </div>
            <Button
              text="back to the lobby"
              class="w-full"
              onClick={() => {
                void navigate({ to: "/games" });
              }}
            />
          </Show>
        </section>
      </Show>
    </div>
  );
}

