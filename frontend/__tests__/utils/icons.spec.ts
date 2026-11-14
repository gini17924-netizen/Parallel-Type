import * as fs from "fs";
import { createRequire } from "module";
import { describe, expect, it } from "vitest";

/**
 * phase 101's CI lesson, pinned as a gate: the production fontawesome
 * SUBSET plugin rejects any `fa-*` class that the installed
 @fortawesome/fontawesome-free set does not know — vitest never renders
 * icons, so a bad icon name used to surface ONLY in the release build.
 * this spec re-runs the plugin's scan over src + static html/css and
 * asserts every used class resolves to a solid/regular/brands icon.
 */
function parseIcons(iconSet: string): string[] {
  const require = createRequire(import.meta.url);
  const path = require.resolve(
    `@fortawesome/fontawesome-free/js/${iconSet}.js`,
  );
  const file: string | null = fs.readFileSync(path).toString();
  return file
    ?.match(/"(.*)": \[.*\],/g)
    ?.map((it) => it.substring(1, it.indexOf(":") - 1)) as string[];
}

function findAllFiles(
  dir: string,
  filter: (filename: string) => boolean,
): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = `${current}/${entry.name}`.replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(full);
      } else if (filter(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

/** the plugin's reserved NON-icon classes (animations, sizing, rotation…)
 * — mirrored from vite-plugins/fontawesome-subset.ts modules2 */
const RESERVED_UTILITY_CLASSES = new Set([
  "spin",
  "pulse",
  "border",
  "pull-left",
  "pull-right",
  "fw",
  "lg",
  "xs",
  "sm",
  "1x",
  "2x",
  "3x",
  "4x",
  "5x",
  "6x",
  "7x",
  "8x",
  "9x",
  "10x",
  "rotate-90",
  "rotate-180",
  "rotate-270",
  "flip-horizontal",
  "flip-vertical",
  "flip-both",
  "flip-horizontal-rotate-90",
  "flip-horizontal-rotate-180",
  "flip-vertical-rotate-90",
  "flip-vertical-rotate-270",
  "inverse",
  "stack",
  "stack-1x",
  "stack-2x",
]);

describe("phase 101 — every fa-* class exists in the fontawesome set", () => {
  it("the src tree uses only known icons", () => {
    const solid = new Set(parseIcons("solid"));
    const regular = new Set(parseIcons("regular"));
    const brands = new Set(parseIcons("brands"));

    const srcFiles = findAllFiles("./src", (filename) => {
      return (
        !filename.startsWith("keybr") &&
        !filename.endsWith("fontawesome-5.scss") &&
        !filename.endsWith("fontawesome-6.scss") &&
        (filename.endsWith(".ts") ||
          filename.endsWith(".tsx") ||
          filename.endsWith(".scss") ||
          filename.endsWith(".html"))
      );
    });

    const unknown = new Map<string, string[]>();
    const regex = /\bfa-[a-z0-9-]+\b/g;
    for (const file of srcFiles) {
      const content = fs.readFileSync(file).toString();
      const matches = content.match(regex);
      if (matches === null) continue;
      for (const match of matches) {
        const name = match.substring(3);
        if (
          !solid.has(name) &&
          !regular.has(name) &&
          !brands.has(name) &&
          !RESERVED_UTILITY_CLASSES.has(name) &&
          !unknown.has(name)
        ) {
          unknown.set(name, [...(unknown.get(name) ?? []), file]);
        }
      }
    }
    expect(
      [...unknown.entries()].map(([icon, files]) => `${icon} (${files[0]}…)`),
      "every used fa-* class must exist in the installed fontawesome set",
    ).toEqual([]);
  });
});
