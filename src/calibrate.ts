// CALIBRATION (Tech③: LLM-as-a-judge trustworthiness).
//
// This standalone entry quantifies HOW MUCH we can trust the `llm-judge` grader by comparing its
// verdicts against the `deterministic` grader — which actually runs the vitest suite and is
// therefore GROUND TRUTH. For each trial we have two booleans:
//
//     truth = deterministic.score.passed   (real: target green AND no regression)
//     judge = llmJudge.score.passed        (the LLM's guess, code read but not executed)
//
// We treat "pass" as the POSITIVE class and build the standard confusion matrix:
//
//                          truth = PASS        truth = FAIL
//     judge = PASS         truePass            falsePass  ← DANGEROUS
//     judge = FAIL         falseFail           trueFail
//
// WHY falsePass IS THE DANGEROUS CELL: an auto-fix bot that ships whatever the judge greenlights
// will merge BROKEN patches every time the judge says PASS but the tests actually FAIL. A high
// false-pass rate makes the judge worse than useless for gating — it launders broken code as
// "reviewed". falseFail is merely wasteful (it rejects a good fix), not unsafe.
//
// HONESTY / SAMPLE SIZE: these rates are only meaningful on a NON-TRIVIAL sample. With ~10 trials
// a single disagreement swings agreement by 10 percentage points, so the self-test numbers below
// are an ILLUSTRATION of the math, not a real characterization of the judge. To actually trust
// (or reject) the judge you need dozens-to-hundreds of labeled trials spanning easy AND hard
// tasks, ideally including deliberately-broken patches so false-pass can even be observed.
//
// Run:
//   npx tsx src/calibrate.ts --self-test                 (no API key needed; synthetic data)
//   npx tsx src/calibrate.ts --from <truth.json> <judge.json>   (stub; see loadFrom below)

import { readFileSync } from "node:fs";
import type { TrialResult } from "./types";

// One trial graded by BOTH graders, reduced to the two booleans we compare.
export type LabeledTrial = {
  taskId: string;
  trial: number;
  truth: boolean; // deterministic grader said passed
  judge: boolean; // llm-judge grader said passed
};

export type CalibrationResult = {
  n: number;
  agreement: number; // rate: mean(judge === truth)
  falsePass: number; // count: judge=PASS, truth=FAIL  (dangerous)
  falseFail: number; // count: judge=FAIL, truth=PASS  (wasteful)
  truePass: number; // count: judge=PASS, truth=PASS
  trueFail: number; // count: judge=FAIL, truth=FAIL
  precision: number; // of the trials the judge called PASS, how many truly passed
  recall: number; // of the trials that truly passed, how many the judge caught
};

// Core metric computation. "pass" is the positive class.
export function calibrate(rows: LabeledTrial[]): CalibrationResult {
  let truePass = 0;
  let trueFail = 0;
  let falsePass = 0;
  let falseFail = 0;

  for (const r of rows) {
    if (r.judge && r.truth) truePass++;
    else if (r.judge && !r.truth) falsePass++; // judge says PASS, reality FAIL
    else if (!r.judge && r.truth) falseFail++; // judge says FAIL, reality PASS
    else trueFail++;
  }

  const n = rows.length;
  const agreement = n ? (truePass + trueFail) / n : 0;

  // precision = TP / (TP + FP): when the judge says PASS, how often is it right?
  //   A low precision means lots of false-pass → unsafe to auto-merge on judge approval.
  const judgePassTotal = truePass + falsePass;
  const precision = judgePassTotal ? truePass / judgePassTotal : 0;

  // recall = TP / (TP + FN): of all truly-passing fixes, how many did the judge approve?
  const realPassTotal = truePass + falseFail;
  const recall = realPassTotal ? truePass / realPassTotal : 0;

  return { n, agreement, falsePass, falseFail, truePass, trueFail, precision, recall };
}

// Render a markdown confusion matrix + the derived rates. Pure string; no I/O.
export function renderCalibration(r: CalibrationResult): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [
    `# calibration — llm-judge vs deterministic (ground truth)`,
    ``,
    `**n** ${r.n} trials · **agreement** ${pct(r.agreement)}`,
    ``,
    `Confusion matrix ("pass" = positive class; rows = judge verdict, cols = truth):`,
    ``,
    `|              | truth PASS | truth FAIL |`,
    `|--------------|-----------|-----------|`,
    `| **judge PASS** | ${r.truePass} (truePass) | ${r.falsePass} (falsePass ⚠️) |`,
    `| **judge FAIL** | ${r.falseFail} (falseFail) | ${r.trueFail} (trueFail) |`,
    ``,
    `| metric | value |`,
    `|---|---|`,
    `| agreement | ${pct(r.agreement)} |`,
    `| precision | ${pct(r.precision)} |`,
    `| recall | ${pct(r.recall)} |`,
    `| false-pass (judge PASS, truth FAIL) | ${r.falsePass} |`,
    `| false-fail (judge FAIL, truth PASS) | ${r.falseFail} |`,
    ``,
    `> ⚠️ false-pass is the dangerous direction: an auto-fix bot that trusts the judge would`,
    `> greenlight broken patches. Calibrate on a non-trivial sample before trusting these rates.`,
    ``,
  ].join("\n");
}

// INPUT WIRING — the intended real flow.
//
// Run the harness TWICE over the same tasks/agent with the same trial count, once per grader:
//     npx tsx src/cli.ts run --task <id> --agent <a> --grader deterministic --trials N
//     npx tsx src/cli.ts run --task <id> --agent <a> --grader llm-judge     --trials N
// Each run produces a report.json containing `results: TrialResult[]`. Feed the two result arrays
// (truth-graded, judge-graded) into pairByTrial to align them by (taskId, trial) into LabeledTrial[].
//
// NOTE: this only pairs correctly if BOTH runs graded the *same* agent output. In fixbench today
// each run re-isolates and re-solves, so a stochastic agent could produce different patches across
// the two runs and the pairing would compare verdicts on DIFFERENT code. For a rigorous study you
// want the agent's patch frozen and graded by both graders; pairByTrial assumes that has been
// arranged (e.g. a deterministic/oracle agent, or a cached patch). Documented here so the caller
// doesn't over-read the numbers.
export function pairByTrial(
  truthResults: TrialResult[],
  judgeResults: TrialResult[],
): LabeledTrial[] {
  const key = (r: TrialResult) => `${r.taskId}#${r.trial}`;
  const judgeByKey = new Map<string, TrialResult>();
  for (const j of judgeResults) judgeByKey.set(key(j), j);

  const rows: LabeledTrial[] = [];
  for (const t of truthResults) {
    const j = judgeByKey.get(key(t));
    if (!j) continue; // no matching judge verdict for this (taskId, trial) → skip
    rows.push({
      taskId: t.taskId,
      trial: t.trial,
      truth: t.score.passed,
      judge: j.score.passed,
    });
  }
  return rows;
}

// `--from <truth.json> <judge.json>` mode (STUB — full impl optional).
//
// Loads two report.json files (each shaped `{ agg, results }` per writeReports in report.ts),
// extracts their `results: TrialResult[]`, and pairs them with pairByTrial. The deterministic run
// must be passed first (it is the truth label), the llm-judge run second.
//
// Intentionally minimal: it assumes the on-disk shape and does not validate it. Wire into real
// reporting before relying on it.
export function loadFrom(truthPath: string, judgePath: string): LabeledTrial[] {
  const readResults = (p: string): TrialResult[] => {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { results?: TrialResult[] };
    return parsed.results ?? [];
  };
  return pairByTrial(readResults(truthPath), readResults(judgePath));
}

// A hand-made synthetic sample for `--self-test`. ~10 rows with a couple of false-pass and
// false-fail so every confusion cell is exercised WITHOUT needing an API key or real trials.
// These labels are fictional — they exist only to prove the math, not to characterize the judge.
function selfTestRows(): LabeledTrial[] {
  return [
    { taskId: "001-parse-duration", trial: 0, truth: true, judge: true }, // truePass
    { taskId: "001-parse-duration", trial: 1, truth: true, judge: true }, // truePass
    { taskId: "001-parse-duration", trial: 2, truth: true, judge: false }, // falseFail
    { taskId: "002-slugify", trial: 0, truth: false, judge: false }, // trueFail
    { taskId: "002-slugify", trial: 1, truth: false, judge: true }, // falsePass ⚠️
    { taskId: "002-slugify", trial: 2, truth: true, judge: true }, // truePass
    { taskId: "003-retry", trial: 0, truth: false, judge: false }, // trueFail
    { taskId: "003-retry", trial: 1, truth: true, judge: true }, // truePass
    { taskId: "003-retry", trial: 2, truth: false, judge: true }, // falsePass ⚠️
    { taskId: "003-retry", trial: 3, truth: true, judge: true }, // truePass
  ];
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Standalone entry: `npx tsx src/calibrate.ts [--self-test | --from a.json b.json]`.
// Only runs when invoked directly (import.meta.main); importing this module stays side-effect free.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);

  if (argv.includes("--self-test")) {
    const rows = selfTestRows();
    const result = calibrate(rows);
    console.log(renderCalibration(result));
  } else if (argv.includes("--from")) {
    const i = argv.indexOf("--from");
    const truthPath = argv[i + 1];
    const judgePath = argv[i + 2];
    if (!truthPath || !judgePath) {
      console.error("usage: tsx src/calibrate.ts --from <truth.json> <judge.json>");
      process.exit(1);
    }
    const rows = loadFrom(truthPath, judgePath);
    console.log(renderCalibration(calibrate(rows)));
  } else {
    console.log(
      [
        "usage: tsx src/calibrate.ts --self-test",
        "       tsx src/calibrate.ts --from <truth.json> <judge.json>",
        "",
        "Compares llm-judge verdicts against deterministic ground truth and reports",
        "agreement / false-pass / false-fail / precision / recall.",
      ].join("\n"),
    );
  }
}
