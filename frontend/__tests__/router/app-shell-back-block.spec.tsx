import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupApp, renderApp } from "../__harness__/app-shell";

//desktop fork: the same DESKTOP_OFFLINE mock as app-shell.spec.tsx — these
//assertions exercise the upstream website flow.
vi.mock("../../src/ts/utils/local-persistence", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DESKTOP_OFFLINE: false,
}));

//B32/KI-19: this test passes in isolation but fails in the app-shell suite's
//full-file order (test pollution introduced with the offline build; bisect
//points at 34965b8, the first desktop commit). It lives in its own file so
//the suite stays green without weakening the assertion.
describe("app shell routing — back blocking (isolated)", () => {
  afterEach(() => {
    cleanupApp();
  });

  it("blocks back while the bar is shown", async () => {
    const app = renderApp({
      url: "/",
      auth: "signedIn",
      results: "pending",
      history: "browser",
    });
    await app.settle();
    void app.navigate({ to: "/account" });
    await app.settle({ waitForRouter: false });
    expect(app.loadingIndicator()).toBe("bar");

    app.router.history.back();
    // popstate fires asynchronously, the blocker then restores the entry
    await vi.waitFor(() => expect(window.location.pathname).toBe("/account"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.settle({ waitForRouter: false });

    expect(window.location.pathname).toBe("/account");
    expect(app.url()).toBe("/account");
    expect(app.loadingBar()?.text).toBe("Downloading results...");
  });
});
