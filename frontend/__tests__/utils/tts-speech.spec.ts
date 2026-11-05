import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  speakWord,
  _resetTtsSpeechForTests,
} from "../../src/ts/utils/tts-speech";
import { showNoticeNotification } from "../../src/ts/states/notifications";
import { Config } from "../../src/ts/config/store";

vi.mock("../../src/ts/states/notifications", () => ({
  showNoticeNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showSuccessNotification: vi.fn(),
}));

vi.mock("../../src/ts/utils/json-data", () => ({
  getLanguage: vi.fn(
    async (lang: string) =>
      lang === "persian"
        ? { name: "persian", bcp47: "fa" }
        : { name: "english" }, //no bcp47: upstream english.json has none
  ),
}));

vi.mock("../../src/ts/config/store", () => ({
  Config: { language: "persian" },
}));

type SpeechMock = {
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
};

let speechMock: SpeechMock;

function installSpeech(voices: string[] = ["fa-IR", "en-US"]): void {
  speechMock = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => voices.map((lang) => ({ lang }))),
  };
  vi.stubGlobal("speechSynthesis", speechMock);
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      lang = "";
      text = "";
    },
  );
}

describe("tts-speech wrapper (idea #12)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetTtsSpeechForTests();
    //the config module is mocked once per FILE: reset the language per test
    Config.language = "persian";
  });

  it("speaks with the language's bcp47 and reuses one utterance reference", async () => {
    installSpeech();
    const ok = await speakWord("سلام");
    expect(ok).toBe(true);
    expect(speechMock.cancel).toHaveBeenCalled();
    expect(speechMock.speak).toHaveBeenCalledTimes(1);
    expect(speechMock.speak.mock.calls[0]?.[0].lang).toBe("fa");
    expect(speechMock.speak.mock.calls[0]?.[0].text).toBe("سلام");

    await speakWord("دوم");
    expect(speechMock.speak).toHaveBeenCalledTimes(2);
    //same utterance instance reused (Chromium GC mitigation)
    expect(speechMock.speak.mock.calls[0]?.[0]).toBe(
      speechMock.speak.mock.calls[1]?.[0],
    );
  });

  it("falls back to en-US when the language has no bcp47 (english.json)", async () => {
    installSpeech();
    Config.language = "english";
    const ok = await speakWord("hello");
    expect(ok).toBe(true);
    expect(speechMock.speak.mock.calls[0]?.[0].lang).toBe("en-US");
  });

  it("resolves the language per speak: no stale voice after a switch", async () => {
    installSpeech();
    await speakWord("سلام"); //fa
    Config.language = "english";
    await speakWord("hello"); //now en-US
    expect(speechMock.speak.mock.calls[1]?.[0].lang).toBe("en-US");
  });

  it("returns false without throwing when speechSynthesis is undefined", async () => {
    //no stub at all: window.speechSynthesis stays undefined
    const ok = await speakWord("سلام");
    expect(ok).toBe(false);
  });

  it("notifies ONCE per language and stays silent without a matching voice", async () => {
    installSpeech(["en-US"]); //no fa voice
    expect(await speakWord("سلام")).toBe(false);
    expect(await speakWord("دوم")).toBe(false);
    expect(speechMock.speak).not.toHaveBeenCalled();
    expect(showNoticeNotification).toHaveBeenCalledTimes(1);
    //a DIFFERENT language with no voice notifies again (per-language once)
    Config.language = "english";
    await speakWord("hello"); //en-US voice exists -> speaks
    expect(speechMock.speak).toHaveBeenCalledTimes(1);
  });

  it("treats prefix-matching voices as compatible (fa vs fa-IR both ways)", async () => {
    installSpeech(["fa", "en"]); //voices with the SHORT form
    expect(await speakWord("سلام")).toBe(true);
    Config.language = "english";
    expect(await speakWord("hello")).toBe(true);
  });

  it("never speaks an empty text", async () => {
    installSpeech();
    expect(await speakWord("")).toBe(false);
    expect(speechMock.speak).not.toHaveBeenCalled();
  });
});
