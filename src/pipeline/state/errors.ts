import { PipelineState } from './states.js';
import type { StateTransition } from './transitions.js';

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: PipelineState,
    public readonly to: PipelineState,
    public readonly reason: string
  ) {
    super(`Illegal state transition: ${from} → ${to}: ${reason}`);
    this.name = 'IllegalStateTransitionError';
  }
}

export class TerminalStateViolationError extends Error {
  constructor(
    public readonly state: PipelineState,
    public readonly attemptedTransition: PipelineState
  ) {
    super(`Cannot transition from terminal state ${state} to ${attemptedTransition}`);
    this.name = 'TerminalStateViolationError';
  }
}

export class StateSkipError extends Error {
  constructor(
    public readonly expectedStates: PipelineState[],
    public readonly actualState: PipelineState
  ) {
    super(`State skipped. Expected one of: ${expectedStates.join(', ')}, but in state: ${actualState}`);
    this.name = 'StateSkipError';
  }
}