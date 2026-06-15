import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Task, TrialContext } from "./types";

// Each trial runs in its own throwaway copy so trials never pollute each other.
// (A git worktree is a heavier alternative; a temp copy is enough for self-contained tasks.)
const EXCLUDE = new Set([".solution", "meta.json"]);

export function isolate(task: Task, trial: number): TrialContext {
  const base = mkdtempSync(join(tmpdir(), `fixbench-${task.id}-t${trial}-`));
  cpSync(task.dir, base, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(basename(src)),
  });
  return { task, repoDir: base };
}

export function cleanup(ctx: TrialContext): void {
  rmSync(ctx.repoDir, { recursive: true, force: true });
}
