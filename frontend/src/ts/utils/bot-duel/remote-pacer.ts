import type { BotPacer } from "./bot-pacer";

/**
 * RemotePacer (online bot-duel, LAN phase 4): the opponent's live progress
 * behind the SAME interface as the offline BotPacer — the duel engine
 * cannot tell them apart. Instead of a nominal wpm it is fed by the
 * relayed `progress` messages: every report anchors (elapsed, chars) and
 * the line extrapolates with the observed speed between reports (capped),
 * so the bar keeps moving while the peer is mid-word.
 *
 * Both clocks are the LOCAL elapsed race time: each side anchors the peer's
 * reports in its own frame, and the frames stay aligned within one RTT —
 * the finish verdict compares the two reported finish times in those
 * aligned frames.
 */

/** extrapolation ceiling — 150 wpm is already beyond every tier */
const MAX_CHARS_PER_MS = 25 / 1000;

export type RemotePacer = BotPacer & {
  /** a relayed progress arrived: the peer completed `wordIndex` words,
   * seen `elapsedMs` into OUR race frame */
  onProgress(wordIndex: number, elapsedMs: number): void;
  /** the peer's race ended: they completed at `finishMs` (their frame) or
   * didn't complete (null — they left or the race ended for them early) */
  onFinished(finishMs: number | null, elapsedMs: number): void;
};

export function createRemotePacer(words: string[]): RemotePacer {
  //cumEnd[i]: the characters needed to have completed word i (the same
  //convention as the offline pacer — one separating space per word)
  const cumEnd: number[] = [];
  let acc = 0;
  for (const word of words) {
    acc += word.length;
    cumEnd.push(acc);
    acc += 1;
  }
  const wordCount = words.length;
  const totalChars = wordCount === 0 ? 0 : (cumEnd[wordCount - 1] ?? 0);

  /** completed words -> characters (their engine counts the space too) */
  const charsOfWords = (completed: number): number => {
    if (completed <= 0) return 0;
    if (completed >= wordCount) return totalChars;
    return Math.min((cumEnd[completed - 1] ?? 0) + 1, totalChars);
  };

  let anchor = { at: 0, chars: 0 };
  let charsPerMs = 0;
  let finishAtMs: number | undefined;

  const progressChars = (elapsedMs: number): number =>
    Math.min(
      totalChars,
      anchor.chars + Math.max(0, elapsedMs - anchor.at) * charsPerMs,
    );

  return {
    totalChars,
    //live getter: the engine reads it on every tick and at the finish —
    //Infinity until the peer's finished message lands
    get finishMs() {
      return finishAtMs ?? Number.POSITIVE_INFINITY;
    },
    onProgress(wordIndex, elapsedMs) {
      const chars = charsOfWords(wordIndex);
      if (elapsedMs > anchor.at) {
        charsPerMs = Math.min(
          MAX_CHARS_PER_MS,
          Math.max(0, (chars - anchor.chars) / (elapsedMs - anchor.at)),
        );
      }
      anchor = { at: elapsedMs, chars };
    },
    onFinished(finishMs, elapsedMs) {
      if (finishMs !== null) finishAtMs = finishMs;
      //pin the line: no more extrapolation past the end of their race
      charsPerMs = 0;
      anchor = {
        at: elapsedMs,
        chars: finishMs === null ? anchor.chars : totalChars,
      };
    },
    progressChars,
    wordIndex: (elapsedMs) => {
      const chars = progressChars(elapsedMs);
      let index = 0;
      //?? Infinity: unreachable past the length guard, satisfies noUncheckedIndexedAccess
      while (index < cumEnd.length && chars >= (cumEnd[index] ?? Infinity)) {
        index++;
      }
      return index;
    },
    finished: (elapsedMs) =>
      finishAtMs !== undefined && elapsedMs >= finishAtMs,
  };
}
