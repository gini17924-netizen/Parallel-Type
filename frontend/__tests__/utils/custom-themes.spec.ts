import { beforeEach, describe, expect, it } from "vitest";

import {
  buildCustomThemeFile,
  deleteLocalCustomTheme,
  listLocalCustomThemes,
  normalizeThemeName,
  resetLocalCustomThemes,
  saveLocalCustomTheme,
  validateCustomThemeFile,
} from "../../src/ts/utils/themes/custom-themes";

const COLORS = {
  bg: "#323437",
  main: "#e2b714",
  caret: "#e2b714",
  sub: "#646669",
  subAlt: "#2c2e31",
  text: "#d1d0c5",
  error: "#ca4754",
  errorExtra: "#7e2a33",
  colorfulError: "#ca4754",
  colorfulErrorExtra: "#7e2a33",
};

describe("phase 92 — the local custom themes", () => {
  beforeEach(() => {
    resetLocalCustomThemes();
  });

  it("saves, lists alphabetically and normalizes the name", () => {
    expect(saveLocalCustomTheme("  my   theme ", COLORS)).toBe(true);
    expect(saveLocalCustomTheme("alpha", COLORS)).toBe(true);
    const list = listLocalCustomThemes();
    expect(list.map((t) => t.name)).toEqual(["alpha", "my theme"]);
    expect(list[0]?.colors).toEqual(COLORS);
  });

  it("rejects an empty name and caps at 20 distinct themes", () => {
    expect(saveLocalCustomTheme("   ", COLORS)).toBe(false);
    for (let i = 1; i <= 20; i++) {
      expect(saveLocalCustomTheme(`theme ${i}`, COLORS)).toBe(true);
    }
    expect(saveLocalCustomTheme("one too many", COLORS)).toBe(false);
    //overwriting an existing name never counts against the cap
    expect(saveLocalCustomTheme("theme 1", { ...COLORS, bg: "#111111" })).toBe(
      true,
    );
    expect(listLocalCustomThemes()).toHaveLength(20);
    //the overwrite actually landed
    expect(
      listLocalCustomThemes().find((t) => t.name === "theme 1")?.colors.bg,
    ).toBe("#111111");
  });

  it("deletes a saved theme once", () => {
    saveLocalCustomTheme("gone", COLORS);
    expect(deleteLocalCustomTheme("gone")).toBe(true);
    expect(deleteLocalCustomTheme("gone")).toBe(false);
    expect(listLocalCustomThemes()).toHaveLength(0);
  });

  it("normalizeThemeName collapses whitespace and clips to 80", () => {
    expect(normalizeThemeName("  a   b  ")).toBe("a b");
    expect(normalizeThemeName("x".repeat(90))).toHaveLength(80);
  });
});

describe("phase 92 — the shareable theme file", () => {
  it("the round-trip: validate accepts what build produced", () => {
    const file = buildCustomThemeFile("my theme", COLORS);
    const validated = validateCustomThemeFile(structuredClone(file));
    expect(validated?.name).toBe("my theme");
    expect(validated?.colors).toEqual(COLORS);
  });

  it("rejects a wrong-kind or wrong-version file", () => {
    expect(
      validateCustomThemeFile({
        version: 2,
        kind: "custom-theme",
        name: "x",
        colors: COLORS,
      }),
    ).toBeUndefined();
    expect(
      validateCustomThemeFile({
        version: 1,
        kind: "something-else",
        name: "x",
        colors: COLORS,
      }),
    ).toBeUndefined();
    expect(validateCustomThemeFile("garbage")).toBeUndefined();
  });

  it("rejects an empty name or a malformed color", () => {
    expect(
      validateCustomThemeFile({
        version: 1,
        kind: "custom-theme",
        name: "",
        colors: COLORS,
      }),
    ).toBeUndefined();
    expect(
      validateCustomThemeFile({
        version: 1,
        kind: "custom-theme",
        name: "x",
        colors: { ...COLORS, bg: "red" },
      }),
    ).toBeUndefined();
    expect(
      validateCustomThemeFile({
        version: 1,
        kind: "custom-theme",
        name: "x",
        colors: { ...COLORS, main: undefined },
      }),
    ).toBeUndefined();
  });
});
