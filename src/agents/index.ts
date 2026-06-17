import type { Agent } from "../types";
import { selfLoop } from "./self-loop";
import { noop, oracle } from "./baselines";
import { claudeCode } from "./claude-code";
import { codex } from "./codex";

export const AGENTS: Record<string, Agent> = {
  "self-loop": selfLoop,
  "claude-code": claudeCode,
  codex,
  noop,
  oracle,
};
