import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

//the page renders outside a router context in this spec — the tanstack
//Link becomes a plain anchor carrying the real children (the routing
//itself is upstream). solid hands children over as a lazy getter — the
//children() helper resolves it into nodes the anchor can adopt
vi.mock("@tanstack/solid-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: (props: { to?: string; children?: unknown; class?: string }) => {
    const el = document.createElement("a");
    el.setAttribute("href", props.to ?? "/");
    el.className = props.class ?? "";
    const append = (node: unknown): void => {
      if (node instanceof Node) {
        el.appendChild(node);
      } else if (typeof node === "string" || typeof node === "number") {
        el.appendChild(document.createTextNode(String(node)));
      } else if (Array.isArray(node)) {
        node.forEach(append);
      }
    };
    append(props.children);
    return el;
  },
}));

import { HomePage } from "../../../../src/ts/components/pages/home/HomePage";
import { resetHomeLayout } from "../../../../src/ts/utils/onboarding/home-layout";
import {
  resetOnboarding,
  skipOnboarding,
} from "../../../../src/ts/utils/onboarding/state";

describe("phase 96 — the home page shell", () => {
  beforeEach(() => {
    resetOnboarding();
    resetHomeLayout();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a fresh install auto-opens the tour at step 1 (welcome)", async () => {
    const { container } = render(() => <HomePage />);
    await vi.waitFor(() => {
      const panel = container.querySelector('[data-testid="onboarding-panel"]');
      expect(panel?.textContent).toContain("welcome to ParallelType");
      expect(panel?.textContent).toContain("step 1/5");
    });
  });

  it("skipping the tour reveals the section cards and never comes back", async () => {
    const { container } = render(() => <HomePage />);
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="onboarding-panel"]'),
      ).not.toBeNull();
    });
    const skip = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("skip the tour"),
    ) as HTMLButtonElement;
    skip.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="onboarding-panel"]'),
      ).toBeNull();
    });
    //the cards render after the panel swap settles
    await vi.waitFor(() => {
      const text = container.textContent ?? "";
      for (const title of ["learning", "practice", "games"]) {
        expect(text).toContain(title);
      }
    });
    //remounting never reopens it
    cleanup();
    const second = render(() => <HomePage />);
    expect(
      second.container.querySelector('[data-testid="onboarding-panel"]'),
    ).toBeNull();
  });

  it("personalize mode exposes up/hide/down and a hidden card returns via its chip", async () => {
    skipOnboarding(); //an existing user
    const { container } = render(() => <HomePage />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("learning");
    });
    const personalize = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("personalize home"),
    ) as HTMLButtonElement;
    personalize.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="layout-editor"]'),
      ).not.toBeNull();
    });
    //hide the games card
    const hideGames = container.querySelector(
      'button[aria-label="hide games"]',
    ) as HTMLButtonElement;
    hideGames.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("show games");
    });
    //the chip brings it back
    const chip = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("show games"),
    ) as HTMLButtonElement;
    chip.click();
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("show games");
    });
  });
});
