import { z } from "zod";
import { createEffect, createRoot, on } from "solid-js";

import { isFunboxActiveWithProperty } from "../test/funbox/list";
import { getActiveWordIndex, isTestActive } from "../states/test";
import * as TestWords from "../test/test-words";
import { LocalStorageWithSchema } from "./local-storage-with-schema";
import { speakWord } from "./tts-speech";

/**
 * Drill speak toggle (idea #12): when enabled, every word that becomes
 * active during a test is spoken through tts-speech.
 *
 * Wiring:
 * - mid-test words: an effect on the active word index (same observable the
 *   engine's word navigation mutates)
 * - the first word: covered by the fork line in test-logic init
 *   (speakCurrentWord) which runs AFTER the words are set - the effect with
 *   { defer: true } cannot see a reset-to-0 that was already 0
 * - anti double-speak: when a speaks-funbox (tts/tts_seen) is active, this
 *   module stays silent - the funbox's own toggleScript handles speaking
 */

const drillSpeech = new LocalStorageWithSchema({
  key: "mtDesktopDrillSpeech",
  schema: z.boolean(),
  fallback: false,
});

export function isDrillSpeechEnabled(): boolean {
  return drillSpeech.get();
}

export function setDrillSpeechEnabled(value: boolean): void {
  drillSpeech.set(value);
}

function speaksFunboxActive(): boolean {
  return isFunboxActiveWithProperty("speaks");
}

/** pure gate for one speak attempt (unit-testable) */
export function shouldSpeakActiveWord(input: {
  enabled: boolean;
  testActive: boolean;
  speaksFunboxActive: boolean;
}): boolean {
  return input.enabled && input.testActive && !input.speaksFunboxActive;
}

/** speaks the current word when the drill toggle demands it (called from
 * test-logic init - the words are already set at that point) */
export function speakCurrentWordIfEnabled(): void {
  if (!isDrillSpeechEnabled()) return;
  if (speaksFunboxActive()) return; //the funbox already speaks
  const word = TestWords.words.getCurrent()?.text;
  if (word !== undefined && word !== "") void speakWord(word);
}

/** installs the global reactive wiring (once, at boot) */
export function installDrillSpeech(): void {
  createRoot(() => {
    createEffect(
      on(
        getActiveWordIndex,
        () => {
          if (
            !shouldSpeakActiveWord({
              enabled: isDrillSpeechEnabled(),
              testActive: isTestActive(),
              speaksFunboxActive: speaksFunboxActive(),
            })
          ) {
            return;
          }
          const word = TestWords.words.getCurrent()?.text;
          if (word !== undefined && word !== "") void speakWord(word);
        },
        { defer: true },
      ),
    );
  });
}
