/*
 * The code-symbols drill (phase 67): code sessions register per-symbol
 * stats — the bracket/operator punctuation characters are the hard part
 * of code typing — and the DrillsPage turns the weak ones into
 * symbol-heavy drill tokens. Its own storage key: these stats must
 * never mix into the letter grids of learn-stats (different script,
 * different practice), mirroring the fork's independent-store rule.
 */
import { LCG } from "@keybr/rand";

import { computeLetterStats, type KeyStat } from "./learn-stats";

export type CodeDrillState = {
  symbols: Record<string, KeyStat>;
};

const STORAGE_KEY = "mtDesktopCodeDrill";

/** the printable ASCII punctuation a code session is judged on */
export const CODE_SYMBOLS: ReadonlySet<string> = new Set(
  "{}[]();=<>!+-*/%&|:.,\"'#@$~^\\`_?".split(""),
);

export function loadCodeDrillState(): CodeDrillState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { symbols: {} };
    const parsed = JSON.parse(raw) as CodeDrillState;
    if (typeof parsed?.symbols !== "object" || parsed.symbols === null) {
      return { symbols: {} };
    }
    //drop anything outside the judged charset — legacy keys or tampering
    const symbols: Record<string, KeyStat> = {};
    for (const [ch, stat] of Object.entries(parsed.symbols)) {
      if (
        CODE_SYMBOLS.has(ch) &&
        typeof stat?.correct === "number" &&
        typeof stat?.incorrect === "number"
      ) {
        symbols[ch] = {
          correct: stat.correct,
          incorrect: stat.incorrect,
        };
      }
    }
    return { symbols };
  } catch {
    return { symbols: {} };
  }
}

function saveCodeDrillState(state: CodeDrillState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Registers a finished CODE session: diffs the snippet's words against
 * the typed words per character (the same shape as learn-stats' letter
 * diff) and keeps only the symbol charset. Returns the updated state.
 */
export function registerCodeSession(
  expectedWords: string[],
  typedWords: string[],
): CodeDrillState {
  const state = loadCodeDrillState();
  const stats = computeLetterStats(expectedWords, typedWords);
  for (const [ch, stat] of Object.entries(stats)) {
    if (!CODE_SYMBOLS.has(ch)) continue;
    const current = state.symbols[ch] ?? { correct: 0, incorrect: 0 };
    state.symbols[ch] = {
      correct: current.correct + stat.correct,
      incorrect: current.incorrect + stat.incorrect,
    };
  }
  saveCodeDrillState(state);
  return state;
}

/** 0..1 weakness per symbol; unseen symbols floor at 0.05 so strong
 * symbols still surface occasionally (the smart-drill floor rule) */
export function symbolWeakness(state: CodeDrillState): Record<string, number> {
  const weakness: Record<string, number> = {};
  for (const ch of CODE_SYMBOLS) {
    const stat = state.symbols[ch];
    const total = (stat?.correct ?? 0) + (stat?.incorrect ?? 0);
    weakness[ch] = total === 0 ? 0.05 : (stat?.incorrect ?? 0) / total;
  }
  return weakness;
}

/** space-free code-flavored tokens, dense with the judged symbols */
const TEMPLATES: readonly string[] = [
  "(i)=>{",
  "};",
  "arr[0]=1;",
  "}else{",
  "return[];",
  "if(x!==null){",
  "s+=\"a\";",
  "v:T[];",
  "\"id\":1,",
  "map.clear();",
  "f(x,{y:2});",
  "n%2===0;",
  "|a,b|a+b",
  "t!=[];",
];

export type SymbolDrillPlan = {
  words: string[];
  /** the weak symbols that actually appear in the plan */
  focusedSymbols: string[];
};

/** the weakest symbols that the plan actually exercises */
function focusedFrom(words: string[], weakness: Record<string, number>): string[] {
  const scored = [...new Set(words.join("").split(""))]
    .filter((ch) => CODE_SYMBOLS.has(ch))
    .map((ch) => ({ ch, score: weakness[ch] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  //only "focused" when the symbol is actually weak, not merely present
  return top.filter((s) => s.score >= 0.25).map((s) => s.ch);
}

/**
 * Builds a symbol-heavy drill plan — PURE: every random choice flows
 * from the injected seed (the smart-drill contract). Selection uses the
 * weakspot argmax trick: sample candidates, keep the one whose symbols
 * carry the highest mean weakness.
 */
export function buildSymbolDrillPlan(
  state: CodeDrillState,
  count = 30,
  seed = Date.now(),
): SymbolDrillPlan {
  const rng = LCG(seed);
  const weakness = symbolWeakness(state);
  const scored = TEMPLATES.map((t) => {
    const chs = [...t].filter((ch) => CODE_SYMBOLS.has(ch));
    const mean =
      chs.length === 0
        ? 0
        : chs.reduce((sum, ch) => sum + (weakness[ch] ?? 0.05), 0) /
          chs.length;
    return { t, mean };
  });
  const words: string[] = [];
  while (words.length < count) {
    let best = scored[Math.floor(rng() * scored.length)] as {
      t: string;
      mean: number;
    };
    for (let k = 0; k < 3; k++) {
      const cand =
        scored[Math.floor(rng() * scored.length)];
      if (cand !== undefined && cand.mean > best.mean) best = cand;
    }
    //templates carry no spaces, so each one is exactly one drill word
    words.push(best.t.trim());
  }
  return { words: words.slice(0, count), focusedSymbols: focusedFrom(words, weakness) };
}
