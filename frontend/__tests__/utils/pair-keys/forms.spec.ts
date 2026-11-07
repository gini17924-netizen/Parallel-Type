import { describe, expect, it } from "vitest";

import { BALANCE } from "../../../src/ts/utils/pair-keys/balance";
import {
  ZWJ,
  formGlyph,
  isJoining,
  letterForms,
} from "../../../src/ts/utils/pair-keys/forms";

const PERSIAN_LETTERS = [
  "ا",
  "ب",
  "پ",
  "ت",
  "ث",
  "ج",
  "چ",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "ژ",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
  "ظ",
  "ع",
  "غ",
  "ف",
  "ق",
  "ک",
  "گ",
  "ل",
  "م",
  "ن",
  "و",
  "ه",
  "ی",
];

describe("pair-keys forms (idea G18 phase 1)", () => {
  it("builds the four forms with the ZWJ trick", () => {
    const forms = letterForms("ب");
    expect(forms.isolated).toBe("ب");
    expect(forms.initial).toBe(`ب${ZWJ}`);
    expect(forms.medial).toBe(`${ZWJ}ب${ZWJ}`);
    expect(forms.final).toBe(`${ZWJ}ب`);
    expect(ZWJ).toBe("\u200D"); //the JOINER, not ZWNJ
  });

  it("every one of the 32 Persian letters yields 4 distinct strings", () => {
    for (const letter of PERSIAN_LETTERS) {
      const forms = letterForms(letter);
      const set = new Set([
        forms.isolated,
        forms.initial,
        forms.medial,
        forms.final,
      ]);
      expect(set.size).toBe(4);
    }
  });

  it("formGlyph maps the four names", () => {
    expect(formGlyph("ب", "isolated")).toBe("ب");
    expect(formGlyph("ب", "medial")).toBe(`${ZWJ}ب${ZWJ}`);
  });

  it("the non-joiners are excluded from joining", () => {
    for (const letter of BALANCE.nonJoiningLetters) {
      expect(isJoining(letter)).toBe(false);
    }
    expect(isJoining("ب")).toBe(true);
    expect(isJoining("پ")).toBe(true);
  });
});
