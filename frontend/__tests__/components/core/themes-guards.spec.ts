import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { ThemeNameSchema } from "@monkeytype/schemas/configs";
import { themes } from "../../../src/ts/constants/themes";

/**
 * Two-file sync guards (idea #13): theme names live in BOTH
 * constants/themes.ts and packages/schemas ThemeNameSchema with no
 * enforcement between them upstream - a name added to one silently breaks
 * the other (schema validation would reject the config value at runtime).
 */

describe("themes two-file sync guards (idea #13)", () => {
  it("every entry in the themes object is a schema member", () => {
    const schemaNames = ThemeNameSchema.options;
    for (const key of Object.keys(themes)) {
      expect(
        schemaNames,
        `theme "${key}" missing from ThemeNameSchema`,
      ).toContain(key);
    }
  });

  it("every schema member has a theme entry", () => {
    for (const name of ThemeNameSchema.options) {
      expect(
        themes[name],
        `schema name "${name}" missing a theme object`,
      ).toBeDefined();
    }
  });

  it("hasCss themes have a css file and theme css files have hasCss", () => {
    const staticDir = path.resolve(process.cwd(), "static/themes");
    const files = new Set(
      fs
        .readdirSync(staticDir)
        .filter((name) => name.endsWith(".css"))
        .map((name) => name.replace(/\.css$/, "")),
    );
    for (const [name, theme] of Object.entries(themes)) {
      if (theme.hasCss === true) {
        expect(
          files.has(name),
          `theme "${name}" hasCss but no static file`,
        ).toBe(true);
      } else {
        expect(
          files.has(name),
          `static css for "${name}" exists but hasCss is not set`,
        ).toBe(false);
      }
    }
  });

  it("fade_ghost neutralizes the typedEffect fades and honors reduced motion", () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "static/themes/fade_ghost.css"),
      "utf8",
    );
    expect(css).toContain("#words .word.typed {");
    expect(css).toContain("opacity: 0.25");
    expect(css).toContain("#words.typed-effect-fade .word.typed");
    expect(css).toContain("#words.typed-effect-hide .word.typed");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
