import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

//the panel branches on the LAN role — the bare spec has no lobby state,
//so the host view is forced through the role stub
vi.mock("../../../../../src/ts/states/lan", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLanRole: () => "host",
  getLanClients: () => ({}),
}));

import { TeamRelayPanel } from "../../../../../src/ts/components/pages/games/landing/TeamRelayPanel";
import {
  _resetLanRelayForTests,
  getRelayState,
  receiveRelayMessage,
} from "../../../../../src/ts/states/lan-relay";

describe("phase 111 — the team relay panel", () => {
  beforeEach(() => {
    vi.stubGlobal("__TAURI__", {
      core: { invoke: vi.fn(async () => undefined) },
    });
    _resetLanRelayForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetLanRelayForTests();
  });

  it("before a relay: the host sees the word source, others the wait note", () => {
    //the host view (the panel renders the host branch for the default seat)
    const { container } = render(() => <TeamRelayPanel />);
    expect(
      container.querySelector('[data-testid="relay-input"]'),
    ).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].some((b) =>
        (b.textContent ?? "").includes("start team relay"),
      ),
    ).toBe(true);
  });

  it("an armed relay shows the progress and the waiting note for a silent seat", () => {
    receiveRelayMessage(
      {
        type: "relay-start",
        words: ["alpha", "beta", "gamma", "delta"],
        seats: ["host", "3"],
      },
      3,
    );
    const { container } = render(() => <TeamRelayPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("team relay (phase 111)");
    expect(text).toContain("word 0 of 4");
    expect(text).toContain("seat 3: 0/2 done");
    //the client's first own word is beta — not yet their turn
    expect(
      container.querySelector('[data-testid="relay-waiting"]'),
    ).not.toBeNull();
  });

  it("the relay seats carry the host-first order", () => {
    receiveRelayMessage(
      {
        type: "relay-start",
        words: ["alpha", "beta"],
        seats: ["host", "7"],
      },
      7,
    );
    expect(getRelayState()?.players.map((p) => p.playerId)).toEqual([
      "host",
      "7",
    ]);
  });
});
