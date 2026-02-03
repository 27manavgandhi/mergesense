export const CONCURRENCY_LIMITS = {
  MAX_CONCURRENT_PR_PIPELINES: 10,
  MAX_CONCURRENT_AI_CALLS: 3,
} as const;

export function getConcurrencyLimits() {
  return {
    prPipelines: CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES,
    aiCalls: CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS,
  };
}