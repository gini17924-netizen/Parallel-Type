import { BALANCE } from "./balance";
import { formGlyph, isJoining, type LetterFormName } from "./forms";

/**
 * Pair Keys board (idea G18, phase 1): the shuffled face-down grid.
 * Each pair shares a baseLetter; in form-name mode one card shows a
 * joined form glyph and its twin shows the base letter (matching runs
 * on baseLetter, never on the rendered string — doc §۳). PURE: the rng
 * is injected so shuffles are deterministic.
 */

export type PairKeysMode = (typeof BALANCE.modes)[number];

export type PairCard = {
  /** the grid index (0..2·pairs-1) */
  id: number;
  /** the letter this pair is about (the match key) */
  baseLetter: string;
  /** what the face shows: the bare letter or a joined form glyph */
  display: string;
  kind: "letter" | "form";
  /** which form a form-card shows (undefined for letter cards) */
  form: LetterFormName | undefined;
};

export type PairBoard = {
  mode: PairKeysMode;
  pairs: number;
  cards: PairCard[];
};

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)) % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** picks `pairs` letters usable for the mode (form-name needs joiners) */
function pickLetters(
  mode: PairKeysMode,
  pairs: number,
  letters: string[],
  rng: () => number,
): string[] {
  const pool = letters.filter(
    (letter) => mode !== "form-name" || isJoining(letter),
  );
  const unique = [...new Set(pool)];
  if (unique.length < pairs) {
    //letter mode always has the full alphabet; form-name has 25 joiners
    throw new Error(`pair-keys: need ${pairs} usable letters for ${mode}`);
  }
  return shuffled(unique, rng).slice(0, pairs);
}

export function createBoard(options: {
  mode: PairKeysMode;
  pairs?: number;
  /** the candidate letters (learn groups / weak letters, read-only) */
  letters: string[];
  rng: () => number;
}): PairBoard {
  const pairs = options.pairs ?? BALANCE.pairs;
  const letters = pickLetters(
    options.mode,
    pairs,
    options.letters,
    options.rng,
  );
  const cards: PairCard[] = [];
  for (const letter of letters) {
    if (options.mode === "letter") {
      cards.push({
        id: cards.length,
        baseLetter: letter,
        display: letter,
        kind: "letter",
        form: undefined,
      });
      cards.push({
        id: cards.length,
        baseLetter: letter,
        display: letter,
        kind: "letter",
        form: undefined,
      });
    } else {
      //one random joined form (seeded) against the bare letter
      const form = BALANCE.formNames[
        Math.floor(options.rng() * BALANCE.formNames.length) %
          BALANCE.formNames.length
      ] as LetterFormName;
      cards.push({
        id: cards.length,
        baseLetter: letter,
        display: formGlyph(letter, form),
        kind: "form",
        form,
      });
      cards.push({
        id: cards.length,
        baseLetter: letter,
        display: letter,
        kind: "letter",
        form: undefined,
      });
    }
  }
  //shuffle the finished pairs (deterministic under the injected rng)
  const placed = shuffled(cards, options.rng).map((card, id) => ({
    ...card,
    id,
  }));
  return { mode: options.mode, pairs, cards: placed };
}
