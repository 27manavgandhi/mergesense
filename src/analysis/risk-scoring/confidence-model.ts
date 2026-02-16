import type { PreCheckResult } from '../../types.js';

export function calculateConfidence(preChecks: PreCheckResult): number {
  const allSignals = [
    ...preChecks.security,
    ...preChecks.persistence,
    ...preChecks.concurrency,
    ...preChecks.apiSurface,
    ...preChecks.stateMutation,
    ...preChecks.errorHandling,
    ...preChecks.criticalPaths,
  ];

  if (allSignals.length === 0) {
    // No signals = moderate confidence (neutral)
    return 0.5;
  }

  const high = allSignals.filter(s => s.confidence === 'high').length;
  const medium = allSignals.filter(s => s.confidence === 'medium').length;
  const low = allSignals.filter(s => s.confidence === 'low').length;

  const weightedSum =
    high * 1.0 +
    medium * 0.6 +
    low * 0.3;

  const maxPossible = allSignals.length * 1.0;

  return Math.min(1.0, weightedSum / maxPossible);
}