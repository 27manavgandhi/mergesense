import crypto from 'crypto';
import type { LedgerEntryInput } from './ledger-types.js';

export function generateLedgerHash(input: LedgerEntryInput): string {
  const payload =
    input.previousLedgerHash +
    '|' +
    input.executionProofHash +
    '|' +
    input.reviewId +
    '|' +
    input.timestamp;

  return crypto
    .createHash('sha256')
    .update(payload, 'utf8')
    .digest('hex');
}


export function verifyLedgerHash(
  input: LedgerEntryInput,
  expectedHash: string
): boolean {
  const recomputedHash = generateLedgerHash(input);
  return recomputedHash === expectedHash;
}