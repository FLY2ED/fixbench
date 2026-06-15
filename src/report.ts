import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrialResult } from "./types";

export type Aggregate = {
  taskId: string;
  agent: string;
  grader: string;
  trials: number;
  passAt1: number; // mean pass rate across trials
  passAtK: boolean; // did ANY trial pass
  regressions: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  avgToolCalls: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function aggregate(results: TrialResult[]): Aggregate {
  const passes = results.filter((r) => r.score.passed).length;
  return {
    taskId: results[0]?.taskId ?? "",
    agent: results[0]?.agent ?? "",
    grader: results[0]?.grader ?? "",
    trials: results.length,
    passAt1: passes / (results.length || 1),
    passAtK: passes > 0,
    regressions: results.filter((r) => r.score.regressed).length,
    avgInputTokens: mean(results.map((r) => r.usage.inputTokens)),
    avgOutputTokens: mean(results.map((r) => r.usage.outputTokens)),
    avgCostUsd: mean(results.map((r) => r.usage.costUsd)),
    avgLatencyMs: mean(results.map((r) => r.usage.latencyMs)),
    avgToolCalls: mean(results.map((r) => r.usage.toolCalls)),
  };
}

export function writeReports(results: TrialResult[], agg: Aggregate, outDir: string): void {
  writeFileSync(join(outDir, "report.json"), JSON.stringify({ agg, results }, null, 2));
  const md = [
    `# fixbench report`,
    ``,
    `**task** \`${agg.taskId}\` · **agent** \`${agg.agent}\` · **grader** \`${agg.grader}\` · **trials** ${agg.trials}`,
    ``,
    `| metric | value |`,
    `|---|---|`,
    `| pass@1 | ${(agg.passAt1 * 100).toFixed(0)}% |`,
    `| pass@k | ${agg.passAtK ? "✅" : "❌"} |`,
    `| regressions | ${agg.regressions} |`,
    `| avg input tokens | ${agg.avgInputTokens.toFixed(0)} |`,
    `| avg output tokens | ${agg.avgOutputTokens.toFixed(0)} |`,
    `| avg cost (USD) | ${agg.avgCostUsd.toFixed(4)} |`,
    `| avg latency (ms) | ${agg.avgLatencyMs.toFixed(0)} |`,
    `| avg tool calls | ${agg.avgToolCalls.toFixed(1)} |`,
    ``,
  ].join("\n");
  writeFileSync(join(outDir, "report.md"), md);
}
