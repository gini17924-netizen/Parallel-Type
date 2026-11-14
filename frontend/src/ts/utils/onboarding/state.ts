import { createSignal } from "solid-js";
import { z } from "zod";

import { LocalStorageWithSchema } from "../local-storage-with-schema";

/**
 * phase 96: the first-run tour — a 5-step machine that shows ONCE. a fresh
 * install has no stored state (seen=false); the home page auto-activates it
 * on mount, and finishing or skipping ANY step marks it seen forever, so an
 * existing user never sees it. the store is the independent-store house
 * rule (mtDesktopOnboarding). reset exists for the specs only.
 */

export type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  /** the route the step's "see it" link points at (optional) */
  destination?: string;
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "welcome",
    title: "welcome to ParallelType",
    description:
      "a keyboard-driven typing trainer — this 5-step tour shows the lay of the land. skip any time.",
  },
  {
    id: "first-type",
    title: "take your first test",
    description:
      "the practice hub is where you type: words, time, quotes — everything stays local on this machine.",
    destination: "/practice",
  },
  {
    id: "games",
    title: "play the typing games",
    description:
      "twenty-plus mini-games turn practice into play — the hub sorts them by pattern.",
    destination: "/games",
  },
  {
    id: "lan",
    title: "race on your LAN",
    description:
      "same Wi-Fi, no server: host a room in the online lobby and race a friend with one code.",
    destination: "/games/online",
  },
  {
    id: "settings",
    title: "make it yours",
    description:
      "themes, sound packs, custom themes and every behavior live in settings.",
    destination: "/settings",
  },
];

const OnboardingStateSchema = z.object({
  seen: z.boolean(),
  step: z.number().int().min(0),
  active: z.boolean(),
});

type OnboardingState = z.infer<typeof OnboardingStateSchema>;

const onboardingStore = new LocalStorageWithSchema({
  key: "mtDesktopOnboarding",
  schema: OnboardingStateSchema,
  fallback: { seen: false, step: 0, active: false },
});

const [onboardingState, setOnboardingState] = createSignal<OnboardingState>(
  onboardingStore.get(),
);

function persist(next: OnboardingState): void {
  onboardingStore.set(next);
  setOnboardingState(next);
}

/** whether the home page should render the tour panel right now */
export function shouldShowOnboarding(): boolean {
  const state = onboardingState();
  return !state.seen && state.active;
}

/** the current step (only meaningful while the tour is active) */
export function currentOnboardingStep(): OnboardingStep | undefined {
  const state = onboardingState();
  if (!state.active || state.seen) return undefined;
  return ONBOARDING_STEPS[state.step];
}

/** the home page auto-activates the tour for a never-seen install */
export function startOnboardingIfNeeded(): void {
  const state = onboardingState();
  if (!state.seen && !state.active) {
    persist({ seen: false, step: 0, active: true });
  }
}

/** next step; finishing the last one marks the tour seen forever */
export function advanceOnboardingStep(): void {
  const state = onboardingState();
  const next = state.step + 1;
  if (next >= ONBOARDING_STEPS.length) {
    persist({ seen: true, step: state.step, active: false });
    return;
  }
  persist({ seen: false, step: next, active: true });
}

/** skipping at ANY step marks the tour seen forever */
export function skipOnboarding(): void {
  persist({ seen: true, step: onboardingState().step, active: false });
}

/** wipes the tour state (the specs' reset; the prod flows never call it) */
export function resetOnboarding(): void {
  onboardingStore.clear();
  setOnboardingState(onboardingStore.get());
}
