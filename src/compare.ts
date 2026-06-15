import { loadTask } from "./tasks";
import { runTrials } from "./runner";
import { aggregate, type Aggregate } from "./report";

// A per-agent rollup across all tasks. Metric math is delegated to aggregate();
// here we only average the already-aggregated per-(agent,task) rows.
export type AgentRollup = {
  agent: string;
  tasks: number; // how many tasks this agent ran
  meanPassAt1: number; // mean pass@1 across tasks (each task weighted equally)
  totalTrials: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  totalRegressions: number;
};

// One per (agent, task) pair. `taskKey` is the requested task dir name (used for the grid),
// which may differ from agg.taskId (the meta.json id) if a task renames itself.
export type CompareRow = { taskKey: string; agg: Aggregate };

export type CompareResult = {
  agents: string[];
  tasks: string[];
  grader: string;
  trials: number;
  rows: CompareRow[]; // one per (agent, task) pair
  rollups: AgentRollup[]; // one per agent, sorted by meanPassAt1 desc (tie: lower avgCost)
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export async function compareMatrix(opts: {
  agents: string[];
  tasks: string[];
  grader: string;
  trials: number;
  tasksDir: string;
}): Promise<CompareResult> {
  const { agents, tasks, grader, trials, tasksDir } = opts;

  const rows: CompareRow[] = [];
  for (const agent of agents) {
    for (const taskKey of tasks) {
      const task = loadTask(tasksDir, taskKey);
      const results = await runTrials(task, agent, grader, trials);
      rows.push({ taskKey, agg: aggregate(results) });
    }
  }

  const rollups: AgentRollup[] = agents.map((agent) => {
    const r = rows.filter((x) => x.agg.agent === agent).map((x) => x.agg);
    return {
      agent,
      tasks: r.length,
      meanPassAt1: mean(r.map((x) => x.passAt1)),
      totalTrials: sum(r.map((x) => x.trials)),
      avgInputTokens: mean(r.map((x) => x.avgInputTokens)),
      avgOutputTokens: mean(r.map((x) => x.avgOutputTokens)),
      avgCostUsd: mean(r.map((x) => x.avgCostUsd)),
      avgLatencyMs: mean(r.map((x) => x.avgLatencyMs)),
      totalRegressions: sum(r.map((x) => x.regressions)),
    };
  });

  rollups.sort((a, b) => b.meanPassAt1 - a.meanPassAt1 || a.avgCostUsd - b.avgCostUsd);

  return { agents, tasks, grader, trials, rows, rollups };
}

export function renderLeaderboard(result: CompareResult): string {
  const { tasks, grader, trials, rows, rollups } = result;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  const lines: string[] = [];
  lines.push(`# fixbench leaderboard`);
  lines.push(``);
  lines.push(`**grader** \`${grader}\` · **trials** ${trials} · **tasks** ${tasks.length} · **agents** ${rollups.length}`);
  lines.push(``);

  // Per-agent rollup table (sorted by mean pass@1 desc, tie-break lower avg cost).
  lines.push(`## Leaderboard (per-agent)`);
  lines.push(``);
  lines.push(
    `| rank | agent | mean pass@1 | tasks | trials | avg in tok | avg out tok | avg cost (USD) | avg latency (ms) | regressions |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
  rollups.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | \`${r.agent}\` | ${pct(r.meanPassAt1)} | ${r.tasks} | ${r.totalTrials} | ` +
        `${r.avgInputTokens.toFixed(0)} | ${r.avgOutputTokens.toFixed(0)} | ${r.avgCostUsd.toFixed(4)} | ` +
        `${r.avgLatencyMs.toFixed(0)} | ${r.totalRegressions} |`,
    );
  });
  lines.push(``);

  // Per-(agent × task) pass@1 grid. Agents are rows (in rollup/leaderboard order), tasks are columns.
  lines.push(`## pass@1 grid (agent × task)`);
  lines.push(``);
  lines.push(`| agent \\ task | ${tasks.join(" | ")} |`);
  lines.push(`|${"---|".repeat(tasks.length + 1)}`);
  for (const roll of rollups) {
    const cells = tasks.map((t) => {
      const row = rows.find((x) => x.agg.agent === roll.agent && x.taskKey === t);
      return row ? pct(row.agg.passAt1) : "—";
    });
    lines.push(`| \`${roll.agent}\` | ${cells.join(" | ")} |`);
  }
  lines.push(``);

  return lines.join("\n");
}
