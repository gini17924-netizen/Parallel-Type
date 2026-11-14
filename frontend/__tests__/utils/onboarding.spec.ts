import { beforeEach, describe, expect, it } from "vitest";

import {
  advanceOnboardingStep,
  currentOnboardingStep,
  ONBOARDING_STEPS,
  resetOnboarding,
  shouldShowOnboarding,
  skipOnboarding,
  startOnboardingIfNeeded,
} from "../../src/ts/utils/onboarding/state";

describe("phase 96 — the first-run tour machine", () => {
  beforeEach(() => {
    resetOnboarding();
  });

  it("five steps with unique ids, in the locked order", () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      "welcome",
      "first-type",
      "games",
      "lan",
      "settings",
    ]);
  });

  it("a fresh install is not seen; starting activates step 0", () => {
    expect(shouldShowOnboarding()).toBe(false);
    startOnboardingIfNeeded();
    expect(shouldShowOnboarding()).toBe(true);
    expect(currentOnboardingStep()?.id).toBe("welcome");
  });

  it("starting twice does not restart the tour", () => {
    startOnboardingIfNeeded();
    advanceOnboardingStep();
    startOnboardingIfNeeded();
    expect(currentOnboardingStep()?.id).toBe("first-type");
  });

  it("advancing through all five marks it seen forever", () => {
    startOnboardingIfNeeded();
    for (const _step of ONBOARDING_STEPS) {
      expect(shouldShowOnboarding()).toBe(true);
      advanceOnboardingStep();
    }
    expect(shouldShowOnboarding()).toBe(false);
    expect(currentOnboardingStep()).toBeUndefined();
    //an existing user never sees it again
    startOnboardingIfNeeded();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("skipping at ANY step marks it seen forever", () => {
    startOnboardingIfNeeded();
    advanceOnboardingStep();
    advanceOnboardingStep();
    expect(currentOnboardingStep()?.id).toBe("games");
    skipOnboarding();
    expect(shouldShowOnboarding()).toBe(false);
    startOnboardingIfNeeded();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("reset returns the machine to the fresh-install state", () => {
    startOnboardingIfNeeded();
    skipOnboarding();
    resetOnboarding();
    expect(shouldShowOnboarding()).toBe(false);
    startOnboardingIfNeeded();
    expect(shouldShowOnboarding()).toBe(true);
    expect(currentOnboardingStep()?.id).toBe("welcome");
  });
});
