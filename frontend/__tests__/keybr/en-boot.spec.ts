import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  Geometry,
  KeyboardOptions,
  Language,
  Layout,
  loadKeyboard,
  ZoneMod,
} from "@keybr/keyboard";
import { censor, makePhoneticModel } from "@keybr/phonetic-model";
import { loadWordList } from "@keybr/content-words";
import { Settings } from "@keybr/settings";
import { GuidedLesson, Lesson } from "@keybr/lesson";
import { MutableKeyStatsMap } from "@keybr/result";

// English boot — mirrors the FA engine test; catches EN-specific crashes.

const enModelData = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "src/keybr/@keybr/phonetic-model/assets/model-en.data",
  ),
);

describe("EN boot", () => {
  it("boots the guided lesson for English", async () => {
    const keyboard = loadKeyboard(
      new KeyboardOptions(
        Language.EN,
        Layout.EN_US,
        Geometry.ANSI_101,
        ZoneMod.STANDARD,
      ),
    );
    const model = censor(
      makePhoneticModel(Language.EN, new Uint8Array(enModelData)),
    );
    const wordList = await loadWordList(Language.EN);
    const settings = new Settings();
    const lesson = new GuidedLesson(settings, keyboard, model, wordList);
    const keyStatsMap = new MutableKeyStatsMap(lesson.letters);
    const lessonKeys = lesson.update(keyStatsMap);
    const fragment = lesson.generate(lessonKeys, Lesson.rng);
    expect(fragment.toString().length).toBeGreaterThan(10);
  });
});
