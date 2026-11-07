import type { LrcLine, ParsedLrc } from "./lrc";

/**
 * Lyric Line session (idea G20, phase 1): the karaoke typing state over
 * one song. The AUDIO CLOCK comes in per tick
 * (`tick(audio.currentTime)` — the doc §۲ rule). The active line is the
 * last line whose LRC time has passed (timed mode) or the manual cursor
 * (plain mode, doc §۰.۶). Completing a line scores its keystroke
 * accuracy; with LRC the SYNC score per line is
 * `max(0, 1000 − |lateness| ÷ 2)` where lateness measures the finish
 * against the NEXT line's start (finish exactly on cue = 1000; the
 * doc's «فاصله اتمام خط از زمان LRC» read against the cue). Instrumental
 * gaps skip with Enter. A seek mid-run voids the session without a
 * summary (doc §۵ — anti-karaoke-cheat). PURE.
 */

export type LyricLineState = "pending" | "active" | "done" | "skipped";

export type LyricLineResult = {
  text: string;
  tMs: number | null;
  state: LyricLineState;
  acc: number;
  latenessMs: number | undefined;
  syncScore: number | undefined;
};

export type LyricSummary = {
  lines: number;
  typedLines: number;
  skippedLines: number;
  acc: number;
  avgLatenessMs: number | undefined;
  syncScore: number | undefined;
};

export type LyricPhase = "playing" | "voided" | "done";

export type LyricSessionState = {
  phase: LyricPhase;
  isTimed: boolean;
  lines: LyricLineResult[];
  activeIndex: number;
  /** the active line's typed prefix length */
  typed: number;
  /** seconds of the song so far (mirrors the last tick) */
  currentSec: number;
  summary: LyricSummary | undefined;
};

export type LyricSession = {
  state(): LyricSessionState;
  /** the audio-clock step; also detects the mid-run seek (doc §۵) */
  tick(currentTimeSec: number): LyricSessionState;
  /** one bare character against the active line */
  feedKey(ch: string): LyricSessionState;
  /** Enter: skip the active line (instrumentals — no score) */
  skipLine(): LyricSessionState;
  /** the page's audio-ended signal → the summary */
  finish(): LyricSessionState;
};

const SEEK_JUMP_SEC = 1.5;

export function createLyricSession(parsed: ParsedLrc): LyricSession {
  const lines: LyricLineResult[] = parsed.lines.map((line: LrcLine) => ({
    text: line.text,
    tMs: line.tMs,
    state: "pending" as LyricLineState,
    acc: 100,
    latenessMs: undefined,
    syncScore: undefined,
  }));
  let phase: LyricPhase = "playing";
  let activeIndex = 0;
  let typed = 0;
  let correctChars = 0;
  let wrongChars = 0;
  let currentSec = 0;
  let lastSec: number | undefined;

  function isTimed(): boolean {
    return parsed.isTimed;
  }

  /** the timed mode's line the song is on: the last line whose cue has
   * passed; -1 before the very first cue */
  function timeIndex(sec: number): number {
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      const tMs = lines[i]?.tMs;
      if (tMs === null || tMs === undefined) continue;
      if (tMs <= sec * 1000) index = i;
      else break;
    }
    return index;
  }

  /** plain mode only: walk to the next pending line and activate it */
  function advance(): void {
    while (activeIndex < lines.length) {
      const line = lines[activeIndex];
      if (line === undefined) break;
      if (line.state !== "pending") {
        activeIndex += 1;
        continue;
      }
      break;
    }
    if (activeIndex >= lines.length) {
      phase = "done";
      return;
    }
    const line = lines[activeIndex];
    if (line !== undefined) line.state = "active";
    typed = 0;
  }

  /** timed mode: the song clock owns the line activation — never
   * backward, and a stuck active line keeps its turn until finished or
   * skipped (the doc's natural waiting, §۰.۶) */
  function syncToSong(): void {
    const idx = timeIndex(currentSec);
    const current = lines[activeIndex];
    if (current?.state === "active") return; //stuck — the typist's turn
    if (idx < activeIndex) return; //the song is behind the typist — wait
    if (idx === activeIndex) {
      if (current?.state === "pending") {
        current.state = "active"; //the cue arrived
        typed = 0;
      }
      return;
    }
    //the song moved past a finished/skipped line — catch up; anything
    //pending in between was missed
    for (let i = activeIndex; i < idx; i++) {
      const line = lines[i];
      if (line?.state === "pending") {
        line.state = "skipped";
      }
    }
    activeIndex = idx;
    const line = lines[idx];
    if (line !== undefined) line.state = "active";
    typed = 0;
  }

  /** the reference time the line should finish on: the NEXT line's cue
   * (the last line gets its own cue → lateness 0 → sync 1000) */
  function refTms(): number {
    const current = lines[activeIndex];
    if (current === undefined) return currentSec * 1000;
    for (let i = activeIndex + 1; i < lines.length; i++) {
      const tMs = lines[i]?.tMs;
      if (tMs !== null && tMs !== undefined) return tMs;
    }
    const fallbackMs = currentSec * 1000;
    return current.tMs ?? fallbackMs;
  }

  function finishLine(skipped: boolean): void {
    const line = lines[activeIndex];
    if (line === undefined) return;
    const total = correctChars + wrongChars;
    line.acc = total === 0 ? 100 : (correctChars / total) * 100;
    if (isTimed() && !skipped) {
      const finishMs = currentSec * 1000;
      const lateness = finishMs - refTms();
      line.latenessMs = Math.round(lateness);
      line.syncScore = Math.max(0, Math.round(1000 - Math.abs(lateness) / 2));
    }
    line.state = skipped ? "skipped" : "done";
    correctChars = 0;
    wrongChars = 0;
    if (isTimed()) {
      //the next line activates when its cue arrives (doc §۰.۶ — the
      //song clock owns the timing, not the typist)
      activeIndex = Math.min(activeIndex + 1, lines.length - 1);
      const next = lines[activeIndex];
      if (next?.state === "active") next.state = "pending";
      //the last line stays pending until its cue (or finish())
      typed = 0;
    } else {
      advance();
    }
  }

  function summary(): LyricSummary {
    const done = lines.filter(
      (line) => line.state === "done" || line.state === "skipped",
    );
    const latenesses = done
      .map((line) => line.latenessMs)
      .filter((it): it is number => it !== undefined);
    const syncs = done
      .map((line) => line.syncScore)
      .filter((it): it is number => it !== undefined);
    return {
      lines: lines.length,
      typedLines: done.filter((line) => line.state === "done").length,
      skippedLines: done.filter((line) => line.state === "skipped").length,
      acc:
        correctChars + wrongChars === 0
          ? 100
          : (correctChars / (correctChars + wrongChars)) * 100,
      avgLatenessMs:
        latenesses.length === 0
          ? undefined
          : latenesses.reduce((sum, it) => sum + it, 0) / latenesses.length,
      syncScore:
        syncs.length === 0
          ? undefined
          : Math.round(syncs.reduce((sum, it) => sum + it, 0) / syncs.length),
    };
  }

  function snapshot(): LyricSessionState {
    return {
      phase,
      isTimed: isTimed(),
      lines: lines.map((line) => ({ ...line })),
      activeIndex,
      typed,
      currentSec,
      summary: phase === "done" ? summary() : undefined,
    };
  }

  if (!isTimed()) advance();

  return {
    state: () => snapshot(),
    tick(currentTimeSec: number) {
      if (phase !== "playing") return snapshot();
      //the anti-karaoke-cheat: a big audio jump mid-run voids the round
      if (
        lastSec !== undefined &&
        Math.abs(currentTimeSec - lastSec) > SEEK_JUMP_SEC
      ) {
        phase = "voided";
        return snapshot();
      }
      lastSec = currentTimeSec;
      currentSec = currentTimeSec;
      if (isTimed()) syncToSong();
      return snapshot();
    },
    feedKey(ch: string) {
      if (phase !== "playing") return snapshot();
      if (ch.length !== 1) return snapshot();
      const line = lines[activeIndex];
      if (line?.state !== "active") return snapshot();
      const expected = line.text[typed];
      if (expected !== ch) {
        wrongChars += 1;
        typed = 0; //the doc's partial reset (§۰.۴)
        return snapshot();
      }
      correctChars += 1;
      typed += 1;
      if (typed >= line.text.length && line.text.length > 0) {
        finishLine(false);
      }
      return snapshot();
    },
    skipLine() {
      if (phase !== "playing") return snapshot();
      const line = lines[activeIndex];
      if (line?.state !== "active") return snapshot();
      finishLine(true);
      return snapshot();
    },
    finish() {
      if (phase !== "playing") return snapshot();
      //mark any remaining pending lines skipped (the song ended early)
      for (const line of lines) {
        if (line.state === "pending" || line.state === "active") {
          line.state = "skipped";
        }
      }
      phase = "done";
      return snapshot();
    },
  };
}
