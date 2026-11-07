import { describe, expect, it } from "vitest";

import type { Keycode } from "../../../src/ts/constants/keys";
import {
  SIDE_LEFT_CODES,
  SIDE_RIGHT_CODES,
  sideOf,
} from "../../../src/ts/utils/split-duel/sides";

/** the compiler-enforced FULL Keycode coverage: adding a code to the
 * union without a side breaks this file's typecheck */
const FULL_COVERAGE: Record<Keycode, true> = {
  Backquote: true,
  Digit1: true,
  Digit2: true,
  Digit3: true,
  Digit4: true,
  Digit5: true,
  Digit6: true,
  Digit7: true,
  Digit8: true,
  Digit9: true,
  Digit0: true,
  Minus: true,
  Equal: true,
  Tab: true,
  KeyQ: true,
  KeyW: true,
  KeyE: true,
  KeyR: true,
  KeyT: true,
  KeyY: true,
  KeyU: true,
  KeyI: true,
  KeyO: true,
  KeyP: true,
  BracketLeft: true,
  BracketRight: true,
  Backslash: true,
  KeyA: true,
  KeyS: true,
  KeyD: true,
  KeyF: true,
  KeyG: true,
  KeyH: true,
  KeyJ: true,
  KeyK: true,
  KeyL: true,
  Semicolon: true,
  Quote: true,
  KeyZ: true,
  KeyX: true,
  KeyC: true,
  KeyV: true,
  KeyB: true,
  KeyN: true,
  KeyM: true,
  Comma: true,
  Period: true,
  Slash: true,
  Space: true,
  ShiftLeft: true,
  IntlBackslash: true,
  ShiftRight: true,
  ArrowUp: true,
  ArrowLeft: true,
  ArrowDown: true,
  ArrowRight: true,
  NumpadMultiply: true,
  NumpadSubtract: true,
  NumpadAdd: true,
  NumpadDecimal: true,
  NumpadEqual: true,
  NumpadDivide: true,
  Numpad0: true,
  Numpad1: true,
  Numpad2: true,
  Numpad3: true,
  Numpad4: true,
  Numpad5: true,
  Numpad6: true,
  Numpad7: true,
  Numpad8: true,
  Numpad9: true,
  NumpadEnter: true,
  Enter: true,
  Backspace: true,
};

describe("split-duel sides (idea G19 phase 1)", () => {
  it("every Keycode belongs to EXACTLY one side", () => {
    const codes = Object.keys(FULL_COVERAGE) as Keycode[];
    for (const code of codes) {
      const side = sideOf(code);
      expect(side === "left" || side === "right").toBe(true);
      const inLeft = SIDE_LEFT_CODES.has(code);
      const inRight = SIDE_RIGHT_CODES.has(code);
      expect(inLeft !== inRight).toBe(true); //never both, never neither
    }
  });

  it("the two side sets together cover the whole union", () => {
    const codes = Object.keys(FULL_COVERAGE) as Keycode[];
    expect(SIDE_LEFT_CODES.size + SIDE_RIGHT_CODES.size).toBe(codes.length);
  });

  it("Space and Enter are RIGHT (doc §۳)", () => {
    expect(sideOf("Space")).toBe("right");
    expect(sideOf("Enter")).toBe("right");
    expect(sideOf("NumpadEnter")).toBe("right");
  });

  it("the border pairs split cleanly (T/Y, G/H, B/N, 5/6)", () => {
    expect(sideOf("KeyT")).toBe("left");
    expect(sideOf("KeyY")).toBe("right");
    expect(sideOf("KeyG")).toBe("left");
    expect(sideOf("KeyH")).toBe("right");
    expect(sideOf("KeyB")).toBe("left");
    expect(sideOf("KeyN")).toBe("right");
    expect(sideOf("Digit5")).toBe("left");
    expect(sideOf("Digit6")).toBe("right");
  });

  it("unknown codes are sideless", () => {
    expect(sideOf("F13")).toBe("sideless");
    expect(sideOf("MediaPlay")).toBe("sideless");
    expect(sideOf("")).toBe("sideless");
  });
});
