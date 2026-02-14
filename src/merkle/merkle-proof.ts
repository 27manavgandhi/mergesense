import crypto from 'crypto';
import type { MerkleProofStep } from './merkle-types.js';
import { MerkleTreeError } from './merkle-types.js';
import { logger } from '../observability/logger.js';

/**
 * Hash two values together (same as merkle-builder).
 */
function hashPair(left: string, right: string): string {
  const payload = left + '|' + right;
  return crypto
    .createHash('sha256')
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Generate Merkle proof for a specific leaf.
 * 
 * The proof consists of sibling hashes needed to reconstruct the root.
 * Each step specifies whether the sibling is on the left or right.
 * 
 * @param leafHashes - All leaf hashes in order
 * @param leafIndex - Index of the leaf to prove
 * @returns Array of proof steps
 */
export function generateMerkleProof(
  leafHashes: string[],
  leafIndex: number
): MerkleProofStep[] {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new MerkleTreeError(`Invalid leaf index: ${leafIndex}`);
  }

  logger.info('merkle_proof_generation', 'Generating Merkle proof', {
    leafIndex,
    totalLeaves: leafHashes.length,
  });

  const proof: MerkleProofStep[] = [];
  let currentLevel = [...leafHashes];
  let currentIndex = leafIndex;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length 
        ? currentLevel[i + 1]
        : currentLevel[i]; // Duplicate last if odd

      // If current index is part of this pair, add sibling to proof
      if (i === currentIndex || i + 1 === currentIndex) {
        if (currentIndex === i) {
          // Current node is on left, add right sibling
          proof.push({
            position: 'right',
            hash: right,
          });
        } else {
          // Current node is on right, add left sibling
          proof.push({
            position: 'left',
            hash: left,
          });
        }
      }

      nextLevel.push(hashPair(left, right));
    }

    currentLevel = nextLevel;
    currentIndex = Math.floor(currentIndex / 2);
  }

  logger.info('merkle_proof_generated', 'Merkle proof generated', {
    leafIndex,
    proofSteps: proof.length,
  });

  return proof;
}