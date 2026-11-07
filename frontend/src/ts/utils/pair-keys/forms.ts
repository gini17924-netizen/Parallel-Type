import { BALANCE } from "./balance";

/**
 * Pair Keys forms (idea G18, phase 1): the Persian letter forms are
 * rendered with the ZWJ trick (U+200D) — no extra fonts or data (doc
 * §۰). isolated = ب | initial = ب+ZWJ | medial = ZWJ+ب+ZWJ | final =
 * ZWJ+ب. PURE strings; rendering is the browser's Arabic shaper.
 */

export const ZWJ = "\u200D";

export type LetterFormName = "isolated" | "initial" | "medial" | "final";

export type LetterForms = {
  letter: string;
  isolated: string;
  initial: string;
  medial: string;
  final: string;
};

export function letterForms(letter: string): LetterForms {
  return {
    letter,
    isolated: letter,
    initial: letter + ZWJ,
    medial: ZWJ + letter + ZWJ,
    final: ZWJ + letter,
  };
}

export function formGlyph(letter: string, form: LetterFormName): string {
  return letterForms(letter)[form];
}

/** whether a letter joins on both sides (non-joiners are useless as
 * form-name cards — all their forms render identically, doc §۶) */
export function isJoining(letter: string): boolean {
  return !(BALANCE.nonJoiningLetters as readonly string[]).includes(letter);
}
