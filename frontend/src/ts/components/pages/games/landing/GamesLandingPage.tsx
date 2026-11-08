import { Link } from "@tanstack/solid-router";
import { For, JSXElement, Show, createSignal } from "solid-js";

import { navigate } from "../../../../router/navigate";
import { getGauntletStats } from "../../../../utils/daily-gauntlet/store";
import {
  GAME_CATEGORIES,
  gamesOfCategory,
} from "../../../../utils/games/game-categories";
import { Button } from "../../../common/Button";

type LandingView = "blocks" | "offline";

/**
 * The Games section landing (the owner-approved reorg): two blocks —
 * Offline Games (the categorized collection) and Online Games (a
 * disabled placeholder until its backend exists). The Offline block
 * opens the categorized view; the Daily Gauntlet is pinned there.
 * All menu text is English (the owner rule — Persian is practice
 * content only).
 */
export function GamesLandingPage(): JSXElement {
  const [view, setView] = createSignal<LandingView>("blocks");

  const goHome = (): void => {
    void navigate({ to: "/home" });
  };

  const Blocks = (): JSXElement => {
    return (
      <section class="grid gap-6">
        <div class="text-center">
          <i class="fas fa-gamepad text-3xl text-main"></i>
          <div class="text-3xl font-bold text-main">games</div>
          <div class="text-sub">
            typing, but playful — pick your side of the cable
          </div>
        </div>
        <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
          <button
            type="button"
            class="group flex flex-col items-center gap-3 rounded bg-sub-alt p-8 text-center transition-[background,color,transform] duration-125 hover:bg-text focus-visible:outline-2 focus-visible:outline-text"
            onClick={() => setView("offline")}
            data-testid="gl-offline"
          >
            <i class="fas fa-plug-circle-check text-4xl text-sub transition-colors duration-125 group-hover:text-bg"></i>
            <div class="text-xl font-bold text-main group-hover:text-bg">
              Offline Games
            </div>
            <div class="text-sm text-sub group-hover:text-bg">
              23 games in 6 skill categories — everything runs on this machine
            </div>
          </button>
          <Link
            to="/games/online"
            class="group flex flex-col items-center gap-3 rounded bg-sub-alt p-8 text-center transition-[background,color,transform] duration-125 hover:bg-text"
            data-testid="gl-online"
          >
            <i class="fas fa-globe text-4xl text-sub transition-colors duration-125 group-hover:text-bg"></i>
            <div class="flex items-center gap-2">
              <div class="text-xl font-bold text-main group-hover:text-bg">
                Online Games
              </div>
              <span
                class="rounded-full bg-main px-2 py-0.5 text-[0.65rem] font-bold text-bg uppercase"
                data-testid="gl-online-badge"
              >
                beta
              </span>
            </div>
            <div class="text-sm text-sub group-hover:text-bg">
              live opponents on your local network — no servers, no internet
            </div>
          </Link>
        </div>
        <button
          type="button"
          class="mx-auto flex items-center gap-2 text-sub transition-colors duration-125 hover:text-main"
          onClick={goHome}
        >
          <i class="fas fa-arrow-left"></i>
          back to home
        </button>
      </section>
    );
  };

  const Offline = (): JSXElement => {
    const stats = getGauntletStats();
    return (
      <section class="grid gap-8">
        <div class="text-center">
          <i class="fas fa-plug-circle-check text-3xl text-main"></i>
          <div class="text-3xl font-bold text-main">offline games</div>
          <div class="text-sub">every game in six skill categories</div>
        </div>
        {/*the pinned Daily Gauntlet banner (the owner's placement)*/}
        <Link
          to="/games/daily-gauntlet"
          class="group flex items-center gap-4 rounded border-2 border-main bg-sub-alt p-5 transition-[background] duration-125 hover:bg-text"
          data-testid="gl-daily"
        >
          <i class="fas fa-shield-alt text-3xl text-main transition-colors duration-125 group-hover:text-bg"></i>
          <div class="grid flex-1 gap-0.5 text-left">
            <div class="flex items-center gap-2">
              <span class="text-xl font-bold text-main group-hover:text-bg">
                Daily Gauntlet
              </span>
              <Show when={stats.streak > 0}>
                <span
                  class="text-sm font-bold text-error"
                  data-testid="gl-daily-streak"
                >
                  🔥 {stats.streak}
                </span>
              </Show>
            </div>
            <div class="text-sm text-sub group-hover:text-bg">
              the three-stage composite challenge of the day — the calendar
              remembers your streak
            </div>
          </div>
          <i class="fas fa-chevron-right text-sub transition-colors duration-125 group-hover:text-bg"></i>
        </Link>
        {/*the six skill categories (every game exactly once)*/}
        <For each={GAME_CATEGORIES}>
          {(category) => (
            <div class="grid gap-3" data-testid="gl-category">
              <div class="flex items-baseline gap-3">
                <i class={`fas ${category.icon} text-main`}></i>
                <div class="text-lg font-bold text-main">{category.title}</div>
                <div class="text-xs text-sub">{category.description}</div>
              </div>
              <div class="grid w-full grid-cols-1 gap-3 md:grid-cols-3">
                <For each={gamesOfCategory(category.id)}>
                  {(card) => (
                    <Link
                      to={card.route}
                      class="group flex flex-col items-center gap-2 rounded bg-sub-alt p-6 text-center transition-[background,color] duration-125 hover:bg-text"
                      data-testid="gl-game-card"
                    >
                      <i
                        class={`fas ${card.icon} text-3xl text-sub transition-colors duration-125 group-hover:text-bg`}
                      ></i>
                      <div class="font-bold text-main group-hover:text-bg">
                        {card.title}
                      </div>
                      <div class="text-xs text-sub group-hover:text-bg">
                        {card.description}
                      </div>
                    </Link>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
        <Button
          text="back"
          fa={{ icon: "fa-arrow-left" }}
          class="mx-auto w-auto"
          onClick={() => setView("blocks")}
        />
      </section>
    );
  };

  return (
    <div class="content-grid grid place-items-center gap-8 py-10">
      <Show when={view() === "blocks"} fallback={<Offline />}>
        <Blocks />
      </Show>
    </div>
  );
}
