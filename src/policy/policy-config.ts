import type { PolicyMode } from './policy-types.js';

/**
 * Parse and validate policy mode from environment variable.
 * 
 * Throws on invalid value (fail-fast).
 */
function parseMode(value?: string): PolicyMode {
  const allowed: PolicyMode[] = ['OFF', 'WARN', 'ENFORCE'];
  
  if (!value) return 'OFF';
  
  if (!allowed.includes(value as PolicyMode)) {
    throw new Error(`Invalid MERGESENSE_POLICY_MODE: ${value}. Must be one of: ${allowed.join(', ')}`);
  }
  
  return value as PolicyMode;
}

/**
 * Merge policy configuration.
 * 
 * Loaded once at startup from environment variables.
 * Immutable during runtime.
 * 
 * Environment variables:
 *   MERGESENSE_POLICY_MODE - OFF (default) | WARN | ENFORCE
 *   MERGESENSE_MAX_RISK_LEVEL - Maximum allowed risk (default: HIGH)
 *   MERGESENSE_MIN_CONFIDENCE - Minimum verdict confidence (default: 0.60)
 *   MERGESENSE_ALLOW_MISALIGNED - Allow misaligned verdicts (default: true)
 *   MERGESENSE_REPO_OVERRIDE_LIST - Comma-separated list of repos to skip policy
 */
export const POLICY_CONFIG = {
  mode: parseMode(process.env.MERGESENSE_POLICY_MODE),
  maxRiskLevel: process.env.MERGESENSE_MAX_RISK_LEVEL ?? 'HIGH',
  minConfidence: parseFloat(process.env.MERGESENSE_MIN_CONFIDENCE ?? '0.60'),
  allowMisaligned: process.env.MERGESENSE_ALLOW_MISALIGNED !== 'false',
  repoOverrides: (process.env.MERGESENSE_REPO_OVERRIDE_LIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
} as const;

// Validate on load
if (isNaN(POLICY_CONFIG.minConfidence) || 
    POLICY_CONFIG.minConfidence < 0 || 
    POLICY_CONFIG.minConfidence > 1) {
  throw new Error(`Invalid MERGESENSE_MIN_CONFIDENCE: must be between 0 and 1`);
}

const validRiskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
if (!validRiskLevels.includes(POLICY_CONFIG.maxRiskLevel)) {
  throw new Error(`Invalid MERGESENSE_MAX_RISK_LEVEL: ${POLICY_CONFIG.maxRiskLevel}. Must be one of: ${validRiskLevels.join(', ')}`);
}