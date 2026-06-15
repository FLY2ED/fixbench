import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { config, estimateCost } from "../config";
import { runTest } from "../testRunner";
import { zeroUsage, type Agent, type AgentResult, type TrialContext } from "../types";

// Keep any path the model proposes inside the repo sandbox.
function safe(repoDir: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(repoDir, p);
  const rel = relative(repoDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes repo: ${p}`);
  return abs;
}

function listFiles(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root));
    else out.push(relative(root, full));
  }
  return out;
}

const TOOLS = [
  { name: "list_files", description: "List all files in the repo.", input_schema: { type: "object", properties: {} } },
  {
    name: "read_file",
    description: "Read a file's contents.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Overwrite a file with new content.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  { name: "run_tests", description: "Run the target test file and return its output.", input_schema: { type: "object", properties: {} } },
];

// A deliberately MINIMAL tool-use agent. Not a production agent — the point is to have a
// fully-instrumented baseline we can measure and compare other agents against.
export const selfLoop: Agent = {
  name: "self-loop",
  async solve(ctx: TrialContext): Promise<AgentResult> {
    const { repoDir, task } = ctx;
    const client = new Anthropic({ apiKey: config.apiKey });
    const usage = zeroUsage();
    const t0 = Date.now();

    const system = [
      "You are a minimal coding agent. Fix the bug so the target test passes.",
      `You may ONLY edit these files: ${task.allowedFiles.join(", ")}.`,
      "Never edit a test file. Use run_tests to verify. Stop once the target test passes.",
    ].join("\n");

    const messages: any[] = [{ role: "user", content: `Task: ${task.title}\n\n${task.problemStatement}` }];

    for (let step = 0; step < config.maxAgentSteps; step++) {
      const res = await client.messages.create({
        model: config.agentModel,
        max_tokens: 2048,
        system,
        tools: TOOLS as any,
        messages,
      });
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      usage.cacheReadTokens += res.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationTokens += res.usage.cache_creation_input_tokens ?? 0;

      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") break;

      const toolResults: any[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        usage.toolCalls++;
        const input = block.input as any;
        let result = "";
        try {
          if (block.name === "list_files") {
            result = listFiles(repoDir).join("\n");
          } else if (block.name === "read_file") {
            result = readFileSync(safe(repoDir, input.path), "utf8");
          } else if (block.name === "write_file") {
            const allowed = task.allowedFiles.some((f) => resolve(repoDir, f) === safe(repoDir, input.path));
            if (!allowed) {
              result = `ERROR: editing ${input.path} is not allowed. Allowed: ${task.allowedFiles.join(", ")}`;
            } else {
              writeFileSync(safe(repoDir, input.path), input.content, "utf8");
              result = `wrote ${input.path}`;
            }
          } else if (block.name === "run_tests") {
            const r = await runTest(repoDir, task.targetTest);
            result = `${r.passed ? "PASS" : "FAIL"}\n${r.output}`;
          } else {
            result = `unknown tool: ${block.name}`;
          }
        } catch (e) {
          result = `ERROR: ${String(e)}`;
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
    }

    usage.latencyMs = Date.now() - t0;
    usage.costUsd = estimateCost(config.agentModel, usage.inputTokens, usage.outputTokens);
    return { usage };
  },
};
