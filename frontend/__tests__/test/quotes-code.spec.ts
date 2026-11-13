import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteData } from "@monkeytype/schemas/quotes";
import type { LanguageObject } from "@monkeytype/schemas/languages";
import { isWordRightToLeft } from "../../src/ts/utils/strings";

const STATIC_DIR = resolve(fileURLToPath(import.meta.url), "../../../static");
function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(STATIC_DIR, rel), "utf-8")) as T;
}

//the generator's quote flow goes through the controller; the mock serves
//the REAL collection read straight off the disk
vi.mock("../../src/ts/controllers/quotes-controller", async () => {
  type Quote = { id: number; text: string; source: string; length: number };
  const fileFor = (language: string): QuoteData =>
    readJson<QuoteData>(`quotes/${language}.json`);
  let filtered: Quote[] = [];
  return {
    default: {
      getQuotes: async (
        language: string,
        quoteLength: number[],
      ): Promise<Quote[]> => {
        const data = fileFor(language);
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
        filtered.find((q) => q.id === id),
      getRandomFavoriteQuote: (): Quote | null => null,
    },
  };
});

const CODE_LANGUAGES = ["code_typescript", "code_rust", "code_python"] as const;

describe("phase 67 — the code snippets mode (mixed RTL/LTR)", () => {
  describe("the collections (content integrity)", () => {
    for (const lang of CODE_LANGUAGES) {
      const data = readJson<QuoteData>(`quotes/${lang}.json`);

      it(`${lang}: strict shape with computed lengths`, () => {
        expect(data.language).toBe(lang);
        expect(data.groups).toHaveLength(4);
        for (const quote of data.quotes) {
          expect(Object.keys(quote).sort()).toEqual([
            "id",
            "length",
            "source",
            "text",
          ]);
          expect(quote.length).toBe(quote.text.length);
          expect(quote.source.trim().length).toBeGreaterThan(0);
        }
      });

      it(`${lang}: no untypeable diacritics`, () => {
        for (const quote of data.quotes) {
          expect(quote.text).not.toMatch(/[\u064B-\u065F\u0670\u0640]/);
        }
      });
    }

    it("the rust thicc bucket is no longer empty (phase 67)", () => {
      const data = readJson<QuoteData>("quotes/code_rust.json");
      const [lo, hi] = data.groups[3] as [number, number];
      expect(
        data.quotes.some((q) => q.length >= lo && q.length <= hi),
      ).toBe(true);
    });
  });

  describe("per-word direction — the keybr no-half-highlight rule", () => {
    const ts = readJson<QuoteData>("quotes/code_typescript.json");
    const mixed = ts.quotes.find((q) => q.text.includes("// لیست کاربران"));
    //the phase's own content: a real snippet with persian comments
    expect(mixed).toBeDefined();

    it("code tokens stay ltr while persian comment words flip rtl", () => {
      const codeWord = "UserCache";
      const commentWord = "کاربران";
      //languageRTL=false: the code container is ltr
      expect(isWordRightToLeft(codeWord, false)[0]).toBe(false);
      expect(isWordRightToLeft(commentWord, false)[0]).toBe(true);
      //symbol-only tokens fall back to the language direction (no flip)
      expect(isWordRightToLeft("=>{};", false)[0]).toBe(false);
    });

    it("every added snippet carries at least one persian comment word", () => {
      for (const lang of CODE_LANGUAGES) {
        const data = readJson<QuoteData>(`quotes/${lang}.json`);
        const added = data.quotes.filter((q) =>
          ["typescript-user-cache", "typescript-retry", "rust-word-counter", "rust-result-chain", "python-average-ms", "python-dedupe-log"].includes(
            q.source,
          ),
        );
        expect(added.length).toBeGreaterThanOrEqual(2);
        for (const quote of added) {
          const words = quote.text.split(/\s+/);
          expect(
            words.some((w) => isWordRightToLeft(w, false)[0]),
          ).toBe(true);
        }
      }
    });
  });

  describe("the real generator flow (quote + code language)", () => {
    let WordsGenerator: typeof import("../../src/ts/test/words-generator");
    let setConfig: typeof import("../../src/ts/config/setters").setConfig;
    const tsLanguage = readJson<LanguageObject>("languages/code_typescript.json");

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

    it("a typescript snippet flows through with ltr flags and symbol words", async () => {
      setConfig("mode", "quote");
      setConfig("language", "code_typescript");
      //medium bucket: the user-cache snippet lives there
      setConfig("quoteLength", [1]);
      WordsGenerator = await import("../../src/ts/test/words-generator");
      const ret = await WordsGenerator.generateWords(tsLanguage);
      expect(ret.words.length).toBeGreaterThan(10);
      //the container stays ltr for code — per-word rtl marks handle the
      //persian comments inside (the keybr rule). the language object
      //carries no rtl/joining flags at all: undefined flows through
      expect(ret.allRightToLeft).toBeUndefined();
      expect(ret.allJoiningScript).toBe(false);
      //real code: symbol-dense words in every medium snippet
      const joined = ret.words.join(" ");
      expect(joined).toMatch(/[{}();]/);
    });
  });
});
