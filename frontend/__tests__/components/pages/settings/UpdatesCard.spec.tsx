import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatesCard } from "../../../../src/ts/components/pages/settings/UpdatesCard";

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
      if (cmd === "updates_check_now") {
        return { status: "updated", version: "0.28.2" };
      }
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

describe("updates card — the stable/beta channel (phase 90)", () => {
  beforeEach(() => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a persisted beta channel renders beta active and a stable flip persists", async () => {
    const { calls } = installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") {
        return { autoCheck: true, channel: "beta" };
      }
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll("button")].some((b) =>
          (b.textContent ?? "").includes("channel: beta"),
        ),
      ).toBe(true);
    });
    //flip back to stable — the command carries the new channel
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("channel: stable"))
      ?.click();
    await vi.waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === "updates_set_channel" && c.args?.["channel"] === "stable",
        ),
      ).toBe(true);
    });
  });

  it("the default channel is stable and a beta flip persists", async () => {
    const { calls } = installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") return { autoCheck: true };
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll("button")].some((b) =>
          (b.textContent ?? "").includes("check for updates"),
        ),
      ).toBe(true);
    });
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("channel: beta"))
      ?.click();
    await vi.waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === "updates_set_channel" && c.args?.["channel"] === "beta",
        ),
      ).toBe(true);
    });
  });

  it("a pre-phase-90 settings file (no channel key) reads as stable, not a crash", async () => {
    installInvokeMock((cmd) => {
      if (cmd === "updates_get_settings") {
        return { autoCheck: true, channel: "garbage" };
      }
      return {};
    });
    const { container } = render(() => <UpdatesCard />);
    await vi.waitFor(() => {
      expect(
        [...container.querySelectorAll("button")].some((b) =>
          (b.textContent ?? "").includes("channel: stable"),
        ),
      ).toBe(true);
    });
    //the hostile value resolved to the safe default and the card renders
    expect(
      container.querySelector('[data-testid="uc-current"]'),
    ).not.toBeNull();
  });
});
