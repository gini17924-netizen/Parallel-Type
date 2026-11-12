import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatesCard } from "../../../../src/ts/components/pages/settings/UpdatesCard";

type InvokeMock = (cmd: string, args?: Record<string, unknown>) => unknown;

function installInvokeMock(
  impl: (cmd: string, args?: Record<string, unknown>) => unknown,
): { calls: { cmd: string; args?: Record<string, unknown> }[] } {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return impl(cmd, args);
      },
    },
  };
  return { calls };
}

describe("updates card (phase 56)", () => {
  beforeEach(() => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the persisted auto-check state and renders the controls", async () => {
    installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") return { autoCheck: false };
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll("button")].some((b) =>
          (b.textContent ?? "").includes("automatic updates: off"),
        ),
      ).toBe(true);
    });
    expect(
      container.querySelector('[data-testid="uc-current"]'),
    ).not.toBeNull();
    //the load read the persisted switch
    expect(
      container
        .querySelector('[aria-label="updates card"]')
        ?.textContent?.includes("automatic updates: off"),
    ).toBe(true);
  });

  it("the toggle flips persist through the command with the flipped value", async () => {
    const { calls } = installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") return { autoCheck: true };
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll("button")].some((b) =>
          (b.textContent ?? "").includes("automatic updates: on"),
        ),
      ).toBe(true);
    });
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("automatic updates: off"))
      ?.click();
    await vi.waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === "updates_set_auto_check" && c.args?.["enabled"] === false,
        ),
      ).toBe(true);
    });
  });

  it("the manual check resolves 'current' and says so", async () => {
    installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") return { autoCheck: true };
      if (cmd === "updates_check_now") return { status: "current" };
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("check for updates"))
      ?.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="uc-current"]')?.textContent,
      ).toContain("you're on the latest version");
    });
  });

  it("an available update announces the version and the restart", async () => {
    installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") return { autoCheck: true };
      if (cmd === "updates_check_now")
        return { status: "updated", version: "0.28.2" };
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    //the card's controls render only after the async settings load —
    //wait for the button before clicking (H1's own lesson, again)
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll("button")].some((b) =>
          (b.textContent ?? "").includes("check for updates"),
        ),
      ).toBe(true);
    });
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("check for updates"))
      ?.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="uc-available"]')?.textContent,
      ).toContain("downloading version 0.28.2");
    });
    expect(
      container.querySelector('[data-testid="uc-available"]')?.textContent,
    ).toContain("the app will restart");
  });
});
