import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Task } from "./types";

export function loadTask(tasksDir: string, id: string): Task {
  const dir = resolve(tasksDir, id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  return {
    id: meta.id ?? id,
    dir,
    title: meta.title,
    problemStatement: meta.problemStatement,
    targetTest: meta.targetTest,
    guardTests: meta.guardTests ?? [],
    allowedFiles: meta.allowedFiles ?? [],
  };
}
