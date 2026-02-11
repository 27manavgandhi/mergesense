import { getActiveContract } from './registry.js';
import { buildExecutionContract } from './definition.js';
import { CURRENT_CONTRACT_VERSION } from './version.js';
import { logger } from '../observability/logger.js';
import type { ContractValidationResult, ContractValidationError, ExecutionContract } from './types.js';
import { ContractMismatchError } from './types.js';

function compareContracts(
  current: ExecutionContract,
  expected: ExecutionContract
): ContractValidationError[] {
  const errors: ContractValidationError[] = [];

  // Version mismatch
  if (current.version !== expected.version) {
    errors.push({
      code: 'VERSION_MISMATCH',
      message: `Contract version mismatch: expected ${expected.version}, got ${current.version}`,
      severity: 'fatal',
      detail: { expected: expected.version, actual: current.version },
    });
  }

  // FSM schema changes
  if (current.fsmSchema.stateCount !== expected.fsmSchema.stateCount) {
    errors.push({
      code: 'FSM_STATE_COUNT_CHANGED',
      message: `State count changed: expected ${expected.fsmSchema.stateCount}, got ${current.fsmSchema.stateCount}`,
      severity: 'fatal',
      detail: {
        expected: expected.fsmSchema.stateCount,
        actual: current.fsmSchema.stateCount,
      },
    });
  }

  const addedStates = current.fsmSchema.states.filter(s => !expected.fsmSchema.states.includes(s));
  const removedStates = expected.fsmSchema.states.filter(s => !current.fsmSchema.states.includes(s));

  if (addedStates.length > 0) {
    errors.push({
      code: 'FSM_STATES_ADDED',
      message: `States added without version increment: ${addedStates.join(', ')}`,
      severity: 'fatal',
      detail: { addedStates },
    });
  }

  if (removedStates.length > 0) {
    errors.push({
      code: 'FSM_STATES_REMOVED',
      message: `States removed without version increment: ${removedStates.join(', ')}`,
      severity: 'fatal',
      detail: { removedStates },
    });
  }

  // Invariant schema changes
  if (current.invariantSchema.invariantCount !== expected.invariantSchema.invariantCount) {
    errors.push({
      code: 'INVARIANT_COUNT_CHANGED',
      message: `Invariant count changed: expected ${expected.invariantSchema.invariantCount}, got ${current.invariantSchema.invariantCount}`,
      severity: 'fatal',
      detail: {
        expected: expected.invariantSchema.invariantCount,
        actual: current.invariantSchema.invariantCount,
      },
    });
  }

  const addedInvariants = current.invariantSchema.invariantIds.filter(
    id => !expected.invariantSchema.invariantIds.includes(id)
  );
  const removedInvariants = expected.invariantSchema.invariantIds.filter(
    id => !current.invariantSchema.invariantIds.includes(id)
  );

  if (addedInvariants.length > 0) {
    errors.push({
      code: 'INVARIANTS_ADDED',
      message: `Invariants added without version increment: ${addedInvariants.join(', ')}`,
      severity: 'error',
      detail: { addedInvariants },
    });
  }

  if (removedInvariants.length > 0) {
    errors.push({
      code: 'INVARIANTS_REMOVED',
      message: `Invariants removed without version increment: ${removedInvariants.join(', ')}`,
      severity: 'fatal',
      detail: { removedInvariants },
    });
  }

  // Check for severity changes
  for (const id of current.invariantSchema.invariantIds) {
    if (expected.invariantSchema.severities[id] &&
        current.invariantSchema.severities[id] !== expected.invariantSchema.severities[id]) {
      errors.push({
        code: 'INVARIANT_SEVERITY_CHANGED',
        message: `Invariant ${id} severity changed without version increment`,
        severity: 'fatal',
        detail: {
          invariantId: id,
          expected: expected.invariantSchema.severities[id],
          actual: current.invariantSchema.severities[id],
        },
      });
    }
  }

  // Postcondition schema changes
  if (current.postconditionSchema.postconditionCount !== expected.postconditionSchema.postconditionCount) {
    errors.push({
      code: 'POSTCONDITION_COUNT_CHANGED',
      message: `Postcondition count changed: expected ${expected.postconditionSchema.postconditionCount}, got ${current.postconditionSchema.postconditionCount}`,
      severity: 'fatal',
      detail: {
        expected: expected.postconditionSchema.postconditionCount,
        actual: current.postconditionSchema.postconditionCount,
      },
    });
  }

  const addedPostconditions = current.postconditionSchema.postconditionIds.filter(
    id => !expected.postconditionSchema.postconditionIds.includes(id)
  );
  const removedPostconditions = expected.postconditionSchema.postconditionIds.filter(
    id => !current.postconditionSchema.postconditionIds.includes(id)
  );

  if (addedPostconditions.length > 0) {
    errors.push({
      code: 'POSTCONDITIONS_ADDED',
      message: `Postconditions added without version increment: ${addedPostconditions.join(', ')}`,
      severity: 'error',
      detail: { addedPostconditions },
    });
  }

  if (removedPostconditions.length > 0) {
    errors.push({
      code: 'POSTCONDITIONS_REMOVED',
      message: `Postconditions removed without version increment: ${removedPostconditions.join(', ')}`,
      severity: 'fatal',
      detail: { removedPostconditions },
    });
  }

  // Check for severity changes
  for (const id of current.postconditionSchema.postconditionIds) {
    if (expected.postconditionSchema.severities[id] &&
        current.postconditionSchema.severities[id] !== expected.postconditionSchema.severities[id]) {
      errors.push({
        code: 'POSTCONDITION_SEVERITY_CHANGED',
        message: `Postcondition ${id} severity changed without version increment`,
        severity: 'fatal',
        detail: {
          postconditionId: id,
          expected: expected.postconditionSchema.severities[id],
          actual: current.postconditionSchema.severities[id],
        },
      });
    }
  }

  // Decision schema hash
  if (current.decisionSchemaHash !== expected.decisionSchemaHash) {
    errors.push({
      code: 'DECISION_SCHEMA_CHANGED',
      message: 'Decision record schema changed without version increment',
      severity: 'fatal',
      detail: {
        expected: expected.decisionSchemaHash,
        actual: current.decisionSchemaHash,
      },
    });
  }

  return errors;
}

export function validateContract(): ContractValidationResult {
  const currentContract = buildExecutionContract();
  const expectedContract = getActiveContract();

  const errors = compareContracts(currentContract, expectedContract);
  const warnings: string[] = [];

  // Hash comparison as final verification
  const hashMatch = currentContract.contractHash === expectedContract.contractHash;

  if (!hashMatch && errors.length === 0) {
    errors.push({
      code: 'CONTRACT_HASH_MISMATCH',
      message: 'Contract hash mismatch with no detected schema changes (possible hash collision or logic error)',
      severity: 'fatal',
      detail: {
        expected: expectedContract.contractHash,
        actual: currentContract.contractHash,
      },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    currentHash: currentContract.contractHash,
    expectedHash: expectedContract.contractHash,
  };
}

export function enforceContract(): void {
  const result = validateContract();

  if (!result.valid) {
    const fatalErrors = result.errors.filter(e => e.severity === 'fatal');
    
    logger.error('contract_mismatch_detected', 'Execution contract validation failed', {
      errors: result.errors,
      currentHash: result.currentHash,
      expectedHash: result.expectedHash,
      version: CURRENT_CONTRACT_VERSION,
    });

    throw new ContractMismatchError(fatalErrors, result.currentHash, result.expectedHash);
  }

  logger.info('contract_validation', 'Execution contract validated successfully', {
    version: CURRENT_CONTRACT_VERSION,
    contractHash: result.expectedHash,
  });
}