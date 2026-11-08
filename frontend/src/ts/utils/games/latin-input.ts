/**
 * Latin input for the games (round-5 finding, phase 1): the games'
 * content is latin, but `event.key` follows the OS layout — on a
 * Persian layout the physical KeyD produces «ی» and every latin-key
 * game went dead. Games must match by PHYSICAL position instead (the
 * doc G21 §۱ rule: code-based matching): map `event.code` → the QWERTY
 * character that key produces on a US layout. A latin `event.key`
 * passes through untouched (latin layouts behave exactly as before),
 * and Lyric Line deliberately does NOT use this (its content is the
 * user's own text, any language).
 */

/** the QWERTY character per physical code (letters + digits) */
const CODE_CHARS: Record<string, string> = {
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Digit0: "0",
  KeyQ: "q",
  KeyW: "w",
  KeyE: "e",
  KeyR: "r",
  KeyT: "t",
  KeyY: "y",
  KeyU: "u",
  KeyI: "i",
  KeyO: "o",
  KeyP: "p",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyZ: "z",
  KeyX: "x",
  KeyC: "c",
  KeyV: "v",
  KeyB: "b",
  KeyN: "n",
  KeyM: "m",
  Space: " ",
};

/** the latin character for this keydown: a latin event.key passes
 * through; otherwise the physical code maps to its QWERTY char; an
 * unknown code returns the raw key (the game's own no-op path) */
export function latinCharFromEvent(key: string, code: string): string {
  if (key.length === 1 && /^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  const mapped = CODE_CHARS[code];
  return mapped ?? key;
}
