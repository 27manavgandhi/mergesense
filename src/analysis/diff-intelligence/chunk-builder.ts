import type { DiffFile } from '../../types.js';
import type { DiffChunk } from './chunk-types.js';

const MAX_CHUNK_LINES = 100;

/**
 * Segment file patches into logical chunks.
 * 
 * Segmentation rules:
 * - Split on diff hunk markers (@@)
 * - Group logically contiguous changes
 * - Remove whitespace-only segments
 * - Track lines added/removed
 * - Preserve original order
 * - Never exceed max chunk size
 */
export function buildDiffChunks(files: DiffFile[]): Omit<DiffChunk, 'priority' | 'riskScore' | 'category'>[] {
  const chunks: Omit<DiffChunk, 'priority' | 'riskScore' | 'category'>[] = [];

  for (const file of files) {
    if (!file.patch || file.patch.trim().length === 0) {
      continue;
    }

    const hunks = file.patch.split(/^@@.*@@$/m).filter(h => h.trim().length > 0);

    for (const hunk of hunks) {
      const lines = hunk.split('\n');
      let linesAdded = 0;
      let linesRemoved = 0;

      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          linesAdded++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          linesRemoved++;
        }
      }

      // Skip whitespace-only chunks
      const meaningfulLines = lines.filter(l => 
        l.trim().length > 0 && 
        !l.startsWith('@@') &&
        !l.startsWith('+++') &&
        !l.startsWith('---')
      );

      if (meaningfulLines.length === 0) {
        continue;
      }

      // Truncate if too large
      let code = hunk;
      if (lines.length > MAX_CHUNK_LINES) {
        const truncated = lines.slice(0, MAX_CHUNK_LINES);
        code = truncated.join('\n') + '\n... (truncated)';
      }

      chunks.push({
        filePath: file.filename,
        linesAdded,
        linesRemoved,
        code,
      });
    }
  }

  return chunks;
}