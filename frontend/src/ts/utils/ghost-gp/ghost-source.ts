/**
 * Ghost GP ghost sources (idea G3, phase 1): PURE — the callers fetch the
 * candidate record (the last local result via states/snapshot, or a PB via
 * db's getLocalPB identity match) and hand it over; this module validates
 * and shapes the ghost. The race language must match the record's language:
 * the ghost paces a word sequence of that language.
 */

export type Ghost = {
  kind: "constant";
  wpm: number;
  /** what the strip shows, eg. "last run" or "personal best" */
  label: string;
};

export type GhostSourceReason = "no-result" | "wrong-language" | "invalid-wpm";

export type GhostSourceResult =
  | { ok: true; ghost: Ghost }
  | { ok: false; reason: GhostSourceReason };

function constantGhost(
  wpm: number,
  label: string,
  language: string,
  currentLanguage: string,
): GhostSourceResult {
  if (language !== currentLanguage) {
    return { ok: false, reason: "wrong-language" };
  }
  if (!(wpm > 0) || Number.isNaN(wpm)) {
    return { ok: false, reason: "invalid-wpm" };
  }
  return { ok: true, ghost: { kind: "constant", wpm, label } };
}

/**
 * Last Ghost: the most recent local test result drives the ghost. The UI
 * maps "no-result" to "run a test first" (the raceYourGhost precedent).
 */
export function ghostFromLastResult(
  last: { wpm: number; language: string } | undefined,
  currentLanguage: string,
): GhostSourceResult {
  if (last === undefined) return { ok: false, reason: "no-result" };
  return constantGhost(last.wpm, "last run", last.language, currentLanguage);
}

/**
 * PB Ghost: a personal best entry of the current language — the UI picks it
 * through db's identity match (punctuation/numbers/difficulty/language/
 * lazyMode/customPunctuation) and hands the entry over.
 */
export function ghostFromPersonalBest(
  pb: { wpm: number; language: string } | undefined,
  currentLanguage: string,
): GhostSourceResult {
  if (pb === undefined) return { ok: false, reason: "no-result" };
  return constantGhost(pb.wpm, "personal best", pb.language, currentLanguage);
}
