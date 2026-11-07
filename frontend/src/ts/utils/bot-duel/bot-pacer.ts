/**
 * Bot Duel pacer (idea G2): the bot's constant-rate progress over a fixed
 * word sequence — the same math as the pace caret (characters = wpm * 5,
 * cps = characters / 60), anchored to a race start. Pure and testable:
 * every query takes the elapsed running milliseconds.
 *
 * Word boundaries count one separating space per word (the bot "types" the
 * space too, like the player's implicit space on a completed word), so both
 * sides progress along the same character line.
 */

export type BotPacer = {
  /** characters typed after elapsedMs (including separating spaces) */
  progressChars(elapsedMs: number): number;
  /** how many words are complete at elapsedMs (0-based; N when finished) */
  wordIndex(elapsedMs: number): number;
  /** whether the last character of the last word is typed by elapsedMs */
  finished(elapsedMs: number): boolean;
  /** the elapsedMs at which the bot crosses the finish line */
  finishMs: number;
  /** all characters of the sequence including the separating spaces */
  totalChars: number;
};

export function createBotPacer(options: {
  wpm: number;
  words: string[];
}): BotPacer {
  if (options.wpm <= 0) throw new Error("bot wpm must be positive");
  const charsPerMs = (options.wpm * 5) / 60000;

  //cumEnd[i]: the characters needed to have completed word i
  const cumEnd: number[] = [];
  let acc = 0;
  for (const word of options.words) {
    acc += word.length;
    cumEnd.push(acc);
    acc += 1; //the separating space
  }
  const wordCount = options.words.length;
  const totalChars = wordCount === 0 ? 0 : (cumEnd[wordCount - 1] ?? 0);

  return {
    totalChars,
    finishMs: totalChars / charsPerMs,
    progressChars: (elapsedMs) => elapsedMs * charsPerMs,
    wordIndex: (elapsedMs) => {
      const chars = elapsedMs * charsPerMs;
      let index = 0;
      //?? Infinity: unreachable past the length guard, satisfies noUncheckedIndexedAccess
      while (index < cumEnd.length && chars >= (cumEnd[index] ?? Infinity)) {
        index++;
      }
      return index;
    },
    finished: (elapsedMs) => elapsedMs * charsPerMs >= totalChars,
  };
}
