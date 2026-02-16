import type { PreCheckResult } from '../../types.js';
import type { DiffChunk } from '../diff-intelligence/chunk-types.js';
import type { CompositeRiskScore, RiskDimensionScores } from './scoring-types.js';
import { WEIGHTS, MAX_SCORE } from './weight-config.js';
import { calculateConfidence } from './confidence-model.js';
import { logger } from '../../observability/logger.js';


function normalize(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.min(1, value / max);
}


function computeChunkDensity(chunks: DiffChunk[]): number {
  if (chunks.length === 0) return 0;

  const high = chunks.filter(c => c.priority === 'high').length;
  const medium = chunks.filter(c => c.priority === 'medium').length;

  // High chunks weighted 2x
  const weightedCount = high * 2 + medium;
  const maxPossible = chunks.length * 2;

  return normalize(weightedCount, maxPossible);
}


export function computeCompositeRiskScore(
  preChecks: PreCheckResult,
  chunks: DiffChunk[]
): CompositeRiskScore {
  // Normalize each dimension (0-1 range)
  const dimensionScores: RiskDimensionScores = {
    security: normalize(preChecks.security.length, 5),
    persistence: normalize(preChecks.persistence.length, 5),
    concurrency: normalize(preChecks.concurrency.length, 5),
    apiExposure: normalize(preChecks.apiSurface.length, 5),
    stateMutation: normalize(preChecks.stateMutation.length, 5),
    criticalPath: normalize(preChecks.criticalPaths.length, 3),
    chunkDensity: computeChunkDensity(chunks),
  };

  // Compute weighted sum
  const weightedSum =
    dimensionScores.security * WEIGHTS.security +
    dimensionScores.persistence * WEIGHTS.persistence +
    dimensionScores.concurrency * WEIGHTS.concurrency +
    dimensionScores.apiExposure * WEIGHTS.apiExposure +
    dimensionScores.stateMutation * WEIGHTS.stateMutation +
    dimensionScores.criticalPath * WEIGHTS.criticalPath +
    dimensionScores.chunkDensity * WEIGHTS.chunkDensity;

  // Scale to 0-100 and round
  const finalScore = Math.round(weightedSum * MAX_SCORE);

  // Classify risk level
  let level: CompositeRiskScore['level'];
  if (finalScore >= 85) {
    level = 'CRITICAL';
  } else if (finalScore >= 65) {
    level = 'HIGH';
  } else if (finalScore >= 40) {
    level = 'MEDIUM';
  } else {
    level = 'LOW';
  }

  // Calculate confidence
  const confidence = calculateConfidence(preChecks);

  logger.info('risk_score_computed', 'Composite PR risk score calculated', {
    score: finalScore,
    level,
    confidence: confidence.toFixed(2),
    breakdown: {
      security: dimensionScores.security.toFixed(2),
      persistence: dimensionScores.persistence.toFixed(2),
      concurrency: dimensionScores.concurrency.toFixed(2),
      apiExposure: dimensionScores.apiExposure.toFixed(2),
      stateMutation: dimensionScores.stateMutation.toFixed(2),
      criticalPath: dimensionScores.criticalPath.toFixed(2),
      chunkDensity: dimensionScores.chunkDensity.toFixed(2),
    },
  });

  return {
    score: finalScore,
    level,
    confidence,
    breakdown: dimensionScores,
  };
}