import type { Grader } from "../types";
import { deterministic } from "./deterministic";
import { llmJudge } from "./llm-judge";

// Day 2: `llm-judge` grader (Tech③) — score answer quality on
// accuracy / grounding / hallucination, and calibrate the judge against deterministic ground truth.
export const GRADERS: Record<string, Grader> = {
  deterministic,
  "llm-judge": llmJudge,
};
