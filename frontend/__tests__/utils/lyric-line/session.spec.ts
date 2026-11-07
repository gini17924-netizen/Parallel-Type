import { describe, expect, it } from "vitest";

import { parseLrc } from "../../../src/ts/utils/lyric-line/lrc";
import {
  createLyricSession,
  type LyricSession,
} from "../../../src/ts/utils/lyric-line/session";

const TIMED = parseLrc(
  "[00:10.00]first line\n[00:20.00]second line\n\n[00:30.00]third",
);
const PLAIN = parseLrc("alpha line\nbeta line");

/** types the active line's text character by character */
function typeLine(session: LyricSession): void {
  const text = session.state().lines[session.state().activeIndex]?.text ?? "";
  for (const ch of text) session.feedKey(ch);
}

/** advances the audio clock in 1s steps — never tripping the seek guard */
function playTo(session: LyricSession, sec: number): void {
  let t = session.state().currentSec;
  while (t < sec) {
    t = Math.min(sec, t + 1);
    session.tick(t);
  }
}

describe("lyric-line session (idea G20 phase 1)", () => {
  it("the timed mode activates lines as their cues arrive", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 5.0); //before the first cue — nothing active yet
    expect(session.state().activeIndex).toBe(0);
    expect(session.state().lines[0]?.state).toBe("pending");
    playTo(session, 10.2); //line 0's cue (10s) passed
    let state = session.state();
    expect(state.lines[0]?.state).toBe("active");
    //finish line 0, then the song reaches line 1's cue
    for (const ch of "first line") session.feedKey(ch);
    playTo(session, 21.5);
    state = session.state();
    expect(state.lines[0]?.state).toBe("done");
    expect(state.lines[1]?.state).toBe("active");
  });

  it("a line stuck past the next cue stays active until finished", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 10.2); //line 0 active
    playTo(session, 25.0); //the song ran on — the stuck line keeps its turn
    const state = session.state();
    expect(state.activeIndex).toBe(0);
    expect(state.lines[0]?.state).toBe("active");
  });

  it("typing the active line finishes it with accuracy", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 10.2);
    const word = "first line";
    for (const ch of word) session.feedKey(ch);
    const state = session.state();
    expect(state.lines[0]?.state).toBe("done");
    expect(state.lines[0]?.acc).toBe(100);
  });

  it("a wrong key resets the partial without penalties (doc §۰.۴)", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 10.2);
    session.feedKey("f");
    session.feedKey("x");
    const state = session.state();
    expect(state.typed).toBe(0);
    expect(state.lines[0]?.state).toBe("active"); //no auto-finish
  });

  it("the sync score measures the finish against the next cue", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 10.5); //the finish will land at 10.5s
    for (const ch of "first line") session.feedKey(ch);
    //the next cue is 20s → lateness −9500 → sync 0
    const state = session.state();
    expect(state.lines[0]?.latenessMs).toBe(-9500);
    expect(state.lines[0]?.syncScore).toBe(0);
  });

  it("finishing exactly on cue scores the full 1000", () => {
    //a 2-line LRC: the last line's cue is its own start → lateness 0
    const two = parseLrc("[00:05.00]line a\n[00:09.00]line b");
    const session = createLyricSession(two);
    playTo(session, 5.0); //line a activates
    playTo(session, 9.0); //the song reaches the next cue before the finish
    for (const ch of "line a") session.feedKey(ch);
    const state = session.state();
    expect(state.lines[0]?.latenessMs).toBe(0);
    expect(state.lines[0]?.syncScore).toBe(1000);
  });

  it("Enter skips an instrumental (or any) line with no score", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 30.2); //line 2's cue passed; line 2 is active
    const active = session.state().activeIndex;
    session.skipLine();
    const state = session.state();
    expect(state.lines[active]?.state).toBe("skipped");
    expect(state.lines[active]?.syncScore).toBeUndefined();
  });

  it("the plain mode advances manually with accuracy only", () => {
    const session = createLyricSession(PLAIN);
    expect(session.state().isTimed).toBe(false);
    typeLine(session);
    let state = session.state();
    expect(state.lines[0]?.state).toBe("done");
    expect(state.lines[0]?.latenessMs).toBeUndefined();
    expect(state.lines[0]?.syncScore).toBeUndefined();
    typeLine(session);
    state = session.state();
    expect(state.phase).toBe("done"); //the last line completed
    expect(state.summary?.syncScore).toBeUndefined();
    expect(state.summary?.typedLines).toBe(2);
  });

  it("a mid-run seek voids the session without a summary", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 10.2); //normal playback
    session.tick(45.0); //the user sought (a >1.5s jump)
    const state = session.state();
    expect(state.phase).toBe("voided");
    expect(state.summary).toBeUndefined();
  });

  it("finish() summarizes the session", () => {
    const session = createLyricSession(TIMED);
    playTo(session, 10.2);
    for (const ch of "first line") session.feedKey(ch);
    const state = session.finish();
    expect(state.phase).toBe("done");
    expect(state.summary?.typedLines).toBe(1);
    expect(state.summary?.skippedLines).toBeGreaterThan(0);
  });
});
