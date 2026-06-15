import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTask } from "./tasks";
import { runTrials } from "./runner";
import { aggregate, writeReports } from "./report";
import { AGENTS } from "./agents";
import { compareMatrix, renderLeaderboard } from "./compare";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tasksDir = join(root, "tasks");

function arg(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}

function listTaskIds(): string[] {
  return readdirSync(tasksDir)
    .filter((name) => !name.startsWith(".") && statSync(join(tasksDir, name)).isDirectory())
    .sort();
}

const cmd = process.argv[2];

if (cmd === "compare") {
  const agents = (arg("--agents") ?? Object.keys(AGENTS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const tasks = (arg("--tasks") ?? listTaskIds().join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const grader = arg("--grader", "deterministic")!;
  const trials = Number(arg("--trials", "1"));

  console.log(`▶ compare agents=[${agents.join(",")}] tasks=${tasks.length} grader=${grader} trials=${trials}`);

  const result = await compareMatrix({ agents, tasks, grader, trials, tasksDir });
  const md = renderLeaderboard(result);
  writeFileSync(join(root, "compare.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(root, "leaderboard.md"), md);

  console.log(`\n🏆 leaderboard (mean pass@1):`);
  for (const r of result.rollups) {
    console.log(`  ${(r.meanPassAt1 * 100).toFixed(0).padStart(3)}%  ${r.agent}`);
  }
  console.log(`\n📄 compare.json / leaderboard.md → ${root}`);
  process.exit(0);
}

if (cmd !== "run") {
  console.log("usage:");
  console.log("  fixbench run --task <id> --agent <name> --grader <name> [--trials N]");
  console.log("  fixbench compare [--agents a,b,c] [--tasks t1,t2] [--grader <name>] [--trials N]");
  process.exit(cmd ? 1 : 0);
}

const taskId = arg("--task");
const agentName = arg("--agent", "noop")!;
const graderName = arg("--grader", "deterministic")!;
const trials = Number(arg("--trials", "1"));
if (!taskId) {
  console.error("missing --task");
  process.exit(1);
}

const task = loadTask(tasksDir, taskId);
console.log(`▶ task=${task.id} agent=${agentName} grader=${graderName} trials=${trials}`);

const results = await runTrials(task, agentName, graderName, trials);
const agg = aggregate(results);
writeReports(results, agg, root);

console.log(
  `\npass@1=${(agg.passAt1 * 100).toFixed(0)}%  pass@k=${agg.passAtK ? "✅" : "❌"}  ` +
    `regressions=${agg.regressions}  avgCost=$${agg.avgCostUsd.toFixed(4)}  avgLatency=${agg.avgLatencyMs.toFixed(0)}ms  ` +
    `avgTools=${agg.avgToolCalls.toFixed(1)}`,
);
for (const r of results) {
  console.log(
    `  trial ${r.trial}: ${r.score.passed ? "✅ PASS" : "❌ FAIL"} — ${r.score.rationale}` +
      (r.error ? ` [err: ${r.error}]` : ""),
  );
}
console.log(`\n📄 report.json / report.md → ${root}`);
