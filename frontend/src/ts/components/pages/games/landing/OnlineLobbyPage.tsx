import { For, JSXElement, Show, createSignal, onCleanup } from "solid-js";

import { Config } from "../../../../config/store";
import { navigate } from "../../../../router/navigate";
import {
  getLanClients,
  getLanDiscovered,
  getLanMyClientId,
  getLanRole,
  isLanConnected,
  lanAvailable,
  lanJoin,
  lanLeave,
  lanPreFillName,
  lanRefreshDiscovered,
  lanStartDiscovery,
  lanStartHost,
  lanStopDiscovery,
  getLanHostInfo,
  getLanPeerName,
  type LanDiscovered,
} from "../../../../states/lan";
import {
  armLanMatch,
  getLanMatch,
  getLanRoomClients,
  sendLanMatchStart,
  startTournamentMatch,
} from "../../../../states/lan-match";
import {
  createBracket,
  clearTournament,
  currentMatch as currentTournamentMatch,
  getTournament,
  setHostTournament,
} from "../../../../states/lan-tournament";
import { cn } from "../../../../utils/cn";
import {
  getLanGame,
  getLanGames,
  type LanGameId,
} from "../../../../utils/games/lan-registry";
import { cachedFetchJson } from "../../../../utils/json-data";
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
 * server. Phase 3 = the live "nearby matches" list from the UDP
 * discovery listener (polled every 2s, one-click join) with the manual
 * ip+code form as the fallback (AP isolation, firewalled discovery).
 */
export function OnlineLobbyPage(): JSXElement {
  const [name, setName] = createSignal(lanPreFillName());
  const [view, setView] = createSignal<LobbyView>("menu");
  const [joinAddr, setJoinAddr] = createSignal("");
  const [joinCode, setJoinCode] = createSignal("");
  const [message, setMessage] = createSignal<string | undefined>(undefined);
  //H1: the manual join gets a visible in-flight state — silence on a
  //click read as "nothing happens" (the user report)
  const [connecting, setConnecting] = createSignal(false);
  //flips after a few silent seconds so the empty list gets the
  //"use the manual join" hint instead of just "listening…"
  const [discoveryWaited, setDiscoveryWaited] = createSignal(false);

  const playerName = (): string => name().trim() || "P1";

  //the discovery lifecycle belongs to this page: listener on mount,
  //poll while open, everything dropped on unmount
  if (lanAvailable()) {
    void lanStartDiscovery();
    void lanRefreshDiscovered();
    const poll = setInterval(() => void lanRefreshDiscovered(), 2000);
    const waited = setTimeout(() => setDiscoveryWaited(true), 6000);
    onCleanup(() => {
      clearInterval(poll);
      clearTimeout(waited);
      lanStopDiscovery();
      //abandoning the lobby with a live-but-unused connection drops it
      //(a connection carrying an armed match keeps living)
      if (getLanMatch() === undefined && getLanRole() !== "none") {
        lanLeave();
      }
    });
  }

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

  const connectTo = async (addr: string, code: string): Promise<boolean> => {
    if (!lanAvailable()) {
      setMessage("the LAN backend is only available inside the desktop app");
      return false;
    }
    setConnecting(true);
    setMessage(undefined);
    const error = await lanJoin(addr, code, playerName());
    setConnecting(false);
    if (error !== undefined) {
      setMessage(`could not connect — ${error}`);
      return false;
    }
    setView("joining");
    return true;
  };

  const joinHost = async (): Promise<void> => {
    setMessage(undefined);
    if (connecting()) return;
    if (joinAddr().trim() === "" || joinCode().trim() === "") {
      setMessage("enter the host ip and session code first");
      return;
    }
    await connectTo(joinAddr().trim(), joinCode().trim().toUpperCase());
  };

  const joinDiscovered = async (session: LanDiscovered): Promise<void> => {
    setMessage(undefined);
    await connectTo(`${session.ip}:${session.port}`, session.code);
  };

  //the host builds the start through the registry contract and ships it —
  //both sides play the exact same seeded stream
  const [matchLength, setMatchLength] = createSignal(30);
  const [selectedGame, setSelectedGame] = createSignal<LanGameId>(
    getLanGames()[0]?.gameId ?? "bot-duel",
  );
  const fetchWordPool = async (): Promise<string[]> => {
    try {
      const data = await cachedFetchJson<{ words: string[] }>(
        `/languages/${Config.language}.json`,
      );
      return data.words;
    } catch {
      return [];
    }
  };
  const startMatch = async (): Promise<void> => {
    const playable = getLanGame(selectedGame());
    if (playable === undefined) return;
    let settings: Record<string, unknown> = {};
    if (playable.gameId === "bot-duel") {
      settings = { length: matchLength(), words: await fetchWordPool() };
    }
    const start = playable.buildStart(settings);
    //arm first: a refused start never reaches the wire
    armLanMatch({
      role: "host",
      peerName: getLanPeerName() ?? "P2",
      start,
    });
    if (getLanMatch() === undefined) {
      setMessage("could not start the match — the settings were rejected");
      return;
    }
    sendLanMatchStart(start, playerName());
    void navigate({ to: playable.route });
  };

  const Nearby = (): JSXElement => {
    return (
      <div class="grid gap-2">
        <div class="text-xs text-sub">nearby matches on this network</div>
        <Show
          when={getLanDiscovered().length > 0}
          fallback={
            <div
              class="rounded bg-bg p-2 text-xs text-sub"
              data-testid="ol-nearby-empty"
            >
              {discoveryWaited()
                ? "no matches found — if the host doesn't appear (some routers isolate devices), use join a match and enter their ip manually"
                : "listening for nearby matches…"}
            </div>
          }
        >
          <For each={getLanDiscovered()}>
            {(session) => (
              <div
                class="flex items-center justify-between gap-2 rounded bg-bg p-2"
                data-testid="ol-nearby-session"
              >
                <div class="grid">
                  <div class="text-sm font-bold text-main">{session.name}</div>
                  <div class="text-xs text-sub">
                    {session.ip}:{session.port} — code {session.code}
                  </div>
                </div>
                <Button
                  text="join"
                  fa={{ icon: "fa-plug" }}
                  class="w-auto"
                  onClick={() => void joinDiscovered(session)}
                />
              </div>
            )}
          </For>
        </Show>
      </div>
    );
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
          <Nearby />
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
            connected vs {getLanPeerName() ?? "P2"} ({clientCount()} in the
            room)
          </div>
          <Show
            when={getLanRole() === "host"}
            fallback={
              <div
                class="text-center text-sm text-sub"
                data-testid="ol-client-waiting"
              >
                waiting for the host to start the match…
              </div>
            }
          >
            <div class="grid gap-2" data-testid="ol-start-match">
              <div class="text-xs text-sub">online game</div>
              <div class="grid grid-cols-2 gap-2">
                <For each={getLanGames()}>
                  {(game) => (
                    <Button
                      text={game.label}
                      fa={{ icon: game.icon }}
                      class={cn(
                        "w-full",
                        selectedGame() === game.gameId && "bg-main text-bg",
                      )}
                      onClick={() => setSelectedGame(game.gameId)}
                    />
                  )}
                </For>
              </div>
              <Show when={selectedGame() === "type-pong"}>
                <div class="text-xs text-sub" data-testid="ol-pong-teaser">
                  the first real versus — one shared ball state-synced 20 times
                  a second; the paddle moves only when you type.
                </div>
              </Show>
              <Show when={selectedGame() === "bot-duel"}>
                <div class="grid gap-1">
                  <div class="text-xs text-sub">race length</div>
                  <div class="grid grid-cols-3 gap-2">
                    <Button
                      text="quick"
                      class={cn(
                        "w-full",
                        matchLength() === 15 && "bg-main text-bg",
                      )}
                      onClick={() => setMatchLength(15)}
                    />
                    <Button
                      text="standard"
                      class={cn(
                        "w-full",
                        matchLength() === 30 && "bg-main text-bg",
                      )}
                      onClick={() => setMatchLength(30)}
                    />
                    <Button
                      text="long"
                      class={cn(
                        "w-full",
                        matchLength() === 60 && "bg-main text-bg",
                      )}
                      onClick={() => setMatchLength(60)}
                    />
                  </div>
                </div>
              </Show>
              <Button
                text="start match"
                fa={{ icon: "fa-flag-checkered" }}
                class="w-full"
                onClick={() => void startMatch()}
              />
            </div>
          </Show>
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
            text={connecting() ? "connecting…" : "connect"}
            fa={{ icon: "fa-plug" }}
            class="w-full"
            disabled={connecting()}
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

  const clientCount = () => Object.keys(getLanClients()).length;

  const startTournament = async (): Promise<void> => {
    const roster = Object.values(getLanClients()).map((client) => ({
      clientId: client.clientId,
      name: client.name,
    }));
    if (roster.length < 2) return;
    const playable = getLanGame(selectedGame());
    if (playable === undefined) return;
    let settings: Record<string, unknown> = {};
    if (playable.gameId === "bot-duel") {
      settings = { length: matchLength(), words: await fetchWordPool() };
    }
    const state = createBracket(roster, playable.buildStart(settings));
    setHostTournament(state);
    startTournamentMatch(state);
  };

  const TournamentBracket = (): JSXElement => {
    const t = getTournament();
    if (t === undefined) return <div />;
    const nameOf = (id: number | null): string => {
      if (id === null) return "—";
      return (
        t.players.find((p) => p.clientId === id)?.name ?? `client ${id}`
      );
    };
    return (
      <div class="grid gap-2" data-testid="tournament-bracket">
        <For each={t.rounds}>
          {(round, roundIndex) => (
            <div class="grid gap-1">
              <div class="text-xs text-sub">
                round {roundIndex() + 1}
                {t.champion === undefined && roundIndex() === t.currentRound
                  ? " — in progress"
                  : ""}
              </div>
              <For each={round}>
                {(match) => {
                  const mine =
                    getLanMyClientId() !== undefined &&
                    (match.players[0] === getLanMyClientId() ||
                      match.players[1] === getLanMyClientId());
                  const isCurrent =
                    t.champion === undefined &&
                    roundIndex() === t.currentRound &&
                    !match.done;
                  return (
                    <div
                      class={`rounded p-2 text-xs ${
                        mine
                          ? "bg-main text-bg font-bold"
                          : isCurrent
                            ? "bg-bg text-main"
                            : "bg-bg text-sub"
                      }`}
                    >
                      {nameOf(match.players[0])} vs {nameOf(match.players[1])}
                      {match.winner !== undefined
                        ? ` — winner: ${nameOf(match.winner)}`
                        : ""}
                      {match.done && match.winner === undefined
                        ? " — bye"
                        : ""}
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>
        <Show when={t.champion !== undefined}>
          <div
            class="rounded bg-main p-2 text-center font-bold text-bg"
            data-testid="tournament-champion"
          >
            champion: {nameOf(t.champion ?? null)}
          </div>
        </Show>
      </div>
    );
  };

  const TournamentSection = (): JSXElement => {
    const t = getTournament();
    const inTournament = t !== undefined;
    const myUp = (): boolean => {
      if (t === undefined || t.champion !== undefined) return false;
      const match = currentTournamentMatch(t);
      const mine = getLanMyClientId();
      if (match === undefined || mine === undefined) return false;
      return match.players[0] === mine || match.players[1] === mine;
    };
    return (
      <section class="grid gap-4 rounded bg-sub-alt p-4" data-testid="tournament-section">
        <div class="text-sub">tournament</div>
        <Show when={inTournament} fallback={<div />}>
          <Show when={myUp()}>
            <div class="text-sm font-bold text-main" data-testid="tournament-up">
              your match is starting — you will be taken to the game
            </div>
          </Show>
          <TournamentBracket />
          <Show when={getLanRole() === "host"}>
            <Button
              text="end tournament"
              fa={{ icon: "fa-stop" }}
              class="w-full"
              onClick={() => {
                clearTournament();
              }}
            />
          </Show>
        </Show>
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
