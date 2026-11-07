import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LEARN_STATE_KEY } from "../../../../src/ts/utils/local-persistence";
import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

function button(app: App, label: string): HTMLButtonElement | undefined {
  return [...app.container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

function seedLearnState(unlockedGroups: number): void {
  window.localStorage.setItem(
    LEARN_STATE_KEY,
    JSON.stringify({ unlockedGroups, keyStats: {}, reviewState: {} }),
  );
}

async function openLearn(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/learn" });
  await app.settle();
  return app;
}

describe("learn page (progressive learning)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanupApp();
  });

  it("a fresh profile unlocks the first group and shows the SECOND as next", async () => {
    const app = await openLearn();
    const text = pageText(app);
    //english groups: fj, dk, sl, ... — unlocked = the first one only
    expect(text).toContain("unlocked letters");
    expect(text).toContain("fj");
    //L1: the next-to-unlock display must be the group AFTER the unlocked
    //ones (dk), not the group being mastered (fj)
    expect(text).toContain("dk");
    expect(text).toContain("mastery threshold: 95% accuracy");
  });

  it("with two groups unlocked, the next-group display shows the third (L1)", async () => {
    seedLearnState(2);
    const app = await openLearn();
    const text = pageText(app);
    //unlocked = fj + dk; the next group to unlock is sl — the old code
    //repeated dk here
    expect(text).toContain("next group to unlock");
    expect(text).toContain("sl");
  });

  it("reset progress refreshes the unlocked-letters line immediately (L2)", async () => {
    seedLearnState(2);
    const app = await openLearn();
    expect(pageText(app)).toContain("fjdk"); //two groups unlocked
    button(app, "reset progress")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const text = pageText(app);
    //the line must drop back to the first group right away — it used to
    //stay stale until a full page remount
    expect(text).toContain("fj");
    expect(text).not.toContain("fjdk");
    //the per-key grid resets too
    expect(text).toContain("no data yet — run a drill");
    expect(window.localStorage.getItem(LEARN_STATE_KEY)).toBeNull();
  });
});
