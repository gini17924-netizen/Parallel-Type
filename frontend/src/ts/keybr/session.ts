// @ts-nocheck -- keybr session glue: framework-free composition of the
// vendored keybr.com engine (AGPL). See SoftwareRelease/docs/KEYBR_PORT_ARCHITECTURE.md

import {
  Geometry,
  KeyboardOptions,
  Language,
  Layout,
  loadKeyboard,
  ZoneMod,
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
import { Histogram, type Sample, makeStats } from "@keybr/textinput";
import { type TextInput } from "@keybr/textinput";

import faModelUrl from "@keybr/phonetic-model/assets/model-fa.data?url";
import enModelUrl from "@keybr/phonetic-model/assets/model-en.data?url";

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
  return KEYBR_LANGUAGES.find((it) => it.id === id) ?? KEYBR_LANGUAGES[0];
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

/** builds the guided lesson for a language */
export async function makeLesson(
  language: KeybrLanguage,
  settings: Settings,
): Promise<GuidedLesson> {
  const keyboard = loadKeyboard(
    new KeyboardOptions(
      language.language,
      language.layout,
      Geometry.ANSI_101,
      ZoneMod.STANDARD,
    ),
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

type StoredStats = {
  timeStamp: number;
  length: number;
  time: number;
  errors: number;
  histogram: Sample[];
};

function loadStored(language: KeybrLanguageId): StoredStats[] {
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

/** rebuilds persisted stats into Result objects for the engine */
export function loadStoredResults(language: KeybrLanguage): Result[] {
  const layout = language.layout;
  const textType = 0; // TextType.TEXT
  return loadStored(language.id).map(
    (it) =>
      new Result(
        layout,
        textType,
        it.timeStamp ?? Date.now(),
        it.length,
        it.time,
        it.errors,
        new Histogram(it.histogram),
      ),
  );
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
  const results = loadStored(language.id);
  results.push(stats);
  //keep a recent window: the engine only needs per-key confidence history
  while (results.length > 200) results.shift();
  store(language.id, results);
}
