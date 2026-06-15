import { runTest } from "../testRunner";
import type { Grader, Score, TrialContext } from "../types";

// Objective grading: the agent doesn't get to *say* it fixed the bug — we run the tests.
// success = target test passes AND no guard test regressed.
export const deterministic: Grader = {
  name: "deterministic",
  async grade(ctx: TrialContext): Promise<Score> {
    const target = await runTest(ctx.repoDir, ctx.task.targetTest);

    const failedGuards: string[] = [];
    for (const g of ctx.task.guardTests) {
      const r = await runTest(ctx.repoDir, g);
      if (!r.passed) failedGuards.push(g);
    }
    const regressed = failedGuards.length > 0;
    const passed = target.passed && !regressed;

    return {
      passed,
      targetPassed: target.passed,
      regressed,
      score: passed ? 1 : 0,
      rationale: passed
        ? "target passed; no regression"
        : `target ${target.passed ? "passed" : "FAILED"}; ${
            regressed ? `regression in ${failedGuards.join(", ")}` : "no regression"
          }`,
    };
  },
};
