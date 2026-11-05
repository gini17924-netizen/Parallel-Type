import { Config } from "../config/store";
import { getLanguage } from "./json-data";
import { showNoticeNotification } from "../states/notifications";

/**
 * Speech wrapper (idea #12) — one module serving BOTH the tts_seen funbox
 * and the drill speak toggle. Deliberately independent from test/tts.ts
 * (upstream stays byte-identical for the original tts funbox).
 *
 * Fixes the upstream gap it would otherwise inherit:
 * - language resolved PER SPEAK (the upstream singleton memoizes the voice
 *   language against an exact "tts" array match -> a renamed clone would go
 *   stale after a mid-session language switch)
 * - a missing installed voice is detected at speak time (getVoices is
 *   async/possibly-empty; the modern "natural" voices never appear in it)
 *   and degrades ONCE per language with a notice, never throwing
 * - the utterance reference is held module-level (the known Chromium GC bug
 *   garbage-collects an unreferenced utterance mid-speech)
 */

let utterance: SpeechSynthesisUtterance | undefined;
let voiceMissingNotified = "";

function hasVoiceFor(bcp47: string): boolean {
  //prefix matching both ways: "fa" <-> "fa-IR"
  return window.speechSynthesis
    .getVoices()
    .some(
      (voice) =>
        voice.lang.toLowerCase().startsWith(bcp47.toLowerCase()) ||
        bcp47.toLowerCase().startsWith(voice.lang.toLowerCase()),
    );
}

function notifyVoiceMissingOnce(bcp47: string): void {
  if (voiceMissingNotified === bcp47) return;
  voiceMissingNotified = bcp47;
  showNoticeNotification(
    `no installed speech voice for "${bcp47}" — add the language's voice (Windows Settings > Time & Language > Speech); continuing silently`,
  );
}

/** speaks one word; false (with no throw) when speech is unavailable or no
 * matching voice is installed */
export async function speakWord(text: string): Promise<boolean> {
  if (typeof window.speechSynthesis === "undefined") return false;
  if (text === "") return false;
  const bcp47 = (await getLanguage(Config.language)).bcp47 ?? "en-US";
  if (!hasVoiceFor(bcp47)) {
    notifyVoiceMissingOnce(bcp47);
    return false;
  }
  window.speechSynthesis.cancel();
  utterance ??= new SpeechSynthesisUtterance();
  utterance.lang = bcp47;
  utterance.text = text;
  window.speechSynthesis.speak(utterance);
  return true;
}

/** test hook: drops the utterance reference and the per-language notice
 * memory (repo _-prefixed convention) */
export function _resetTtsSpeechForTests(): void {
  utterance = undefined;
  voiceMissingNotified = "";
}
