/*
 * Rationale:
 * - Security: Highest weight (0.25) - direct exploit potential
 * - Persistence: High weight (0.18) - data corruption risk
 * - Concurrency: Significant (0.15) - race conditions, deadlocks
 * - API Exposure: Moderate (0.12) - public attack surface
 * - State Mutation: Moderate (0.10) - side effect complexity
 * - Critical Path: Moderate (0.10) - system availability
 * - Chunk Density: Lower (0.10) - code volume indicator
 */
export const WEIGHTS = {
  security: 0.25,
  persistence: 0.18,
  concurrency: 0.15,
  apiExposure: 0.12,
  stateMutation: 0.10,
  criticalPath: 0.10,
  chunkDensity: 0.10,
} as const;

export const MAX_SCORE = 100;

/**
 * Validate that weights sum to 1.0.
 * Called at module initialization.
 */
export function validateWeights(): void {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1.0) > 0.001) {
    throw new Error(`Risk scoring weights must sum to 1.0. Current sum: ${total}`);
  }
}

// Validate at module load time
validateWeights();