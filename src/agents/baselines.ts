import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zeroUsage, type Agent } from "../types";

// Lower bound: does nothing. The target test should stay FAILING.
export const noop: Agent = {
  name: "noop",
  async solve() {
    return { usage: zeroUsage(), notes: "no-op" };
  },
};

// Upper bound: applies the task's known-good solution (tasks/<id>/.solution/**).
// Useful as a sanity ceiling — if oracle can't make a task pass, the task itself is broken.
export const oracle: Agent = {
  name: "oracle",
  async solve(ctx) {
    const sol = join(ctx.task.dir, ".solution");
    if (!existsSync(sol)) return { usage: zeroUsage(), notes: "no .solution; no-op" };
    cpSync(sol, ctx.repoDir, { recursive: true });
    return { usage: zeroUsage(), notes: "applied known-good solution" };
  },
};
