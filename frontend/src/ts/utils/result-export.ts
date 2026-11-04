import { Mode } from "@monkeytype/schemas/shared";

import { SnapshotResult } from "../constants/default-snapshot";
import { loadLocalResults } from "./local-persistence";
import { download } from "./misc";

/**
 * Full-fidelity CSV export of the local results store (idea #11).
 *
 * Unlike the old account-table export (misc.ts downloadResultsCSV), this
 * reads loadLocalResults() directly: no result filters, no collection cap,
 * and RFC 4180 escaping. misc.ts stays untouched - the account button
 * rewires to this module.
 *
 * Column order starts with the upstream misc.ts order so existing external
 * spreadsheets keep working, then appends the new columns.
 */

const CSV_HEADER = [
  "_id",
  "isPb",
  "wpm",
  "acc",
  "rawWpm",
  "consistency",
  "charStats",
  "mode",
  "mode2",
  "quoteLength",
  "restartCount",
  "testDuration",
  "afkDuration",
  "incompleteTestSeconds",
  "punctuation",
  "numbers",
  "language",
  "funbox",
  "difficulty",
  "lazyMode",
  "blindMode",
  "bailedOut",
  "tags",
  "timestamp",
  //idea #11 additions
  "timestampISO",
  "keyConsistency",
  "wpmConsistency",
  "customTextLength",
] as const;

/** RFC 4180: quote a field containing a delimiter, quote or newline; quotes
 * inside are doubled. undefined/null render as empty. */
function csvField(value: string | number | boolean | undefined | null): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** stored rows carry the schema's 4-tuple; defensively handle a legacy
 * object shape as correct;incorrect;extra;missed */
function charStatsField(charStats: unknown): string {
  if (Array.isArray(charStats)) return charStats.join(";");
  if (typeof charStats === "object" && charStats !== null) {
    const it = charStats as Record<string, unknown>;
    return [it["correct"], it["incorrect"], it["extra"], it["missed"]]
      .map((value) => Number(value ?? 0))
      .join(";");
  }
  return "";
}

function joinSemicolon(value: unknown): string | undefined {
  return Array.isArray(value) && value.length > 0 ? value.join(";") : undefined;
}

export function resultToCsvRow(result: SnapshotResult<Mode>): string[] {
  const customText = result.customText as { textLen?: number } | undefined;
  return [
    result._id,
    result.isPb,
    result.wpm,
    result.acc,
    result.rawWpm,
    result.consistency,
    charStatsField(result.charStats),
    result.mode,
    result.mode2,
    result.quoteLength,
    result.restartCount,
    result.testDuration,
    result.afkDuration,
    result.incompleteTestSeconds,
    result.punctuation,
    result.numbers,
    result.language,
    joinSemicolon(result.funbox), //regression: raw array joined "," and broke columns
    result.difficulty,
    result.lazyMode,
    result.blindMode,
    result.bailedOut,
    joinSemicolon(result.tags),
    result.timestamp,
    new Date(result.timestamp).toISOString(),
    result.keyConsistency,
    result.wpmConsistency,
    customText?.textLen,
  ].map(csvField);
}

/** header + one row per result, in the order given (no sorting here) */
export function toCsv(results: readonly SnapshotResult<Mode>[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const result of results) lines.push(resultToCsvRow(result).join(","));
  return lines.join("\n");
}

/** exports EVERY local result (no filters, no cap), newest first */
export async function exportResultsCsv(): Promise<void> {
  const results = [...(await loadLocalResults())].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const blob = new Blob([toCsv(results)], { type: "text/csv" });
  const date = new Date().toISOString().slice(0, 10);
  download({ filename: `monkeytype-results-${date}.csv`, data: blob });
}
