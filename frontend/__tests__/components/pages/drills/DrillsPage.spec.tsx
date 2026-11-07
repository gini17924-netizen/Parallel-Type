import { describe, expect, it } from "vitest";

import { takeActiveDrillWords } from "../../../../src/ts/utils/learn-stats";
import { renderApp } from "../../../__harness__/app-shell";

describe("drills page (smart drill wiring)", () => {
  it("a started smart drill registers its words for the review schedule (KI-39)", async () => {
    const app = renderApp();
    await app.settle();
    await app.router.navigate({ to: "/drills" });
    await app.settle();

    const start = [...app.container.querySelectorAll("button")].find((b) =>
      /start smart drill/i.test(b.textContent ?? ""),
    );
    expect(start).not.toBeUndefined();
    start?.click();

    //the engine load + generation is async: poll the registration itself
    //(the app router uses memory history, so window.location never moves)
    let words: string[] | undefined;
    for (let i = 0; i < 90 && words === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      words = takeActiveDrillWords();
    }
    expect(Array.isArray(words), "the smart drill never registered").toBe(true);
    expect((words ?? []).length).toBeGreaterThan(0);
    //consumed exactly once: a second read is empty
    expect(takeActiveDrillWords()).toBeUndefined();
  });
});
