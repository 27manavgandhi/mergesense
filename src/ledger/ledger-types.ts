export interface LedgerEntryInput {
  previousLedgerHash: string;
  executionProofHash: string;
  reviewId: string;
  timestamp: string;
}

export interface LedgerEntry {
  ledgerHash: string;
  previousLedgerHash: string;
  algorithm: 'sha256-ledger-v1';
}

export interface LedgerVerificationResult {
  valid: boolean;
  totalEntries: number;
  brokenAtIndex?: number;
  reason?: string;
  verificationTimestamp: string;
}

export class LedgerGenerationError extends Error {
  constructor(message: string, public readonly reviewId: string) {
    super(message);
    this.name = 'LedgerGenerationError';
  }
}

export class LedgerChainBrokenError extends Error {
  constructor(
    message: string,
    public readonly brokenAtIndex: number,
    public readonly totalEntries: number
  ) {
    super(message);
    this.name = 'LedgerChainBrokenError';
  }
}