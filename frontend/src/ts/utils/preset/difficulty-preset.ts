import { z } from "zod";

import { setConfig } from "../../config/setters";
import { download } from "../misc";

/**
 * The per-game difficulty preset (phase 86): a versioned JSON file that
 * carries the CHALLENGE-DEFINING config keys — mode, duration/amount,
 * language, difficulty, funbox, punctuation, numbers, the fail rules —
 * so a friend can import the file and race under the exact same
 * settings. Everything else in the receiver's config stays theirs.
 *
 * Validation rides the CONFIG schema itself (a pick of it), so a preset
 * can never carry a value the app wouldn't accept. PURE: applyPreset is
 * the only impure function and it just forwards to setConfig (which runs
 * the app's own validation again).
 */

/** the challenge-defining keys a preset carries (the whitelist) */
export const PRESET_KEYS = [
  "mode",
  "time",
  "words",
  "quoteLength",
  "language",
  "difficulty",
  "funbox",
  "punctuation",
  "numbers",
  "stopOnError",
  "deleteOnError",
  "confidenceMode",
  "minWpm",
  "minWpmCustomSpeed",
  "minAcc",
  "minAccCustom",
  "lazyMode",
] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

export type DifficultyPreset = {
  version: 1;
  kind: "difficulty-preset";
  name: string;
  preset: Partial<Record<PresetKey, unknown>>;
};

const PresetValuesSchema = z
  .object({
    mode: z.string(),
    time: z.number(),
    words: z.number(),
    quoteLength: z.array(z.number()),
    language: z.string(),
    difficulty: z.string(),
    funbox: z.array(z.string()),
    punctuation: z.boolean(),
    numbers: z.boolean(),
    stopOnError: z.string(),
    deleteOnError: z.string(),
    confidenceMode: z.string(),
    minWpm: z.number(),
    minWpmCustomSpeed: z.number(),
    minAcc: z.number(),
    minAccCustom: z.number(),
    lazyMode: z.boolean(),
  })
  .partial();

const PresetFileSchema = z.object({
  version: z.literal(1),
  kind: z.literal("difficulty-preset"),
  name: z.string().min(1).max(80),
  preset: PresetValuesSchema,
});

/** builds a preset file from the LIVE config — only the whitelist keys */
export function buildPresetFromConfig(
  name: string,
  config: Record<string, unknown>,
): DifficultyPreset {
  const preset: Partial<Record<PresetKey, unknown>> = {};
  for (const key of PRESET_KEYS) {
    const value = config[key];
    if (value !== undefined) preset[key] = value;
  }
  return {
    version: 1,
    kind: "difficulty-preset",
    name: name.slice(0, 80),
    preset,
  };
}

/** validates an untrusted parsed value as a preset file */
export function validatePresetFile(raw: unknown): DifficultyPreset | undefined {
  const parsed = PresetFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** applies a validated preset: one setConfig per carried key — the app's
 * own per-key validation runs again inside setConfig, so a hostile file
 * still cannot smuggle an invalid value */
export function applyPreset(
  preset: DifficultyPreset,
  setters: {
    setConfig: <T extends Record<string, unknown>>(
      key: keyof DifficultyPreset["preset"] & string,
      value: T[keyof T],
    ) => void;
  },
): void {
  for (const key of PRESET_KEYS) {
    const value = preset.preset[key];
    if (value === undefined) continue;
    setters.setConfig(key as never, value as never);
  }
}

/** downloads the preset as a versioned json file (the share flow) */
export function downloadPresetFile(preset: DifficultyPreset): void {
  download({
    filename: `paralleltype-preset-${preset.name.replace(/[^a-z0-9_-]+/gi, "-")}.json`,
    data: new Blob([JSON.stringify(preset, null, 2) + "\n"], {
      type: "application/json",
    }),
  });
}

