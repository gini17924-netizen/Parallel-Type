// keybr session glue: framework-free composition of the
// vendored keybr.com engine (AGPL). See SoftwareRelease/docs/KEYBR_PORT_ARCHITECTURE.md

import {
  KeyboardOptions,
  Language,
  Layout,
  loadKeyboard,
} from "@keybr/keyboard";
import {
  censor,
  makePhoneticModel,
  PhoneticModel,
} from "@keybr/phonetic-model";
import { loadWordList } from "@keybr/content-words";
import { type WordList } from "@keybr/content";
import { Settings } from "@keybr/settings";
import { Result } from "@keybr/result";
import { GuidedLesson } from "@keybr/lesson";
import { makeStats } from "@keybr/textinput";
import { type TextInput } from "@keybr/textinput";

import faModelUrl from "@keybr/phonetic-model/assets/model-fa.data?url";
import enModelUrl from "@keybr/phonetic-model/assets/model-en.data?url";

import * as DesktopAutoBackup from "../utils/desktop-auto-backup";
import { storedRowsToResults, type StoredStats } from "./stored-results";

export type { StoredStats };

export type KeybrLanguageId = "fa" | "en";

export type KeybrLanguage = {
  readonly id: KeybrLanguageId;
  readonly label: string;
  readonly language: Language;
  readonly layout: Layout;
  readonly modelUrl: string;
};

export const KEYBR_LANGUAGES: readonly KeybrLanguage[] = [
  {
    id: "fa",
    label: "فارسی",
    language: Language.FA,
    layout: Layout.FA_IR,
    modelUrl: faModelUrl,
  },
  {
    id: "en",
    label: "English",
    language: Language.EN,
    layout: Layout.EN_US,
    modelUrl: enModelUrl,
  },
];

export function keybrLanguageById(id: KeybrLanguageId): KeybrLanguage {
  const found = KEYBR_LANGUAGES.find((it) => it.id === id);
  if (found !== undefined) return found;
  //KEYBR_LANGUAGES is a non-empty compile-time constant; this is unreachable
  const fallback = KEYBR_LANGUAGES.at(0);
  if (fallback === undefined) throw new Error("no keybr languages configured");
  return fallback;
}

const SETTINGS_KEY = "mtKeybrSettings";
const RESULTS_KEY = "mtKeybrResults";

export function loadKeybrSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) {
      return new Settings(JSON.parse(raw));
    }
  } catch {
    // fall through to defaults
  }
  return new Settings();
}

export function saveKeybrSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(settings.toJSON()),
    );
  } catch {
    // ignore storage failures
  }
}

/** loads the compiled phonetic model for a language, fully offline */
export async function loadPhoneticModel(
  language: KeybrLanguage,
): Promise<PhoneticModel> {
  const response = await fetch(language.modelUrl);
  const body = new Uint8Array(await response.arrayBuffer());
  return censor(makePhoneticModel(language.language, body));
}

//idea #7: consumers outside /keybr (the smart drill) share one lazy model
//per language - the ~69KB asset loads at most once per session. A failed
//load clears the slot so a later call can retry.
const sharedModels: Partial<Record<KeybrLanguageId, Promise<PhoneticModel>>> =
  {};

export function loadSharedPhoneticModel(
  id: KeybrLanguageId,
): Promise<PhoneticModel> {
  sharedModels[id] ??= loadPhoneticModel(keybrLanguageById(id)).catch(
    (error: unknown) => {
      sharedModels[id] = undefined;
      throw error;
    },
  );
  return sharedModels[id] as Promise<PhoneticModel>;
}

/** builds the guided lesson for a language */
export async function makeLesson(
  language: KeybrLanguage,
  settings: Settings,
): Promise<GuidedLesson> {
  //the public factory (the constructor is private): its defaults are the
  //same ANSI_101/STANDARD geometry the fork previously passed explicitly
  const keyboard = loadKeyboard(
    KeyboardOptions.default()
      .withLanguage(language.language)
      .withLayout(language.layout),
  );
  const [model, wordList] = await Promise.all([
    loadPhoneticModel(language),
    loadWordList(language.language).catch(() => null),
  ]);
  return new GuidedLesson(
    settings,
    keyboard,
    model,
    (wordList ?? []) as unknown as WordList,
  );
}

// ---------------------------------------------------------------------------
// result persistence (localStorage, per language)
// ---------------------------------------------------------------------------

function loadStored(language: KeybrLanguageId): unknown[] {
  try {
    const raw = window.localStorage.getItem(`${RESULTS_KEY}:${language}`);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // fall through to empty
  }
  return [];
}

function store(language: KeybrLanguageId, results: StoredStats[]): void {
  try {
    window.localStorage.setItem(
      `${RESULTS_KEY}:${language}`,
      JSON.stringify(results),
    );
  } catch {
    // ignore storage failures
  }
}

/** rebuilds persisted stats into Result objects for the engine; malformed
 * rows (e.g. from a corrupt backup restore) are skipped, not fatal (audit L1) */
export function loadStoredResults(language: KeybrLanguage): Result[] {
  return storedRowsToResults(language.layout, loadStored(language.id));
}

/** extracts the storable stats of a finished text input */
export function resultStats(textInput: TextInput): StoredStats {
  const stats = makeStats(textInput.steps);
  return {
    timeStamp: Date.now(),
    length: stats.length,
    time: stats.time,
    errors: stats.errors,
    histogram: [...stats.histogram].map((sample) => ({
      codePoint: sample.codePoint,
      hitCount: sample.hitCount,
      missCount: sample.missCount,
      timeToType: sample.timeToType,
    })),
  };
}

export function storeResultStats(
  language: KeybrLanguage,
  stats: StoredStats,
): void {
  //write side: these rows were written by this module (the read side, in
  //stored-results.ts, validates their shape defensively - audit L1)
  const results = loadStored(language.id) as StoredStats[];
  results.push(stats);
  //keep a recent window: the engine only needs per-key confidence history
  while (results.length > 200) results.shift();
  store(language.id, results);
  //keep the automatic backup file current for keybr-only users too
  DesktopAutoBackup.queueAutoBackup();
}
