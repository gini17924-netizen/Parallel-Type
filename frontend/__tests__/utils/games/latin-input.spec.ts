import { describe, expect, it } from "vitest";

import { latinCharFromEvent } from "../../../src/ts/utils/games/latin-input";

describe("latin input for games (round-5 phase 1)", () => {
  it("a latin event.key passes through untouched", () => {
    expect(latinCharFromEvent("d", "KeyD")).toBe("d");
    expect(latinCharFromEvent("Z", "KeyZ")).toBe("z"); //shift cap
    expect(latinCharFromEvent("5", "Digit5")).toBe("5");
  });

  it("a Persian layout's key maps by the physical code", () => {
    //KeyD on a Persian layout produces «ی» — the game must still see d
    expect(latinCharFromEvent("ی", "KeyD")).toBe("d");
    expect(latinCharFromEvent("ق", "KeyW")).toBe("w");
    expect(latinCharFromEvent("آ", "KeyH")).toBe("h");
  });

  it("space maps by code and unknown codes pass through", () => {
    expect(latinCharFromEvent("‌", "Space")).toBe(" ");
    expect(latinCharFromEvent("Ω", "Unknown99")).toBe("Ω"); //the game's no-op path
  });

  it("the letter games' full input path: a Persian-layout word still matches", () => {
    //the word "had" typed on a Persian layout yields these key/code pairs
    const pairs: [string, string][] = [
      ["ا", "KeyH"],
      ["ش", "KeyA"],
      ["ی", "KeyD"],
    ];
    const typed = pairs.map(([key, code]) => latinCharFromEvent(key, code));
    expect(typed.join("")).toBe("had");
  });
});
