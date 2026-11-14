import { z } from "zod";

import { ThemeSchema, type Theme } from "../../constants/themes";
import { LocalStorageWithSchema } from "../local-storage-with-schema";
import { download } from "../misc";

/**
 * phase 92: LOCAL named custom themes. The upstream machinery is
 * account-gated (collections/custom-themes goes through Firebase) and the
 * desktop fork boots signed-out, so "save as new" was dead code — the
 * pickers edited a live theme that was never nameable. This store gives
 * the same capability offline: named snapshots of the theme colors, kept
 * in their own localStorage key (the independent-store house rule — never
 * the learn-stats letter grid), applied through the EXISTING pathway
 * (setConfig("customThemeColors") — the controller converts and applies).
 * PURE: applying and persisting to the config happen in the component.
 */

const MAX_LOCAL_THEMES = 20;
const MAX_NAME_LENGTH = 80;

const localThemesStore = new LocalStorageWithSchema({
  key: "mtDesktopCustomThemes",
  schema: z.record(z.string(), ThemeSchema),
  fallback: {},
});

export type LocalCustomTheme = { name: string; colors: Theme };

/** trims and collapses whitespace; the caller decides if empty is fatal */
export function normalizeThemeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

/** the named themes, alphabetical */
export function listLocalCustomThemes(): LocalCustomTheme[] {
  const stored = localThemesStore.get();
  return Object.entries(stored)
    .map(([name, colors]) => ({ name, colors }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** saves (or overwrites) a named snapshot. false = empty name or the cap
 * reached for a NEW name — overwrites never count against the cap */
export function saveLocalCustomTheme(name: string, colors: Theme): boolean {
  const clean = normalizeThemeName(name);
  if (clean === "") return false;
  const stored = localThemesStore.get();
  if (
    stored[clean] === undefined &&
    Object.keys(stored).length >= MAX_LOCAL_THEMES
  ) {
    return false;
  }
  stored[clean] = colors;
  localThemesStore.set(stored);
  return true;
}

export function deleteLocalCustomTheme(name: string): boolean {
  const stored = localThemesStore.get();
  if (stored[name] === undefined) return false;
  const next: Record<string, Theme> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key !== name) next[key] = value;
  }
  localThemesStore.set(next);
  return true;
}

/** wipes the store (the specs' reset; the prod flows never call it) */
export function resetLocalCustomThemes(): void {
  localThemesStore.clear();
}

// ---- the shareable file (the difficulty-preset pattern of phase 86) ----

const CustomThemeFileSchema = z.object({
  version: z.literal(1),
  kind: z.literal("custom-theme"),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  colors: ThemeSchema,
});

export type CustomThemeFile = z.infer<typeof CustomThemeFileSchema>;

/** builds a versioned theme file from a named snapshot */
export function buildCustomThemeFile(
  name: string,
  colors: Theme,
): CustomThemeFile {
  return {
    version: 1,
    kind: "custom-theme",
    name: normalizeThemeName(name),
    colors: { ...colors },
  };
}

/** validates an untrusted parsed value as a theme file — a hostile file
 * cannot smuggle a malformed color set through */
export function validateCustomThemeFile(
  raw: unknown,
): CustomThemeFile | undefined {
  const parsed = CustomThemeFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** downloads the theme file (the share flow) */
export function downloadCustomThemeFile(file: CustomThemeFile): void {
  download({
    filename: `paralleltype-theme-${file.name.replace(/[^a-z0-9_-]+/gi, "-")}.json`,
    data: new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: "application/json",
    }),
  });
}
