import type { BotPacer } from "../bot-duel/bot-pacer";

/**
 * The curve ghost's pacer (idea G3, phase 3): progress accumulates the
 * record's per-second raw wpm (chartData.burst) instead of a constant rate —
 * the ghost accelerates and slows down exactly like the real race it came
 * from. Each second s contributes burst[s] * 5 / 60 characters (the
 * monkeytype chars-per-word convention).
 *
 * After the burst data runs out the ghost plateaus at the last second's
 * rate: a record shorter than the race keeps pacing, just flat. A burst
 * that never reaches the race length at a zero tail rate never finishes
 * (finishMs = Infinity) — the player then simply wins by completing.
 */
export function createCurvePacer(options: {
  perSecondWpm: number[];
  words: string[];
}): BotPacer {
  const perSecondWpm = options.perSecondWpm.filter(
    (wpm) => typeof wpm === "number" && wpm > 0,
  );
  const charsPerSecond = perSecondWpm.map((wpm) => (wpm * 5) / 60);

  //word boundaries over the race words (the same walk as the bot pacer)
  const cumEnd: number[] = [];
  let wordAcc = 0;
  for (const word of options.words) {
    wordAcc += word.length;
    cumEnd.push(wordAcc);
    wordAcc += 1; //the separating space
  }
  const wordCount = options.words.length;
  const totalChars = wordCount === 0 ? 0 : (cumEnd[wordCount - 1] ?? 0);

  //cumChars[s]: the characters accumulated before second s starts
  const cumChars: number[] = [];
  let acc = 0;
  for (const cps of charsPerSecond) {
    cumChars.push(acc);
    acc += cps;
  }
  const totalBurstChars = acc;
  const lastRate = charsPerSecond[charsPerSecond.length - 1] ?? 0;

  const charsAt = (elapsedMs: number): number => {
    if (charsPerSecond.length === 0) return 0;
    const seconds = Math.max(0, elapsedMs) / 1000;
    const full = Math.min(Math.floor(seconds), charsPerSecond.length);
    let chars = 0;
    for (let s = 0; s < full; s++) chars += charsPerSecond[s] ?? 0;
    const fraction = seconds - full;
    if (fraction > 0) {
      //within the data: the current second's share; past it: the plateau
      chars +=
        (full < charsPerSecond.length
          ? (charsPerSecond[full] ?? 0)
          : lastRate) * fraction;
    }
    return chars;
  };

  //the finish: the first second whose cumulative chars reach the race
  //length, interpolated inside that second; past the data the plateau rate
  //applies; a zero-tail curve that never reaches it never finishes
  let finishMs = Infinity;
  for (let s = 0; s < charsPerSecond.length; s++) {
    const cps = charsPerSecond[s] ?? 0;
    const start = cumChars[s] ?? 0;
    const end = start + cps;
    if (end >= totalChars && cps > 0) {
      const needed = totalChars - start;
      finishMs = s * 1000 + (needed / cps) * 1000;
      break;
    }
  }
  if (
    !Number.isFinite(finishMs) &&
    lastRate > 0 &&
    totalChars > totalBurstChars
  ) {
    const needed = totalChars - totalBurstChars;
    finishMs = charsPerSecond.length * 1000 + (needed / lastRate) * 1000;
  }

  return {
    totalChars,
    finishMs,
    progressChars: charsAt,
    wordIndex: (elapsedMs) => {
      const chars = charsAt(elapsedMs);
      let index = 0;
      //?? Infinity: unreachable past the length guard
      while (index < cumEnd.length && chars >= (cumEnd[index] ?? Infinity)) {
        index++;
      }
      return index;
    },
    finished: (elapsedMs) => charsAt(elapsedMs) >= totalChars,
  };
}
