export const config = {
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  agentModel: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
  judgeModel: process.env.JUDGE_MODEL ?? "claude-sonnet-4-6",
  maxAgentSteps: Number(process.env.MAX_AGENT_STEPS ?? 12),
};

// NOTE: pricing is TIME-SENSITIVE. Verify current numbers at https://www.anthropic.com/pricing
// before trusting `costUsd`. Token counts (from res.usage) are always accurate; cost is derived.
// Units: USD per 1,000,000 tokens.
export const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 15, out: 75 }, // TODO verify
  "claude-sonnet-4-6": { in: 3, out: 15 }, // TODO verify
  "claude-haiku-4-5-20251001": { in: 1, out: 5 }, // TODO verify
};

export function estimateCost(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}
