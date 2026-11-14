/**
 * The word relay engine (phase 83): two players alternate words on ONE
 * shared list — side 0 takes the even indexes, side 1 the odd ones. The
 * global word index is the sum of both sides' cursors: the turn owner is
 * whoever's side the next global index belongs to. Pure: the remote
 * cursor arrives from the wire and is injected, never simulated.
 *
 * A word is accepted only when it is EXACTLY the side's next word —
 * mistyped words are rejected (no partial credit; the co-op clock keeps
 * running, mistakes cost time naturally).
 */

export type RelaySide = 0 | 1;

export type RelayState = {
  /** the words this side has correctly typed */
  myIndex: number;
  /** the words the partner has correctly typed (from the wire) */
  theirIndex: number;
  /** the global word index the next typed word belongs to */
  globalIndex: number;
  /** whose turn it is right now */
  turn: RelaySide;
  /** this side has typed all of its words */
  myDone: boolean;
  /** the whole list is covered */
  allDone: boolean;
};

export type RelayEngine = {
  side(): RelaySide;
  words(): string[];
  /** the exact match against THIS side's next word; false = rejected or
   * not my turn or already done */
  feedWord(word: string): boolean;
  /** the partner's cursor arrives from the wire */
  setTheirIndex(index: number): void;
  state(): RelayState;
};

export function createRelayEngine(
  words: string[],
  side: RelaySide,
): RelayEngine {
  const myWords = words.filter((_, index) => index % 2 === side);
  let myIndex = 0;
  let theirIndex = 0;

  const state = (): RelayState => {
    const globalIndex = myIndex + theirIndex;
    const turn: RelaySide = (globalIndex % 2 === 0 ? 0 : 1) as RelaySide;
    const myDone = myIndex >= myWords.length;
    const allDone = globalIndex >= words.length;
    return { myIndex, theirIndex, globalIndex, turn, myDone, allDone };
  };

  return {
    side: () => side,
    words: () => [...words],
    feedWord(word: string): boolean {
      const snap = state();
      if (snap.turn !== side || snap.myDone) return false;
      const expected = myWords[myIndex] as string;
      if (word.trim() !== expected) return false;
      myIndex += 1;
      return true;
    },
    setTheirIndex(index: number): void {
      //the wire is untrusted: the partner's cursor can never exceed their
      //word count (the odd-index slots) nor rewind
      const theirTotal = words.filter((_, index) => index % 2 !== side).length;
      if (
        Number.isFinite(index) &&
        index >= 0 &&
        index <= theirTotal &&
        index > theirIndex
      ) {
        theirIndex = Math.floor(index);
      }
    },
    state,
  };
}
