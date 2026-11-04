import type { Layout } from "@keybr/keyboard";
import { Result, TextType } from "@keybr/result";
import { Histogram } from "@keybr/textinput";

/**
 * Conversion of the persisted per-language keybr rows (`mtKeybrResults:*`,
 * owned by keybr/session.ts) into engine Result objects (audit L1).
 *
 * The stored payload is plain JSON written by this app - but it is also
 * restored verbatim from backup files, so malformed rows can exist. The
 * engine does not throw on bad histograms: it silently computes NaN
 * confidences and poisons the whole lesson. Every row is therefore
 * shape-validated and a rejected row is skipped instead of breaking the
 * boot; storage itself is left untouched (the skip is idempotent).
 */

export type StoredStats = {
  timeStamp: number;
  length: number;
  time: number;
  errors: number;
  histogram: {
    codePoint: number;
    hitCount: number;
    missCount: number;
    timeToType: number;
  }[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWellFormedStoredRow(row: unknown): row is StoredStats {
  if (typeof row !== "object" || row === null) return false;
  const it = row as Partial<StoredStats>;
  //timeStamp may be absent on very old rows: a fresh stamp is applied below
  if (it.timeStamp !== undefined && !isFiniteNumber(it.timeStamp)) return false;
  if (
    !isFiniteNumber(it.length) ||
    !isFiniteNumber(it.time) ||
    !isFiniteNumber(it.errors)
  ) {
    return false;
  }
  if (!Array.isArray(it.histogram)) return false;
  return it.histogram.every((sample) => {
    if (typeof sample !== "object" || sample === null) return false;
    const s = sample as Partial<StoredStats["histogram"][number]>;
    return (
      isFiniteNumber(s.codePoint) &&
      isFiniteNumber(s.hitCount) &&
      isFiniteNumber(s.missCount) &&
      isFiniteNumber(s.timeToType)
    );
  });
}

/** rebuilds engine results from persisted rows, skipping malformed ones */
export function storedRowsToResults(layout: Layout, rows: unknown[]): Result[] {
  const results: Result[] = [];
  for (const row of rows) {
    if (!isWellFormedStoredRow(row)) continue; //audit L1
    try {
      results.push(
        new Result(
          layout,
          //guided lessons produce GENERATED text upstream (LessonType.GUIDED);
          //the old session.ts passed a literal 0 - a type hole @ts-nocheck hid
          TextType.GENERATED,
          row.timeStamp ?? Date.now(),
          row.length,
          row.time,
          row.errors,
          new Histogram(row.histogram),
        ),
      );
    } catch {
      //defensive: one rejected row must not break the whole boot
      continue;
    }
  }
  return results;
}
