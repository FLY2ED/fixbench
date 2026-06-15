// fixbench leaderboard — Cloudflare module Worker (ES modules).
// Renders a committed compare.json snapshot as a self-contained, dependency-free HTML page.
// Workers have no local filesystem, so the data is imported as a JSON module at build time.
import data from "../public/leaderboard-data.json";

/** Shape of a single per-agent rollup row in compare.json. */
interface Rollup {
  agent: string;
  tasks: number;
  meanPassAt1: number;
  totalTrials: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  totalRegressions: number;
}

/** Per-(agent,task) aggregate carried inside each compare.json row. */
interface RowAgg {
  taskId: string;
  agent: string;
  passAt1: number;
  passAtK: boolean;
  regressions: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  avgToolCalls: number;
}

interface Compare {
  agents: string[];
  tasks: string[];
  grader: string;
  trials: number;
  rows: { taskKey: string; agg: RowAgg }[];
  rollups: Rollup[];
}

const compare = data as unknown as Compare;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const tok = (n: number): string => (n ? Math.round(n).toLocaleString("en-US") : "0");
const usd = (n: number): string => `$${n.toFixed(4)}`;
const ms = (n: number): string => `${Math.round(n)} ms`;

/** Build a lookup of pass@1 by `${agent}__${task}` from compare.rows. */
function passLookup(c: Compare): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of c.rows) m.set(`${r.agg.agent}__${r.agg.taskId}`, r.agg.passAt1);
  return m;
}

function rollupRows(c: Compare): string {
  // Sort by mean pass@1 desc; rank assigned after sort.
  const sorted = [...c.rollups].sort((a, b) => b.meanPassAt1 - a.meanPassAt1);
  return sorted
    .map((r, i) => {
      const top = r.meanPassAt1 >= 1 ? ' class="best"' : "";
      return `<tr>
  <td class="rank">${i + 1}</td>
  <td class="agent"><code>${esc(r.agent)}</code></td>
  <td${top}>${pct(r.meanPassAt1)}</td>
  <td class="num">${tok(r.avgInputTokens + r.avgOutputTokens)}</td>
  <td class="num">${usd(r.avgCostUsd)}</td>
  <td class="num">${ms(r.avgLatencyMs)}</td>
  <td class="num">${r.totalRegressions}</td>
</tr>`;
    })
    .join("\n");
}

function gridRows(c: Compare): string {
  const lk = passLookup(c);
  // Order agents by rollup pass@1 desc so the grid matches the leaderboard order.
  const order = [...c.rollups]
    .sort((a, b) => b.meanPassAt1 - a.meanPassAt1)
    .map((r) => r.agent);
  return order
    .map((agent) => {
      const cells = c.tasks
        .map((t) => {
          const v = lk.get(`${agent}__${t}`) ?? 0;
          const cls = v >= 1 ? "pass" : v <= 0 ? "fail" : "partial";
          return `<td class="cell ${cls}">${pct(v)}</td>`;
        })
        .join("");
      return `<tr><td class="agent"><code>${esc(agent)}</code></td>${cells}</tr>`;
    })
    .join("\n");
}

function gridHeader(c: Compare): string {
  return c.tasks.map((t) => `<th class="task">${esc(t)}</th>`).join("");
}

function renderHtml(c: Compare): string {
  const updated = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>fixbench leaderboard</title>
<meta name="description" content="fixbench — a self-curated micro-benchmark for AI coding agents." />
<style>
  :root {
    --bg: #0e1116;
    --panel: #161b22;
    --border: #232a33;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
    --pass: #2ea043;
    --fail: #6e7681;
    --partial: #d29922;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 920px; margin: 0 auto; padding: 48px 20px 64px; }
  header h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; }
  header p.lede { color: var(--muted); margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
  .meta code { color: var(--accent); }
  section { margin-top: 40px; }
  h2 { font-size: 18px; margin: 0 0 14px; font-weight: 600; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow-x: auto;
  }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  thead th {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--muted); font-weight: 600; background: rgba(255,255,255,0.02);
  }
  tbody tr:last-child td { border-bottom: none; }
  td.rank { color: var(--muted); width: 1%; }
  td.num { text-align: right; }
  th.num { text-align: right; }
  code { font: 13px/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; color: var(--text); }
  td.best { color: var(--pass); font-weight: 600; }
  th.task { font-size: 11px; }
  td.cell { text-align: center; font-weight: 600; }
  td.cell.pass { color: var(--pass); }
  td.cell.fail { color: var(--fail); }
  td.cell.partial { color: var(--partial); }
  footer {
    margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--border);
    color: var(--muted); font-size: 12.5px;
  }
  footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>fixbench leaderboard</h1>
      <p class="lede">Mini AI coding-agent evaluation harness.</p>
      <p class="meta">grader <code>${esc(c.grader)}</code> &middot; trials ${c.trials} &middot; tasks ${c.tasks.length} &middot; agents ${c.agents.length} &middot; updated ${updated}</p>
    </header>

    <section>
      <h2>Leaderboard (per-agent)</h2>
      <div class="panel">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>agent</th>
              <th>mean pass@1</th>
              <th class="num">avg tokens</th>
              <th class="num">avg cost</th>
              <th class="num">avg latency</th>
              <th class="num">regressions</th>
            </tr>
          </thead>
          <tbody>
${rollupRows(c)}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>pass@1 grid (agent &times; task)</h2>
      <div class="panel">
        <table>
          <thead>
            <tr><th>agent \\ task</th>${gridHeader(c)}</tr>
          </thead>
          <tbody>
${gridRows(c)}
          </tbody>
        </table>
      </div>
    </section>

    <footer>
      Self-curated micro-benchmark; pricing estimated. Generated by <code>fixbench compare</code>; served from a committed snapshot on Cloudflare Workers.
    </footer>
  </div>
</body>
</html>`;
}

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);

    // Lightweight health/JSON endpoint; serves the raw snapshot.
    if (url.pathname === "/data.json") {
      return new Response(JSON.stringify(compare), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(renderHtml(compare), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  },
};
