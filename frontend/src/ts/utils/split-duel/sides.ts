import type { Keycode } from "../../constants/keys";

/**
 * Split-Key Showdown side table (idea G19, phase 1): the physical
 * keyboard split for two players on one board (doc §۳ — the ANSI
 * halves). Routing is code-based, so BOTH players can use their own
 * layout on the same physical keys. Border codes (KeyT/KeyY, KeyG/KeyH,
 * KeyB/KeyN, Digit5/Digit6) each belong to EXACTLY one side.
 */

export type KeySide = "left" | "right" | "sideless";

/** the left half of a standard ANSI board (doc §۳ explicit list) */
export const SIDE_LEFT_CODES: ReadonlySet<Keycode> = new Set<Keycode>([
  "Backquote",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Tab",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyT",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyG",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyV",
  "KeyB",
  "ShiftLeft",
  "IntlBackslash",
]);

/** the right half — the exact complement; Space and Enter are RIGHT
 * (doc §۳: the page never needs them mid-word anyway) */
export const SIDE_RIGHT_CODES: ReadonlySet<Keycode> = new Set<Keycode>([
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "Minus",
  "Equal",
  "KeyY",
  "KeyU",
  "KeyI",
  "KeyO",
  "KeyP",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "KeyH",
  "KeyJ",
  "KeyK",
  "KeyL",
  "Semicolon",
  "Quote",
  "KeyN",
  "KeyM",
  "Comma",
  "Period",
  "Slash",
  "ShiftRight",
  "Space",
  "Enter",
  "NumpadEnter",
  "Backspace",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "NumpadMultiply",
  "NumpadSubtract",
  "NumpadAdd",
  "NumpadDecimal",
  "NumpadEqual",
  "NumpadDivide",
  "Numpad0",
  "Numpad1",
  "Numpad2",
  "Numpad3",
  "Numpad4",
  "Numpad5",
  "Numpad6",
  "Numpad7",
  "Numpad8",
  "Numpad9",
]);

/** exactly one side owns every Keycode; unknown codes are sideless */
export function sideOf(code: string): KeySide {
  if (SIDE_LEFT_CODES.has(code as Keycode)) return "left";
  if (SIDE_RIGHT_CODES.has(code as Keycode)) return "right";
  return "sideless";
}
