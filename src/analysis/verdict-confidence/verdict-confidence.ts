import type { CompositeRiskScore } from '../risk-scoring/scoring-types.js';
import type { VerdictConfidence } from './verdict-types.js';
import { classifyUncertainty } from './uncertainty-model.js';
import { shouldRecommendManualReview } from './threshold-policy.js';
import { logger } from '../../observability/logger.js';

type Verdict = 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';

/**
 * Expected alignment between risk levels and verdict labels.
 *
 * Based on domain semantics:
 *   LOW risk → safe or safe_with_conditions (AI should agree)
 *   MEDIUM risk → safe_with_conditions or requires_changes
 *   HIGH risk → requires_changes or high_risk
 *   CRITICAL risk → high_risk only
 */
const EXPECTED_ALIGNMENT: Record<string, Verdict[]> = {
  LOW: ['safe', 'safe_with_conditions'],
  MEDIUM: ['safe_with_conditions', 'requires_changes'],
  HIGH: ['requires_changes', 'high_risk'],
  CRITICAL: ['high_risk'],
};

/**
 * Compute alignment between AI verdict and composite risk score.
 *
 * Alignment reflects whether the AI's qualitative assessment
 * agrees with the quantitative risk scoring.
 *
 * Returns:
 *   1.0 - full alignment (AI verdict matches expected for risk level)
 *   0.5 - misalignment penalty (AI verdict contradicts risk level)
 */
function computeAlignmentScore(
  verdict: Verdict,
  risk: CompositeRiskScore
): { score: number; aligned: boolean } {
  const expected = EXPECTED_ALIGNMENT[risk.level] ?? [];

  if (expected.includes(verdict)) {
    return { score: 1.0, aligned: true };
  }

  return { score: 0.5, aligned: false };
}

/**
 * Compute verdict confidence for an AI review.
 *
 * Formula:
 *   final_confidence = min(1, base_confidence × 0.7 + alignment × 0.3)
 *
 * Where:
 *   base_confidence = signal confidence from risk scoring (Day 22)
 *   alignment = 1.0 if verdict matches risk level, 0.5 if not
 *
 * Weight rationale:
 *   Signal confidence (70%): Primary source of ground truth
 *   Alignment (30%): Sanity check between qualitative + quantitative
 *
 * Deterministic. Pure function. No side effects.
 *
 * @param verdict - AI-generated verdict label
 * @param risk - Composite risk score from Day 22
 * @returns Verdict confidence with uncertainty classification
 */
export function computeVerdictConfidence(
  verdict: Verdict,
  risk: CompositeRiskScore
): VerdictConfidence {
  const { score: alignmentScore, aligned } = computeAlignmentScore(verdict, risk);
  const baseConfidence = risk.confidence;

  const finalConfidence = Math.min(
    1.0,
    baseConfidence * 0.7 + alignmentScore * 0.3
  );

  const uncertainty = classifyUncertainty(finalConfidence);
  const manualReviewRecommended = shouldRecommendManualReview(finalConfidence, risk);

  logger.info('verdict_confidence_computed', 'Verdict confidence calculated', {
    verdict,
    riskLevel: risk.level,
    riskScore: risk.score,
    baseConfidence: baseConfidence.toFixed(3),
    alignmentScore: alignmentScore.toFixed(1),
    aligned,
    finalConfidence: finalConfidence.toFixed(3),
    uncertainty,
    manualReviewRecommended,
  });

  if (!aligned) {
    logger.warn('verdict_misalignment', 'AI verdict misaligned with risk score', {
      verdict,
      riskLevel: risk.level,
      riskScore: risk.score,
      expectedVerdicts: EXPECTED_ALIGNMENT[risk.level],
    });
  }

  return {
    verdict,
    confidence: finalConfidence,
    uncertainty,
    manualReviewRecommended,
    alignmentWithRiskScore: aligned ? 'aligned' : 'misaligned',
  };
}