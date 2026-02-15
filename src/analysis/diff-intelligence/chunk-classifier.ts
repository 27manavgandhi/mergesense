import type { PreCheckResult } from '../../types.js';
import type { DiffChunk } from './chunk-types.js';

/**
 * Calculate risk score for a chunk based on:
 * - File path patterns
 * - Change density
 * - Pre-check signal presence
 * - Security boundaries
 * - API surface exposure
 * 
 * Score range: 0-100
 * Deterministic (no randomness)
 */
function calculateRiskScore(
  chunk: Omit<DiffChunk, 'priority' | 'riskScore' | 'category'>,
  preChecks: PreCheckResult
): number {
  let score = 0;
  const filePath = chunk.filePath.toLowerCase();

  // Security-sensitive patterns
  if (filePath.includes('auth') || 
      filePath.includes('security') || 
      filePath.includes('crypto') ||
      filePath.includes('password') ||
      filePath.includes('token')) {
    score += 40;
  }

  // Persistence operations
  if (filePath.includes('database') || 
      filePath.includes('migration') || 
      filePath.includes('schema') ||
      filePath.includes('persistence') ||
      filePath.includes('storage')) {
    score += 30;
  }

  // Concurrency patterns
  if (filePath.includes('concurrency') || 
      filePath.includes('semaphore') || 
      filePath.includes('lock') ||
      filePath.includes('mutex') ||
      filePath.includes('atomic')) {
    score += 25;
  }

  // API surface
  if (filePath.includes('api') || 
      filePath.includes('endpoint') || 
      filePath.includes('route') ||
      filePath.includes('handler')) {
    score += 20;
  }

  // Core infrastructure
  if (filePath.includes('index.ts') || 
      filePath.includes('main.ts') || 
      filePath.includes('server.ts')) {
    score += 20;
  }

  // Large changes
  const totalLines = chunk.linesAdded + chunk.linesRemoved;
  if (totalLines > 50) {
    score += 15;
  } else if (totalLines > 20) {
    score += 10;
  } else if (totalLines > 10) {
    score += 5;
  }

  // Pre-check signal correlation
  const hasHighRiskSignals = preChecks.security.some(s => s.confidence === 'high') ||
                             preChecks.persistence.some(s => s.confidence === 'high') ||
                             preChecks.concurrency.some(s => s.confidence === 'high');
  
  if (hasHighRiskSignals) {
    score += 15;
  }

  // Normalize to 0-100 range
  return Math.min(100, score);
}

/**
 * Determine category based on file path.
 */
function determineCategory(filePath: string): string {
  const lower = filePath.toLowerCase();
  
  if (lower.includes('auth') || lower.includes('security')) return 'security';
  if (lower.includes('database') || lower.includes('persistence')) return 'persistence';
  if (lower.includes('api') || lower.includes('endpoint')) return 'api';
  if (lower.includes('test') || lower.includes('spec')) return 'test';
  if (lower.includes('config')) return 'configuration';
  if (lower.includes('types.ts') || lower.includes('interface')) return 'types';
  if (lower.includes('util') || lower.includes('helper')) return 'utility';
  
  return 'application';
}

/**
 * Map risk score to priority level.
 * 
 * 70-100 → high
 * 40-69  → medium
 * <40    → low
 */
function mapScoreToPriority(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Classify chunks with risk scoring and priority assignment.
 */
export function classifyChunks(
  chunks: Omit<DiffChunk, 'priority' | 'riskScore' | 'category'>[],
  preChecks: PreCheckResult
): DiffChunk[] {
  return chunks.map(chunk => {
    const riskScore = calculateRiskScore(chunk, preChecks);
    const priority = mapScoreToPriority(riskScore);
    const category = determineCategory(chunk.filePath);

    return {
      ...chunk,
      riskScore,
      priority,
      category,
    };
  });
}