import { beforeEach, describe, expect, it } from "vitest";

import {
  dictationSpellingAccuracy,
  getDictationState,
  recordDictationSession,
} from "../../src/ts/utils/dictation-stats";

function session(overrides: {
  spellingAccuracy?: number;
  language?: string;
  timestamp?: number;
}): Parameters<typeof recordDictationSession>[0] {
  return {
    timestamp: overrides.timestamp ?? 1700000000000,
    language: overrides.language ?? "persian",
    mode: "words",
    spellingAccuracy: overrides.spellingAccuracy ?? 90,
    wpm: 40,
  };
}

describe("phase 68 — the dictation store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty and records sessions", () => {
    expect(dictationSpellingAccuracy()).toBeUndefined();
    recordDictationSession(session({ spellingAccuracy: 92 }));
    recordDictationSession(session({ spellingAccuracy: 80 }));
    const state = getDictationState();
    expect(state.sessions).toHaveLength(2);
    expect(dictationSpellingAccuracy()).toBe(86);
  });

  it("caps the store at the most recent 100 sessions", () => {
    for (let i = 0; i < 110; i++) {
      recordDictationSession(
        session({
          spellingAccuracy: 30 + (i % 60),
          timestamp: 1700000000000 + i,
        }),
      );
    }
    const state = getDictationState();
    expect(state.sessions).toHaveLength(100);
    //the oldest (first ten) were dropped: the first kept row is #10
    expect(state.sessions[0]?.spellingAccuracy).toBe(30 + (10 % 60));
  });

  it("one corrupt row does not throw away the whole history", () => {
    recordDictationSession(session({ spellingAccuracy: 88 }));
    const raw = window.localStorage.getItem("mtDesktopDictation") as string;
    const parsed = JSON.parse(raw) as { sessions: unknown[] };
    parsed.sessions.push({ timestamp: "garbage" });
    window.localStorage.setItem("mtDesktopDictation", JSON.stringify(parsed));
    const state = getDictationState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.spellingAccuracy).toBe(88);
  });

  it("corrupt storage loads as empty", () => {
    window.localStorage.setItem("mtDesktopDictation", "{broken");
    expect(getDictationState().sessions).toEqual([]);
    expect(dictationSpellingAccuracy()).toBeUndefined();
  });
});
