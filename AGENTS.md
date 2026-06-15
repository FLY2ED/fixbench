# fixbench — agent operating rules

STOP. Before changing the Anthropic SDK calls, Claude Code headless flags, Cloudflare
Workers, or GitHub Actions wiring, verify the CURRENT official docs (Context7 / official
site). Model APIs, model IDs, CLI flags, and pricing change over time.

## What this is

A minimal AI coding-agent **evaluation harness**: isolate a buggy repo, let a pluggable
agent fix it, grade deterministically by running tests, and log tokens / cost / latency.
Built as a portfolio demo for NAVER 2026 인턴 프로덕트 트랙:

- **Tech②** — AI 코딩 에이전트 평가 하네스 + 자동 수정 봇  → `deterministic` grader
- **Tech③** — RAG / 대화 평가 (LLM-as-a-judge)            → `llm-judge` grader (Day 2)

## Commands

| command | purpose |
|---|---|
| `npm run run:noop`   | baseline (lower bound): do-nothing agent → target test should FAIL |
| `npm run run:oracle` | baseline (upper bound): apply known-good fix → target test should PASS |
| `npm run run:self`   | self-loop agent (needs `ANTHROPIC_API_KEY`) |
| `npm run typecheck`  | `tsc --noEmit` |

## Honesty guardrails (carry into the writeup)

- `self-loop` is a *minimal* tool-use agent, not a production agent.
- Pricing in `src/config.ts` is **unverified** — confirm at anthropic.com/pricing. Token
  counts come straight from the API and are accurate; cost is derived and approximate.
- `tasks/` is a **self-curated micro-benchmark**, not SWE-bench.
- LLM-as-a-judge (Day 2) must be calibrated against human labels — do not trust it blindly.
