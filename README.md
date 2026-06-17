# fixbench

**A pluggable evaluation harness for AI coding agents: isolate a buggy repo, let a swappable agent fix it, then grade the fix deterministically (run the tests) or with an LLM-as-a-judge — and log pass@k, tokens, cost, and latency for a fair head-to-head.**

Built as a portfolio demo for the NAVER 2026 하계 인턴 프로덕트 트랙 application.

## Why this exists (Tech② / Tech③ mapping)

| Track | Theme | What in fixbench maps to it |
|---|---|---|
| **Tech②** | AI 코딩 에이전트 평가 하네스 + 자동 수정 봇 | The harness itself: pluggable **agents** that attempt fixes inside an isolated repo, the **`deterministic` grader** (runs the task's tests; pass = target test green AND no regression), the **`compare` leaderboard**, and the **auto-fix bot** (`src/fix.ts` emits a reviewable patch; a GitHub Action opens a **draft PR** when the fix passes — never auto-merges). |
| **Tech③** | RAG / 대화 평가 (LLM-as-a-judge) | The **`llm-judge` grader**: an LLM reads the proposed fix and emits a *structured verdict* (`passed / score / grounded / hallucinationRisk / rationale`) via forced tool output — plus **`calibrate.ts`**, which scores that judge against the deterministic ground truth (agreement / false-pass / false-fail / precision / recall). |

## Architecture

```
 tasks/<id>/                         per-task fixture
   ├─ src/**          (buggy source the agent may edit)
   ├─ <target>.test   (FAILS until the bug is fixed)
   ├─ guard.test      (regression tripwire — must STAY green)
   ├─ .solution/**    (known-good fix; HIDDEN from the agent)
   └─ meta.json       (title, problem statement, allowedFiles; HIDDEN)
        │
        │  loadTask()            tasks.ts
        ▼
   ┌──────────┐   temp copy per trial; .solution + meta.json EXCLUDED
   │ isolate  │   ─────────────────────────────────────────────────►  repoDir (throwaway)
   └──────────┘   isolate.ts
        │
        ▼
   ┌────────────────────┐   registry: self-loop | claude-code | codex | noop | oracle
   │  Agent  adapter    │   mutates files in repoDir to (attempt to) fix the bug
   └────────────────────┘   agents/*  →  AgentResult { usage }
        │
        │  (the agent's edits are already applied in repoDir — "apply" = in-place writes)
        ▼
   ┌────────────────────┐   registry: deterministic | llm-judge
   │  Grader            │   deterministic → run target + guard tests (ground truth)
   └────────────────────┘   llm-judge     → LLM reads the fix → structured verdict (JUDGED)
        │                   graders/*  →  Score { passed, targetPassed, regressed, score, rationale }
        ▼
   ┌────────────────────┐   aggregate() → pass@1, pass@k, regressions, tokens, cost, latency, tools
   │ report / leaderboard│  run:      report.json + report.md          (report.ts, cli.ts)
   └────────────────────┘   compare:   leaderboard.md + compare.json    (compare.ts, cli.ts)
        │
        ▼   cleanup() removes the temp repo (isolate.ts)

  ── consumers of the above ────────────────────────────────────────────────────
   fix.ts ──► proposed-fix.diff + fix-result.json ──► GitHub Action ──► DRAFT PR   (auto-fix bot)
   compare.json ──► public/leaderboard-data.json ──► worker/index.ts ──► Cloudflare leaderboard
   deterministic + llm-judge verdicts ──► calibrate.ts ──► confusion matrix         (judge calibration)
```

Both **agents and graders are registry-pluggable** (`src/agents/index.ts`, `src/graders/index.ts`) behind the `Agent` / `Grader` interfaces in `src/types.ts`. That pluggability is the whole point: every adapter runs against the identical isolated repo and the identical metric pipeline, so comparisons are apples-to-apples.

## Agent × Grader matrix

Any agent can be graded by any grader. Agents (rows) and graders (columns):

| agent ↓ \ grader → | `deterministic` (runs tests) | `llm-judge` (reads the fix) |
|---|---|---|
| **`noop`** — does nothing (lower-bound baseline) | target test stays FAIL → expected ❌ | judge should also say ❌ (good calibration check) |
| **`oracle`** — applies `tasks/<id>/.solution` (upper-bound baseline) | target PASS, no regression → ✅ | judge should say ✅ |
| **`self-loop`** — minimal Anthropic SDK tool-use loop (needs key) | objective pass/fail | judged pass/fail |
| **`claude-code`** — shells out to the Claude Code CLI headless (needs key/auth) | objective pass/fail | judged pass/fail |
| **`codex`** — shells out to the OpenAI Codex CLI (`codex exec`, needs login) | objective pass/fail | judged pass/fail |

- **`noop`** and **`oracle`** are deterministic baselines that need **no API key** — they bracket every metric between a known floor and ceiling.
- **`self-loop`** is a *deliberately minimal* tool-use agent (`list_files` / `read_file` / `write_file` / `run_tests`) built on `@anthropic-ai/sdk`. It exists to be a fully-instrumented baseline, not a production agent.
- **`claude-code`** is an honest thin wrapper that shells out to the real `claude` CLI in headless mode (`-p --output-format json --model <m> --permission-mode bypassPermissions`) with `cwd = repoDir`, and reads tokens/cost/duration back from the CLI's JSON result. It re-implements no agent loop of its own.
- **`codex`** is the same honest pattern for the OpenAI Codex CLI (`codex exec --cd <repo> -s workspace-write --skip-git-repo-check --json`). Having **two real-agent adapters** is what makes the leaderboard a *fair head-to-head*.

## Live results (real run)

**Live leaderboard → https://fixbench.naldadev.com** (Cloudflare Worker; `/data.json` serves the raw snapshot)

A real `compare --agents claude-code,codex --grader deterministic --trials 1` over all 5 tasks (2026-06-15):

| rank | agent | mean pass@1 | avg latency | avg cost | note |
|---|---|---|---|---|---|
| 1 | `codex` | 100% (5/5) | ~76 s | n/a\* | tokens from JSONL; cost not tracked (non-Anthropic model) |
| 1 | `claude-code` | 100% (5/5) | ~14 s | $0.098 | ~5× faster on this set |

\* Honest reading of this result: (1) the micro-benchmark is easy enough that **both agents solve every task**, so correctness doesn't separate them — the live signal is **latency/cost**, and the real takeaway is that the benchmark needs *harder* tasks to differentiate quality. (2) `claude-code`'s reported `input_tokens` looks tiny (~5) because the `claude` CLI counts only *uncached* input — most context is served from cache, so the billed `cost` is the figure to trust. Surfacing exactly this kind of instrumentation nuance is the harness's job.

## Quickstart

### Install

```bash
npm install
```

### 1) Baseline run — NO API KEY required

The `noop` (floor) and `oracle` (ceiling) agents are deterministic, so you can exercise the full isolate → agent → grade → report pipeline with zero credentials:

```bash
npm run run:noop     # do-nothing agent → target test FAILS  → pass@1 = 0%   (lower bound)
npm run run:oracle   # applies .solution → target test PASSES → pass@1 = 100% (upper bound)
```

Each writes `report.json` + `report.md` at the repo root and prints a one-line summary.

The general form:

```bash
npx tsx src/cli.ts run --task <id> --agent <name> --grader <name> [--trials N]
# e.g.
npx tsx src/cli.ts run --task 005-order-state --agent oracle --grader deterministic
```

Tasks: `001-parse-duration`, `002-paginate`, `003-split-fee`, `004-mask-phone`, `005-order-state`.

### 2) Key-required runs

Set `ANTHROPIC_API_KEY` (see `.env.example`) for the LLM-driven agents and grader:

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# self-loop agent, graded by running the tests, 3 trials (nondeterminism → use trials)
npm run run:self
npx tsx src/cli.ts run --task 002-paginate --agent self-loop --grader deterministic --trials 3

# real Claude Code CLI as the agent (requires the `claude` CLI installed & authenticated)
npx tsx src/cli.ts run --task 004-mask-phone --agent claude-code --grader deterministic

# llm-judge grader — score a fix WITHOUT running tests (Tech③)
npx tsx src/cli.ts run --task 001-parse-duration --agent self-loop --grader llm-judge
```

### 3) Compare — rank agents across all tasks (no key for `noop,oracle`)

```bash
# rank agents across all tasks → writes leaderboard.md + compare.json
npx tsx src/cli.ts compare --agents noop,oracle --grader deterministic
#   🏆 leaderboard (mean pass@1):  100% oracle   0% noop   (verified)
# add LLM agents (needs ANTHROPIC_API_KEY):
npx tsx src/cli.ts compare --agents noop,oracle,self-loop --grader deterministic --trials 3
```

Writes `compare.json` (per-agent rollup + per-(agent×task) grid) and `leaderboard.md`. Defaults: all registered agents, all tasks under `tasks/`, `--grader deterministic`, `--trials 1`. The `--agents noop,oracle` form needs **no API key** and is the recommended first end-to-end smoke test.

### 4) Calibrate the judge — confusion matrix vs. ground truth (Tech③)

```bash
# synthetic self-test (no API key): proves the math end-to-end
npx tsx src/calibrate.ts --self-test
#   n 10 · agreement 70.0% · false-pass 2 ⚠️ · false-fail 1 · precision 71.4% · recall 83.3%

# real use: grade the same task once per grader, then pair by (taskId, trial)
npx tsx src/cli.ts run --task 001-parse-duration --agent oracle --grader deterministic   # writes report.json (truth)
#   ...rename/save that report.json, run again with --grader llm-judge to get the judge report...
npx tsx src/calibrate.ts --from <truth.json> <judge.json>
```

`calibrate.ts` computes agreement, the full confusion matrix (`truePass / falsePass / falseFail / trueFail`), precision, and recall. It treats the **deterministic** grader as ground truth and exposes `pairByTrial()` to align two report.json result arrays by `(taskId, trial)`. **`--self-test` data is synthetic and fictional** — it demonstrates the math, not the real judge's accuracy. The dangerous cell is **false-pass** (judge says PASS, tests FAIL); calibrate on a non-trivial labeled sample before trusting the judge to gate anything.

### 5) Auto-fix bot — propose a patch, open a draft PR (Tech②)

```bash
# run one trial on an isolated copy, emit a reviewable patch + metrics
npx tsx src/fix.ts --task 003-split-fee --agent self-loop
#   → proposed-fix.diff   (unified diff of the task's allowedFiles, via `git diff --no-index`)
#   → fix-result.json     ({ taskId, agent, passed, targetPassed, regressed, usage })
```

`src/fix.ts` operates on a **throwaway isolated copy** so the task fixtures are never modified, and prints the verdict + cost/tools/latency. The GitHub Action **`.github/workflows/fixbench-autofix.yml`** (`workflow_dispatch` with `task` / `agent` inputs) wraps it: checkout → setup-node (Node 20) → `npm ci` → run `src/fix.ts` with `secrets.ANTHROPIC_API_KEY` → upload the diff + metrics as an artifact → and **only when `passed == true`** apply the patch and open a **DRAFT** PR via `peter-evans/create-pull-request@v8` (label `fixbench-autofix`). It **never auto-merges** — a human reviews and merges. A failing run uploads the attempted diff and opens no PR.

> Enabling the Action requires pushing this repo to GitHub and setting the `ANTHROPIC_API_KEY` repo secret.

### 6) Cloudflare Workers leaderboard

```bash
npm run leaderboard:snapshot   # copy compare.json → public/leaderboard-data.json (committed snapshot)
npm run cf:dev                 # wrangler dev — preview the leaderboard locally
npm run cf:deploy              # wrangler deploy (requires your Cloudflare login)
```

`worker/index.ts` is a dependency-free ES-module Worker that renders the committed `public/leaderboard-data.json` snapshot as a self-contained HTML leaderboard (per-agent rollup + agent×task pass@1 grid), plus a `/data.json` route that serves the raw snapshot. Config: `wrangler.jsonc` (`name fixbench`, `compatibility_date 2026-06-15`, wrangler v4). `npx wrangler deploy --dry-run` builds clean (~10.78 KiB). A real `cf:deploy` needs your own Cloudflare login.

## Metrics

Computed per trial and aggregated in `src/report.ts` (and rolled up per agent for the `compare` leaderboard in `src/compare.ts`):

| metric | meaning |
|---|---|
| **pass@1** | mean pass rate across trials (a trial passes only if the grader returns `passed`) |
| **pass@k** | did **any** of the k trials pass — the "can it ever get there" signal |
| **regressions** | trials where a guard test went red (a fix that broke something else) |
| **tokens** | input / output (plus cache read/creation), taken straight from `res.usage` — accurate |
| **cost (USD)** | derived via `estimateCost()` from token counts × per-model pricing — **approximate, pricing unverified** (see `src/config.ts`); `claude-code` prefers the CLI's own `total_cost_usd` |
| **latency** | wall-clock per trial (`claude-code` prefers the CLI's reported `duration_ms`) |
| **tool calls** | number of tool invocations the agent made (`self-loop` only; `claude-code`'s JSON does not expose a tool-call count, so it stays 0) |

For the **deterministic** grader, `passed = target test passes AND no guard test regressed`. For **llm-judge**, `passed` is the model's *judged* verdict (no tests are executed), so `regressed` is always `false` and `targetPassed` mirrors `passed`.

## Honesty / limitations

This is a portfolio prototype. Being precise about what it is **not** matters more than the demo:

- **`self-loop` is minimal**, not a production agent. Four tools, a single linear message loop, capped at `MAX_AGENT_STEPS` (default 12). It's a measurable baseline, nothing more.
- **`tasks/` is a self-curated micro-benchmark** — 5 small, single- or two-file TypeScript bug fixes. It is **NOT SWE-bench** and makes no claim of representativeness. It's enough to demonstrate the harness, not to rank real agents.
- **Pricing is UNVERIFIED.** The per-model rates in `src/config.ts` are placeholders marked `TODO verify` against anthropic.com/pricing. **Token counts are accurate** (straight from the API); **cost is derived and approximate.**
- **`llm-judge` can be wrong, and the harness proves it must be calibrated.** It never runs code, so it can't catch runtime errors, flakiness, or execution-only regressions. `calibrate.ts --self-test` is the live demonstration: on its synthetic sample (n=10) the judge agrees with ground truth only **70%** of the time, with **2 false-passes** (the dangerous direction — broken code laundered as "reviewed"). Those numbers are illustrative, not the real judge's accuracy; the point is that the judge's error rate must be **quantified against the deterministic grader** before it gates anything, and a 10-trial sample is far too small to trust.
- **`claude-code`'s `allowedFiles` restriction is prompt-only.** The wrapper *asks* the CLI to edit only the allowed files and not to touch tests; it does not sandbox the filesystem. The **guard tests are the backstop** — an out-of-bounds edit that breaks something shows up as a regression. (The `self-loop` agent, by contrast, hard-rejects writes outside `allowedFiles` in its `write_file` tool.)
- **What's shipped vs. what needs your action.** The full command surface — `run`, `compare`, `calibrate`, `fix` (with the draft-PR GitHub Action), and the Cloudflare Worker (`cf:dev` / `cf:deploy`, `wrangler deploy --dry-run` builds clean) — is implemented and verified on disk. Three things still genuinely require **your** credentials: the LLM-driven agents/grader need `ANTHROPIC_API_KEY`; a real `cf:deploy` needs your Cloudflare login; and enabling the auto-fix Action needs pushing to GitHub and setting the `ANTHROPIC_API_KEY` repo secret. These are configuration steps, not missing features.

## Layout

```
src/
  cli.ts            run + compare subcommands: parse args → runTrials/compareMatrix → write reports
  runner.ts         per-trial loop: isolate → agent.solve → grader.grade → cleanup
  isolate.ts        temp-copy a task per trial (.solution + meta.json excluded)
  tasks.ts          load meta.json into a Task
  testRunner.ts     spawn the harness's own vitest against the isolated copy
  report.ts         aggregate() metrics + write report.json / report.md
  compare.ts        per-agent rollup + render leaderboard.md / compare.json
  calibrate.ts      judge-vs-deterministic confusion matrix (--self-test / --from)
  fix.ts            auto-fix bot entry → proposed-fix.diff + fix-result.json
  config.ts         models, max steps, UNVERIFIED pricing + estimateCost()
  types.ts          Agent / Grader / Task / Score / Usage contracts
  agents/           index (registry) + self-loop, claude-code, baselines (noop, oracle)
  graders/          index (registry) + deterministic, llm-judge
tasks/              001..005 fixtures (buggy src + tests + .solution + meta.json)
worker/index.ts     Cloudflare Worker: render leaderboard HTML + /data.json
wrangler.jsonc      Worker config (name fixbench, compatibility_date 2026-06-15)
public/             leaderboard-data.json (committed compare.json snapshot)
.github/workflows/  fixbench-autofix.yml (workflow_dispatch → draft PR on pass)
docs/               DESIGN.md (rationale), WRITEUP-ko.md (회고)
```

See **`docs/DESIGN.md`** for design rationale and **`docs/WRITEUP-ko.md`** for the Korean write-up.
