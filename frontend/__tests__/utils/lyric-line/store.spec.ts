import { beforeEach, describe, expect, it } from "vitest";

import {
  LYRIC_SESSIONS_KEY,
  _resetLyricSessionsForTests,
  getLyricSessions,
  recordLyricSession,
  sanitizeImportedLyricSessions,
} from "../../../src/ts/utils/lyric-line/store";

describe("lyric-line store (idea G20 phase 1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    _resetLyricSessionsForTests();
  });

  it("records a session (metadata only — never the media)", () => {
    recordLyricSession({
      songName: "آهنگ تست.mp3",
      lines: 24,
      acc: 97.5,
      syncScore: 880,
    });
    const sessions = getLyricSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.songName).toBe("آهنگ تست.mp3");
    expect(sessions[0]?.syncScore).toBe(880);
  });

  it("a session without LRC omits the sync score", () => {
    recordLyricSession({
      songName: "plain.txt",
      lines: 12,
      acc: 90,
      syncScore: undefined,
    });
    expect(getLyricSessions()[0]?.syncScore).toBeUndefined();
  });

  it("caps the sessions at the newest 10", () => {
    for (let i = 0; i < 12; i++) {
      recordLyricSession({
        songName: `song ${i}`,
        lines: i,
        acc: 50 + i,
        syncScore: undefined,
      });
    }
    const sessions = getLyricSessions();
    expect(sessions).toHaveLength(10);
    expect(sessions[0]?.songName).toBe("song 11");
  });

  it("the reset hook clears storage and cache", () => {
    recordLyricSession({
      songName: "x",
      lines: 1,
      acc: 80,
      syncScore: undefined,
    });
    _resetLyricSessionsForTests();
    expect(window.localStorage.getItem(LYRIC_SESSIONS_KEY)).toBeNull();
    expect(getLyricSessions()).toHaveLength(0);
  });

  it("sanitize drops garbage rows and truncates names (audit L4)", () => {
    const sanitized = sanitizeImportedLyricSessions({
      sessions: [
        { at: 10, songName: "good song", lines: 20, acc: 95, syncScore: 900 },
        { junk: true },
      ],
    });
    expect(sanitized.sessions).toHaveLength(1);
    expect(sanitized.sessions[0]?.songName).toBe("good song");
    expect(sanitizeImportedLyricSessions(null).sessions).toHaveLength(0);
  });
});
