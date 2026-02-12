import crypto from 'crypto';
import type { ExecutionProofInput } from './types.js';

/**
 * Canonical JSON stringifier with deterministic key ordering.
 * 
 * Requirements:
 * - Recursively sort object keys
 * - Preserve array order
 * - No undefined values
 * - No functions
 * - UTF-8 normalized
 * - No whitespace variation
 */
function canonicalStringify(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'null';
  
  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    const items = obj.map(item => canonicalStringify(item));
    return `[${items.join(',')}]`;
  }
  
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter(key => obj[key] !== undefined)
      .map(key => `"${key}":${canonicalStringify(obj[key])}`);
    return `{${pairs.join(',')}}`;
  }
  
  return 'null';
}

/**
 * Generate deterministic execution proof hash.
 * 
 * Hash is computed over canonical representation of:
 * - Contract identity (version + hash)
 * - Execution identity (reviewId + PR)
 * - Execution path (decision path + states)
 * - Correctness results (invariants + postconditions)
 * - Execution outcomes (verdict + flags + timing)
 * 
 * The hash is stable, deterministic, and tamper-evident.
 */
export function generateExecutionProofHash(input: ExecutionProofInput): string {
  // Construct proof object with canonical field ordering
  const proofObject = {
    // Contract binding
    contractHash: input.contractHash,
    contractVersion: input.contractVersion,
    
    // Execution identity
    reviewId: input.reviewId,
    pr: {
      owner: input.prOwner,
      repo: input.prRepo,
      number: input.prNumber,
    },
    
    // Execution path
    decisionPath: input.decisionPath,
    finalState: input.finalState,
    stateTransitions: input.stateTransitions.map(t => ({
      from: t.from,
      to: t.to,
    })),
    
    // Correctness results
    invariants: {
      total: input.invariantViolations.total,
      warn: input.invariantViolations.warn,
      error: input.invariantViolations.error,
      fatal: input.invariantViolations.fatal,
      violationIds: [...input.invariantViolations.violationIds].sort(),
    },
    postconditions: {
      totalChecked: input.postconditionResults.totalChecked,
      passed: input.postconditionResults.passed,
      violationCount: input.postconditionResults.violationCount,
      violationIds: [...input.postconditionResults.violationIds].sort(),
    },
    
    // Execution outcomes
    verdict: input.verdict || null,
    aiInvoked: input.aiInvoked,
    fallbackUsed: input.fallbackUsed,
    commentPosted: input.commentPosted,
    processingTimeMs: input.processingTimeMs,
    
    // Timestamp (top-level only, deterministic)
    timestamp: input.timestamp,
  };
  
  // Generate canonical string representation
  const canonical = canonicalStringify(proofObject);
  
  // Compute SHA-256 hash
  const hash = crypto
    .createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex');
  
  // Truncate to 32 chars for readability
  return hash.substring(0, 32);
}

/**
 * Verify that a hash was generated from the given input.
 */
export function verifyExecutionProofHash(
  input: ExecutionProofInput,
  expectedHash: string
): boolean {
  const recomputedHash = generateExecutionProofHash(input);
  return recomputedHash === expectedHash;
}