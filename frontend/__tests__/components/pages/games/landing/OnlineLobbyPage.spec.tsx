import "fake-indexeddb/auto";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnlineLobbyPage } from "../../../../../src/ts/components/pages/games/landing/OnlineLobbyPage";
import { _resetLanStateForTests } from "../../../../../src/ts/states/lan";

/** the frontend talks to the Rust pipe through window.__TAURI__ — this
 * fake records the invokes and captures the event listeners so the spec
 * can fire the Rust-side events (peer-joined etc.) */
function installTauriMock(discovered: Record<string, unknown>[] = []): {
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
} {
  const invokes: { cmd: string; args: Record<string, unknown> }[] = [];
  const handlers = new Map<string, ((e: { payload: unknown }) => void)[]>();
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokes.push({ cmd, args: args ?? {} });
        if (cmd === "lan_start_host") {
          return {
            sessionId: "lan-test/N3DB",
            code: "N3DB",
            port: 51987,
            ip: "192.168.100.24",
            name: (args?.["name"] as string) ?? "P1",
          };
        }
        if (cmd === "lan_connect_client") {
          return { connected: true, addr: args?.["addr"] };
        }
        if (cmd === "lan_get_discovered") {
          return discovered;
        }
        return {};
      },
    },
    event: {
      listen: async (ev: string, cb: (e: { payload: unknown }) => void) => {
        const list = handlers.get(ev) ?? [];
        list.push(cb);
        handlers.set(ev, list);
        return () => undefined;
      },
    },
  };
  return {
    invokes,
    fire: (ev: string, payload: unknown) => {
      for (const cb of handlers.get(ev) ?? []) cb({ payload });
    },
  };
}

function pageText(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe("online lobby (LAN, phase 2)", () => {
  let tauri: ReturnType<typeof installTauriMock>;

  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    tauri = installTauriMock();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanup();
  });

  it("the lobby shows the name (pre-filled) and the host/join actions", async () => {
    const { container } = render(() => <OnlineLobbyPage />);
    const text = pageText(container);
    expect(text).toContain("host a match");
    expect(text).toContain("join a match");
    expect(
      container.querySelector('input[aria-label="player name"]'),
    ).not.toBeNull();
  });

  it("hosting starts the host and shows the code + ip + waiting", async () => {
    const { container } = render(() => <OnlineLobbyPage />);
    fireEvent.input(
      container.querySelector(
        'input[aria-label="player name"]',
      ) as HTMLInputElement,
      { target: { value: "HOST1" } },
    );
    const hostBtn = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("host a match"),
    );
    hostBtn?.click();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="ol-code"]')?.textContent,
      ).toBe("N3DB");
      expect(
        container.querySelector('[data-testid="ol-ip"]')?.textContent,
      ).toBe("192.168.100.24");
      expect(
        container.querySelector('[data-testid="ol-waiting"]'),
      ).not.toBeNull();
    });
    expect(tauri.invokes.some((entry) => entry.cmd === "lan_start_host")).toBe(
      true,
    );
  });

  it("joining with ip + code connects and announces the peer", async () => {
    const { container } = render(() => <OnlineLobbyPage />);
    const joinBtn = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("join a match"),
    );
    joinBtn?.click();
    fireEvent.input(
      container.querySelector(
        'input[aria-label="host ip and port"]',
      ) as HTMLInputElement,
      { target: { value: "192.168.100.24:51987" } },
    );
    fireEvent.input(
      container.querySelector(
        'input[aria-label="session code"]',
      ) as HTMLInputElement,
      { target: { value: "N3DB" } },
    );
    const connectBtn = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("connect"),
    );
    connectBtn?.click();
    await vi.waitFor(() => {
      expect(
        tauri.invokes.some((entry) => entry.cmd === "lan_connect_client"),
      ).toBe(true);
    });
    //the Rust side announces the joined peer through lan://peer-joined
    tauri.fire("lan://peer-joined", { name: "HOST1" });
    expect(pageText(container)).toContain("connected vs HOST1");
  });

  it("leaving resets to the lobby menu", async () => {
    const { container } = render(() => <OnlineLobbyPage />);
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("host a match"))
      ?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="ol-code"]')).not.toBeNull();
    });
    [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("cancel hosting"))
      ?.click();
    expect(pageText(container)).toContain("host a match");
  });
});

describe("online lobby (LAN, phase 3 — discovery)", () => {
  let tauri: ReturnType<typeof installTauriMock>;

  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetLanStateForTests();
    tauri = installTauriMock();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanup();
  });

  it("runs the discovery lifecycle on mount and shows the listening hint", async () => {
    const { container, unmount } = render(() => <OnlineLobbyPage />);
    await vi.waitFor(() => {
      expect(
        container
          .querySelector('[data-testid="ol-nearby-empty"]')
          ?.textContent?.includes("listening for nearby matches"),
      ).toBe(true);
    });
    expect(
      tauri.invokes.some((entry) => entry.cmd === "lan_start_discovery"),
    ).toBe(true);
    expect(
      tauri.invokes.some((entry) => entry.cmd === "lan_get_discovered"),
    ).toBe(true);
    unmount();
    expect(
      tauri.invokes.some((entry) => entry.cmd === "lan_stop_discovery"),
    ).toBe(true);
  });

  it("lists a discovered match and joins it with one click", async () => {
    tauri = installTauriMock([
      {
        sessionId: "lan-9/N3DB",
        name: "HOST9",
        code: "N3DB",
        port: 51987,
        ip: "192.168.100.24",
      },
    ]);
    const { container } = render(() => <OnlineLobbyPage />);
    await vi.waitFor(() => {
      expect(
        container
          .querySelector('[data-testid="ol-nearby-session"]')
          ?.textContent?.includes("HOST9"),
      ).toBe(true);
    });
    expect(
      container
        .querySelector('[data-testid="ol-nearby-session"]')
        ?.textContent?.includes("192.168.100.24:51987"),
    ).toBe(true);
    //the row's own join button (not the menu's "join a match")
    container
      .querySelector('[data-testid="ol-nearby-session"]')
      ?.querySelector("button")
      ?.click();
    await vi.waitFor(() => {
      const connect = tauri.invokes.find(
        (entry) => entry.cmd === "lan_connect_client",
      );
      expect(connect?.args?.["addr"]).toBe("192.168.100.24:51987");
      expect(connect?.args?.["code"]).toBe("N3DB");
    });
    //let the join promise chain settle (setView runs a microtask after
    //the invoke resolves) before the Rust side announces the peer
    await new Promise((r) => setTimeout(r, 0));
    tauri.fire("lan://peer-joined", { name: "HOST9" });
    expect(pageText(container)).toContain("connected vs HOST9");
  });
});
