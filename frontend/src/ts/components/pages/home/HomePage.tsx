import { Link } from "@tanstack/solid-router";
import { createSignal, For, JSXElement, onMount, Show } from "solid-js";

import {
  type AppSection,
  sectionDestination,
} from "../../../constants/app-structure";
import {
  homeCards,
  moveSectionDown,
  moveSectionUp,
  toggleSectionHidden,
} from "../../../utils/onboarding/home-layout";
import {
  advanceOnboardingStep,
  currentOnboardingStep,
  ONBOARDING_STEPS,
  shouldShowOnboarding,
  skipOnboarding,
  startOnboardingIfNeeded,
} from "../../../utils/onboarding/state";

/**
 * The home hub: the app's start screen with one card per section (the user
 * may reorder or hide cards — phase 96's personal layout). First-run
 * installs see the 5-step tour ONCE (phase 96); existing users never do.
 * Sections with several sub-sections open the picker, single-destination
 * sections link straight to their route (see app-structure.ts).
 */
export function HomePage(): JSXElement {
  onMount(() => {
    startOnboardingIfNeeded();
  });

  const [editing, setEditing] = createSignal(false);

  const step = (): ReturnType<typeof currentOnboardingStep> => {
    return shouldShowOnboarding() ? currentOnboardingStep() : undefined;
  };

  const SectionCard = (props: { section: AppSection }): JSXElement => (
    <Link
      to={sectionDestination(props.section)}
      class="group flex flex-col items-center gap-3 rounded bg-sub-alt p-8 text-center transition-[background,color,transform] duration-125 hover:bg-text focus-visible:outline-2 focus-visible:outline-text"
    >
      <i
        class={`fas ${props.section.icon} text-4xl text-sub transition-colors duration-125 group-hover:text-bg`}
      ></i>
      <div class="text-xl font-bold text-main group-hover:text-bg">
        {props.section.title}
      </div>
      <div class="text-sm text-sub group-hover:text-bg">
        {props.section.description}
      </div>
    </Link>
  );

  const EditableSectionCard = (props: { section: AppSection }): JSXElement => (
    <div
      class="flex flex-col gap-2 rounded bg-sub-alt p-4 text-center"
      data-testid={`layout-card-${props.section.id}`}
    >
      <div class="text-lg font-bold text-main">{props.section.title}</div>
      <div class="grid grid-cols-3 gap-1">
        <button
          type="button"
          class="rounded bg-bg p-2 text-xs text-sub hover:text-main"
          aria-label={`move ${props.section.title} up`}
          onClick={() => moveSectionUp(props.section.id)}
        >
          <i class="fas fa-arrow-up"></i>
        </button>
        <button
          type="button"
          class="rounded bg-bg p-2 text-xs text-sub hover:text-main"
          aria-label={`hide ${props.section.title}`}
          onClick={() => toggleSectionHidden(props.section.id)}
        >
          <i class="fas fa-eye-slash"></i>
        </button>
        <button
          type="button"
          class="rounded bg-bg p-2 text-xs text-sub hover:text-main"
          aria-label={`move ${props.section.title} down`}
          onClick={() => moveSectionDown(props.section.id)}
        >
          <i class="fas fa-arrow-down"></i>
        </button>
      </div>
    </div>
  );

  return (
    <div class="content-grid grid place-items-center gap-8 py-10">
      <div class="text-center">
        <div class="text-3xl font-bold text-main">ParallelType</div>
        <div class="text-sub">where do you want to type today?</div>
      </div>
      <Show
        when={step() !== undefined}
        fallback={
          <Show
            when={editing()}
            fallback={
              <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
                <For each={homeCards().visible}>
                  {(section) => <SectionCard section={section} />}
                </For>
              </div>
            }
          >
            <div class="grid w-full gap-4" data-testid="layout-editor">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                <For each={homeCards().visible}>
                  {(section) => <EditableSectionCard section={section} />}
                </For>
              </div>
              <Show when={homeCards().hidden.length > 0}>
                <div class="grid gap-2">
                  <div class="text-sub">hidden cards — bring them back:</div>
                  <div class="flex flex-wrap gap-2">
                    <For each={homeCards().hidden}>
                      {(section) => (
                        <button
                          type="button"
                          class="rounded bg-sub-alt p-2 text-xs text-sub hover:text-main"
                          onClick={() => toggleSectionHidden(section.id)}
                        >
                          show {section.title}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <button
                type="button"
                class="mx-auto rounded bg-sub-alt px-4 py-2 text-sm text-main"
                onClick={() => setEditing(false)}
              >
                done personalizing
              </button>
            </div>
          </Show>
        }
      >
        <div
          class="grid w-full max-w-xl gap-4 rounded bg-sub-alt p-6"
          data-testid="onboarding-panel"
        >
          <div class="text-xs text-sub">
            step{" "}
            {(ONBOARDING_STEPS.findIndex((s) => s.id === step()?.id) ?? 0) + 1}/
            {ONBOARDING_STEPS.length}
          </div>
          <div class="text-xl font-bold text-main">{step()?.title}</div>
          <div class="text-sm text-sub">{step()?.description}</div>
          <Show when={step()?.destination !== undefined}>
            <Link
              to={step()?.destination ?? "/"}
              class="rounded bg-bg p-2 text-center text-sm text-main"
            >
              see it now
            </Link>
          </Show>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="rounded bg-bg p-2 text-sm text-sub"
              onClick={() => skipOnboarding()}
            >
              skip the tour
            </button>
            <button
              type="button"
              class="rounded bg-main p-2 text-sm text-bg"
              onClick={() => advanceOnboardingStep()}
            >
              next
            </button>
          </div>
        </div>
      </Show>
      <button
        type="button"
        class="rounded bg-sub-alt px-4 py-2 text-xs text-sub hover:text-main"
        onClick={() => setEditing((prev) => !prev)}
      >
        {editing() ? "close personalization" : "personalize home"}
      </button>
    </div>
  );
}
