import { JSXElement, Show, createSignal } from "solid-js";

import {
  isLanConnected,
  lanAvailable,
  lanJoin,
  lanLeave,
  lanPreFillName,
  lanStartHost,
  getLanHostInfo,
  getLanPeerName,
} from "../../../../states/lan";
import { Button } from "../../../common/Button";
import { H2 } from "../../../common/Headers";

type LobbyView = "menu" | "hosting" | "joining";

function HudCell(props: {
  label: string;
  value: string;
  testId?: string;
}): JSXElement {
  return (
    <div class="rounded bg-bg p-2 text-center">
      <div
        class="text-xl font-bold text-main tabular-nums"
        data-testid={props.testId}
      >
        {props.value}
      </div>
      <div class="text-xs text-sub">{props.label}</div>
    </div>
  );
}

/**
 * The Online Games lobby (the owner-approved LAN design): two players on
 * the same local network find each other and connect — no external
 * server. Phase 2 = the name, hosting (code + ip shown for the other
 * player) and manual-IP joining. The UDP discovery list arrives in
 * phase 3; the first online game (bot duel) in phase 4.
 */
export function OnlineLobbyPage(): JSXElement {
  const [name, setName] = createSignal(lanPreFillName());
  const [view, setView] = createSignal<LobbyView>("menu");
  const [joinAddr, setJoinAddr] = createSignal("");
  const [joinCode, setJoinCode] = createSignal("");
  const [message, setMessage] = createSignal<string | undefined>(undefined);

  const playerName = (): string => name().trim() || "P1";

  const startHosting = async (): Promise<void> => {
    setMessage(undefined);
    if (!lanAvailable()) {
      setMessage("the LAN backend is only available inside the desktop app");
      return;
    }
    const info = await lanStartHost(playerName());
    if (info === undefined) {
      setMessage("failed to start hosting");
      return;
    }
    setView("hosting");
  };

  const joinHost = async (): Promise<void> => {
    setMessage(undefined);
    if (joinAddr().trim() === "" || joinCode().trim() === "") {
      setMessage("enter the host ip and session code first");
      return;
    }
    if (!lanAvailable()) {
      setMessage("the LAN backend is only available inside the desktop app");
      return;
    }
    const ok = await lanJoin(
      joinAddr().trim(),
      joinCode().trim().toUpperCase(),
      playerName(),
    );
    if (!ok) {
      setMessage("could not connect — check the ip and the code");
      return;
    }
    setView("joining");
  };

  const Menu = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show
          when={lanAvailable()}
          fallback={
            <div class="rounded bg-bg p-3 text-center text-xs text-sub">
              the LAN backend is only available inside the desktop app
            </div>
          }
        >
          <div class="grid gap-1">
            <div class="text-xs text-sub">
              player name (shown to the opponent)
            </div>
            <input
              class="rounded bg-bg p-2 text-main"
              value={name()}
              maxLength={12}
              aria-label="player name"
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <Show when={message() !== undefined}>
            <div class="text-error">{message()}</div>
          </Show>
          <div class="grid grid-cols-2 gap-2">
            <Button
              text="host a match"
              fa={{ icon: "fa-wifi" }}
              class="w-full"
              onClick={() => void startHosting()}
            />
            <Button
              text="join a match"
              fa={{ icon: "fa-search" }}
              class="w-full"
              onClick={() => setView("joining")}
            />
          </div>
          <div class="text-xs text-sub">
            both players must be on the same local network — no internet needed.
            if discovery fails (some routers isolate devices), enter the ip of
            the host + code on the join screen.
          </div>
        </Show>
      </section>
    );
  };

  const Hosting = (): JSXElement => {
    const info = getLanHostInfo();
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <div class="grid grid-cols-3 gap-2">
          <HudCell label="code" value={info?.code ?? "—"} testId="ol-code" />
          <HudCell label="ip" value={info?.ip ?? "—"} testId="ol-ip" />
          <HudCell label="port" value={`${info?.port ?? "—"}`} />
        </div>
        <Show
          when={isLanConnected()}
          fallback={
            <div class="text-center text-sm text-sub" data-testid="ol-waiting">
              waiting for the opponent — they pick the join action and enter
              this code
            </div>
          }
        >
          <div
            class="text-center text-lg font-bold text-main"
            data-testid="ol-connected"
          >
            connected vs {getLanPeerName() ?? "P2"}
          </div>
        </Show>
        <Button
          text="cancel hosting"
          fa={{ icon: "fa-times" }}
          class="w-full"
          onClick={() => {
            lanLeave();
            setView("menu");
          }}
        />
      </section>
    );
  };

  const Joining = (): JSXElement => {
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4">
        <Show
          when={!isLanConnected()}
          fallback={
            <div
              class="text-center text-lg font-bold text-main"
              data-testid="ol-connected"
            >
              connected vs {getLanPeerName() ?? "the host"}
            </div>
          }
        >
          <div class="grid gap-1">
            <div class="text-xs text-sub">host ip</div>
            <input
              class="rounded bg-bg p-2 text-main"
              value={joinAddr()}
              placeholder="192.168.1.20:51987"
              aria-label="host ip and port"
              onInput={(e) => setJoinAddr(e.currentTarget.value)}
            />
          </div>
          <div class="grid gap-1">
            <div class="text-xs text-sub">session code</div>
            <input
              class="rounded bg-bg p-2 text-main"
              value={joinCode()}
              placeholder="ABCD"
              maxLength={4}
              aria-label="session code"
              onInput={(e) => setJoinCode(e.currentTarget.value.toUpperCase())}
            />
          </div>
          <Show when={message() !== undefined}>
            <div class="text-error">{message()}</div>
          </Show>
          <Button
            text="connect"
            fa={{ icon: "fa-plug" }}
            class="w-full"
            onClick={() => void joinHost()}
          />
        </Show>
        <Button
          text="back"
          fa={{ icon: "fa-arrow-left" }}
          class="mx-auto w-auto"
          onClick={() => {
            lanLeave();
            setView("menu");
          }}
        />
      </section>
    );
  };

  return (
    <div class="content-grid grid gap-8">
      <section>
        <H2 fa={{ icon: "fa-globe" }} text="online games" />
        <p class="text-sub">
          play against a real person on your local network — same wi-fi, no
          internet, no servers. host a match or join one.
        </p>
      </section>
      <Show
        when={view() === "menu"}
        fallback={
          <Show when={view() === "hosting"} fallback={<Joining />}>
            <Hosting />
          </Show>
        }
      >
        <Menu />
      </Show>
    </div>
  );
}
