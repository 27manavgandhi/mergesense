import type { CompositeRiskScore } from '../risk-scoring/scoring-types.js';

/**
 * Determine whether manual review should be recommended.
 *
 * Triggers when:
 *   1. Confidence < 0.50 (any level - very low confidence)
 *   2. Risk HIGH and confidence < 0.70 (insufficient certainty for high risk)
 *   3. Risk CRITICAL and confidence < 0.85 (near-certain required for critical)
 *
 * Rationale:
 *   High-risk PRs require higher confidence before automation can be trusted.
 *   Low confidence at any risk level means signals are ambiguous.
 *
 * Deterministic. No randomness.
 */
export function shouldRecommendManualReview(
  confidence: number,
  risk: CompositeRiskScore
): boolean {
  // Absolute low-confidence threshold
  if (confidence < 0.50) return true;

  // High risk with moderate confidence
  if (risk.level === 'HIGH' && confidence < 0.70) return true;

  // Critical risk requires very high confidence
  if (risk.level === 'CRITICAL' && confidence < 0.85) return true;

  return false;
}