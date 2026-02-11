import type { PipelineState } from '../pipeline/state/states.js';
import type { InvariantID } from '../invariants/types.js';
import type { PostconditionID } from '../postconditions/types.js';

export interface ExecutionContract {
  version: string;
  fsmSchema: {
    states: PipelineState[];
    terminalStates: PipelineState[];
    stateCount: number;
  };
  invariantSchema: {
    invariantIds: InvariantID[];
    invariantCount: number;
    severities: Record<InvariantID, string>;
  };
  postconditionSchema: {
    postconditionIds: PostconditionID[];
    postconditionCount: number;
    severities: Record<PostconditionID, string>;
  };
  decisionSchemaHash: string;
  contractHash: string;
  createdAt: string;
  immutable: boolean;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
  warnings: string[];
  currentHash: string;
  expectedHash: string;
}

export interface ContractValidationError {
  code: string;
  message: string;
  severity: 'fatal' | 'error' | 'warn';
  detail: any;
}

export class ContractMismatchError extends Error {
  constructor(
    public readonly errors: ContractValidationError[],
    public readonly currentHash: string,
    public readonly expectedHash: string
  ) {
    super(`Contract mismatch detected: ${errors.map(e => e.code).join(', ')}`);
    this.name = 'ContractMismatchError';
  }
}