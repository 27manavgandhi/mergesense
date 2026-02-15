import type { DiffChunk } from './chunk-types.js';
import { logger } from '../../observability/logger.js';

const MAX_MEDIUM_CHUNKS = 10;
const MAX_LOW_CHUNKS_DETAIL = 5;

/**
 * Sort chunks by priority and risk score.
 * 
 * Sort order:
 * 1. High priority (descending by riskScore)
 * 2. Medium priority (descending by riskScore)
 * 3. Low priority (descending by riskScore)
 */
function sortChunks(chunks: DiffChunk[]): DiffChunk[] {
  const priorityOrder = { high: 0, medium: 1, low: 2 };

  return [...chunks].sort((a, b) => {
    // Sort by priority first
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Within same priority, sort by risk score descending
    return b.riskScore - a.riskScore;
  });
}

/**
 * Apply deterministic truncation if needed.
 * 
 * Rules:
 * - Always include ALL high priority chunks
 * - Include top N medium chunks
 * - Include top M low chunks with detail
 * - Summarize remaining low chunks
 */
export function prioritizeChunks(chunks: DiffChunk[]): {
  included: DiffChunk[];
  truncated: number;
  summary: string;
} {
  const sorted = sortChunks(chunks);

  const high = sorted.filter(c => c.priority === 'high');
  const medium = sorted.filter(c => c.priority === 'medium');
  const low = sorted.filter(c => c.priority === 'low');

  logger.info('chunk_prioritization', 'Prioritizing diff chunks', {
    total: chunks.length,
    high: high.length,
    medium: medium.length,
    low: low.length,
  });

  // Always include all high priority
  const included: DiffChunk[] = [...high];

  // Include top N medium
  const mediumToInclude = medium.slice(0, MAX_MEDIUM_CHUNKS);
  included.push(...mediumToInclude);

  // Include top M low with detail
  const lowToInclude = low.slice(0, MAX_LOW_CHUNKS_DETAIL);
  included.push(...lowToInclude);

  // Calculate truncation
  const truncatedMedium = Math.max(0, medium.length - MAX_MEDIUM_CHUNKS);
  const truncatedLow = Math.max(0, low.length - MAX_LOW_CHUNKS_DETAIL);
  const totalTruncated = truncatedMedium + truncatedLow;

  // Generate summary of truncated chunks
  let summary = '';
  if (totalTruncated > 0) {
    const truncatedCategories = new Set([
      ...medium.slice(MAX_MEDIUM_CHUNKS).map(c => c.category),
      ...low.slice(MAX_LOW_CHUNKS_DETAIL).map(c => c.category),
    ]);

    summary = `${totalTruncated} additional low-priority chunks (categories: ${Array.from(truncatedCategories).join(', ')}) were omitted for token efficiency.`;

    logger.info('chunk_truncation', 'Applied deterministic truncation', {
      truncatedMedium,
      truncatedLow,
      totalTruncated,
      categories: Array.from(truncatedCategories),
    });
  }

  return {
    included,
    truncated: totalTruncated,
    summary,
  };
}