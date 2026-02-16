import type { CompositeRiskScore } from './scoring-types.js';

export function formatRiskScore(score: CompositeRiskScore): string {
  const emoji = {
    LOW: '✅',
    MEDIUM: '⚠️',
    HIGH: '🔶',
    CRITICAL: '🔴',
  }[score.level];

  return [
    `### ${emoji} PR Risk Score: ${score.score} / 100 (${score.level})`,
    `**Confidence:** ${(score.confidence * 100).toFixed(0)}%`,
    '',
  ].join('\n');
}

/**
 * Format detailed breakdown for debugging/logging.
 */
export function formatDetailedBreakdown(score: CompositeRiskScore): string {
  const dimensions = Object.entries(score.breakdown)
    .map(([key, value]) => `  - ${key}: ${(value * 100).toFixed(0)}%`)
    .join('\n');

  return [
    `Risk Breakdown:`,
    dimensions,
    `Overall: ${score.score}/100 (${score.level})`,
    `Confidence: ${(score.confidence * 100).toFixed(0)}%`,
  ].join('\n');
}