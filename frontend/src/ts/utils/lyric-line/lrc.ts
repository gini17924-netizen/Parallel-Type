/**
 * Lyric Line LRC parser (idea G20, phase 1): the standard `[mm:ss.xx]`
 * karaoke format plus the offset tag and the plain-text fallback (doc
 * §۲). Multiple timestamps on one line duplicate the text; metadata
 * tags ([ar:] [ti:] …) are ignored; runs of whitespace collapse to one
 * space (doc §۵). PURE strings in, structures out.
 */

export type LrcLine = {
  /** the line's start in ms; null = a plain (untimed) line */
  tMs: number | null;
  text: string;
};

export type ParsedLrc = {
  lines: LrcLine[];
  /** the [offset:+ms] tag — positive shifts every timestamp earlier */
  offsetMs: number;
  /** true when at least one line carried a timestamp */
  isTimed: boolean;
};

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
const META_TAG = /^\[(ar|al|ti|by|length|re|ve):.*\]$/i;

function toMs(min: string, sec: string, frac: string | undefined): number {
  const minutes = Number(min);
  const seconds = Number(sec);
  const fraction = frac ?? "0";
  //1-2 digits = hundredths, 3 digits = milliseconds
  const ms =
    fraction.length === 3
      ? Number(fraction)
      : Number(fraction.padEnd(2, "0")) * 10;
  return minutes * 60000 + seconds * 1000 + ms;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseLrc(raw: string): ParsedLrc {
  const lines: LrcLine[] = [];
  let offsetMs = 0;
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      //a blank line separates stanzas — keep it as an instrumental gap
      lines.push({ tMs: null, text: "" });
      continue;
    }
    const offsetMatch = OFFSET_TAG.exec(trimmed);
    if (offsetMatch !== null) {
      offsetMs = Number(offsetMatch[1] ?? 0);
      continue;
    }
    if (META_TAG.test(trimmed)) continue;
    const tags: number[] = [];
    let text = trimmed;
    TIME_TAG.lastIndex = 0;
    let match = TIME_TAG.exec(trimmed);
    while (match !== null) {
      tags.push(toMs(match[1] ?? "0", match[2] ?? "0", match[3]));
      text = text.slice(match[0].length);
      match = TIME_TAG.exec(trimmed);
    }
    const clean = collapse(text);
    if (tags.length === 0) {
      lines.push({ tMs: null, text: clean });
      continue;
    }
    for (const tMs of tags) {
      //positive offset = the lyrics show earlier (the LRC convention)
      lines.push({ tMs: Math.max(0, tMs - offsetMs), text: clean });
    }
  }
  const timed = lines.some((line) => line.tMs !== null);
  if (timed) {
    //null-timed (blank separator) lines sort to the end
    lines.sort(
      (a, b) =>
        (a.tMs ?? Number.MAX_SAFE_INTEGER) - (b.tMs ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return { lines, offsetMs, isTimed: timed };
}
