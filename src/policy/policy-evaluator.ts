import type { CompositeRiskScore } from '../analysis/risk-scoring/scoring-types.js';
import type { VerdictConfidence } from '../analysis/verdict-confidence/verdict-types.js';
import { POLICY_CONFIG } from './policy-config.js';
import type { MergePolicyResult } from './policy-types.js';
import { logger } from '../observability/logger.js';

const RISK_HIERARCHY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Check if risk level exceeds configured threshold.
 * 
 * Uses ordinal comparison based on risk hierarchy.
 */
function exceedsRiskThreshold(riskLevel: string): boolean {
  const currentIndex = RISK_HIERARCHY.indexOf(riskLevel);
  const maxIndex = RISK_HIERARCHY.indexOf(POLICY_CONFIG.maxRiskLevel);
  
  return currentIndex > maxIndex;
}

/**
 * Evaluate merge policy for a PR.
 * 
 * Checks:
 * 1. Repo override list (bypasses all checks)
 * 2. Risk level threshold
 * 3. Minimum confidence threshold
 * 4. Alignment with risk score (if configured)
 * 
 * Deterministic. Pure function. No side effects.
 * 
 * @param repoFullName - Repository in "owner/repo" format
 * @param risk - Composite risk score from Day 22
 * @param verdict - Verdict confidence from Day 23
 * @returns Policy evaluation result
 */
export function evaluateMergePolicy(
  repoFullName: string,
  risk: CompositeRiskScore,
  verdict: VerdictConfidence
): MergePolicyResult {
  // Check repo override
  if (POLICY_CONFIG.repoOverrides.includes(repoFullName)) {
    logger.info('policy_repo_override', 'Repository in override list, policy bypassed', {
      repo: repoFullName,
    });
    
    return {
      allowed: true,
      violated: false,
      reasons: [],
    };
  }

  const reasons: string[] = [];

  // Check risk level threshold
  if (exceedsRiskThreshold(risk.level)) {
    reasons.push(`Risk level ${risk.level} exceeds allowed ${POLICY_CONFIG.maxRiskLevel}`);
  }

  // Check minimum confidence
  if (verdict.confidence < POLICY_CONFIG.minConfidence) {
    reasons.push(`Confidence ${(verdict.confidence * 100).toFixed(0)}% below minimum ${(POLICY_CONFIG.minConfidence * 100).toFixed(0)}%`);
  }

  // Check alignment (if enforcement enabled)
  if (!POLICY_CONFIG.allowMisaligned && 
      verdict.alignmentWithRiskScore === 'misaligned') {
    reasons.push('Verdict misaligned with risk score');
  }

  const result: MergePolicyResult = {
    allowed: reasons.length === 0,
    violated: reasons.length > 0,
    reasons,
  };

  logger.info('policy_evaluation', 'Merge policy evaluated', {
    repo: repoFullName,
    mode: POLICY_CONFIG.mode,
    allowed: result.allowed,
    violated: result.violated,
    reasons: result.reasons,
    riskLevel: risk.level,
    confidence: verdict.confidence.toFixed(2),
  });

  return result;
}