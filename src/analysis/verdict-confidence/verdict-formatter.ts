import type { VerdictConfidence } from './verdict-types.js';

/**
 * Format verdict confidence block for PR comment.
 *
 * Output example:
 * ```
 * ### 🟡 Verdict Confidence
 * Confidence: 74%
 * Uncertainty: MODERATE
 * Manual Review Recommended: NO
 * ```
 */
export function formatVerdictConfidence(v: VerdictConfidence): string {
  const emoji = {
    LOW: '🟢',
    MODERATE: '🟡',
    HIGH: '🔴',
  }[v.uncertainty];

  const manualFlag = v.manualReviewRecommended
    ? '**YES — human review strongly recommended**'
    : 'NO';

  const alignmentNote = v.alignmentWithRiskScore === 'misaligned'
    ? '\n> ⚡ Note: AI verdict and quantitative risk score are misaligned. Review carefully.'
    : '';

  return [
    `### ${emoji} Verdict Confidence`,
    `**Confidence:** ${(v.confidence * 100).toFixed(0)}%`,
    `**Uncertainty:** ${v.uncertainty}`,
    `**Manual Review Recommended:** ${manualFlag}`,
    alignmentNote,
    '',
  ].join('\n');
}