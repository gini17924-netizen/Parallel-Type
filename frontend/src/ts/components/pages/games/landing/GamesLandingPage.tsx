import { JSXElement, Show, createSignal } from "solid-js";

import { navigate } from "../../../../router/navigate";
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
          <div
            class="flex flex-col items-center gap-3 rounded bg-sub-alt p-8 text-center opacity-60"
            data-testid="gl-online"
          >
            <i class="fas fa-globe text-4xl text-sub"></i>
            <div class="flex items-center gap-2">
              <div class="text-xl font-bold text-sub">Online Games</div>
              <span
                class="rounded-full bg-sub px-2 py-0.5 text-[0.65rem] font-bold text-main uppercase"
                data-testid="gl-online-badge"
              >
                coming soon
              </span>
            </div>
            <div class="text-sm text-sub">
              live opponents and leaderboards — later
            </div>
            <Button
              text="enter"
              fa={{ icon: "fa-lock" }}
              disabled={true}
              class="w-auto"
            />
          </div>
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
    return (
      <section class="grid gap-6">
        <div class="text-center">
          <i class="fas fa-plug-circle-check text-3xl text-main"></i>
          <div class="text-3xl font-bold text-main">offline games</div>
          <div class="text-sub">
            placeholder — the categories arrive in the next phase
          </div>
        </div>
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
