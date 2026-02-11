import { buildExecutionContract } from './definition.js';
import type { ExecutionContract } from './types.js';

/**
 * Active execution contract.
 * This is the single source of truth for the current system's semantic definition.
 * 
 * IMMUTABILITY: Once this contract is built at startup, it MUST NOT change
 * during the lifetime of the process.
 */
let activeContract: ExecutionContract | null = null;

export function initializeContract(): ExecutionContract {
  if (activeContract !== null) {
    return activeContract;
  }

  activeContract = buildExecutionContract();
  return activeContract;
}

export function getActiveContract(): ExecutionContract {
  if (activeContract === null) {
    throw new Error('Contract not initialized. Call initializeContract() first.');
  }
  return activeContract;
}

export function getContractVersion(): string {
  return getActiveContract().version;
}

export function getContractHash(): string {
  return getActiveContract().contractHash;
}