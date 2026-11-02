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
import { makeStats, TextInput } from "@keybr/textinput";
import { MutableKeyStatsMap, Result } from "@keybr/result";

// Persian: the vendored engine, end to end — the fidelity proof of the port.
// The compiled phonetic model is read straight from the vendored asset.

const faModelData = fs.readFileSync(
  [0, 1]
    .map((i) =>
      path.resolve(
        process.cwd(),
        "../".repeat(i),
        "src/keybr/@keybr/phonetic-model/assets/model-fa.data",
      ),
    )
    .find((p) => fs.existsSync(p))!,
);

function faKeyboard() {
  return loadKeyboard(
    new KeyboardOptions(
      Language.FA,
      Layout.FA_IR,
      Geometry.ANSI_101,
      ZoneMod.STANDARD,
    ),
  );
}

function typeFragmentPerfectly(textInput: TextInput): void {
  const text = textInput.text;
  let timeStamp = 1000;
  for (const ch of text) {
    timeStamp += 90; //~660 cpm: well above the default target speed
    const feedback = textInput.onInput({
      timeStamp,
      inputType: "appendChar",
      codePoint: ch.codePointAt(0)!,
      timeToType: 80,
    });
    expect(feedback).toBeDefined();
  }
  expect(textInput.completed).toBe(true);
}

describe("keybr engine (vendored, Persian)", () => {
  it("generates Persian fragments within the included alphabet", async () => {
    const settings = new Settings();
    const keyboard = faKeyboard();
    const model = censor(
      makePhoneticModel(Language.FA, new Uint8Array(faModelData)),
    );
    const wordList = await loadWordList(Language.FA);
    const lesson = new GuidedLesson(settings, keyboard, model, wordList);

    const keyStatsMap = new MutableKeyStatsMap(lesson.letters);
    const lessonKeys = lesson.update(keyStatsMap);
    const fragment = lesson.generate(lessonKeys, Lesson.rng);
    const text = fragment.toString();

    expect(text.length).toBeGreaterThan(10);
    //every letter of the fragment belongs to the included keys
    const included = new Set(
      [...lessonKeys]
        .filter((k) => k.isIncluded)
        .map((k) => k.letter.codePoint),
    );
    for (const ch of text) {
      if (ch === " ") continue;
      expect(included.has(ch.codePointAt(0)!)).toBe(true);
    }
  });

  it("progresses: perfect lessons unlock more letters", async () => {
    const settings = new Settings();
    const keyboard = faKeyboard();
    const model = censor(
      makePhoneticModel(Language.FA, new Uint8Array(faModelData)),
    );
    const wordList = await loadWordList(Language.FA);
    const lesson = new GuidedLesson(settings, keyboard, model, wordList);

    const keyStatsMap = new MutableKeyStatsMap(lesson.letters);
    const includedCount = (): number =>
      [...lesson.update(keyStatsMap)].filter((k) => k.isIncluded).length;

    const initial = includedCount();
    expect(initial).toBeGreaterThanOrEqual(6); //minimal alphabet

    //perfect drills at high speed: confidence reaches 1, keys include
    for (
      let round = 0;
      round < 60 &&
      includedCount() < Math.min(initial + 3, lesson.letters.length);
      round++
    ) {
      const lessonKeys = lesson.update(keyStatsMap);
      const fragment = lesson.generate(lessonKeys, Lesson.rng);
      const textInput = new TextInput(fragment, {
        stopOnError: false,
        forgiveErrors: false,
        spaceSkipsWords: false,
      });
      typeFragmentPerfectly(textInput);
      keyStatsMap.append(
        Result.fromStats(
          Layout.FA_IR,
          0,
          Date.now(),
          makeStats(textInput.steps),
        ),
      );
    }

    const final = includedCount();
    expect(final).toBeGreaterThan(initial);
  });

  it("builds valid results from typed input", async () => {
    const settings = new Settings();
    const keyboard = faKeyboard();
    const model = censor(
      makePhoneticModel(Language.FA, new Uint8Array(faModelData)),
    );
    const wordList = await loadWordList(Language.FA);
    const lesson = new GuidedLesson(settings, keyboard, model, wordList);
    const keyStatsMap = new MutableKeyStatsMap(lesson.letters);
    const lessonKeys = lesson.update(keyStatsMap);
    const fragment = lesson.generate(lessonKeys, Lesson.rng);

    const textInput = new TextInput(fragment, {
      stopOnError: false,
      forgiveErrors: false,
      spaceSkipsWords: false,
    });
    typeFragmentPerfectly(textInput);

    const result = Result.fromStats(
      Layout.FA_IR,
      0,
      Date.now(),
      makeStats(textInput.steps),
    );
    expect(result.length).toBe(fragment.toString().length);
    expect(result.accuracy).toBe(1);
    expect(result.validate()).toBe(true);
  });
});
