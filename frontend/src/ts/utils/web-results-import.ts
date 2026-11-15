import type { SnapshotResult } from "../constants/default-snapshot";
import type { Mode } from "@monkeytype/schemas/shared";
import {
  appendLocalResult,
  loadLocalResults,
  makeLocalResultId,
} from "./local-persistence";
import { download } from "./misc";

/**
 * phase 109: the web-results bridge — import the MONKEYTYPE WEB export
 * (the account page's JSON download: an array of results) into the local
 * offline store, and export the local results as a single-file HTML
 * report (the self-contained, no-server rule). BOTH directions are pure
 * over the wire shapes: the importer sanitizes every field and refuses
 * nothing silently — unknown rows are skipped and counted, so a partial
 * or hostile file imports what it can and reports the rest.
 */

export type WebResultRow = {
  timestamp: number;
  mode: string;
  mode2: string;
  wpm: number;
  acc: number;
  rawWpm?: number;
  consistency?: number;
};

export type ImportOutcome = {
  imported: number;
  skipped: number;
};

/** PURE: parse an untrusted payload (the web export file's parsed JSON)
 * into local-ready rows. the accepted shape: an ARRAY of objects, each
 * with a finite positive timestamp and finite wpm/acc — monkeytype web
 * exports carry those per row. unknown rows are skipped (counted). */
export function parseWebResults(payload: unknown): {
  rows: SnapshotResult<"time">[];
  skipped: number;
} {
  const rows: SnapshotResult<"time">[] = [];
  let skipped = 0;
  if (!Array.isArray(payload)) return { rows, skipped: 1 };
  for (const raw of payload) {
    if (typeof raw !== "object" || raw === null) {
      skipped++;
      continue;
    }
    const row = raw as Record<string, unknown>;
    const timestamp = row["timestamp"];
    const wpm = row["wpm"];
    const acc = row["acc"];
    const mode = row["mode"];
    const mode2 = row["mode2"];
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      typeof wpm !== "number" ||
      !Number.isFinite(wpm) ||
      typeof acc !== "number" ||
      !Number.isFinite(acc) ||
      typeof mode !== "string" ||
      typeof mode2 !== "string"
    ) {
      skipped++;
      continue;
    }
    const rawWpm = row["rawWpm"];
    const consistency = row["consistency"];
    rows.push({
      _id: makeLocalResultId(),
      timestamp,
      mode: mode as Mode,
      mode2,
      wpm,
      acc,
      ...(typeof rawWpm === "number" ? { rawWpm } : {}),
      ...(typeof consistency === "number" ? { consistency } : {}),
    } as unknown as SnapshotResult<"time">);
  }
  return { rows, skipped };
}

/** PURE: de-duplicate against the ALREADY-IMPORTED timestamps (a friend
 * re-shares the same export; the same web result must not double-import) */
export function dedupeAgainst(
  rows: SnapshotResult<"time">[],
  existingTimestamps: number[],
): { rows: SnapshotResult<"time">[]; duplicates: number } {
  const seen = new Set(existingTimestamps.filter((ts) => ts > 0));
  const kept: SnapshotResult<"time">[] = [];
  let duplicates = 0;
  for (const row of rows) {
    if (seen.has(row.timestamp)) {
      duplicates++;
      continue;
    }
    seen.add(row.timestamp);
    kept.push(row);
  }
  return { rows: kept, duplicates };
}

/** the self-contained HTML report (the no-server rule): the local
 * results' weekly aggregates and the personal bests rendered as a static
 * table — PURE, returns the html string */
export function buildResultsHtmlReport(rows: SnapshotResult<Mode>[]): string {
  const sorted = [...rows].sort((a, b) => b.timestamp - a.timestamp);
  const bestWpm = Math.max(0, ...sorted.map((r) => r.wpm));
  const bestAcc = Math.max(0, ...sorted.map((r) => r.acc));
  const escape = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const tableRows = sorted
    .slice(0, 200)
    .map(
      (row) =>
        `<tr><td>${new Date(row.timestamp).toISOString().slice(0, 10)}</td><td>${escape(row.mode)}</td><td>${escape(row.mode2 ?? "")}</td><td>${row.wpm}</td><td>${row.acc}%</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ParallelType results report</title>
<style>body{font-family:monospace;background:#323437;color:#d1d0c5;margin:2rem}
h1{color:#e2b714}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #646669;padding:0.4rem 0.8rem;text-align:left}
th{background:#2c2e31}.big{font-size:1.6rem;color:#e2b714}</style></head>
<body><h1>ParallelType results report</h1>
<p><span class="big">${sorted.length}</span> results &nbsp; best wpm <span class="big">${bestWpm}</span> &nbsp; best acc <span class="big">${bestAcc}%</span></p>
<table><tr><th>date</th><th>mode</th><th>mode2</th><th>wpm</th><th>acc</th></tr>${tableRows}</table>
<p style="color:#646669">generated offline by ParallelType — no server involved</p>
</body></html>`;
}

/** the orchestration the account page's button calls: parse the payload,
 * de-duplicate against the STORE's timestamps, append every new row and
 * return the outcome for the notification */
export async function importWebResults(payload: unknown): Promise<{
  imported: number;
  skipped: number;
  duplicates: number;
}> {
  const parsed = parseWebResults(payload);
  const existing = (await loadLocalResults()).map((r) => r.timestamp);
  const deduped = dedupeAgainst(parsed.rows, existing);
  for (const row of deduped.rows) {
    await appendLocalResult(row);
  }
  return {
    imported: deduped.rows.length,
    skipped: parsed.skipped,
    duplicates: deduped.duplicates,
  };
}

/** downloads the report file (the share flow) */
export function downloadResultsHtmlReport(rows: SnapshotResult<Mode>[]): void {
  download({
    filename: `paralleltype-report-${new Date().toISOString().slice(0, 10)}.html`,
    data: new Blob([buildResultsHtmlReport(rows)], {
      type: "text/html",
    }),
  });
}
