export interface ExecutionProofInput {
  contractHash: string;
  contractVersion: string;
  reviewId: string;
  prOwner: string;
  prRepo: string;
  prNumber: number;
  decisionPath: string;
  invariantViolations: {
    total: number;
    warn: number;
    error: number;
    fatal: number;
    violationIds: string[];
  };
  stateTransitions: Array<{ from: string; to: string }>;
  finalState: string;
  postconditionResults: {
    totalChecked: number;
    passed: boolean;
    violationCount: number;
    violationIds: string[];
  };
  verdict?: string;
  processingTimeMs: number;
  aiInvoked: boolean;
  fallbackUsed: boolean;
  commentPosted: boolean;
  timestamp: string;
}

export interface ExecutionProof {
  executionProofHash: string;
  executionProofAlgorithm: 'sha256-v1';
  sealed: boolean;
}

export interface VerificationResult {
  valid: boolean;
  reviewId: string;
  contractVersion: string;
  contractHash: string;
  executionProofHash: string;
  recomputedHash?: string;
  reason?: string;
  verificationTimestamp: string;
}

export class ProofGenerationError extends Error {
  constructor(message: string, public readonly reviewId: string) {
    super(message);
    this.name = 'ProofGenerationError';
  }
}

export class ProofVerificationError extends Error {
  constructor(message: string, public readonly reviewId: string) {
    super(message);
    this.name = 'ProofVerificationError';
  }
}