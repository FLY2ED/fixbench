import { spawn } from "node:child_process";
import { config, estimateCost } from "../config";
import { zeroUsage, type Agent, type AgentResult, type TrialContext } from "../types";

// This adapter is an HONEST thin wrapper: it shells out to the REAL Claude Code CLI
// (`claude`) in headless mode and lets it edit files in ctx.repoDir in place. We do not
// re-implement any agent loop here — Claude Code drives its own tool use.
//
// FLAGS (verified against `claude --help` on 2026-06-15):
//   -p / --print                  non-interactive: print the result and exit.
//   --output-format json          single structured JSON result on stdout (only with --print).
//   --model <model>               model selection; we pass config.agentModel.
//   --permission-mode bypassPermissions
//                                 lets it Edit/Write without interactive prompts (sandbox run).
//                                 (Equivalent to --dangerously-skip-permissions; using the
//                                  scoped permission-mode flag is the least surprising choice.)
//   --add-dir <dir>               we run with cwd = repoDir so this is implicit, but we also
//                                 pass the prompt as the trailing arg.
//
// The JSON `result` object (verified empirically) looks like:
//   { type:"result", subtype:"success", is_error:false, duration_ms, num_turns,
//     result:"<final text>", total_cost_usd,
//     usage:{ input_tokens, output_tokens, cache_read_input_tokens,
//             cache_creation_input_tokens, ... }, ... }

type ClaudeJsonResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

function buildPrompt(ctx: TrialContext): string {
  const { task } = ctx;
  return [
    `Fix this bug. Title: ${task.title}`,
    "",
    task.problemStatement,
    "",
    `You may ONLY edit these files: ${task.allowedFiles.join(", ")}.`,
    "Do NOT edit or create any test files. Make the minimal change needed to fix the bug,",
    "then stop.",
  ].join("\n");
}

export const claudeCode: Agent = {
  name: "claude-code",
  async solve(ctx: TrialContext): Promise<AgentResult> {
    const { repoDir } = ctx;
    const usage = zeroUsage();
    const t0 = Date.now();

    const prompt = buildPrompt(ctx);
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      config.agentModel,
      // Allow file edits without interactive prompts in this sandboxed working copy.
      "--permission-mode",
      "bypassPermissions",
    ];

    // Collect stdout/stderr; never throw on a missing/unauthenticated CLI — degrade so the
    // harness can still record an error trial.
    let stdout = "";
    let stderr = "";
    let spawnError = "";

    await new Promise<void>((res) => {
      let child;
      try {
        child = spawn("claude", args, {
          cwd: repoDir,
          // Inherit env (ANTHROPIC_API_KEY / auth) but don't attach a TTY; closing stdin
          // ensures the CLI doesn't wait for interactive input.
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        spawnError = String(e);
        res();
        return;
      }
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => {
        // e.g. ENOENT when the `claude` binary isn't installed.
        spawnError = String(e);
        res();
      });
      child.on("close", () => res());
    });

    usage.latencyMs = Date.now() - t0;

    if (spawnError) {
      return { usage, notes: `claude CLI failed to spawn: ${spawnError}` };
    }

    // Parse the single JSON result. On any parse failure, degrade gracefully with notes
    // (zeroUsage tokens, but keep the measured wall-clock latency).
    let parsed: ClaudeJsonResult;
    try {
      parsed = JSON.parse(stdout.trim()) as ClaudeJsonResult;
    } catch {
      const tail = (stderr || stdout).slice(-500).trim();
      return {
        usage,
        notes: `could not parse claude JSON output. tail of output: ${tail || "<empty>"}`,
      };
    }

    const u = parsed.usage ?? {};
    usage.inputTokens = u.input_tokens ?? 0;
    usage.outputTokens = u.output_tokens ?? 0;
    usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
    usage.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
    // The JSON result does not expose a tool-call count (only `num_turns`, which is
    // conversation turns, not tool invocations). Leave toolCalls at 0 rather than
    // conflate it with turns.
    usage.toolCalls = 0;

    // Prefer the CLI's own duration; fall back to our measured wall clock.
    if (typeof parsed.duration_ms === "number") usage.latencyMs = parsed.duration_ms;

    // Prefer the CLI's reported cost; fall back to estimateCost() from token counts.
    if (typeof parsed.total_cost_usd === "number") {
      usage.costUsd = parsed.total_cost_usd;
    } else {
      usage.costUsd = estimateCost(config.agentModel, usage.inputTokens, usage.outputTokens);
    }

    const notes =
      parsed.is_error || parsed.subtype !== "success"
        ? `claude reported a non-success result (subtype=${parsed.subtype ?? "?"}). result: ${
            (parsed.result ?? "").slice(0, 300)
          }`
        : undefined;

    return { usage, notes };
  },
};
