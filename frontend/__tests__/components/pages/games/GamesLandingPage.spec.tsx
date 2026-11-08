import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

async function openLanding(): Promise<App> {
  const app = renderApp();
  await app.settle();
  await app.router.navigate({ to: "/games" });
  await app.settle();
  return app;
}

describe("games landing (games reorg, phase 2)", () => {
  beforeEach(() => {
    (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanupApp();
  });

  it("the landing shows the two blocks", async () => {
    const app = await openLanding();
    const text = pageText(app);
    expect(text).toContain("Offline Games");
    expect(text).toContain("Online Games");
    expect(
      app.container.querySelector('[data-testid="gl-offline"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="gl-online"]'),
    ).not.toBeNull();
  });

  it("the Online block is disabled with a coming-soon badge", async () => {
    const app = await openLanding();
    const online = app.container.querySelector('[data-testid="gl-online"]');
    expect(online?.textContent).toContain("coming soon");
    const enterBtn = [...(online?.querySelectorAll("button") ?? [])][0];
    expect(enterBtn?.disabled ?? false).toBe(true);
  });

  it("clicking Offline opens the categories view", async () => {
    const app = await openLanding();
    app.container
      .querySelector('[data-testid="gl-offline"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settle();
    const text = pageText(app);
    expect(text).toContain("offline games");
    //the pinned Daily Gauntlet banner
    expect(
      app.container.querySelector('[data-testid="gl-daily"]'),
    ).not.toBeNull();
    //all six categories render
    expect(
      app.container.querySelectorAll('[data-testid="gl-category"]'),
    ).toHaveLength(6);
    //every categorized game card renders exactly once (23 = 24 - daily)
    expect(
      app.container.querySelectorAll('[data-testid="gl-game-card"]'),
    ).toHaveLength(23);
    //the approved taxonomy titles
    for (const title of [
      "Speed & Race",
      "Precision & Timing",
      "Reflex & Survival",
      "Memory & Deduction",
      "Movement & Spatial",
      "Two Players",
    ]) {
      expect(text).toContain(title);
    }
  });

  it("the daily banner links to the gauntlet", async () => {
    const app = await openLanding();
    app.container
      .querySelector('[data-testid="gl-offline"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settle();
    app.container
      .querySelector('[data-testid="gl-daily"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settle();
    expect(app.router.state.location.pathname).toBe("/games/daily-gauntlet");
  });

  it("a category game card links to its game route", async () => {
    const app = await openLanding();
    app.container
      .querySelector('[data-testid="gl-offline"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settle();
    const card = [
      ...app.container.querySelectorAll('[data-testid="gl-game-card"]'),
    ].find((el) => el.textContent?.includes("word blast"));
    card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settle();
    expect(app.router.state.location.pathname).toBe("/games/word-blast");
  });

  it("the back-to-home control returns home", async () => {
    const app = await openLanding();
    const backBtn = [...app.container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("back to home"),
    );
    backBtn?.click();
    await app.settle();
    expect(app.router.state.location.pathname).toBe("/home");
  });
});
