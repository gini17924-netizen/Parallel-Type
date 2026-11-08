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

  it("clicking Offline opens the offline view (the categories arrive in phase 3)", async () => {
    const app = await openLanding();
    app.container
      .querySelector('[data-testid="gl-offline"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settle();
    const text = pageText(app);
    expect(text).toContain("offline games");
    expect(
      app.container.querySelector('[data-testid="gl-offline"]'),
    ).toBeNull(); //the blocks view is gone
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
