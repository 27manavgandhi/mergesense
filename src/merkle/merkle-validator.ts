import crypto from 'crypto';
import type { MerkleProofStep, MerkleVerificationRequest, MerkleVerificationResult } from './merkle-types.js';
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
 * Verify a Merkle proof.
 * 
 * Algorithm:
 * 1. Start with leaf hash
 * 2. For each proof step, hash with sibling (left or right)
 * 3. Final hash should equal root
 * 
 * @param leafHash - The leaf hash to verify
 * @param proof - Array of proof steps (siblings)
 * @param expectedRoot - Expected Merkle root
 * @returns Verification result
 */
export function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string
): MerkleVerificationResult {
  logger.info('merkle_proof_verification', 'Verifying Merkle proof', {
    leafHash: leafHash.substring(0, 16) + '...',
    proofSteps: proof.length,
    expectedRoot: expectedRoot.substring(0, 16) + '...',
  });

  let currentHash = leafHash;

  // Climb the tree using proof steps
  for (const step of proof) {
    if (step.position === 'left') {
      // Sibling is on left
      currentHash = hashPair(step.hash, currentHash);
    } else {
      // Sibling is on right
      currentHash = hashPair(currentHash, step.hash);
    }
  }

  const valid = currentHash === expectedRoot;

  if (!valid) {
    logger.warn('merkle_proof_invalid', 'Merkle proof verification failed', {
      leafHash: leafHash.substring(0, 16) + '...',
      expectedRoot: expectedRoot.substring(0, 16) + '...',
      recomputedRoot: currentHash.substring(0, 16) + '...',
    });

    return {
      valid: false,
      recomputedRoot: currentHash,
      reason: 'Recomputed root does not match expected root',
    };
  }

  logger.info('merkle_proof_verified', 'Merkle proof verified successfully', {
    leafHash: leafHash.substring(0, 16) + '...',
    root: expectedRoot.substring(0, 16) + '...',
  });

  return {
    valid: true,
    recomputedRoot: currentHash,
  };
}

/**
 * Verify a Merkle proof from request format.
 */
export function verifyMerkleProofRequest(
  request: MerkleVerificationRequest
): MerkleVerificationResult {
  return verifyMerkleProof(request.leafHash, request.proof, request.root);
}