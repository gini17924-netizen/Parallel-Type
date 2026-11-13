/*
 * The stats HTML export (phase 72): ONE self-contained file — inline CSS,
 * inline SVG charts, no scripts, no external URLs — the whole point is a
 * file the user can keep, mail, or open years later offline. The builder
 * is pure; the file assembly (snapshot + local results → download) lives
 * next to it.
 */
import { loadLocalResults } from "./local-persistence";
import { getSnapshot } from "../states/snapshot";
import { download } from "./misc";

export type StatsExportPbRow = {
  wpm: number;
  acc: number;
  raw?: number;
  timestamp?: number;
  language?: string;
};

export type StatsExportResult = {
  wpm: number;
  acc: number;
  mode: string;
  mode2: string;
  language: string;
  timestamp: number;
};

export type StatsExportData = {
  name: string;
  generatedAt: number;
  typingStats: {
    timeTyping: number;
    startedTests: number;
    completedTests: number;
  };
  xp: number;
  streak: number;
  maxStreak: number;
  personalBests: Record<string, Record<string, StatsExportPbRow[]>>;
  results: StatsExportResult[];
};

/** the chart draws the most recent results, oldest first */
const CHART_RESULT_CAP = 100;
/** the recent-results table on the report */
const TABLE_RESULT_CAP = 20;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** the wpm/accuracy polylines over the most recent results, oldest first;
 * undefined when there are fewer than two points to draw */
export function buildTrendChart(
  results: StatsExportResult[],
): string | undefined {
  const recent = results
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-CHART_RESULT_CAP);
  if (recent.length < 2) return undefined;

  const width = 640;
  const height = 220;
  const pad = 28;
  const maxWpm = Math.max(...recent.map((r) => r.wpm), 1);
  const maxAcc = 100;
  const stepX = (width - pad * 2) / (recent.length - 1);
  const point = (value: number, max: number, index: number): string => {
    const x = pad + index * stepX;
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const wpmPoints = recent
    .map((r, i) => point(r.wpm, maxWpm, i))
    .join(" ");
  const accPoints = recent.map((r, i) => point(r.acc, maxAcc, i)).join(" ");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="wpm and accuracy trend">
<polyline fill="none" stroke="#e2b714" stroke-width="2" points="${wpmPoints}" />
<polyline fill="none" stroke="#6c7086" stroke-width="1.5" stroke-dasharray="4 3" points="${accPoints}" />
<text x="${pad}" y="16" fill="#e2b714" font-size="12">wpm (peak ${Math.round(maxWpm)})</text>
<text x="${pad}" y="${height - 8}" fill="#6c7086" font-size="12">accuracy (scaled to 100)</text>
</svg>`;
}

/** PB rows flattened across modes, strongest first */
function flattenPersonalBests(
  personalBests: StatsExportData["personalBests"],
): { mode: string; mode2: string; row: StatsExportPbRow }[] {
  const rows: { mode: string; mode2: string; row: StatsExportPbRow }[] = [];
  for (const mode of Object.keys(personalBests).sort()) {
    const bucket = personalBests[mode] ?? {};
    for (const mode2 of Object.keys(bucket).sort()) {
      for (const row of bucket[mode2] ?? []) {
        rows.push({ mode, mode2, row });
      }
    }
  }
  return rows.sort((a, b) => b.row.wpm - a.row.wpm);
}

const STYLE = `
body { background: #323437; color: #d1d0c5; font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 32px; }
h1 { color: #e2b714; font-size: 28px; margin: 0 0 4px; }
h2 { color: #e2b714; font-size: 18px; margin: 28px 0 10px; }
p.sub { color: #6c7086; margin: 0 0 20px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.card { background: #2c2e31; border-radius: 8px; padding: 14px; }
.card .v { font-size: 22px; font-weight: 700; color: #d1d0c5; }
.card .k { font-size: 12px; color: #6c7086; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #2c2e31; }
th { color: #6c7086; font-weight: 600; }
.chart { background: #2c2e31; border-radius: 8px; padding: 12px; }
footer { margin-top: 32px; color: #6c7086; font-size: 12px; }
a { color: #e2b714; }
`;

export function buildStatsExportHtml(data: StatsExportData): string {
  const name = escapeHtml(data.name === "" ? "offline user" : data.name);
  const chart = buildTrendChart(data.results);
  const pbRows = flattenPersonalBests(data.personalBests);
  const recent = data.results
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, TABLE_RESULT_CAP);

  const pbTable = pbRows
    .map(
      ({ mode, mode2, row }) =>
        `<tr><td>${escapeHtml(mode)}</td><td>${escapeHtml(mode2)}</td><td>${escapeHtml(
          row.language ?? "",
        )}</td><td>${row.wpm}</td><td>${row.acc}%</td><td>${
          row.raw ?? ""
        }</td><td>${row.timestamp === undefined ? "" : formatDate(row.timestamp)}</td></tr>`,
    )
    .join("\n");

  const recentRows = recent
    .map(
      (r) =>
        `<tr><td>${formatDate(r.timestamp)}</td><td>${escapeHtml(
          r.mode,
        )}/${escapeHtml(r.mode2)}</td><td>${escapeHtml(
          r.language,
        )}</td><td>${r.wpm}</td><td>${r.acc}%</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ParallelType stats — ${name}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>ParallelType stats</h1>
<p class="sub">for ${name} — generated ${formatDate(data.generatedAt)} · a single self-contained file, no scripts, no network</p>

<h2>summary</h2>
<div class="cards">
<div class="card"><div class="v">${formatDuration(data.typingStats.timeTyping)}</div><div class="k">time typed</div></div>
<div class="card"><div class="v">${data.typingStats.completedTests}</div><div class="k">completed tests</div></div>
<div class="card"><div class="v">${data.typingStats.startedTests}</div><div class="k">started tests</div></div>
<div class="card"><div class="v">${data.xp}</div><div class="k">xp</div></div>
<div class="card"><div class="v">${data.streak} / ${data.maxStreak}</div><div class="k">streak / max</div></div>
<div class="card"><div class="v">${pbRows.length}</div><div class="k">personal bests</div></div>
</div>

<h2>wpm &amp; accuracy trend</h2>
<div class="chart">${
    chart ?? "<p class=\"sub\">not enough results to draw a trend yet</p>"
  }</div>

<h2>personal bests (${pbRows.length})</h2>
<table>
<tr><th>mode</th><th>mode2</th><th>language</th><th>wpm</th><th>acc</th><th>raw</th><th>date</th></tr>
${pbTable}
</table>

<h2>recent results (${recent.length})</h2>
<table>
<tr><th>date</th><th>mode</th><th>language</th><th>wpm</th><th>acc</th></tr>
${recentRows}
</table>

<footer>exported from the ParallelType desktop app (phase 72) — everything in this file is local data; it never left your machine.</footer>
</body>
</html>
`;
}

/** assembles the export from the live snapshot + local results and
 * downloads it — the AccountPage button's entry point */
export async function exportStatsHtmlFile(): Promise<void> {
  const snapshot = getSnapshot();
  if (snapshot === undefined) {
    throw new Error("stats export: no snapshot available");
  }
  const results = await loadLocalResults();
  const data: StatsExportData = {
    name: snapshot.name,
    generatedAt: Date.now(),
    typingStats: snapshot.typingStats,
    xp: snapshot.xp,
    streak: snapshot.streak,
    maxStreak: snapshot.maxStreak,
    personalBests: snapshot.personalBests,
    results: results.map((result) => ({
      wpm: result.wpm,
      acc: result.acc,
      mode: result.mode,
      mode2: result.mode2,
      language: result.language,
      timestamp: result.timestamp,
    })),
  };
  const stamp = formatDate(data.generatedAt);
  download({
    filename: `paralleltype-stats-${stamp}.html`,
    data: new Blob([buildStatsExportHtml(data)], { type: "text/html" }),
  });
}
