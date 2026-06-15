import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Run the harness's own vitest install against an isolated task copy.
// cwd = the temp repo, so vitest discovers and runs the task's test files there.
const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = join(harnessRoot, "node_modules", ".bin", "vitest");

export type TestRun = { passed: boolean; output: string };

export function runTest(repoDir: string, testFile: string): Promise<TestRun> {
  return new Promise((resolve) => {
    const child = spawn(vitestBin, ["run", testFile, "--reporter=dot"], {
      cwd: repoDir,
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ passed: code === 0, output: out.slice(-4000) }));
    child.on("error", (e) => resolve({ passed: false, output: String(e) }));
  });
}
