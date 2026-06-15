// Core contracts. Agents and Graders are both pluggable so we can compare them fairly —
// that pluggability IS the point of an eval harness.

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  toolCalls: number;
  latencyMs: number;
  costUsd: number;
};

export function zeroUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCalls: 0,
    latencyMs: 0,
    costUsd: 0,
  };
}

export type Task = {
  id: string;
  dir: string; // absolute path to the task source dir
  title: string;
  problemStatement: string;
  targetTest: string; // test file that should pass after the fix
  guardTests: string[]; // tests that must STAY green (regression guard)
  allowedFiles: string[]; // files the agent may edit (relative to repo)
};

export type TrialContext = {
  task: Task;
  repoDir: string; // isolated working copy the agent edits
};

export type AgentResult = {
  usage: Usage;
  notes?: string;
};

export interface Agent {
  name: string;
  /** Mutate files inside ctx.repoDir to (attempt to) fix the task. */
  solve(ctx: TrialContext): Promise<AgentResult>;
}

export type Score = {
  passed: boolean; // target green AND no regression
  targetPassed: boolean;
  regressed: boolean;
  score: number; // 0..1
  rationale: string;
};

export interface Grader {
  name: string;
  grade(ctx: TrialContext): Promise<Score>;
}

export type TrialResult = {
  taskId: string;
  agent: string;
  grader: string;
  trial: number;
  score: Score;
  usage: Usage;
  error?: string;
};
