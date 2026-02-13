import { generateLedgerHash } from './ledger-hasher.js';
import { logger } from '../observability/logger.js';
import type { LedgerEntry, LedgerEntryInput } from './ledger-types.js';
import { LedgerGenerationError } from './ledger-types.js';


export class LedgerManager {
  private lastLedgerHash: string = 'GENESIS';
  private entryCount: number = 0;


  getPreviousHash(): string {
    return this.lastLedgerHash;
  }

 
  getEntryCount(): number {
    return this.entryCount;
  }


  generateLedgerEntry(
    executionProofHash: string,
    reviewId: string,
    timestamp: string
  ): LedgerEntry {
    try {
      const input: LedgerEntryInput = {
        previousLedgerHash: this.lastLedgerHash,
        executionProofHash,
        reviewId,
        timestamp,
      };

      const ledgerHash = generateLedgerHash(input);

      logger.info('ledger_entry_generated', 'Ledger entry generated', {
        reviewId,
        previousHash: this.lastLedgerHash,
        ledgerHash,
        entryNumber: this.entryCount + 1,
      });

      // Advance ledger state
      this.lastLedgerHash = ledgerHash;
      this.entryCount++;

      return {
        ledgerHash,
        previousLedgerHash: input.previousLedgerHash,
        algorithm: 'sha256-ledger-v1',
      };
    } catch (error) {
      logger.error('ledger_generation_failed', 'Failed to generate ledger entry', {
        reviewId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new LedgerGenerationError(
        `Ledger entry generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        reviewId
      );
    }
  }

  initializeFromHistory(decisions: { ledgerHash: string }[]): void {
    if (decisions.length === 0) {
      this.lastLedgerHash = 'GENESIS';
      this.entryCount = 0;
      logger.info('ledger_initialized', 'Ledger initialized (empty)', {
        headHash: 'GENESIS',
        entryCount: 0,
      });
      return;
    }

    // Take the most recent decision's hash as current head
    const mostRecent = decisions[decisions.length - 1];
    this.lastLedgerHash = mostRecent.ledgerHash;
    this.entryCount = decisions.length;

    logger.info('ledger_initialized', 'Ledger initialized from history', {
      headHash: this.lastLedgerHash,
      entryCount: this.entryCount,
    });
  }
}

// Global ledger manager instance
export const ledgerManager = new LedgerManager();