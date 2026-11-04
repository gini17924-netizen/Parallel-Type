import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as WordsGeneratorModule from "../../src/ts/test/words-generator";
import { CustomPunctuationSchema } from "@monkeytype/schemas/configs";
import type { Mode } from "@monkeytype/schemas/shared";
import type { SnapshotResult } from "../../src/ts/constants/default-snapshot";

/**
 * Punctuation generation tests (idea #4). Math.random is pinned in
 * words-generator (`const random = Math.random` at module load), so stubbing
 * Math.random BEFORE importing the module drives every branch
 * deterministically.
 */
describe("punctuateWord (custom punctuation, idea #4)", () => {
  let WordsGenerator: typeof WordsGeneratorModule;
  let setConfig: typeof import("../../src/ts/config/setters").setConfig;

  /** stub Math.random to replay the given sequence */
  function stubRandom(...values: number[]): void {
    let index = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      const value = values[index % values.length] as number;
      index++;
      return value;
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    const setters = await import("../../src/ts/config/setters");
    setConfig = setters.setConfig;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadWithRandom(...values: number[]): Promise<void> {
    stubRandom(...values);
    WordsGenerator = await import("../../src/ts/test/words-generator");
  }

  it("default style: persian sentence end uses the built-in period", async () => {
    await loadWithRandom(0.05, 0.5);
    setConfig("language", "persian");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت.");
  });

  it("default style: persian question mark branch", async () => {
    await loadWithRandom(0.05, 0.85);
    setConfig("language", "persian");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت؟");
  });

  it("default style: persian exclamation branch", async () => {
    await loadWithRandom(0.05, 0.95);
    setConfig("language", "persian");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت!");
  });

  it("capitalizes after a persian question mark (shouldCapitalize)", async () => {
    await loadWithRandom(0.5);
    setConfig("language", "persian");
    //branch 1: lastChar "؟" matches /[?!.؟]/ → capitalize fires, branch 2 skipped
    const word = await WordsGenerator.punctuateWord("سلام؟", "دلم", 3, 10);
    expect(word).toBe("دلم");
  });

  it("custom style «،؟» uses only set characters (branch 2)", async () => {
    await loadWithRandom(0.05, 0.9); //0.9*3 → index 2 → "؟"
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "«،؟»");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت؟");
  });

  it("custom style: the comma branch picks from the set", async () => {
    //0.5 skips branch 2, 0.1 skips quotes/brackets/colon/dash/semicolon and
    //hits the comma branch (< 0.2), 0.4 then picks index 0 from the set
    await loadWithRandom(0.5, 0.1, 0.4);
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "،؟");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت،");
  });

  it("custom style: paired « » wrap like the quote branch", async () => {
    await loadWithRandom(0.005);
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "«،»");
    //the quote branch is only reachable at index === maxindex - 2 (the 10%
    //sentence-end branch eats every other slot in the else-if chain)
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 8, 10);
    expect(word).toBe("«نرفت»");
  });

  it("custom style: ZWNJ stays inside the word and never as a suffix", async () => {
    await loadWithRandom(0.05, 0.9, 0.3); //branch 2 picks "؟", then ZWNJ position
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "،؟");
    setConfig("customPunctuationZwnj", true);
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toContain("\u200C");
    expect(word.startsWith("\u200C")).toBe(false);
    expect(word.endsWith("\u200C")).toBe(false);
    expect(word.replace(/\u200C/g, "").length).toBe("نرفت".length + 1); //+ the ؟
  });

  it("custom style: ZWNJ inside the set is never used as a suffix", async () => {
    await loadWithRandom(0.05, 0.5); //comma branch picks "،" (ZWNJ filtered out)
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "\u200C،");
    setConfig("customPunctuationZwnj", false);
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت،");
    expect(word.includes("\u200C")).toBe(false);
  });

  it("custom style with an empty set falls back to the built-in table", async () => {
    await loadWithRandom(0.05, 0.5);
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 5, 10);
    expect(word).toBe("نرفت."); //built-in period
  });

  it("guaranteed ender at the last index picks from the custom set", async () => {
    await loadWithRandom(0.99, 0.1); //index === maxindex-1 forces branch 2
    setConfig("language", "persian");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "«،؟»");
    const word = await WordsGenerator.punctuateWord("گفت", "نرفت", 8, 10);
    expect(word.endsWith("،") || word.endsWith("؟") || word.endsWith("«")).toBe(
      true,
    );
  });

  it("code branches are untouched by the custom set", async () => {
    //call 1 (0.0115) skips branch 2 via index === maxindex - 2; calls 2-3
    //skip quote (< 0.01) and single-quote (< 0.011); call 4 hits the bracket
    //branch (< 0.012, before colon < 0.013); call 5 picks "()" in the code path
    await loadWithRandom(0.0115, 0.5, 0.5, 0.0115);
    setConfig("language", "code_javascript");
    setConfig("punctuationStyle", "custom");
    setConfig("customPunctuation", "،؟");
    const word = await WordsGenerator.punctuateWord(undefined, "foo", 8, 10);
    expect(word).toBe("(foo)");
  });

  it("migrateConfig applies the new defaults to old configs", async () => {
    const { migrateConfig } = await import("../../src/ts/config/utils");
    const oldConfig = { punctuation: true, numbers: false, mode: "time" };
    const migrated = migrateConfig(oldConfig);
    expect(migrated.punctuationStyle).toBe("default");
    expect(migrated.customPunctuation).toBe("");
    expect(migrated.customPunctuationZwnj).toBe(false);
    expect(migrated.punctuation).toBe(true); //existing values kept
  });

  it("CustomPunctuationSchema caps the set at 32 characters", () => {
    expect(CustomPunctuationSchema.safeParse("،".repeat(32)).success).toBe(
      true,
    );
    expect(CustomPunctuationSchema.safeParse("،".repeat(33)).success).toBe(
      false,
    );
  });
});

describe("PB identity with customPunctuation (idea #4)", () => {
  let DB: typeof import("../../src/ts/db");
  let setConfig: typeof import("../../src/ts/config/setters").setConfig;

  beforeEach(async () => {
    window.localStorage.clear();
    vi.resetModules();
    const setters = await import("../../src/ts/config/setters");
    setConfig = setters.setConfig;
    DB = await import("../../src/ts/db");
  });

  function makePbResult(id: string, wpm: number): SnapshotResult<Mode> {
    return {
      _id: id,
      wpm,
      rawWpm: wpm + 10,
      acc: 100,
      consistency: 80,
      mode: "time",
      mode2: "30",
      timestamp: Date.now(),
      restartCount: 0,
      incompleteTestSeconds: 0,
      afkDuration: 0,
      testDuration: 30,
      punctuation: false,
      numbers: false,
      difficulty: "normal",
      language: "english",
      lazyMode: false,
      funbox: [],
      charStats: [100, 0, 0, 0],
      isPb: true,
    } as unknown as SnapshotResult<Mode>;
  }

  it("separates PBs typed with different custom punctuation sets", () => {
    //bootstrap a local snapshot with a PB typed under set "A" via the real
    //save path (saveLocalPB is private; saveLocalResult is its entry point)
    setConfig("customPunctuation", "A");
    DB.initLocalSnapshot();
    DB.saveLocalResult({
      result: makePbResult("pbA", 120),
      isPb: true,
    });
    const pbA = DB.getLocalPB(
      "time",
      "30",
      false,
      false,
      "english",
      "normal",
      false,
      [],
    );
    expect(pbA?.wpm).toBe(120);
    expect(pbA?.customPunctuation).toBe("A");

    //switching the set: the "A" PB must NOT match the "B" bucket
    setConfig("customPunctuation", "B");
    expect(
      DB.getLocalPB("time", "30", false, false, "english", "normal", false, []),
    ).toBeUndefined();

    //a "B" set result saves into its own bucket entry
    DB.saveLocalResult({
      result: makePbResult("pbB", 100),
      isPb: true,
    });
    const pbB = DB.getLocalPB(
      "time",
      "30",
      false,
      false,
      "english",
      "normal",
      false,
      [],
    );
    expect(pbB?.wpm).toBe(100);
    expect(pbB?.customPunctuation).toBe("B");

    //old PBs without the field only match the empty set
    setConfig("customPunctuation", "");
    expect(
      DB.getLocalPB("time", "30", false, false, "english", "normal", false, []),
    ).toBeUndefined(); //the A/B entries don't match the empty set
    setConfig("punctuation", true); //punctuation mismatch on purpose
    setConfig("customPunctuation", "A");
    expect(
      DB.getLocalPB("time", "30", true, false, "english", "normal", false, []),
    ).toBeUndefined(); //punctuation mismatch (true vs false)
  });
});
