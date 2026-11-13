import { beforeEach, describe, expect, it } from "vitest";

import {
  buildSymbolDrillPlan,
  CODE_SYMBOLS,
  loadCodeDrillState,
  registerCodeSession,
  symbolWeakness,
} from "../../src/ts/utils/code-drill";

describe("phase 67 — the code-symbols drill", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("registers only the judged symbol charset — letters stay out", () => {
    const state = registerCodeSession(
      ["let", "x=1;", "if(x!==null){", "}else{"],
      ["let", "x=1;", "if(x!==null){", "}else{"],
    );
    //symbols counted
    expect(state.symbols[";"]?.correct).toBeGreaterThan(0);
    expect(state.symbols["{"]?.correct).toBeGreaterThan(0);
    //letters never enter this store (they belong to learn-stats)
    expect(state.symbols["x"]).toBeUndefined();
    expect(state.symbols["l"]).toBeUndefined();
    //persisted under the own key
    const raw = window.localStorage.getItem("mtDesktopCodeDrill");
    expect(raw).not.toBeNull();
  });

  it("counts an error against the expected symbol", () => {
    //the missing trailing ';' is an error on the EXPECTED symbol
    const state = registerCodeSession(["a=(1);"], ["a=(1)"]);
    expect(state.symbols[";"]?.incorrect).toBe(1);
    expect(state.symbols["("]?.correct).toBe(1);
    expect(state.symbols[")"]?.correct).toBe(1);
  });

  it("merges sessions and persists across reloads", () => {
    registerCodeSession(["};"], ["};"]);
    registerCodeSession(["};"], ["};"]);
    const state = loadCodeDrillState();
    expect(state.symbols["}"]?.correct).toBe(2);
  });

  it("symbol weakness is 0.05-floored for unseen symbols", () => {
    const state = loadCodeDrillState();
    const weakness = symbolWeakness(state);
    expect(weakness["{"]).toBe(0.05);
    const used = registerCodeSession(["x;"], ["x,"]);
    //the expected ';' was mis-typed: full weakness
    expect(used.symbols[";"]?.incorrect).toBe(1);
    const w = symbolWeakness(used);
    expect(w[";"]).toBe(1);
  });

  it("the plan is deterministic per seed and symbol-dense", () => {
    const state = loadCodeDrillState();
    const a = buildSymbolDrillPlan(state, 20, 1234);
    const b = buildSymbolDrillPlan(state, 20, 1234);
    expect(a.words).toEqual(b.words);
    expect(a.words).toHaveLength(20);
    //every token is space-free (CustomText words contract) and dense
    for (const word of a.words) {
      expect(word.includes(" ")).toBe(false);
      const symbols = [...word].filter((ch) => CODE_SYMBOLS.has(ch));
      expect(symbols.length).toBeGreaterThan(0);
    }
    //a state full of weak braces focuses the plan on brace-heavy tokens
    const weak: typeof state = { symbols: {} };
    for (const ch of CODE_SYMBOLS) {
      weak.symbols[ch] =
        ch === "{" || ch === "}"
          ? { correct: 0, incorrect: 10 }
          : { correct: 10, incorrect: 0 };
    }
    const focused = buildSymbolDrillPlan(weak, 30, 99);
    const braceTokens = focused.words.filter((w) => w.includes("{") || w.includes("}"));
    expect(braceTokens.length).toBeGreaterThan(0);
    expect(focused.focusedSymbols).toContain("{");
  });

  it("corrupt storage loads as an empty state", () => {
    window.localStorage.setItem("mtDesktopCodeDrill", "{not json");
    expect(loadCodeDrillState().symbols).toEqual({});
    window.localStorage.setItem(
      "mtDesktopCodeDrill",
      JSON.stringify({ symbols: { x: { correct: 1, incorrect: 0 }, ";": { correct: 2, incorrect: 1 } } }),
    );
    //the letter key is dropped on load — only symbols survive
    expect(loadCodeDrillState().symbols).toEqual({
      ";": { correct: 2, incorrect: 1 },
    });
  });
});
