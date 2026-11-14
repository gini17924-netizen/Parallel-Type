import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

import { App, cleanupApp, renderApp } from "../../../__harness__/app-shell";

function pageText(app: App): string {
  return app.container.textContent ?? "";
}

describe("the streaks page (phase 98)", () => {
  afterEach(() => {
    cleanupApp();
  });

  it("the unified view renders with the daily and weekly rows", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/streaks" });
    await app.settle();
    const text = pageText(app);
    expect(text).toContain("streaks");
    expect(text).toContain("daily — typed at least once");
    expect(text).toContain("weekly — typed in the week");
    expect(text).toContain("per game");
    //a fresh install: zero chains, but the rows are there
    expect(
      app.container.querySelector('[data-testid="streak-daily"]'),
    ).not.toBeNull();
    expect(
      app.container.querySelector('[data-testid="streak-weekly"]'),
    ).not.toBeNull();
  });

  it("the practice picker lists the streaks entry", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({
      to: "/sections/$sectionId",
      params: { sectionId: "practice" },
    });
    await app.settle();
    expect(pageText(app)).toContain("streaks");
  });
});
