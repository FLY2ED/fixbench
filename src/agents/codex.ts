import { spawn } from "node:child_process";
import { zeroUsage, type Agent, type AgentResult, type TrialContext } from "../types";

// Honest thin wrapper around the REAL OpenAI Codex CLI (`codex exec`), mirroring claude-code.ts.
// Codex drives its own tool use; we just hand it the isolated buggy repo and let it edit in place.
// Having BOTH claude-code and codex adapters is the point of the harness: a fair, side-by-side
// comparison of two real coding agents on the same tasks with the same deterministic grader.
//
// FLAGS (verified against `codex exec --help`, codex-cli 0.140.0, 2026-06-15):
//   exec                          non-interactive subcommand (no prompts).
//   -C, --cd <dir>                working root = the isolated repo copy.
//   -s, --sandbox workspace-write let the agent write within that working root.
//   --skip-git-repo-check         the temp copy is NOT a git repo.
//   --json                        emit JSONL events on stdout (best-effort token parse).
//   --color never                 clean output.
// Sandbox is overridable via CODEX_SANDBOX (e.g. `danger-full-access`) if a run needs it.

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

export const codex: Agent = {
  name: "codex",
  async solve(ctx: TrialContext): Promise<AgentResult> {
    const { repoDir } = ctx;
    const usage = zeroUsage();
    const t0 = Date.now();

    const sandbox = process.env.CODEX_SANDBOX ?? "workspace-write";
    const prompt = buildPrompt(ctx);
    const args = [
      "exec",
      "--cd",
      repoDir,
      "-s",
      sandbox,
      "--skip-git-repo-check",
      "--json",
      "--color",
      "never",
      prompt,
    ];

    let stdout = "";
    let stderr = "";
    let spawnError = "";

    await new Promise<void>((res) => {
      let child;
      try {
        child = spawn("codex", args, { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        spawnError = String(e);
        res();
        return;
      }
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => {
        spawnError = String(e); // e.g. ENOENT when `codex` isn't installed
        res();
      });
      child.on("close", () => res());
    });

    usage.latencyMs = Date.now() - t0;
    if (spawnError) return { usage, notes: `codex CLI failed to spawn: ${spawnError}` };

    // Best-effort token extraction from JSONL. Codex's event schema isn't guaranteed stable, so
    // we scan every line for the last object exposing token counts and DON'T fail the trial if
    // none is found (tokens stay 0, latency is still real).
    let foundTokens = false;
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      let obj: any;
      try {
        obj = JSON.parse(t);
      } catch {
        continue;
      }
      const u = obj.usage ?? obj.token_usage ?? obj.info?.usage ?? obj;
      const inT = u?.input_tokens ?? u?.prompt_tokens ?? u?.total_input_tokens;
      const outT = u?.output_tokens ?? u?.completion_tokens ?? u?.total_output_tokens;
      if (typeof inT === "number" || typeof outT === "number") {
        if (typeof inT === "number") usage.inputTokens = inT;
        if (typeof outT === "number") usage.outputTokens = outT;
        foundTokens = true;
      }
    }

    // PRICING has no entry for codex's (non-Anthropic) model, so we deliberately leave costUsd
    // at 0 rather than guess OpenAI pricing. Tokens above are accurate when present.
    const notes = foundTokens
      ? "codex: token counts parsed best-effort from JSONL; cost not tracked (non-Anthropic model)."
      : `codex: no token usage parsed; latency only. tail: ${
          (stderr || stdout).slice(-300).trim() || "<empty>"
        }`;
    return { usage, notes };
  },
};
