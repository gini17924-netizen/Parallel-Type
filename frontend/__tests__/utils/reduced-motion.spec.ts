import { afterEach, describe, expect, it, vi } from "vitest";

import {
  effectiveAnimationParams,
  prefersReducedMotion,
  promiseAnimate,
} from "../../src/ts/utils/animation";

describe("phase 95 — the animation gate honors prefers-reduced-motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefersReducedMotion reads the media query", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion)",
    }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
    //no matchMedia at all (old engines) — never reduced
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reduced motion collapses duration and delay to zero", () => {
    const reduced = effectiveAnimationParams(
      { opacity: [0, 1], duration: 300, delay: 100 },
      true,
    );
    expect(reduced).toMatchObject({ duration: 0, delay: 0, opacity: [0, 1] });
  });

  it("normal motion passes the params through untouched", () => {
    const options = { opacity: [0, 1], duration: 300, delay: 100 };
    expect(effectiveAnimationParams(options, false)).toBe(options);
  });

  it("promiseAnimate resolves with the real engine (smoke)", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    await expect(
      promiseAnimate("body", { opacity: [1, 1], duration: 5 }),
    ).resolves.toBeUndefined();
  });
});
