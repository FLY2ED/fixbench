# fixbench — design decisions & rationale

This document explains *why* fixbench is shaped the way it is. The guiding constraint:
an evaluation harness is only as credible as its fairness and its honesty about error.
Every decision below serves one of those two.

## 1. Pluggable adapters behind narrow interfaces

`src/types.ts` defines two tiny contracts:

```ts
interface Agent  { name: string; solve(ctx: TrialContext): Promise<AgentResult>; }
interface Grader { name: string; grade(ctx: TrialContext): Promise<Score>; }
```

Agents are registered in `src/agents/index.ts`, graders in `src/graders/index.ts`. The
runner resolves them by string key and never knows which concrete implementation it has.

**Why.** The reason to build a harness at all is *comparison*. If each agent brought its
own task loading, its own isolation, its own metric math, no two numbers would be
comparable. By forcing every agent through the same `solve(ctx)` → same isolated repo →
same grader → same `aggregate()`, the only thing that varies between runs is the thing
under test. The interfaces are deliberately narrow (an agent only mutates files; a grader
only returns a `Score`) so that adding a new agent or grader is a single file, no harness
surgery. `noop`/`oracle` exist precisely *because* the abstraction is cheap: they're
two-line agents that bracket every metric.

## 2. Two graders: deterministic (truth) vs. llm-judge (signal)

**`deterministic`** (`graders/deterministic.ts`) runs the task's real vitest suite:
`passed = target test passes AND no guard test regressed`. The agent does not get to
*claim* it fixed the bug — execution decides. This is ground truth.

**`llm-judge`** (`graders/llm-judge.ts`) asks an LLM to *read the current code and reason
about whether it solves the task*, without running anything. It returns a structured
verdict: `{ passed, score, grounded, hallucinationRisk, rationale }`.

**Why keep both.** They answer different questions. Deterministic answers "did it work?"
— authoritative but only available when you have an executable oracle (tests). The
llm-judge answers "does this *look* correct, and how grounded is that judgement?" — the
Tech③ shape, where the thing being evaluated (a RAG answer, a chat reply) often has *no*
executable oracle and a model judge is the only scalable signal. Shipping both in one
harness over the same trials is what makes calibration possible (§6).

### Forced structured output, not prose-parsing

The judge is given exactly one tool, `submit_verdict`, whose `input_schema` *is* the
verdict shape, and is called with `tool_choice: { type: "tool", name: "submit_verdict" }`.
That compels the model to emit one tool-use block whose input conforms to the schema. We
read a typed object straight off the block — no regex over free-form text, no
JSON-in-markdown brittleness. The judge prompt also explicitly pushes toward
*false-over-ungrounded-guess* ("prefer false", lower `grounded` / raise
`hallucinationRisk` when assuming unshown behavior), because for a judge the dangerous
failure is a confident false PASS.

## 3. The regression guard

Every task ships a `guard.test.ts` alongside its target test. The deterministic grader
runs the guards too, and a fix only `passed` if the target goes green **and** no guard
went red.

**Why.** "Make the failing test pass" is a trivially gameable objective — delete the
behavior, special-case the input, or break a neighbouring feature. The guard test is a
cheap tripwire for that: it encodes "these things must stay true" and turns a sneaky
regression into a recorded `regressed: true`. It's the harness analogue of a code
reviewer who runs the *rest* of the suite, not just the new test. It also backstops the
`claude-code` adapter's prompt-only `allowedFiles` restriction (§5).

## 4. Trial isolation: one throwaway copy per trial

`isolate.ts` does `mkdtemp` + `cpSync` of the task dir into a fresh temp directory for
**each trial**, then `cleanup()` removes it. Two things are excluded from the copy: the
`.solution/` directory and `meta.json`.

**Why a copy per trial.** Agents mutate files in place. If trials shared a directory, a
second trial would start from the first trial's edits — measuring nothing. A throwaway
copy guarantees every trial starts from the identical buggy baseline, so trial-to-trial
variance reflects the *agent*, not contamination.

**Why exclude `.solution` and `meta.json`.** The oracle's answer key and the task's
metadata (including `allowedFiles` and the full problem statement) must not leak into what
the agent — or the llm-judge — can see by reading the working directory. The judge in
particular reads file contents straight from `repoDir`; excluding `.solution` there is
what guarantees it is grading the *fix*, not peeking at the answer.

**Why a temp copy and not a git worktree.** A worktree is the heavier, more "real" choice
and the natural upgrade for larger fixtures with history. For self-contained
single-/two-file tasks it buys nothing a recursive copy doesn't, so we took the simpler
path and noted the alternative in code.

## 5. The claude-code adapter: an honest thin wrapper

`agents/claude-code.ts` shells out to the real `claude` CLI in headless mode
(`-p <prompt> --output-format json --model <m> --permission-mode bypassPermissions`, with
`cwd = repoDir`). It re-implements **no** agent loop — Claude Code drives its own tool use
— and reads `usage`, `total_cost_usd`, and `duration_ms` back from the single JSON result.

**Design choices worth naming:**

- **Degrade, never throw.** A missing/unauthenticated CLI (ENOENT, spawn error, or
  unparseable stdout) returns an `AgentResult` with a `notes` explanation and
  zero-token usage but preserved wall-clock latency. One broken environment records an
  error trial instead of crashing a whole comparison.
- **Don't conflate turns with tool calls.** The JSON exposes `num_turns` (conversation
  turns), not a tool-invocation count, so `toolCalls` is left at 0 rather than reported as
  a misleading number.
- **Prefer the source's own numbers.** When the CLI reports `total_cost_usd` /
  `duration_ms`, we use them over our derived estimates — the tool knows its own cost
  better than our unverified pricing table does.
- **`allowedFiles` is prompt-only here.** The wrapper *asks* the CLI to touch only the
  allowed files; it does not sandbox the filesystem. This is stated honestly, and the
  guard tests (§3) are the backstop. (Contrast `self-loop`, which *enforces* the
  allowlist in its `write_file` tool and rejects out-of-bounds writes.)

## 5a. The auto-fix bot: propose, never auto-merge

`src/fix.ts` is the Tech② "자동 수정 봇" surface. It deliberately does **not** reuse
`runner.runTrials` — that loop cleans up the temp copy in `finally`, but the bot needs the
edited copy to survive long enough to diff it. So `fix.ts` runs one trial by hand
(isolate → solve → grade), diffs each `allowedFile` (original task source vs. edited temp
copy) with `git diff --no-index`, rewrites the temp paths to clean `a/<rel>`→`b/<rel>`
hunks, and emits `proposed-fix.diff` + `fix-result.json` — then discards the copy.

**Design choices worth naming:**

- **Fixtures are never touched.** The agent only ever edits the throwaway isolated copy;
  the bot diffs against the pristine fixture and the patch is for a *human* to apply.
- **`git diff --no-index` exit semantics.** It exits 1 when files differ (a
  success-with-diff, not an error) and 0 when identical; `fix.ts` treats only other codes
  as real failures.
- **The workflow gates on the grader, not the model's word.** The Action
  (`.github/workflows/fixbench-autofix.yml`) opens a PR *only* when `fix-result.json`
  reports `passed == true` (deterministic: target green, no regression). A FAIL run still
  uploads the attempted diff as an artifact but opens nothing.
- **Draft PR, least privilege, no auto-merge.** `peter-evans/create-pull-request@v8` with
  `draft: always-true`, a `fixbench-autofix` label, and `permissions: { contents: write,
  pull-requests: write }`. A human reviews and merges. This is the safety posture an
  auto-fix bot *must* have — the bot's authority ends at "propose."

## 6. Handling LLM nondeterminism

LLM agents and judges are stochastic; a single run is an anecdote. fixbench treats
variance as first-class:

- **`--trials N`.** Run the same (task, agent, grader) N times. Each trial is fully
  isolated (§4), so the trials are independent samples.
- **pass@1 as a mean.** `aggregate()` reports pass@1 as the *mean pass rate across trials*
  — the expected probability a single attempt succeeds.
- **pass@k.** Whether *any* trial passed — the "can it ever get there with retries"
  ceiling, which for an auto-fix bot is often the more actionable number.
- **Averaged cost / latency / tokens / tool calls.** Reported as means so a comparison
  isn't decided by one lucky or unlucky sample.

The `compare` subcommand (`src/cli.ts` → `compareMatrix` / `renderLeaderboard` in
`compare.ts`) rolls these per-(agent,task) aggregates up per agent (mean pass@1 across
tasks, tie-broken by lower average cost) and writes `compare.json` plus a `leaderboard.md`
that includes both the per-agent rollup and an agent×task pass@1 grid — so you see both the
headline ranking and where each agent is strong or weak. (Verified: `compare --agents
noop,oracle` yields oracle 100% / noop 0%.) Reporting explicit confidence intervals /
mean±σ is a natural next step; today the harness reports means and pass@k.

## 7. Calibration: judging the judge

The llm-judge is only trustworthy once its error rate is *quantified*. Because the
deterministic grader is ground truth and both graders run over the same trials, you can
grade identical fixes both ways and compute:

```
agreement   = mean( llmJudge.passed === deterministic.passed )
false-pass  = judge says PASS but tests FAIL   ← the dangerous direction
false-fail  = judge says FAIL but tests PASS
```

That confusion matrix is exactly what **`src/calibrate.ts`** produces. `calibrate(rows)`
computes agreement, all four confusion cells, precision (`TP/(TP+FP)` — how often a judge
"PASS" is real), and recall (`TP/(TP+FN)`), and `renderCalibration` prints them as a
markdown matrix. Two entry modes: `--self-test` runs a built-in **synthetic** sample
(no API key) to prove the math; `--from <truth.json> <judge.json>` loads two real
report.json result arrays and pairs them by `(taskId, trial)` via the exported
`pairByTrial()`. A judge with a low false-pass rate can be trusted as a cheap pre-filter;
a high one cannot, and the number tells you which. This closes the Tech③ loop: don't trust
a model judge — *measure it against the ground truth you do have.*

> **The self-test is a worked example, not a result.** `calibrate.ts --self-test` reports
> agreement **70%**, false-pass **2**, false-fail **1**, precision **71.4%**, recall
> **83.3%** on its hand-made n=10 sample. Those labels are fictional and the sample is tiny
> — a single disagreement swings agreement by 10 points. The number's job is to make the
> *methodology* concrete and to show why a real characterization needs dozens-to-hundreds
> of labeled trials (including deliberately-broken patches, so false-pass can even be
> observed). `calibrate.ts` documents one more subtlety in code: `pairByTrial` only compares
> like-for-like if both graders saw the *same* agent output, so a rigorous study freezes the
> patch (e.g. an oracle/cached patch) rather than re-solving per grader.

## 8. Publishing the leaderboard: a static snapshot, not a live service

`worker/index.ts` is a dependency-free Cloudflare ES-module Worker. Workers have no local
filesystem, so it imports `public/leaderboard-data.json` (a committed `compare.json`
snapshot) as a JSON module at build time and renders it as a self-contained HTML page —
per-agent rollup + agent×task grid — with a `/data.json` route for the raw data. The
deliberate choice here is **static snapshot over live compute**: the Worker never runs the
harness (that needs an API key, a Node toolchain, and minutes of wall-clock — none of which
belong in an edge request). `npm run leaderboard:snapshot` refreshes the committed data;
`wrangler deploy --dry-run` builds clean (~10.78 KiB). Config lives in `wrangler.jsonc`
(`compatibility_date` pinned to the authoring date per current Wrangler v4 guidance).

## 9. Deliberate non-goals & honest gaps

- **Not SWE-bench.** Five hand-written micro-tasks demonstrate the machinery; they make no
  representativeness claim.
- **Unverified pricing.** `config.ts` rates are placeholders; token counts are real, cost
  is derived. Flagged in code and README.
- **Calibration self-test is synthetic.** The shipped confusion matrix proves the math, not
  the real judge's accuracy (§7); real numbers need a non-trivial labeled sample.
- **Shipped vs. requires-credentials.** `run` / `compare` / `calibrate` / `fix`, the
  draft-PR Action, and the Cloudflare Worker are all implemented and verified. What still
  needs the operator's own credentials: `ANTHROPIC_API_KEY` for the LLM agents/grader, a
  Cloudflare login for a real `cf:deploy`, and a GitHub push + repo secret to enable the
  Action. Those are configuration, not missing features.
