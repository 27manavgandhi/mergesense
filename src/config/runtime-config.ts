import { LIMITS } from './limits.js';

/**
 * Runtime configuration from environment variables.
 * 
 * Validated at startup. Fails fast on invalid values.
 * Cannot exceed hard limits defined in limits.ts.
 */
export const RUNTIME_CONFIG = {
  memoryLimitMb: parseInt(
    process.env.MERGESENSE_MAX_MEMORY_MB ?? String(LIMITS.MAX_MEMORY_MB)
  ),
  maxRequestsPerMinute: parseInt(
    process.env.MERGESENSE_MAX_RPM ?? String(LIMITS.MAX_REQUESTS_PER_MINUTE)
  ),
  maxConcurrentPR: parseInt(
    process.env.MERGESENSE_MAX_CONCURRENT ?? String(LIMITS.MAX_CONCURRENT_PR_PROCESSING)
  ),
} as const;

// Validation
if (isNaN(RUNTIME_CONFIG.memoryLimitMb) || RUNTIME_CONFIG.memoryLimitMb < 128) {
  throw new Error(
    `Invalid MERGESENSE_MAX_MEMORY_MB: ${process.env.MERGESENSE_MAX_MEMORY_MB}. Must be >= 128.`
  );
}

if (RUNTIME_CONFIG.memoryLimitMb > LIMITS.MAX_MEMORY_MB) {
  throw new Error(
    `MERGESENSE_MAX_MEMORY_MB (${RUNTIME_CONFIG.memoryLimitMb}) exceeds hard limit (${LIMITS.MAX_MEMORY_MB})`
  );
}

if (isNaN(RUNTIME_CONFIG.maxRequestsPerMinute) || RUNTIME_CONFIG.maxRequestsPerMinute < 1) {
  throw new Error(
    `Invalid MERGESENSE_MAX_RPM: ${process.env.MERGESENSE_MAX_RPM}. Must be >= 1.`
  );
}

if (isNaN(RUNTIME_CONFIG.maxConcurrentPR) || RUNTIME_CONFIG.maxConcurrentPR < 1) {
  throw new Error(
    `Invalid MERGESENSE_MAX_CONCURRENT: ${process.env.MERGESENSE_MAX_CONCURRENT}. Must be >= 1.`
  );
}