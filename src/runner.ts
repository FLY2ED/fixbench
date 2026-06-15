import { isolate, cleanup } from "./isolate";
import { AGENTS } from "./agents";
import { GRADERS } from "./graders";
import { zeroUsage, type Task, type TrialResult } from "./types";

export async function runTrials(
  task: Task,
  agentName: string,
  graderName: string,
  trials: number,
): Promise<TrialResult[]> {
  const agent = AGENTS[agentName];
  const grader = GRADERS[graderName];
  if (!agent) throw new Error(`unknown agent: ${agentName} (have: ${Object.keys(AGENTS).join(", ")})`);
  if (!grader) throw new Error(`unknown grader: ${graderName} (have: ${Object.keys(GRADERS).join(", ")})`);

  const results: TrialResult[] = [];
  for (let trial = 1; trial <= trials; trial++) {
    const ctx = isolate(task, trial);
    try {
      const ar = await agent.solve(ctx);
      const score = await grader.grade(ctx);
      results.push({ taskId: task.id, agent: agentName, grader: graderName, trial, score, usage: ar.usage });
    } catch (e) {
      results.push({
        taskId: task.id,
        agent: agentName,
        grader: graderName,
        trial,
        score: { passed: false, targetPassed: false, regressed: false, score: 0, rationale: "error" },
        usage: zeroUsage(),
        error: String(e),
      });
    } finally {
      cleanup(ctx);
    }
  }
  return results;
}
