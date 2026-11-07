import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
