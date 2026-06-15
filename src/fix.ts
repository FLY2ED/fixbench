import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTask } from "./tasks";
import { isolate, cleanup } from "./isolate";
import { AGENTS } from "./agents";
import { GRADERS } from "./graders";
import type { Usage } from "./types";

// Auto-fix bot entry (Tech② "자동 수정 봇").
//
// Unlike cli.ts (which aggregates metrics across trials and throws away each
// isolated copy), this entry runs ONE trial, KEEPS the edited copy long enough
// to diff it, and emits a reviewable PATCH. It never touches the task fixtures:
// the agent only ever edits the throwaway temp copy produced by isolate().
//
//   npx tsx src/fix.ts --task <id> --agent <name> [--grader deterministic]
//
// Outputs (to project root):
//   - proposed-fix.diff  : unified diff of the task's allowedFiles
//   - fix-result.json    : { taskId, agent, passed, targetPassed, regressed, usage }
//
// The diff is the proposed change for a HUMAN to review. This entry NEVER
// applies it back to the fixtures and the workflow that wraps it NEVER
// auto-merges — it opens a DRAFT PR only.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tasksDir = join(root, "tasks");

function arg(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}

const taskId = arg("--task");
const agentName = arg("--agent", "self-loop")!;
const graderName = arg("--grader", "deterministic")!;
if (!taskId) {
  console.error("usage: npx tsx src/fix.ts --task <id> --agent <name> [--grader deterministic]");
  process.exit(1);
}

const agent = AGENTS[agentName];
const grader = GRADERS[graderName];
if (!agent) {
  console.error(`unknown agent: ${agentName} (have: ${Object.keys(AGENTS).join(", ")})`);
  process.exit(1);
}
if (!grader) {
  console.error(`unknown grader: ${graderName} (have: ${Object.keys(GRADERS).join(", ")})`);
  process.exit(1);
}

const task = loadTask(tasksDir, taskId);
console.log(`▶ fix task=${task.id} agent=${agentName} grader=${graderName}`);

// `git diff --no-index <orig> <edited>` produces a unified diff of two files
// without needing a git repo. NOTE: it EXITS 1 when the files differ (that's a
// success-with-diff, not an error) and 0 when identical. Any other code is a
// real failure. We rewrite the in-temp paths to the in-repo path so the patch
// reads as a normal `a/<file>` → `b/<file>` change a reviewer can `git apply`.
function diffFile(origAbs: string, editedAbs: string, relPath: string): string {
  const r = spawnSync("git", ["diff", "--no-index", "--", origAbs, editedAbs], { encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git diff --no-index failed (status=${r.status}): ${r.stderr || r.stdout}`);
  }
  if (r.status === 0 || !r.stdout) return ""; // identical → no hunk for this file
  // Normalise the temp-dir paths to a/<rel> and b/<rel> for a clean reviewable patch.
  return r.stdout
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git ")) return `diff --git a/${relPath} b/${relPath}`;
      if (line.startsWith("--- ")) return `--- a/${relPath}`;
      if (line.startsWith("+++ ")) return `+++ b/${relPath}`;
      return line;
    })
    .join("\n");
}

// Run a single trial: isolate → solve → grade → diff. We intentionally do NOT
// reuse runner.runTrials here because it cleans up the temp copy in `finally`,
// and we need the edited copy to survive long enough to diff it.
type FixResult = {
  taskId: string;
  agent: string;
  passed: boolean;
  targetPassed: boolean;
  regressed: boolean;
  usage: Usage;
};

const ctx = isolate(task, 1);
let diff = "";
let result: FixResult;
try {
  const ar = await agent.solve(ctx);
  const score = await grader.grade(ctx);

  // Diff each allowed file: task source (original) vs edited temp copy.
  const hunks: string[] = [];
  for (const rel of task.allowedFiles) {
    const origAbs = resolve(task.dir, rel);
    const editedAbs = resolve(ctx.repoDir, rel);
    if (!existsSync(origAbs) || !existsSync(editedAbs)) continue;
    const h = diffFile(origAbs, editedAbs, rel);
    if (h.trim()) hunks.push(h.replace(/\n+$/, ""));
  }
  diff = hunks.length ? hunks.join("\n") + "\n" : "";

  result = {
    taskId: task.id,
    agent: agentName,
    passed: score.passed,
    targetPassed: score.targetPassed,
    regressed: score.regressed,
    usage: ar.usage,
  };
} finally {
  // Always discard the temp copy — the fixtures are never modified, only this copy.
  cleanup(ctx);
}

writeFileSync(join(root, "proposed-fix.diff"), diff);
writeFileSync(join(root, "fix-result.json"), JSON.stringify(result, null, 2) + "\n");

const verdict = result.passed ? "✅ PASS" : "❌ FAIL";
console.log(
  `${verdict}  task=${result.taskId} agent=${result.agent}  ` +
    `target=${result.targetPassed ? "green" : "red"} regressed=${result.regressed}  ` +
    `diffBytes=${Buffer.byteLength(diff)}  ` +
    `cost=$${result.usage.costUsd.toFixed(4)} tools=${result.usage.toolCalls} latency=${result.usage.latencyMs}ms`,
);
console.log(`📄 proposed-fix.diff / fix-result.json → ${root}`);

// Non-zero exit only on a genuine harness error (handled above by throwing).
// A FAIL result is still a successful RUN — the workflow's own guard decides
// whether to open a PR (it only does so when passed==true).
