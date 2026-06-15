import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import type { Grader, Score, TrialContext } from "../types";

// LLM-as-a-judge grader (Tech③).
//
// This grader asks an LLM to *read the proposed fix and reason about whether it solves the
// task* — without executing the tests. It is the subjective counterpart to the `deterministic`
// grader, which runs the real vitest suite and is therefore ground truth.
//
// WHY KEEP BOTH — CALIBRATION:
//   An LLM judge is only trustworthy once it has been CALIBRATED against ground truth. Because
//   fixbench already ships the `deterministic` grader (which runs the actual target/guard tests),
//   you can grade the SAME trials with both graders and measure the judge's AGREEMENT RATE:
//       agreement = mean( llmJudge.passed === deterministic.passed )
//   plus the usual confusion-matrix terms (false-pass = judge says PASS but tests FAIL — the
//   dangerous direction; false-fail = judge says FAIL but tests PASS). This file does NOT
//   implement that harness; it just produces a judged Score in the same shape so the comparison
//   is a straightforward diff over TrialResults.
//
// HONESTY: this judge can be wrong. It never runs code, so it cannot detect runtime errors,
// flaky behavior, or regressions that only surface under execution. It does NOT replace the
// deterministic grader — it is a cheaper, fuzzier signal whose error rate must be quantified
// before it is trusted for anything.

// The judge is forced to answer in this exact structured shape (see tool_choice below).
type Verdict = {
  passed: boolean;
  score: number; // 0..1
  grounded: boolean; // did the judge's reasoning stay anchored to the shown code?
  hallucinationRisk: "low" | "med" | "high";
  rationale: string;
};

// A single tool whose input_schema IS our verdict schema. We force the model to call it
// (tool_choice below), which turns "free-form prose" into a typed, parseable object.
const VERDICT_TOOL = {
  name: "submit_verdict",
  description: "Submit your judgement of whether the code change correctly solves the task.",
  input_schema: {
    type: "object",
    properties: {
      passed: { type: "boolean", description: "Does the fix correctly solve the task?" },
      score: { type: "number", description: "Confidence/quality from 0 (wrong) to 1 (clearly correct)." },
      grounded: {
        type: "boolean",
        description: "Is the rationale grounded in the actual code shown, not assumptions?",
      },
      hallucinationRisk: {
        type: "string",
        enum: ["low", "med", "high"],
        description: "Risk that this verdict relies on facts not present in the shown code.",
      },
      rationale: { type: "string", description: "Brief justification referencing the shown code." },
    },
    required: ["passed", "score", "grounded", "hallucinationRisk", "rationale"],
  },
} as const;

function readMaybe(repoDir: string, rel: string): string {
  try {
    return readFileSync(join(repoDir, rel), "utf8");
  } catch (e) {
    return `<<could not read ${rel}: ${String(e)}>>`;
  }
}

export const llmJudge: Grader = {
  name: "llm-judge",
  async grade(ctx: TrialContext): Promise<Score> {
    const { repoDir, task } = ctx;
    const client = new Anthropic({ apiKey: config.apiKey });

    // The judge sees: the task statement, the CURRENT contents of each editable file (i.e. the
    // agent's fix), and the target test it should satisfy. It never sees the .solution — and it
    // can't, because isolate.ts excludes .solution from repoDir.
    const editedFiles = task.allowedFiles
      .map((f) => `--- FILE: ${f} ---\n${readMaybe(repoDir, f)}`)
      .join("\n\n");
    const targetTest = `--- TARGET TEST: ${task.targetTest} ---\n${readMaybe(repoDir, task.targetTest)}`;

    const system = [
      "You are a strict code reviewer acting as an LLM-as-a-judge.",
      "Decide whether the CURRENT code would make the target test pass and would not obviously break.",
      "You cannot run the tests — reason from the code only. If the code does not clearly solve the",
      "task, return passed=false. Prefer false over an ungrounded guess. Ground every claim in the",
      "code shown; if you find yourself assuming unshown behavior, lower `grounded` and raise",
      "`hallucinationRisk`. You MUST answer by calling the submit_verdict tool.",
    ].join("\n");

    const userContent = [
      `TASK: ${task.title}`,
      "",
      "PROBLEM STATEMENT:",
      task.problemStatement,
      "",
      "PROPOSED FIX (current contents of editable files):",
      editedFiles,
      "",
      "TARGET TEST the fix must satisfy:",
      targetTest,
    ].join("\n");

    const res = await client.messages.create({
      model: config.judgeModel,
      max_tokens: 1024,
      system,
      tools: [VERDICT_TOOL] as any,
      // FORCED STRUCTURED OUTPUT — the key technique:
      // tool_choice { type: "tool", name } compels the model to emit exactly one tool_use block
      // whose `input` conforms to VERDICT_TOOL.input_schema. No prose-parsing, no JSON-in-text
      // brittleness — we read a typed object straight off the block.
      tool_choice: { type: "tool", name: VERDICT_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    });

    // Extract the forced tool_use block and treat its input as the verdict.
    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      // Should not happen with forced tool_choice, but fail honestly rather than fake a PASS.
      return {
        passed: false,
        targetPassed: false,
        regressed: false,
        score: 0,
        rationale: "llm-judge: model did not return a structured verdict (no tool_use block).",
      };
    }
    const v = toolUse.input as Verdict;

    // Clamp the score defensively — the model is asked for 0..1 but we don't trust it blindly.
    const score = Math.max(0, Math.min(1, Number(v.score)));
    const tokens = `${res.usage.input_tokens}in/${res.usage.output_tokens}out`;

    // Map the judge's verdict onto our Score shape. NOTE: this is a JUDGED verdict, not an
    // EXECUTED one — no tests were run. `targetPassed` mirrors `passed`, and `regressed` is
    // always false because a non-executing judge cannot observe a real regression.
    return {
      passed: Boolean(v.passed),
      targetPassed: Boolean(v.passed),
      regressed: false,
      score,
      rationale: `[llm-judge ${config.judgeModel}, ${tokens}; JUDGED not executed] ${v.rationale} (grounded=${v.grounded}, hallucinationRisk=${v.hallucinationRisk})`,
    };
  },
};
