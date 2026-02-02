const CLAUDE_SONNET_4_PRICING = {
  INPUT_TOKENS_PER_1K: 0.003,
  OUTPUT_TOKENS_PER_1K: 0.015,
} as const;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export function calculateCost(usage: TokenUsage): CostEstimate {
  const inputCost = (usage.inputTokens / 1000) * CLAUDE_SONNET_4_PRICING.INPUT_TOKENS_PER_1K;
  const outputCost = (usage.outputTokens / 1000) * CLAUDE_SONNET_4_PRICING.OUTPUT_TOKENS_PER_1K;
  
  return {
    inputCost: parseFloat(inputCost.toFixed(6)),
    outputCost: parseFloat(outputCost.toFixed(6)),
    totalCost: parseFloat((inputCost + outputCost).toFixed(6)),
  };
}

