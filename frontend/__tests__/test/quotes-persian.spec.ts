import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteData } from "@monkeytype/schemas/quotes";
import type { Mode } from "@monkeytype/schemas/shared";
import type { SnapshotResult } from "../../src/ts/constants/default-snapshot";
import type { LanguageObject } from "@monkeytype/schemas/languages";

const STATIC_DIR = resolve(fileURLToPath(import.meta.url), "../../../static");
function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(STATIC_DIR, rel), "utf-8")) as T;
}

vi.mock("../../src/ts/states/notifications", () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showNoticeNotification: vi.fn(),
}));

//the generator's quote flow goes through the controller; the mock serves
//the REAL collection read straight off the disk, so content changes are
//exercised by the mode tests too
vi.mock("../../src/ts/controllers/quotes-controller", async () => {
  type Quote = { id: number; text: string; source: string; length: number };
  const data = readJson<QuoteData>("quotes/persian.json");
  let filtered: Quote[] = data.quotes;
  return {
    default: {
      getQuotes: async (
        _language: string,
        quoteLength: number[],
      ): Promise<Quote[]> => {
        filtered = data.quotes.filter((q) =>
          quoteLength.some((index) => {
            const [lo, hi] = data.groups[index] ?? [0, 0];
            return q.length >= lo && q.length <= hi;
          }),
        );
        return filtered;
      },
      getRandomQuote: (): Quote | null =>
        filtered.length > 0
          ? (filtered[Math.floor(Math.random() * filtered.length)] as Quote)
          : null,
      getQuoteById: (id: number): Quote | undefined =>
        data.quotes.find((q) => q.id === id),
      getRandomFavoriteQuote: (): Quote | null => null,
    },
  };
});

describe("phase 66 — the persian quotes mode", () => {
  describe("the collection (content integrity)", () => {
    const data = readJson<QuoteData>("quotes/persian.json");

    it("keeps the strict schema shape with computed lengths", () => {
      expect(data.language).toBe("persian");
      expect(data.groups).toEqual([
        [0, 100],
        [101, 300],
        [301, 600],
        [601, 9999],
      ]);
      for (const quote of data.quotes) {
        expect(Object.keys(quote).sort()).toEqual([
          "id",
          "length",
          "source",
          "text",
        ]);
        //length is the char count, never asserted by hand
        expect(quote.length).toBe(quote.text.length);
        expect(quote.text.trim().length).toBeGreaterThan(0);
        expect(quote.source.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(quote.id)).toBe(true);
      }
    });

    it("never repeats an id or a text", () => {
      const ids = new Set<number>();
      const texts = new Set<string>();
      for (const quote of data.quotes) {
        expect(ids.has(quote.id)).toBe(false);
        expect(texts.has(quote.text)).toBe(false);
        ids.add(quote.id);
        texts.add(quote.text);
      }
    });

    it("types clean: no untypeable diacritics anywhere", () => {
      for (const quote of data.quotes) {
        expect(quote.text).not.toMatch(/[\u064B-\u065F\u0670\u0640]/);
      }
    });

    it("covers all four buckets — thicc is no longer empty", () => {
      const counts = [0, 0, 0, 0];
      for (const quote of data.quotes) {
        for (let i = 0; i < data.groups.length; i++) {
          const [lo, hi] = data.groups[i] as [number, number];
          if (quote.length >= lo && quote.length <= hi) {
            counts[i] = (counts[i] ?? 0) + 1;
            break;
          }
        }
      }
      expect(counts[3]).toBeGreaterThan(0); //thicc — empty before phase 66
      for (const count of counts) expect(count).toBeGreaterThan(0);
    });
  });

  describe("the real generator flow", () => {
    let WordsGenerator: typeof import("../../src/ts/test/words-generator");
    let setConfig: typeof import("../../src/ts/config/setters").setConfig;
    const persian = readJson<LanguageObject>("languages/persian.json");

    beforeEach(async () => {
      vi.resetModules();
      window.localStorage.clear();
      (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
      const setters = await import("../../src/ts/config/setters");
      setConfig = setters.setConfig;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("the thicc bucket (empty before this phase) generates a long rtl run", async () => {
      setConfig("mode", "quote");
      setConfig("language", "persian");
      setConfig("quoteLength", [3]);
      WordsGenerator = await import("../../src/ts/test/words-generator");
      const ret = await WordsGenerator.generateWords(persian);
      expect(ret.words.length).toBeGreaterThan(30);
      expect(ret.allRightToLeft).toBe(true);
      expect(ret.allJoiningScript).toBe(true);
    });

    it("the short bucket generates a compact run with the same rtl flags", async () => {
      setConfig("mode", "quote");
      setConfig("language", "persian");
      setConfig("quoteLength", [0]);
      WordsGenerator = await import("../../src/ts/test/words-generator");
      const ret = await WordsGenerator.generateWords(persian);
      expect(ret.words.length).toBeGreaterThan(3);
      expect(ret.allRightToLeft).toBe(true);
      expect(ret.allJoiningScript).toBe(true);
    });
  });

  describe("quote pbs land in language-keyed buckets", () => {
    beforeEach(() => {
      vi.resetModules();
      window.localStorage.clear();
      (globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory();
    });

    function makeQuoteResult(
      overrides: Partial<SnapshotResult<Mode>> & { _id: string },
    ): SnapshotResult<Mode> {
      return {
        wpm: 90,
        rawWpm: 100,
        charStats: { correct: 45, incorrect: 0, extra: 0, missed: 0 },
        acc: 100,
        consistency: 70,
        mode: "quote",
        mode2: "21",
        timestamp: 1700000000000,
        restartCount: 0,
        incompleteTestSeconds: 0,
        afkDuration: 0,
        testDuration: 30,
        punctuation: false,
        numbers: false,
        difficulty: "normal",
        language: "persian",
        lazyMode: false,
        funbox: [],
        ...overrides,
      } as unknown as SnapshotResult<Mode>;
    }

    it("a persian quote result never touches the english bucket", async () => {
      const Db = await import("../../src/ts/db");
      Db.initLocalSnapshot();
      Db.saveLocalResult({
        result: makeQuoteResult({ _id: "fa_best" }),
        isPb: true,
      });

      //same quote id, different language: separate buckets entirely
      expect(
        Db.getLocalPB("quote", "21", false, false, "persian", "normal", false, []),
      ).toBeDefined();
      expect(
        Db.getLocalPB("quote", "21", false, false, "english", "normal", false, []),
      ).toBeUndefined();
    });

    it("a faster english run of the same quote does not overwrite persian", async () => {
      const Db = await import("../../src/ts/db");
      Db.initLocalSnapshot();
      Db.saveLocalResult({
        result: makeQuoteResult({ _id: "fa_best", language: "persian", wpm: 60 }),
        isPb: true,
      });
      Db.saveLocalResult({
        result: makeQuoteResult({ _id: "en_best", language: "english", wpm: 120 }),
        isPb: true,
      });

      expect(
        Db.getLocalPB("quote", "21", false, false, "persian", "normal", false, [])
          ?.wpm,
      ).toBe(60);
      expect(
        Db.getLocalPB("quote", "21", false, false, "english", "normal", false, [])
          ?.wpm,
      ).toBe(120);
    });
  });
});
