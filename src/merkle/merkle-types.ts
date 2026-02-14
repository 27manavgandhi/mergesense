export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
}

export interface MerkleTree {
  root: string;
  leafCount: number;
}

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export interface MerkleProof {
  reviewId: string;
  executionProofHash: string;
  proof: MerkleProofStep[];
  root: string;
}

export interface MerkleVerificationRequest {
  leafHash: string;
  proof: MerkleProofStep[];
  root: string;
}

export interface MerkleVerificationResult {
  valid: boolean;
  recomputedRoot?: string;
  reason?: string;
}

export class MerkleTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerkleTreeError';
  }
}