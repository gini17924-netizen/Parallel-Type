import { fireEvent } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetBotDuelStatsForTests,
  BOT_DUEL_STATS_KEY,
} from "../../../../src/ts/utils/bot-duel/duel-store";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function openBotDuel(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games/bot-duel" });
  await app.settle();
  return app;
}

function currentWord(app: App): string {
  return (
    app.container.querySelector('[data-testid="bd-word"]')?.textContent ?? ""
  );
}

/** the already-typed head of the current word (the main-colored span) */
function typedPart(app: App): string {
  return (
    app.container.querySelector('[data-testid="bd-word"] > .text-main')
      ?.textContent ?? ""
  );
}

async function startRace(app: App): Promise<void> {
  vi.useFakeTimers();
  button(app, "start race")?.click();
  await vi.advanceTimersByTimeAsync(50); //the word list resolves (fallback)
  await vi.advanceTimersByTimeAsync(2800); //countdown 3-2-1 -> the duel
}

describe("bot duel page (idea G2 phase 3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetBotDuelStatsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupApp();
  });

  it("picker renders the bot tiers and the race lengths", async () => {
    const app = await openBotDuel();
    const text = pageText(app);
    expect(text).toContain("bot speed (wpm)");
    expect(text).toContain("140 is endgame");
    expect(text).toContain("start race");
    for (const tier of ["40", "60", "80", "100", "120", "140"]) {
      expect(text).toContain(tier);
    }
    for (const length of ["quick", "standard", "long"]) {
      expect(text).toContain(length);
    }
  });

  it("a race won by typing ends in the result overlay and records stats", async () => {
    const app = await openBotDuel();
    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    //type whatever the current word shows until the race is won
    for (let guard = 0; guard < 400; guard++) {
      if (pageText(app).includes("you win!")) break;
      const word = currentWord(app);
      const done = typedPart(app).length;
      if (word !== "" && done < word.length) {
        fireEvent.keyDown(window, { key: word[done] });
      } else {
        await vi.advanceTimersByTimeAsync(50);
      }
    }
    expect(pageText(app)).toContain("you win!");
    expect(pageText(app)).toContain("rematch (same words)");

    //the result reached the store: a won race on the 60wpm tier
    const raw = JSON.parse(
      window.localStorage.getItem(BOT_DUEL_STATS_KEY) ?? "{}",
    ) as {
      history: { result: string }[];
      byTier: Record<string, { wins: number }>;
    };
    expect(raw.history).toHaveLength(1);
    expect(raw.history[0]?.result).toBe("won");
    expect(raw.byTier["60"]?.wins).toBe(1);
  });

  it("a window blur during the duel voids the race without recording", async () => {
    const app = await openBotDuel();
    await startRace(app);
    expect(currentWord(app)).not.toBe("");

    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pageText(app)).toContain("race void");
    expect(pageText(app)).toContain("start race"); //back at the picker
    expect(window.localStorage.getItem(BOT_DUEL_STATS_KEY)).toBeNull();
  });
});
