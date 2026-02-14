import crypto from 'crypto';
import type { MerkleNode, MerkleTree } from './merkle-types.js';
import { MerkleTreeError } from './merkle-types.js';
import { logger } from '../observability/logger.js';

/**
 * Hash two values together using SHA-256.
 * Uses deterministic concatenation with delimiter.
 */
function hashPair(left: string, right: string): string {
  const payload = left + '|' + right;
  return crypto
    .createHash('sha256')
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Build Merkle tree from leaf hashes.
 * 
 * Algorithm:
 * 1. Start with leaf hashes as level 0
 * 2. For each level, pair adjacent nodes
 * 3. If odd count, duplicate last node
 * 4. Hash each pair to create next level
 * 5. Repeat until single root node
 * 
 * Properties:
 * - Deterministic (same input → same tree)
 * - Stable ordering
 * - No truncation
 * - SHA-256 throughout
 */
export function buildMerkleTree(leafHashes: string[]): MerkleTree {
  if (leafHashes.length === 0) {
    throw new MerkleTreeError('Cannot build Merkle tree from empty leaf set');
  }

  logger.info('merkle_tree_build', 'Building Merkle tree', {
    leafCount: leafHashes.length,
  });

  // Build tree from bottom up
  let currentLevel: MerkleNode[] = leafHashes.map(hash => ({ hash }));

  while (currentLevel.length > 1) {
    const nextLevel: MerkleNode[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length 
        ? currentLevel[i + 1]
        : currentLevel[i]; // Duplicate last if odd

      const parentHash = hashPair(left.hash, right.hash);
      nextLevel.push({
        hash: parentHash,
        left,
        right,
      });
    }

    currentLevel = nextLevel;
  }

  const root = currentLevel[0].hash;

  logger.info('merkle_tree_built', 'Merkle tree constructed', {
    root,
    leafCount: leafHashes.length,
  });

  return {
    root,
    leafCount: leafHashes.length,
  };
}

/**
 * Get Merkle root without building full tree structure.
 * More efficient for root-only computation.
 */
export function getMerkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) {
    throw new MerkleTreeError('Cannot compute Merkle root from empty leaf set');
  }

  let currentLevel = [...leafHashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length 
        ? currentLevel[i + 1]
        : currentLevel[i]; // Duplicate last if odd

      nextLevel.push(hashPair(left, right));
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}