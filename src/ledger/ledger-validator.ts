import type { DecisionRecord } from '../decisions/types.js';
import { generateLedgerHash } from './ledger-hasher.js';
import type { LedgerVerificationResult } from './ledger-types.js';
import { logger } from '../observability/logger.js';



export function verifyLedgerChain(decisions: DecisionRecord[]): LedgerVerificationResult {
  if (decisions.length === 0) {
    logger.info('ledger_verification', 'Empty ledger - valid by default', {
      totalEntries: 0,
    });
    
    return {
      valid: true,
      totalEntries: 0,
      verificationTimestamp: new Date().toISOString(),
    };
  }

  let expectedPrevious = 'GENESIS';

  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];

    // Verify previousLedgerHash matches expected
    if (decision.previousLedgerHash !== expectedPrevious) {
      logger.error('ledger_chain_broken', 'Previous hash mismatch in ledger chain', {
        index: i,
        reviewId: decision.reviewId,
        expectedPrevious,
        actualPrevious: decision.previousLedgerHash,
      });

      return {
        valid: false,
        totalEntries: decisions.length,
        brokenAtIndex: i,
        reason: `Previous hash mismatch at index ${i}: expected ${expectedPrevious}, got ${decision.previousLedgerHash}`,
        verificationTimestamp: new Date().toISOString(),
      };
    }

    // Recompute ledger hash
    const recomputed = generateLedgerHash({
      previousLedgerHash: expectedPrevious,
      executionProofHash: decision.executionProofHash,
      reviewId: decision.reviewId,
      timestamp: decision.timestamp,
    });

    // Verify ledger hash matches
    if (recomputed !== decision.ledgerHash) {
      logger.error('ledger_chain_broken', 'Ledger hash mismatch in chain', {
        index: i,
        reviewId: decision.reviewId,
        expectedHash: recomputed,
        actualHash: decision.ledgerHash,
      });

      return {
        valid: false,
        totalEntries: decisions.length,
        brokenAtIndex: i,
        reason: `Ledger hash mismatch at index ${i}`,
        verificationTimestamp: new Date().toISOString(),
      };
    }

    // Advance to next link
    expectedPrevious = decision.ledgerHash;
  }

  logger.info('ledger_verification', 'Ledger chain verified successfully', {
    totalEntries: decisions.length,
    headHash: decisions[decisions.length - 1].ledgerHash,
  });

  return {
    valid: true,
    totalEntries: decisions.length,
    verificationTimestamp: new Date().toISOString(),
  };
}