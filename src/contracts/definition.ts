import crypto from 'crypto';
import { CURRENT_CONTRACT_VERSION } from './version.js';
import { getAllStates, getTerminalStates } from '../pipeline/state/states.js';
import { getAllInvariants } from '../invariants/registry.js';
import { getAllPostconditions } from '../postconditions/registry.js';
import type { ExecutionContract } from './types.js';

function generateDeterministicHash(data: any): string {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

function generateDecisionSchemaHash(): string {
  const schemaDefinition = {
    fields: [
      'reviewId',
      'timestamp',
      'pr',
      'path',
      'aiInvoked',
      'aiBlocked',
      'fallbackUsed',
      'preCheckSummary',
      'verdict',
      'commentPosted',
      'processingTimeMs',
      'instanceMode',
      'faultsInjected',
      'invariantViolations',
      'stateHistory',
      'postconditions',
      'formallyValid',
      'contractVersion',
      'contractValid',
    ],
    version: CURRENT_CONTRACT_VERSION,
  };
  return generateDeterministicHash(schemaDefinition);
}

export function buildExecutionContract(): ExecutionContract {
  const allStates = getAllStates();
  const terminalStates = getTerminalStates();
  const allInvariants = getAllInvariants();
  const allPostconditions = getAllPostconditions();

  const fsmSchema = {
    states: allStates,
    terminalStates,
    stateCount: allStates.length,
  };

  const invariantSchema = {
    invariantIds: allInvariants.map(i => i.id),
    invariantCount: allInvariants.length,
    severities: Object.fromEntries(allInvariants.map(i => [i.id, i.severity])),
  };

  const postconditionSchema = {
    postconditionIds: allPostconditions.map(p => p.id),
    postconditionCount: allPostconditions.length,
    severities: Object.fromEntries(allPostconditions.map(p => [p.id, p.severity])),
  };

  const decisionSchemaHash = generateDecisionSchemaHash();

  const contractData = {
    version: CURRENT_CONTRACT_VERSION,
    fsmSchema,
    invariantSchema,
    postconditionSchema,
    decisionSchemaHash,
  };

  const contractHash = generateDeterministicHash(contractData);

  return {
    ...contractData,
    contractHash,
    createdAt: new Date().toISOString(),
    immutable: true,
  };
}