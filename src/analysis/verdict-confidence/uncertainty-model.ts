import type { UncertaintyLevel } from './verdict-types.js';

/**
 * Classify uncertainty level from confidence score.
 *
 * Thresholds:
 *   ≥ 0.80 → LOW     (high confidence in verdict)
 *   ≥ 0.60 → MODERATE (some uncertainty)
 *   < 0.60 → HIGH    (low confidence, caution warranted)
 *
 * Deterministic. No randomness.
 */
export function classifyUncertainty(confidence: number): UncertaintyLevel {
  if (confidence >= 0.80) return 'LOW';
  if (confidence >= 0.60) return 'MODERATE';
  return 'HIGH';
}