import { describe, expect, it } from "vitest";

import { createCurvePacer } from "../../../src/ts/utils/ghost-gp/curve-pacer";

//burst [60, 120] wpm -> second 0: 5 chars, second 1: 10 chars (cum 15);
//race words 3,2,5 chars -> cumEnd 3, 6, 12 chars (two separating spaces)
const WORDS = ["abc", "de", "fight"];

describe("ghost-gp curve pacer (idea G3 phase 3)", () => {
  it("accumulates the record's per-second wpm", () => {
    const pacer = createCurvePacer({
      perSecondWpm: [60, 120],
      words: WORDS,
    });
    expect(pacer.progressChars(0)).toBe(0);
    expect(pacer.progressChars(500)).toBe(2.5); //half of the first second
    expect(pacer.progressChars(1000)).toBe(5); //second 0 done
    expect(pacer.progressChars(1500)).toBe(10); //half of the second's 10
    expect(pacer.progressChars(2000)).toBe(15); //both seconds done
  });

  it("plateaus at the last second's rate past the data", () => {
    const pacer = createCurvePacer({ perSecondWpm: [60, 120], words: WORDS });
    //past 2000ms the ghost keeps the 120wpm rate: +10 chars per second
    expect(pacer.progressChars(2500)).toBe(20);
    expect(pacer.progressChars(3000)).toBe(25);
  });

  it("crosses word boundaries with the accumulated chars", () => {
    const pacer = createCurvePacer({ perSecondWpm: [60, 120], words: WORDS });
    expect(pacer.wordIndex(599)).toBe(0); //2.995 chars
    expect(pacer.wordIndex(600)).toBe(1); //3 chars: word 0 done
    expect(pacer.wordIndex(1500)).toBe(2); //10 chars: word 1 done
    expect(pacer.wordIndex(2400)).toBe(3); //20 chars: all done
  });

  it("finishes inside the second that crosses the race length", () => {
    const pacer = createCurvePacer({ perSecondWpm: [60, 120], words: WORDS });
    //12 chars needed; 5 land in second 0, 10 land in second 1 -> the 7th
    //char of second 1: 1000 + (7/10)*1000 = 1700ms
    expect(pacer.finishMs).toBe(1700);
    expect(pacer.finished(1699)).toBe(false);
    expect(pacer.finished(1700)).toBe(true);
  });

  it("a short burst finishes on its plateau", () => {
    //a single 60wpm second = 5 chars; the race needs 12 -> the remaining 7
    //chars are typed at the plateau rate (1 char per 200ms) -> 1000 + 1400
    const pacer = createCurvePacer({ perSecondWpm: [60], words: WORDS });
    expect(pacer.finishMs).toBe(2400);
    expect(pacer.finished(2399)).toBe(false);
    expect(pacer.finished(2400)).toBe(true);
  });

  it("a zero-tail curve that never reaches the race never finishes", () => {
    const pacer = createCurvePacer({ perSecondWpm: [0], words: WORDS });
    expect(pacer.finishMs).toBe(Infinity);
    expect(pacer.finished(999999)).toBe(false);
  });

  it("filters non-positive burst entries", () => {
    const pacer = createCurvePacer({
      perSecondWpm: [0, 60, -5, 120],
      words: WORDS,
    });
    //only 60 and 120 survive: the same accumulation as the first test
    expect(pacer.progressChars(1000)).toBe(5);
    expect(pacer.progressChars(2000)).toBe(15);
  });
});
