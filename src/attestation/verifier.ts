import { generateExecutionProofHash } from './hasher.js';
import { getActiveContract } from '../contracts/registry.js';
import { logger } from '../observability/logger.js';
import type { DecisionRecord } from '../decisions/types.js';
import type { VerificationResult, ExecutionProofInput } from './types.js';
import { ProofVerificationError } from './types.js';

/**
 * Verify execution proof for a decision record.
 * 
 * Verification steps:
 * 1. Extract proof input from decision record
 * 2. Recompute hash
 * 3. Compare to stored hash
 * 4. Validate contract binding
 * 5. Return verification result
 */
export function verifyDecisionProof(decision: DecisionRecord): VerificationResult {
  const reviewId = decision.reviewId;
  
  try {
    // Check if decision is sealed
    if (!decision.executionProofHash || !decision.sealed) {
      return {
        valid: false,
        reviewId,
        contractVersion: decision.contractVersion,
        contractHash: decision.contractHash,
        executionProofHash: decision.executionProofHash || 'missing',
        reason: 'Decision not sealed (no execution proof)',
        verificationTimestamp: new Date().toISOString(),
      };
    }
    
    // Extract proof input from decision
    const proofInput: ExecutionProofInput = {
      contractHash: decision.contractHash,
      contractVersion: decision.contractVersion,
      reviewId: decision.reviewId,
      prOwner: decision.pr.owner,
      prRepo: decision.pr.repo,
      prNumber: decision.pr.number,
      decisionPath: decision.path,
      invariantViolations: {
        total: decision.invariantViolations?.total || 0,
        warn: decision.invariantViolations?.warn || 0,
        error: decision.invariantViolations?.error || 0,
        fatal: decision.invariantViolations?.fatal || 0,
        violationIds: decision.invariantViolations?.violations.map(v => v.invariantId) || [],
      },
      stateTransitions: decision.stateHistory?.transitions.map(t => ({
        from: t.from,
        to: t.to,
      })) || [],
      finalState: decision.stateHistory?.finalState || 'UNKNOWN',
      postconditionResults: {
        totalChecked: decision.postconditions?.totalChecked || 0,
        passed: decision.postconditions?.passed || false,
        violationCount: decision.postconditions?.violations.total || 0,
        violationIds: decision.postconditions?.violations.details?.map(v => v.postconditionId) || [],
      },
      verdict: decision.verdict,
      processingTimeMs: decision.processingTimeMs,
      aiInvoked: decision.aiInvoked,
      fallbackUsed: decision.fallbackUsed,
      commentPosted: decision.commentPosted,
      timestamp: decision.timestamp,
    };
    
    // Recompute hash
    const recomputedHash = generateExecutionProofHash(proofInput);
    
    // Compare hashes
    const hashMatch = recomputedHash === decision.executionProofHash;
    
    if (!hashMatch) {
      logger.error('tamper_detected', 'Execution proof verification failed - hash mismatch', {
        reviewId,
        expected: decision.executionProofHash,
        recomputed: recomputedHash,
        contractVersion: decision.contractVersion,
      });
      
      return {
        valid: false,
        reviewId,
        contractVersion: decision.contractVersion,
        contractHash: decision.contractHash,
        executionProofHash: decision.executionProofHash,
        recomputedHash,
        reason: 'Hash mismatch - possible tampering detected',
        verificationTimestamp: new Date().toISOString(),
      };
    }
    
    // Validate contract binding (only if current version)
    const activeContract = getActiveContract();
    if (decision.contractVersion === activeContract.version) {
      if (decision.contractHash !== activeContract.contractHash) {
        logger.warn('contract_hash_mismatch', 'Decision claims current version but hash differs', {
          reviewId,
          decisionHash: decision.contractHash,
          activeHash: activeContract.contractHash,
        });
        
        return {
          valid: false,
          reviewId,
          contractVersion: decision.contractVersion,
          contractHash: decision.contractHash,
          executionProofHash: decision.executionProofHash,
          recomputedHash,
          reason: 'Contract hash mismatch for current version',
          verificationTimestamp: new Date().toISOString(),
        };
      }
    } else {
      // Historical version - cannot fully validate without contract registry
      logger.info('historical_verification', 'Verifying decision from historical contract version', {
        reviewId,
        decisionVersion: decision.contractVersion,
        activeVersion: activeContract.version,
      });
    }
    
    logger.info('proof_verified', 'Execution proof verified successfully', {
      reviewId,
      contractVersion: decision.contractVersion,
      proofHash: decision.executionProofHash,
    });
    
    return {
      valid: true,
      reviewId,
      contractVersion: decision.contractVersion,
      contractHash: decision.contractHash,
      executionProofHash: decision.executionProofHash,
      recomputedHash,
      verificationTimestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    logger.error('proof_verification_error', 'Error during proof verification', {
      reviewId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    throw new ProofVerificationError(
      `Proof verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      reviewId
    );
  }
}