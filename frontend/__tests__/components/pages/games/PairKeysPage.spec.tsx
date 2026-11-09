import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetLanStateForTests,
  lanStartHost,
} from "../../../../src/ts/states/lan";
import {
  _resetLanMatchForTests,
  armLanMatch,
  handleLanPeerMessage,
} from "../../../../src/ts/states/lan-match";
import {
  PAIR_KEYS_STATS_KEY,
  _resetPairKeysForTests,
} from "../../../../src/ts/utils/pair-keys/store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function cards(app: App): HTMLButtonElement[] {
  return [
    ...app.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="pk-card"]',
    ),
  ];
}

function twin(
  app: App,
  card: HTMLButtonElement | undefined,
): HTMLButtonElement | undefined {
  const base = card?.getAttribute("data-base");
  if (base === null || base === undefined) return undefined;
  return cards(app).find(
    (other) => other !== card && other.getAttribute("data-base") === base,
  );
}

async function openPairKeys(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/pair-keys" });
  await app.settle();
  return app;
}

describe("pair keys page (idea G18 phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetPairKeysForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    cleanupApp();
  });

  it("the setup renders the modes, the levels and the how-to", async () => {
    const app = await openPairKeys();
    const text = pageText(app);
    expect(text).toContain("letter forms");
    expect(text).toContain("letters");
    expect(text).toContain("level 1 · preview");
    expect(text).toContain("level 2 · blind");
    expect(text).toContain("start memory game");
  });

  it("level 1 previews the whole grid for 2s, then hides it", async () => {
    const app = await openPairKeys();
    vi.useFakeTimers();
    button(app, "start memory game")?.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(pageText(app)).toContain("memorize!");
    expect(cards(app)).toHaveLength(16);
    expect(
      cards(app).every((card) => card.getAttribute("data-face") === "up"),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(
      cards(app).every((card) => card.getAttribute("data-face") === "down"),
    ).toBe(true);
  });

  it("a matched pair stays face-up and the HUD moves", async () => {
    const app = await openPairKeys();
    vi.useFakeTimers();
    button(app, "start memory game")?.click();
    await vi.advanceTimersByTimeAsync(2100); //past the preview
    const first = cards(app)[0];
    const mate = twin(app, first);
    expect(mate).toBeDefined();
    first?.click();
    await vi.advanceTimersByTimeAsync(20);
    mate?.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(first?.getAttribute("data-face")).toBe("matched");
    expect(mate?.getAttribute("data-face")).toBe("matched");
    expect(pageText(app)).toContain("1/8");
  });

  it("a mismatch flips both cards back after 700ms", async () => {
    const app = await openPairKeys();
    vi.useFakeTimers();
    button(app, "start memory game")?.click();
    await vi.advanceTimersByTimeAsync(2100);
    //find two cards with DIFFERENT letters
    const all = cards(app);
    const a = all[0];
    const b = all.find(
      (card) => card.getAttribute("data-base") !== a?.getAttribute("data-base"),
    );
    a?.click();
    await vi.advanceTimersByTimeAsync(20);
    b?.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(a?.getAttribute("data-face")).toBe("up");
    expect(b?.getAttribute("data-face")).toBe("up");
    await vi.advanceTimersByTimeAsync(800);
    expect(a?.getAttribute("data-face")).toBe("down");
    expect(b?.getAttribute("data-face")).toBe("down");
  });

  it("form-name mode pairs a form glyph with its bare base letter", async () => {
    const app = await openPairKeys();
    vi.useFakeTimers();
    button(app, "start memory game")?.click(); //default mode = form-name
    await vi.advanceTimersByTimeAsync(2100);
    const formCards = cards(app).filter(
      (card) => card.getAttribute("data-kind") === "form",
    );
    expect(formCards).toHaveLength(8); //one form card per pair
    const first = formCards[0];
    const base = first?.getAttribute("data-base") ?? "";
    //the face shows a JOINED glyph: the base letter padded with ZWJs —
    //never the bare letter alone
    const glyph = (first?.textContent ?? "").replace("◆", "");
    expect(glyph).not.toBe(base);
    expect(glyph.length).toBeGreaterThan(base.length); //ZWJ padding added
    first?.click();
    await vi.advanceTimersByTimeAsync(20);
    twin(app, first)?.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(first?.getAttribute("data-face")).toBe("matched");
  });

  it("matching all 8 pairs ends the run and records it", async () => {
    const app = await openPairKeys();
    vi.useFakeTimers();
    button(app, "start memory game")?.click();
    await vi.advanceTimersByTimeAsync(2100);
    //pair every card with its twin (data-base twins work in both modes)
    let guard = 0;
    while (pageText(app).includes("/8") && guard++ < 40) {
      const next = cards(app).find(
        (card) => card.getAttribute("data-face") === "down",
      );
      if (next === undefined) break;
      next.click();
      await vi.advanceTimersByTimeAsync(20);
      twin(app, next)?.click();
      await vi.advanceTimersByTimeAsync(20);
    }
    //the 100ms tick notices the done phase and swaps in the result screen
    await vi.advanceTimersByTimeAsync(200);
    const text = pageText(app);
    expect(text).toContain("perfect run!"); //pure twin play = 8 moves
    const raw = JSON.parse(
      window.localStorage.getItem(PAIR_KEYS_STATS_KEY) ?? "{}",
    ) as { games?: number; history?: unknown[] };
    expect(raw.games ?? 0).toBeGreaterThan(0);
    expect(raw.history?.length ?? 0).toBeGreaterThan(0);
  });
});

/** the tauri fake for the online tests: records the invokes and captures
 * the event listeners so the spec can fire the Rust-side events */
function installTauriMock(): {
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
            name: "P1",
          };
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

/** solves the board: clicks matching pairs until the verdict/awaiting */
async function solveBoard(app: App): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    if (
      app.container.querySelector('[data-testid="pk-awaiting"]') !== null ||
      app.container.querySelector('[data-testid="pk-verdict"]') !== null
    ) {
      return;
    }
    const cardList = cards(app);
    const open = cardList.filter(
      (card) => card.getAttribute("data-face") !== "matched",
    );
    const byBase = new Map<string, HTMLElement[]>();
    for (const card of open) {
      const base = card.getAttribute("data-base") ?? "";
      byBase.set(base, [...(byBase.get(base) ?? []), card]);
    }
    let clicked = false;
    for (const [, group] of byBase) {
      if (group.length >= 2) {
        (group[0] as HTMLElement).click();
        (group[1] as HTMLElement).click();
        clicked = true;
        break;
      }
    }
    if (!clicked && open.length >= 2) {
      (open[0] as HTMLElement).click();
      (open[1] as HTMLElement).click();
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("pair keys online (online wave, phase 26)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
    _resetPairKeysForTests();
    _resetLanStateForTests();
    _resetLanMatchForTests();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanupApp();
  });

  it("an armed match races the board: banner, relay, awaiting, win", async () => {
    const tauri = installTauriMock();
    await lanStartHost("HOST1");
    tauri.fire("lan://peer-joined", { name: "P2" });
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/games/pair-keys" });
    await app.settle();
    armLanMatch({
      role: "host",
      peerName: "P2",
      start: {
        gameId: "pair-keys",
        seed: 42,
        params: { lang: "english", mode: "letter", level: 1 },
      },
    });
    await new Promise((r) => setTimeout(r, 100)); //the board builds
    expect(pageText(app)).toContain("online vs P2");
    expect(pageText(app)).toContain("same board");

    await solveBoard(app);
    expect(pageText(app)).toContain("waiting for P2");
    const finishes = tauri.invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);

    //the peer solves later -> I win; no local records
    handleLanPeerMessage({ type: "finished", finishMs: 999_999, acc: 100 });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("you win!");
    expect(window.localStorage.getItem(PAIR_KEYS_STATS_KEY)).toBeNull();
  });

  it("the peer's earlier finish resolves my solve as a loss", async () => {
    const { app, invokes } = await armOnlineSolve();
    //the peer finishes instantly while I am still solving
    handleLanPeerMessage({
      type: "progress",
      gameId: "pair-keys",
      state: { found: 8, moves: 8 },
    });
    handleLanPeerMessage({ type: "finished", finishMs: 100, acc: 100 });
    await new Promise((r) => setTimeout(r, 60));

    await solveBoard(app);
    expect(pageText(app)).toContain("P2 wins");
    const finishes = invokes.filter(
      (entry) =>
        entry.cmd === "lan_send_message" &&
        (entry.args["message"] as Record<string, unknown>)["type"] ===
          "finished",
    );
    expect(finishes).toHaveLength(1);
  });

  it("a disconnect during the solve voids it", async () => {
    const { app, fire } = await armOnlineSolve();
    fire("lan://peer-left", { reason: "disconnected" });
    await new Promise((r) => setTimeout(r, 80));
    expect(pageText(app)).toContain("the opponent left");
    expect(pageText(app)).toContain("start memory game"); //back at setup
  });
});

async function armOnlineSolve(): Promise<{
  app: App;
  invokes: { cmd: string; args: Record<string, unknown> }[];
  fire: (ev: string, payload: unknown) => void;
}> {
  const tauri = installTauriMock();
  await lanStartHost("HOST1");
  tauri.fire("lan://peer-joined", { name: "P2" });
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/pair-keys" });
  await app.settle();
  armLanMatch({
    role: "host",
    peerName: "P2",
    start: {
      gameId: "pair-keys",
      seed: 42,
      params: { lang: "english", mode: "letter", level: 1 },
    },
  });
  await new Promise((r) => setTimeout(r, 100)); //the board builds
  return { app, invokes: tauri.invokes, fire: tauri.fire };
}
